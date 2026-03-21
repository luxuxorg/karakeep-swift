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
