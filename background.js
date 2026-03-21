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
