// content.js — declared content script, no imports
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'getSelection') {
    sendResponse({ selection: window.getSelection().toString() });
  }
});
