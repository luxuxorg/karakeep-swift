// background.js
import { apiFetch, buildInvertedIndex, Trie, getCache } from './utils.js';

const STORAGE = {
  TAGS:          'tags',
  LISTS:         'lists',
  TAG_TRIE:      'tagTrie',
  TAG_INDEX:     'tagInvertedIndex',
  BOOKMARKED:    'bookmarkedUrls',
  LAST_TAGS:     'lastUsedTags',
};

// ─── Cache Refresh ────────────────────────────────────────────────────────────

async function fetchAllBookmarkUrls() {
  const urls = [];
  let cursor = null;
  while (true) {
    const path = cursor
      ? `/api/v1/bookmarks?limit=100&cursor=${encodeURIComponent(cursor)}`
      : '/api/v1/bookmarks?limit=100';
    const data = await apiFetch(path);
    const items = data.bookmarks ?? data.items ?? data ?? [];
    for (const b of items) {
      if (b.url) urls.push(b.url);
    }
    // Stop if no next cursor or empty page
    cursor = data.nextCursor ?? data.cursor ?? null;
    if (!cursor || items.length === 0) break;
  }
  return urls;
}

async function refreshCache() {
  try {
    const [tagsData, listsData, bookmarkUrls] = await Promise.all([
      apiFetch('/api/v1/tags'),
      apiFetch('/api/v1/lists'),
      fetchAllBookmarkUrls(),
    ]);

    const tags  = tagsData.tags  ?? tagsData  ?? [];
    const lists = listsData.lists ?? listsData ?? [];

    const trie = new Trie();
    for (const tag of tags) trie.insert(tag.name, tag.id);
    const invertedIndex = buildInvertedIndex(tags);

    await chrome.storage.local.set({
      [STORAGE.TAGS]:       tags,
      [STORAGE.LISTS]:      lists,
      [STORAGE.TAG_TRIE]:   trie.serialize(),
      [STORAGE.TAG_INDEX]:  invertedIndex,
      [STORAGE.BOOKMARKED]: bookmarkUrls,
    });
  } catch (err) {
    // Settings not yet configured or network error — fail silently
    console.warn('[Karakeep] Cache refresh failed:', err.message);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('refreshCache', { periodInMinutes: 10 });
  refreshCache();
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
  const result = await chrome.storage.local.get(STORAGE.BOOKMARKED);
  const bookmarkedUrls = result[STORAGE.BOOKMARKED] ?? [];
  if (bookmarkedUrls.includes(url)) {
    chrome.action.setBadgeText({ text: '', tabId });
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

// ─── Create Bookmark ──────────────────────────────────────────────────────────

async function createBookmark(url, title, description, tagIds, listId) {
  const data = await apiFetch('/api/v1/bookmarks', {
    method: 'POST',
    body: JSON.stringify({ url, title, description, tagIds, listId }),
  });

  // Update bookmarkedUrls cache
  const result = await chrome.storage.local.get(STORAGE.BOOKMARKED);
  const urls = result[STORAGE.BOOKMARKED] ?? [];
  if (!urls.includes(url)) urls.push(url);
  await chrome.storage.local.set({
    [STORAGE.BOOKMARKED]: urls,
    [STORAGE.LAST_TAGS]:  tagIds ?? [],
  });

  // Refresh badge for any tab showing this URL
  // Note: chrome.tabs.query requires a match pattern, not a raw URL.
  // Query all tabs and filter by exact URL instead.
  const allTabs = await chrome.tabs.query({});
  for (const tab of allTabs) {
    if (tab.url === url) updateBadge(tab.id, tab.url);
  }

  return data;
}

// ─── Message Router ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'createBookmark') {
    const { url, title, description, tagIds, listId } = msg.payload;
    createBookmark(url, title, description, tagIds, listId)
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true; // keep channel open for async response
  }

  if (msg.action === 'refreshCache') {
    refreshCache().then(() => sendResponse({ ok: true }));
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
