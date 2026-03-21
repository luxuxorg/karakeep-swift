// popup.js
import { getSettings, getCache, searchTags } from './utils.js';

// ─── State ────────────────────────────────────────────────────────────────────
let currentUrl            = '';
let currentTitle          = '';
let selectedTags          = []; // [{ id, name }]
let cache                 = { tags: [], lists: [], trie: null, invertedIndex: {} };
let activeSuggestionIndex = -1;
let alreadySavedId        = null; // bookmark ID if URL is already in cache

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const unconfigured       = document.getElementById('unconfigured');
const mainForm           = document.getElementById('mainForm');
const pageTitleEl        = document.getElementById('pageTitle');
const alreadySavedNotice = document.getElementById('alreadySavedNotice');
const listSelect         = document.getElementById('listSelect');
const noteInput          = document.getElementById('noteInput');
const tagInput           = document.getElementById('tagInput');
const chipsRow           = document.getElementById('chipsRow');
const suggestions        = document.getElementById('suggestions');
const saveBtn            = document.getElementById('saveBtn');
const errorBanner        = document.getElementById('errorBanner');
const gearBtn            = document.getElementById('gearBtn');
const openOptionsBtn     = document.getElementById('openOptionsBtn');

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  const settings = await getSettings();

  if (!settings.serverUrl || !settings.apiKey) {
    unconfigured.style.display = '';
    openOptionsBtn?.focus();
    return;
  }

  mainForm.style.display = '';

  // Instant: get tab info
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentUrl   = tab.url   ?? '';
  currentTitle = tab.title ?? '';
  pageTitleEl.value = currentTitle;

  noteInput.focus();

  // Try to get selected text from content script (non-blocking)
  // lastError must be consumed to suppress console warning on restricted pages
  chrome.tabs.sendMessage(tab.id, { action: 'getSelection' }, (resp) => {
    if (chrome.runtime.lastError) return;
    if (resp?.selection) noteInput.value = resp.selection;
  });

  // Load cache
  cache = await getCache();
  renderListDropdown(cache.lists);

  // Prefill from stored bookmark if URL is already saved
  const stored = cache.bookmarkedItems[currentUrl];
  if (stored) {
    alreadySavedId = stored.id;

    // Prefill fields from stored data
    pageTitleEl.value = stored.title || currentTitle;
    // Only overwrite note if not already prefilled by getSelection
    if (!noteInput.value) noteInput.value = stored.description || '';

    // Prefill tags: look up full tag objects from cache
    for (const id of (stored.tagIds ?? [])) {
      const tag = cache.tags.find(t => t.id === id) ?? { id, name: id };
      addTag(tag);
    }

    // Set list selection
    if (stored.listId) listSelect.value = stored.listId;

    // Show notice and update button
    alreadySavedNotice.textContent = 'Already bookmarked — editing will update it.';
    alreadySavedNotice.classList.add('visible');
    saveBtn.textContent = 'Update bookmark';
  }
}

function renderListDropdown(lists) {
  listSelect.innerHTML = '<option value="">No list</option>';
  for (const list of lists) {
    const opt = document.createElement('option');
    opt.value = list.id;
    opt.textContent = list.name;
    listSelect.appendChild(opt);
  }
}

gearBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());
openOptionsBtn?.addEventListener('click', () => chrome.runtime.openOptionsPage());

init();

// ─── Chips ────────────────────────────────────────────────────────────────────

function renderChips() {
  chipsRow.innerHTML = '';
  for (const tag of selectedTags) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.setAttribute('role', 'listitem');
    chip.appendChild(document.createTextNode(tag.name));
    const btn = document.createElement('button');
    btn.className = 'chip-remove';
    btn.dataset.id = tag.id;
    btn.setAttribute('aria-label', `Remove tag ${tag.name}`);
    btn.textContent = '×';
    chip.appendChild(btn);
    chipsRow.appendChild(chip);
  }
}

chipsRow.addEventListener('click', (e) => {
  if (e.target.classList.contains('chip-remove')) {
    const id = e.target.dataset.id;
    selectedTags = selectedTags.filter(t => t.id !== id);
    renderChips();
  }
});

function addTag(tag) {
  if (!tag || selectedTags.some(t => t.id === tag.id)) return;
  selectedTags.push(tag);
  renderChips();
}

function addRawTag(name) {
  const trimmed = name.trim();
  if (!trimmed) return;
  // Use name as both id and label for raw (not-yet-created) tags.
  // The Karakeep API accepts tag names in the tagIds field to create-or-reuse tags by name.
  addTag({ id: trimmed, name: trimmed });
}

// ─── Suggestions ──────────────────────────────────────────────────────────────

