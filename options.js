// options.js
import { getSettings, saveSettings, apiFetch } from './utils.js';

const serverUrlInput = document.getElementById('serverUrl');
const apiKeyInput    = document.getElementById('apiKey');
const saveBtn        = document.getElementById('saveBtn');
const testBtn        = document.getElementById('testBtn');
const statusMsg      = document.getElementById('statusMsg');

function showStatus(text, type) {
  statusMsg.textContent = text;
  statusMsg.className = `status-msg ${type}`;
}

// Prefill from storage on load
getSettings().then(({ serverUrl, apiKey }) => {
  serverUrlInput.value = serverUrl;
  apiKeyInput.value    = apiKey;
});

saveBtn.addEventListener('click', async () => {
  const serverUrl = serverUrlInput.value.trim();
  const apiKey    = apiKeyInput.value.trim();
  await saveSettings({ serverUrl, apiKey });
  chrome.runtime.sendMessage({ action: 'refreshCache' });
  showStatus('Saved', 'success');
  setTimeout(() => showStatus('', ''), 2000);
});

testBtn.addEventListener('click', async () => {
  const serverUrl = serverUrlInput.value.trim();
  const apiKey    = apiKeyInput.value.trim();
  testBtn.disabled = true;
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
