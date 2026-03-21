// popup.js
import { getSettings, getCache, searchTags } from './utils.js';

// ─── State ────────────────────────────────────────────────────────────────────
let currentUrl   = '';
let currentTitle = '';
let selectedTags = []; // [{ id, name }]
let cache        = { tags: [], lists: [], trie: null, invertedIndex: {} };

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const unconfigured   = document.getElementById('unconfigured');
const mainForm       = document.getElementById('mainForm');
const pageTitleEl    = document.getElementById('pageTitle');
const listSelect     = document.getElementById('listSelect');
const noteInput      = document.getElementById('noteInput');
const tagInput       = document.getElementById('tagInput');
const chipsRow       = document.getElementById('chipsRow');
const suggestions    = document.getElementById('suggestions');
const saveBtn        = document.getElementById('saveBtn');
const errorBanner    = document.getElementById('errorBanner');
const gearBtn        = document.getElementById('gearBtn');
const openOptionsBtn = document.getElementById('openOptionsBtn');

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  const settings = await getSettings();

  if (!settings.serverUrl || !settings.apiKey) {
    unconfigured.style.display = '';
    return;
  }

  mainForm.style.display = '';

  // Instant: get tab info immediately
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentUrl   = tab.url   ?? '';
  currentTitle = tab.title ?? '';
  pageTitleEl.textContent = currentTitle;

  // Try to get selected text from content script (non-blocking)
  chrome.tabs.sendMessage(tab.id, { action: 'getSelection' }, (resp) => {
    if (resp?.selection) noteInput.value = resp.selection;
  });

  // Load cache for list dropdown and tag search
  cache = await getCache();
  renderListDropdown(cache.lists);
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
    chip.appendChild(document.createTextNode(tag.name));
    const btn = document.createElement('button');
    btn.className = 'chip-remove';
    btn.dataset.id = tag.id;
    btn.setAttribute('aria-label', `Remove ${tag.name}`);
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
  // Use name as both id and label for raw (not-yet-created) tags
  addTag({ id: trimmed, name: trimmed });
}

// ─── Suggestions ──────────────────────────────────────────────────────────────

function renderSuggestions(results) {
  suggestions.innerHTML = '';
  if (!results.length) {
    suggestions.classList.remove('open');
    return;
  }
  for (const tag of results) {
    const item = document.createElement('div');
    item.className = 'suggestion-item';
    item.textContent = tag.name;
    item.dataset.id   = tag.id;
    item.dataset.name = tag.name;
    item.addEventListener('mousedown', (e) => {
      e.preventDefault(); // prevent blur before click registers
      acceptTopSuggestion(tag);
    });
    suggestions.appendChild(item);
  }
  suggestions.classList.add('open');
}

function closeSuggestions() {
  suggestions.classList.remove('open');
  suggestions.innerHTML = '';
}

function acceptTopSuggestion(tag) {
  if (!tag) {
    // fallback: take first item in suggestions
    const first = suggestions.querySelector('.suggestion-item');
    if (!first) return;
    tag = { id: first.dataset.id, name: first.dataset.name };
  }
  addTag(tag);
  tagInput.value = '';
  closeSuggestions();
  tagInput.focus();
}

tagInput.addEventListener('input', () => {
  const q = tagInput.value.trim();
  if (!q || !cache.trie) { closeSuggestions(); return; }
  const results = searchTags(q, cache.trie, cache.invertedIndex, cache.tags);
  renderSuggestions(results);
});

tagInput.addEventListener('keydown', (e) => {
  if (e.key === 'Tab' || (e.key === 'Enter' && suggestions.classList.contains('open'))) {
    e.preventDefault();
    const first = suggestions.querySelector('.suggestion-item');
    if (first) {
      acceptTopSuggestion({ id: first.dataset.id, name: first.dataset.name });
    }
    return;
  }
  if (e.key === 'Enter' && !suggestions.classList.contains('open')) {
    e.preventDefault();
    addRawTag(tagInput.value);
    tagInput.value = '';
    closeSuggestions();
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
