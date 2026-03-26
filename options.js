// options.js
import { getSettings, saveSettings, apiFetch, isAllowedOrigin,
         serverOriginPattern, hasServerPermission, requestServerPermission,
         hasPermanentApiKey, clearPermanentApiKey } from './utils.js';

const serverUrlInput = document.getElementById('serverUrl');
const apiKeyInput    = document.getElementById('apiKey');
const saveBtn        = document.getElementById('saveBtn');
const testBtn        = document.getElementById('testBtn');
const statusMsg      = document.getElementById('statusMsg');
const forgetKeyBtn   = document.getElementById('forgetKeyBtn');

function showStatus(text, type) {
  statusMsg.textContent = text;
  statusMsg.className = `status-msg ${type}`;
}

// Prefill from storage on load
getSettings().then(({ serverUrl, apiKey }) => {
  serverUrlInput.value = serverUrl;
  apiKeyInput.value    = apiKey;
});

hasPermanentApiKey().then(has => {
  if (has) forgetKeyBtn.style.display = '';
});

forgetKeyBtn.addEventListener('click', async () => {
  await clearPermanentApiKey();
  forgetKeyBtn.style.display = 'none';
  apiKeyInput.value = '';
  showStatus('API key removed', 'success');
  setTimeout(() => showStatus('', ''), 2000);
});

saveBtn.addEventListener('click', async () => {
  const serverUrl = serverUrlInput.value.trim();
  const apiKey    = apiKeyInput.value.trim();

  if (!serverUrl) {
    showStatus('✗ Server URL is required', 'error');
    return;
  }
  if (!isAllowedOrigin(serverUrl)) {
    showStatus('✗ Server URL must use HTTPS (or http://localhost / http://127.0.0.1 for local dev)', 'error');
    return;
  }

  // Revoke permission for the previous origin if the URL has changed
  const { serverUrl: prevUrl } = await getSettings();
  const prevPattern = prevUrl ? serverOriginPattern(prevUrl) : null;
  const newPattern  = serverOriginPattern(serverUrl);
  if (prevPattern && prevPattern !== newPattern) {
    await chrome.permissions.remove({ origins: [prevPattern] }).catch(() => {});
  }

  // Request host permission for the new origin if not already held
  if (newPattern && !await hasServerPermission(serverUrl)) {
    showStatus('Requesting access to this server…', '');
  }
  const { granted } = await requestServerPermission(serverUrl);
  if (!granted) {
    showStatus('✗ Permission denied — click Allow when prompted to grant access to this server.', 'error');
    return;
  }

  await saveSettings({ serverUrl, apiKey });
  chrome.runtime.sendMessage({ action: 'refreshCache' });
  showStatus('Saved ✓', 'success');
  setTimeout(() => showStatus('', ''), 2000);
});

testBtn.addEventListener('click', async () => {
  const serverUrl = serverUrlInput.value.trim();
  const apiKey    = apiKeyInput.value.trim();

  if (!isAllowedOrigin(serverUrl)) {
    showStatus('✗ Server URL must use HTTPS (or http://localhost / http://127.0.0.1)', 'error');
    return;
  }

  testBtn.disabled = true;

  // Ensure permission before testing — may trigger the Chrome dialog
  const { granted } = await requestServerPermission(serverUrl);
  if (!granted) {
    showStatus('✗ Permission denied — cannot test without browser access to this server.', 'error');
    testBtn.disabled = false;
    return;
  }

  showStatus('Testing…', '');
  try {
    await apiFetch('/api/v1/tags', undefined, { serverUrl, apiKey });
    showStatus('✓ Connected', 'success');
  } catch (err) {
    showStatus(`✗ ${err.message}`, 'error');
  } finally {
    testBtn.disabled = false;
  }
});
