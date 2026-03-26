// background.js
import { apiFetch, buildInvertedIndex, Trie, normalizeUrl } from './utils.js';

const STORAGE = {
  TAGS:               'tags',
  LISTS:              'lists',
  TAG_TRIE:           'tagTrie',
  TAG_INDEX:          'tagInvertedIndex',
  // Minimal index: { [normalizedUrl]: bookmarkId } — no full content stored locally
  BOOKMARKED_INDEX:   'bookmarkedIndex',
  LAST_TAGS:          'lastUsedTags',
  LAST_BOOKMARK_SYNC: 'lastBookmarkSync',
};

// Skip the expensive full-crawl if a sync already happened within this window.
const BOOKMARK_SYNC_TTL = 4 * 60 * 60 * 1000; // 4 hours

// ─── Cache Refresh ────────────────────────────────────────────────────────────

async function fetchAllBookmarks() {
  const index = {};
  let cursor = null;
  while (true) {
    const path = cursor
      ? `/api/v1/bookmarks?limit=100&cursor=${encodeURIComponent(cursor)}`
      : '/api/v1/bookmarks?limit=100';
    const data = await apiFetch(path);
    const bookmarks = data.bookmarks ?? data.items ?? data ?? [];
    for (const b of bookmarks) {
      const url = b.url ?? b.content?.url;
      if (url) index[normalizeUrl(url)] = b.id;
    }
    cursor = data.nextCursor ?? data.cursor ?? null;
    if (!cursor || bookmarks.length === 0) break;
  }
  return index;
}

// Refresh tags + lists only (cheap — runs on every alarm tick).
async function refreshCache() {
  try {
    const [tagsData, listsData] = await Promise.all([
      apiFetch('/api/v1/tags'),
      apiFetch('/api/v1/lists'),
    ]);

    const tags  = tagsData.tags  ?? tagsData  ?? [];
    const lists = listsData.lists ?? listsData ?? [];

    const trie = new Trie();
    for (const tag of tags) trie.insert(tag.name, tag.id);
    const invertedIndex = buildInvertedIndex(tags);

    await chrome.storage.local.set({
      [STORAGE.TAGS]:      tags,
      [STORAGE.LISTS]:     lists,
      [STORAGE.TAG_TRIE]:  trie.serialize(),
      [STORAGE.TAG_INDEX]: invertedIndex,
    });
  } catch (err) {
    console.warn('[Karakeep] Cache refresh failed:', err.message);
  }
}

// Full bookmark sync (expensive — skipped if a recent sync exists, unless forced).
async function syncBookmarks({ force = false } = {}) {
  if (!force) {
    const stored = await chrome.storage.local.get(STORAGE.LAST_BOOKMARK_SYNC);
    const lastSync = stored[STORAGE.LAST_BOOKMARK_SYNC] ?? 0;
    if (Date.now() - lastSync < BOOKMARK_SYNC_TTL) return; // still fresh
  }
  try {
    const index = await fetchAllBookmarks();
    await chrome.storage.local.set({
      [STORAGE.BOOKMARKED_INDEX]:   index,
      [STORAGE.LAST_BOOKMARK_SYNC]: Date.now(),
    });
  } catch (err) {
    console.warn('[Karakeep] Bookmark sync failed:', err.message);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('refreshCache', { periodInMinutes: 60 });
  refreshCache();
  syncBookmarks({ force: true }); // always populate on fresh install
});

chrome.runtime.onStartup.addListener(() => {
  syncBookmarks(); // skips if synced within the last 4 hours
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'refreshCache') refreshCache();
});

// ─── Badge ────────────────────────────────────────────────────────────────────

async function updateBadge(tabId, url) {
  if (!url || url.startsWith('chrome://')) {
    chrome.action.setBadgeText({ text: '', tabId });
    return;
  }
  const result = await chrome.storage.local.get(STORAGE.BOOKMARKED_INDEX);
  const index = result[STORAGE.BOOKMARKED_INDEX] ?? {};
  if (index[normalizeUrl(url)]) {
    // A single space renders as a visible colored dot; empty string hides the badge
    chrome.action.setBadgeText({ text: ' ', tabId });
    chrome.action.setBadgeBackgroundColor({ color: '#22c55e', tabId });
  } else {
    chrome.action.setBadgeText({ text: '', tabId });
    chrome.action.setBadgeBackgroundColor({ color: [0, 0, 0, 0], tabId });
  }
}

chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId, (tab) => {
    if (tab?.url) updateBadge(tabId, tab.url);
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab?.url) {
    updateBadge(tabId, tab.url);
  }
});

// ─── Bookmark helpers ─────────────────────────────────────────────────────────

async function updateBadgeForUrl(url) {
  const allTabs = await chrome.tabs.query({});
  for (const tab of allTabs) {
    if (tab.url === url) updateBadge(tab.id, tab.url);
  }
}