function renderSuggestions(results) {
  activeSuggestionIndex = -1;
  suggestions.innerHTML = '';
  if (!results.length) {
    suggestions.classList.remove('open');
    tagInput.setAttribute('aria-expanded', 'false');
    tagInput.removeAttribute('aria-activedescendant');
    return;
  }
  results.forEach((tag, i) => {
    const item = document.createElement('div');
    item.className = 'suggestion-item';
    item.id = `suggestion-${i}`;
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', 'false');
    item.textContent = tag.name;
    item.dataset.id   = tag.id;
    item.dataset.name = tag.name;
    item.addEventListener('mousedown', (e) => {
      e.preventDefault(); // prevent blur before click registers
      acceptSuggestion(tag);
    });
    suggestions.appendChild(item);
  });
  suggestions.classList.add('open');
  tagInput.setAttribute('aria-expanded', 'true');
}

function updateActiveSuggestion() {
  suggestions.querySelectorAll('[role="option"]').forEach((item, i) => {
    const active = i === activeSuggestionIndex;
    item.classList.toggle('active', active);
    item.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  if (activeSuggestionIndex >= 0) {
    tagInput.setAttribute('aria-activedescendant', `suggestion-${activeSuggestionIndex}`);
  } else {
    tagInput.removeAttribute('aria-activedescendant');
  }
}

function closeSuggestions() {
  activeSuggestionIndex = -1;
  suggestions.classList.remove('open');
  suggestions.innerHTML = '';
  tagInput.setAttribute('aria-expanded', 'false');
  tagInput.removeAttribute('aria-activedescendant');
}

function acceptSuggestion(tag) {
  addTag(tag);
  tagInput.value = '';
  activeSuggestionIndex = -1;
  closeSuggestions();
  tagInput.focus();
}

function acceptActiveSuggestion() {
  const items = suggestions.querySelectorAll('[role="option"]');
  if (!items.length) return;
  const target = activeSuggestionIndex >= 0 ? items[activeSuggestionIndex] : items[0];
  if (target) acceptSuggestion({ id: target.dataset.id, name: target.dataset.name });
}

tagInput.addEventListener('input', () => {
  const q = tagInput.value.trim();
  if (!q || !cache.trie) { closeSuggestions(); return; }
  const results = searchTags(q, cache.trie, cache.invertedIndex, cache.tags);
  renderSuggestions(results);
});

tagInput.addEventListener('keydown', (e) => {
  const open = suggestions.classList.contains('open');

  if (e.key === 'ArrowDown' && open) {
    e.preventDefault();
    const count = suggestions.querySelectorAll('[role="option"]').length;
    activeSuggestionIndex = Math.min(activeSuggestionIndex + 1, count - 1);
    updateActiveSuggestion();
    return;
  }
  if (e.key === 'ArrowUp' && open) {
    e.preventDefault();
    activeSuggestionIndex = Math.max(activeSuggestionIndex - 1, -1);
    updateActiveSuggestion();
    return;
  }
  if (e.key === 'Tab' || (e.key === 'Enter' && open)) {
    e.preventDefault();
    acceptActiveSuggestion();
    return;
  }
  if (e.key === 'Enter' && !open) {
    e.preventDefault();
    if (tagInput.value.trim()) {
      addRawTag(tagInput.value);
      tagInput.value = '';
    } else {
      // Empty tag input + Enter + dropdown closed → save
      saveBtn.click();
    }
    return;
  }
  if (e.key === 'Backspace' && !tagInput.value) {
    selectedTags.pop();
    renderChips();
  }
});

tagInput.addEventListener('blur', () => {
  // Delay so mousedown on suggestion fires first
  setTimeout(closeSuggestions, 150);
});

// ─── Save ─────────────────────────────────────────────────────────────────────

function showError(msg) {
  errorBanner.textContent = msg;
  errorBanner.classList.add('visible');
}

function hideError() {
  errorBanner.classList.remove('visible');
  errorBanner.textContent = '';
}

saveBtn.addEventListener('click', () => {
  hideError();

  // Optimistic UI
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saved!';

  const payload = {
    url:         currentUrl,
    title:       pageTitleEl.value.trim() || currentTitle,
    description: noteInput.value.trim(),
    tagIds:      selectedTags.map(t => t.id),
    listId:      listSelect.value || null,
  };

  const message = alreadySavedId
    ? { action: 'updateBookmark', payload: { id: alreadySavedId, ...payload } }
    : { action: 'createBookmark', payload };

  chrome.runtime.sendMessage(message, (resp) => {
    if (chrome.runtime.lastError) {
      showError('Extension error — please reload the popup.');
      saveBtn.disabled = false;
      saveBtn.textContent = alreadySavedId ? 'Update bookmark' : 'Save';
      return;
    }
    if (resp?.ok) {
      setTimeout(() => window.close(), 800);
    } else {
      showError(resp?.error ?? 'Could not save — please try again.');
      saveBtn.disabled = false;
      saveBtn.textContent = alreadySavedId ? 'Update bookmark' : 'Save';
    }
  });
});

// ─── Global keyboard: Enter on save button fires natively via browser.
// Only extra case: Enter in tag input when empty + no dropdown open.
// (Handled inside tagInput keydown above.)
// No global document Enter handler — prevents accidental saves from title/list.
