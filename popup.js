// popup.js
import { getSettings, saveSettings, getCache, searchTags, apiFetch, normalizeUrl,
         saveSessionApiKey } from './utils.js';

// ─── State ────────────────────────────────────────────────────────────────────
let currentUrl            = '';
let currentTitle          = '';
let selectedTags          = []; // [{ id, name }]
let cache                 = { tags: [], lists: [], trie: null, invertedIndex: {}, bookmarkedIndex: {} };
let activeSuggestionIndex = -1;
let alreadySavedId        = null; // bookmark ID if URL is already in cache

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const unconfigured       = document.getElementById('unconfigured');
const openOptionsBtn     = document.getElementById('openOptionsBtn');
// Auth panel
const authPanel          = document.getElementById('authPanel');
const openLibraryBtnAuth = document.getElementById('openLibraryBtnAuth');
const gearBtnAuth        = document.getElementById('gearBtnAuth');
const pmServerUrl        = document.getElementById('pmServerUrl');
const sessionApiKeyInput = document.getElementById('sessionApiKeyInput');
const authError          = document.getElementById('authError');
const useSessionBtn      = document.getElementById('useSessionBtn');
const storePermBtn       = document.getElementById('storePermBtn');
// Main form
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
const openLibraryBtn     = document.getElementById('openLibraryBtn');

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  const settings = await getSettings();

  if (!settings.serverUrl) {
    unconfigured.style.display = '';
    openOptionsBtn?.focus();
    return;
  }

  if (!settings.apiKey) {
    // Server configured but no key available — ask user to supply one
    authPanel.style.display = '';
    openLibraryBtnAuth.href = settings.serverUrl;
    pmServerUrl.value = settings.serverUrl; // helps password managers associate the credential
    sessionApiKeyInput.focus();
    return;
  }

  await showMainForm(settings);
}

async function showMainForm(settings) {
  mainForm.style.display = '';
  openLibraryBtn.href = settings.serverUrl;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentUrl   = tab.url   ?? '';
  currentTitle = tab.title ?? '';
  pageTitleEl.value = currentTitle;

  noteInput.focus();

  // Get selected text on-demand via scripting API (no persistent content script needed)
  chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames: false },
    func: () => window.getSelection().toString(),
  }).then((results) => {
    const text = results?.[0]?.result;
    if (text) noteInput.value = text;
  }).catch(() => {});

  cache = await getCache();
  renderListDropdown(cache.lists);

  const bookmarkId = cache.bookmarkedIndex[normalizeUrl(currentUrl)];
  if (bookmarkId) {
    alreadySavedId = bookmarkId;
    saveBtn.textContent = 'Update bookmark';
    alreadySavedNotice.textContent = 'Already bookmarked — loading details…';
    alreadySavedNotice.classList.add('visible');

    try {
      const data = await apiFetch(`/api/v1/bookmarks/${bookmarkId}`, undefined, settings);
      pageTitleEl.value = data.title || currentTitle;
      if (!noteInput.value) noteInput.value = data.note ?? data.description ?? '';
      for (const tag of (data.tags ?? [])) addTag({ id: tag.id, name: tag.name });
      const listId = data.listId ?? (data.lists ?? [])[0]?.id ?? null;
      if (listId) listSelect.value = listId;
      alreadySavedNotice.textContent = 'Already bookmarked — editing will update it.';
    } catch {
      alreadySavedNotice.textContent = 'Already bookmarked — could not load details.';
    }
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
gearBtnAuth.addEventListener('click', () => chrome.runtime.openOptionsPage());
openOptionsBtn?.addEventListener('click', () => chrome.runtime.openOptionsPage());

// ─── Auth panel ───────────────────────────────────────────────────────────────

function showAuthError(msg) {
  authError.textContent = msg;
}

function clearAuthError() {
  authError.textContent = '';
}

useSessionBtn.addEventListener('click', async () => {
  const key = sessionApiKeyInput.value.trim();
  if (!key) { showAuthError('Please enter an API key.'); return; }
  clearAuthError();
  await saveSessionApiKey(key);
  authPanel.style.display = 'none';
  const settings = await getSettings();
  await showMainForm(settings);
});

document.getElementById('authForm').addEventListener('submit', (e) => e.preventDefault());

storePermBtn.addEventListener('click', async () => {
  const key = sessionApiKeyInput.value.trim();
  if (!key) { showAuthError('Please enter an API key.'); return; }
  clearAuthError();
  storePermBtn.disabled = true;
  const settings = await getSettings();
  await saveSettings({ serverUrl: settings.serverUrl, apiKey: key });
  authPanel.style.display = 'none';
  await showMainForm({ ...settings, apiKey: key });
  storePermBtn.disabled = false;
});

init();

// ─── Chips ────────────────────────────────────────────────────────────────────

function renderChips() {
  chipsRow.innerHTML = '';
  for (const tag of selectedTags) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.setAttribute('role', 'option');
    chip.setAttribute('aria-selected', 'true');
    chip.setAttribute('aria-label', `${tag.name} — press Delete to remove`);
    chip.setAttribute('tabindex', '0');
    chip.dataset.id = tag.id;
    chip.appendChild(document.createTextNode(tag.name));
    const btn = document.createElement('button');
    btn.className = 'chip-remove';
    btn.dataset.id = tag.id;
    btn.setAttribute('aria-label', `Remove tag ${tag.name}`);
    btn.setAttribute('tabindex', '-1'); // mouse-only; keyboard uses chip itself
    btn.textContent = '×';
    chip.appendChild(btn);
    chipsRow.appendChild(chip);
  }
}

function removeChipById(id) {
  const idx = selectedTags.findIndex(t => t.id === id);
  if (idx === -1) return;
  selectedTags.splice(idx, 1);
  renderChips();
  // Keep focus inside the chip row if chips remain, otherwise return to tag input
  const chips = chipsRow.querySelectorAll('.chip');
  if (chips.length > 0) {
    chips[Math.min(idx, chips.length - 1)].focus();
  } else {
    tagInput.focus();
  }
}

chipsRow.addEventListener('click', (e) => {
  if (e.target.classList.contains('chip-remove')) {
    removeChipById(e.target.dataset.id);
  }
});

chipsRow.addEventListener('keydown', (e) => {
  if (!e.target.classList.contains('chip')) return;
  if (e.key === 'Delete' || e.key === 'Backspace' || e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    removeChipById(e.target.dataset.id);
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
  if (e.key === 'Enter' && open) {
    e.preventDefault();
    acceptActiveSuggestion();
    return;
  }
  if (e.key === ',') {
    e.preventDefault();
    if (open) {
      acceptActiveSuggestion(); // pick first proposed tag
    } else if (tagInput.value.trim()) {
      addRawTag(tagInput.value);
      tagInput.value = '';
    }
    return;
  }
  if (e.key === 'Enter' && !open) {
    e.preventDefault();
    if (tagInput.value.trim()) {
      addRawTag(tagInput.value);
      tagInput.value = '';
    }
    // Empty input + no dropdown → do nothing
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

// ─── Keyboard summary ─────────────────────────────────────────────────────────
// Save fires ONLY when the save button receives Enter/Space (native browser behaviour).
// Tag input: Enter/comma → add tag; Tab → browser navigation (not intercepted).
// No global document Enter handler.