// ─── Create Bookmark ──────────────────────────────────────────────────────────

async function createBookmark(url, title, description, tagIds, listId) {
  const data = await apiFetch('/api/v1/bookmarks', {
    method: 'POST',
    body: JSON.stringify({ type: 'link', url, title, description, tagIds, listId }),
  });

  const result = await chrome.storage.local.get(STORAGE.BOOKMARKED_INDEX);
  const index = result[STORAGE.BOOKMARKED_INDEX] ?? {};
  index[normalizeUrl(url)] = data.id;
  await chrome.storage.local.set({
    [STORAGE.BOOKMARKED_INDEX]: index,
    [STORAGE.LAST_TAGS]:        tagIds ?? [],
  });

  await updateBadgeForUrl(url);
  return data;
}

// ─── Update Bookmark ──────────────────────────────────────────────────────────

async function updateBookmark(id, url, title, description, tagIds, listId) {
  const data = await apiFetch(`/api/v1/bookmarks/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ title, description, tagIds, listId }),
  });

  const result = await chrome.storage.local.get(STORAGE.BOOKMARKED_INDEX);
  const index = result[STORAGE.BOOKMARKED_INDEX] ?? {};
  index[normalizeUrl(url)] = id;
  await chrome.storage.local.set({
    [STORAGE.BOOKMARKED_INDEX]: index,
    [STORAGE.LAST_TAGS]:        tagIds ?? [],
  });

  await updateBadgeForUrl(url);
  return data;
}

// ─── Message Router ───────────────────────────────────────────────────────────

const MAX_URL_LEN    = 2048;
const MAX_STR_LEN    = 10000;
const MAX_TAGS       = 50;
const MAX_ID_LEN     = 200;
const ALLOWED_ACTIONS = new Set(['createBookmark', 'updateBookmark', 'refreshCache']);

function validatePayload(p) {
  if (!p || typeof p !== 'object') return 'missing payload';
  if (typeof p.url !== 'string' || p.url.length > MAX_URL_LEN) return 'invalid url';
  try { new URL(p.url); } catch { return 'invalid url format'; }
  if (typeof p.title !== 'string' || p.title.length > MAX_STR_LEN) return 'invalid title';
  if (typeof p.description !== 'string' || p.description.length > MAX_STR_LEN) return 'invalid description';
  if (!Array.isArray(p.tagIds) || p.tagIds.length > MAX_TAGS) return 'invalid tagIds';
  if (!p.tagIds.every(t => typeof t === 'string' && t.length <= MAX_ID_LEN)) return 'invalid tag entry';
  if (p.listId != null && typeof p.listId !== 'string') return 'invalid listId';
  return null;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Reject messages from outside this extension
  if (!sender || sender.id !== chrome.runtime.id) {
    sendResponse({ ok: false, error: 'unauthorized' });
    return false;
  }

  if (!msg || typeof msg.action !== 'string' || !ALLOWED_ACTIONS.has(msg.action)) {
    sendResponse({ ok: false, error: 'unknown action' });
    return false;
  }

  if (msg.action === 'createBookmark') {
    const err = validatePayload(msg.payload);
    if (err) { sendResponse({ ok: false, error: err }); return false; }
    const { url, title, description, tagIds, listId } = msg.payload;
    createBookmark(url, title, description, tagIds, listId)
      .then(data => sendResponse({ ok: true, id: data.id }))
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (msg.action === 'updateBookmark') {
    if (!msg.payload?.id || typeof msg.payload.id !== 'string' || msg.payload.id.length > MAX_ID_LEN) {
      sendResponse({ ok: false, error: 'invalid id' }); return false;
    }
    const err = validatePayload(msg.payload);
    if (err) { sendResponse({ ok: false, error: err }); return false; }
    const { id, url, title, description, tagIds, listId } = msg.payload;
    updateBookmark(id, url, title, description, tagIds, listId)
      .then(() => sendResponse({ ok: true }))
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (msg.action === 'refreshCache') {
    Promise.all([refreshCache(), syncBookmarks({ force: true })])
      .then(() => sendResponse({ ok: true }));
    return true;
  }
});

// ─── Silent Save (Ctrl+Shift+S) ───────────────────────────────────────────────

chrome.commands.onCommand.addListener((command) => {
  if (command !== 'silent-save') return;
  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    const tab = tabs[0];
    if (!tab?.url) return;
    const result = await chrome.storage.local.get(STORAGE.LAST_TAGS);
    const lastUsedTags = result[STORAGE.LAST_TAGS] ?? [];
    createBookmark(tab.url, tab.title ?? '', '', lastUsedTags, null)
      .catch(() => {}); // silently swallow errors
  });
});
