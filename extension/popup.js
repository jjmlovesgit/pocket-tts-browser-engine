// popup.js

const SERVER_URL = 'http://127.0.0.1:8080';
const STORAGE_KEY = 'pocket-tts-settings';

// DOM
const statusBadge = document.getElementById('statusBadge');
const statusDot = document.getElementById('statusDot');
const serverStatus = document.getElementById('serverStatus');
const voiceSelect = document.getElementById('voiceSelect');
const speakBtn = document.getElementById('speakBtn');
const stopBtn = document.getElementById('stopBtn');
const refreshBtn = document.getElementById('refreshBtn');
const optionsBtn = document.getElementById('optionsBtn');
const clearLogBtn = document.getElementById('clearLogBtn');
const logArea = document.getElementById('logArea');
const extensionId = document.getElementById('extensionId');
const openOptionsLink = document.getElementById('openOptionsLink');
const bridgeExtensionIdInput = document.getElementById('bridgeExtensionIdInput');

let settings = {};
let isSpeaking = false;
const FALLBACK_VOICE_NAMES = [
  'Pocket US Female',
  'Pocket US Male',
  'Pocket UK Female',
  'Pocket UK Male',
  'Pocket AU Female',
  'Pocket AU Male',
  'Pocket US Child',
  'Pocket UK Child'
];
const INSTALLER_EXTENSION_ID_KEY = 'bridgeExtensionId';

// ============================================
// Logging
// ============================================

function addLog(message, type = 'info') {
  const timestamp = new Date().toLocaleTimeString();
  const prefix = type === 'error' ? '❌' : type === 'success' ? '✅' : 'ℹ️';
  const className = type === 'error' ? 'log-error' : type === 'success' ? 'log-success' : 'log-info';
  const line = document.createElement('div');
  line.className = className;
  line.textContent = `[${timestamp}] ${prefix} ${message}`;
  logArea.appendChild(line);
  logArea.scrollTop = logArea.scrollHeight;

  // Keep log manageable
  while (logArea.children.length > 50) {
    logArea.removeChild(logArea.firstChild);
  }
}

// ============================================
// Status
// ============================================

function setStatus(state, message) {
  statusBadge.textContent = state.toUpperCase();
  statusBadge.className = `status-badge ${state}`;
  serverStatus.textContent = message;

  if (state === 'ready') {
    statusDot.className = 'status-dot green';
  } else if (state === 'loading') {
    statusDot.className = 'status-dot yellow';
  } else {
    statusDot.className = 'status-dot red';
  }
}

async function checkStatus() {
  setStatus('loading', 'Checking...');
  try {
    const response = await fetch(`${SERVER_URL}/health`, {
      signal: AbortSignal.timeout(1500)
    });
    if (response.ok) {
      setStatus('ready', '✅ Running');
      addLog('Server healthy', 'success');
      return true;
    } else {
      setStatus('error', `❌ ${response.status}`);
      addLog(`Server error: ${response.status}`, 'error');
      return false;
    }
  } catch (error) {
    setStatus('error', '❌ Not running');
    addLog(`Server not reachable: ${error.message}`, 'error');
    return false;
  }
}

// ============================================
// Voices
// ============================================

async function loadVoices() {
  try {
    const voices = await new Promise((resolve) => {
      chrome.tts.getVoices(resolve);
    });

    const pocketVoices = voices.filter(v => v.voiceName && v.voiceName.startsWith('Pocket'));

    if (pocketVoices.length === 0) {
      // Fallback to hardcoded voices
      voiceSelect.innerHTML = FALLBACK_VOICE_NAMES.map((voiceName) => `
        <option value="${voiceName}">${voiceName}</option>
      `).join('');
      addLog('Using fallback voice list', 'info');
      return;
    }

    voiceSelect.innerHTML = pocketVoices.map(v => `
      <option value="${v.voiceName}">${v.voiceName}</option>
    `).join('');

    addLog(`Loaded ${pocketVoices.length} Pocket voices`, 'success');
  } catch (error) {
    addLog(`Failed to load voices: ${error.message}`, 'error');
  }
}

// ============================================
// Settings
// ============================================

function loadSettings() {
  chrome.storage.local.get([STORAGE_KEY], (result) => {
    settings = result[STORAGE_KEY] || {
      defaultVoice: 'Pocket US Female',
      speed: 1.0,
      pitch: 1.0,
      volume: 1.0,
      bridgeExtensionId: chrome.runtime.id
    };
    if (voiceSelect.querySelector(`option[value="${settings.defaultVoice}"]`)) {
      voiceSelect.value = settings.defaultVoice;
    }
    bridgeExtensionIdInput.value = settings.bridgeExtensionId || chrome.runtime.id;
  });
}

function normalizeExtensionId(value) {
  const trimmed = (value || '').trim();
  if (!trimmed) {
    return '';
  }

  const urlMatch = trimmed.match(/^chrome-extension:\/\/([a-z]{32})\/?$/i);
  if (urlMatch) {
    return urlMatch[1].toLowerCase();
  }

  if (/^[a-z]{32}$/i.test(trimmed)) {
    return trimmed.toLowerCase();
  }

  return '';
}

// ============================================
// Speech
// ============================================

function speak(text) {
  if (isSpeaking) {
    chrome.tts.stop();
    isSpeaking = false;
  }

  const voice = voiceSelect.value || 'Pocket US Female';
  const rate = settings.speed || 1.0;
  const pitch = settings.pitch || 1.0;
  const volume = settings.volume || 1.0;

  if (!text || text.trim() === '') {
    addLog('No text to speak', 'error');
    return;
  }

  speakBtn.disabled = true;
  speakBtn.textContent = '🔊 Speaking...';
  addLog(`Speaking: "${text.substring(0, 40)}${text.length > 40 ? '...' : ''}"`, 'info');

  chrome.tts.speak(text, {
    voiceName: voice,
    rate: rate,
    pitch: pitch,
    volume: volume,
    onEvent: (event) => {
      if (event.type === 'start') {
        isSpeaking = true;
      } else if (event.type === 'end') {
        isSpeaking = false;
        speakBtn.disabled = false;
        speakBtn.textContent = '🔊 Speak';
        addLog('Speech complete', 'success');
      } else if (event.type === 'error') {
        isSpeaking = false;
        speakBtn.disabled = false;
        speakBtn.textContent = '🔊 Speak';
        addLog(`Speech error: ${event.errorMessage}`, 'error');
      } else if (event.type === 'interrupted' || event.type === 'cancelled') {
        isSpeaking = false;
        speakBtn.disabled = false;
        speakBtn.textContent = '🔊 Speak';
        addLog('Speech stopped', 'info');
      }
    }
  });
}

function stopSpeech() {
  chrome.tts.stop();
  isSpeaking = false;
  speakBtn.disabled = false;
  speakBtn.textContent = '🔊 Speak';
  addLog('Speech stopped by user', 'info');
}

async function openSidePanel() {
  try {
    const currentWindow = await chrome.windows.getCurrent();
    await chrome.sidePanel.setOptions({
      path: 'options.html',
      enabled: true
    });
    await chrome.sidePanel.open({
      windowId: currentWindow.id
    });
    window.close();
  } catch (error) {
    addLog(`Failed to open side panel: ${error.message}`, 'error');
  }
}

// ============================================
// Event Listeners
// ============================================

// Speak button
speakBtn.addEventListener('click', () => {
  const text = prompt('Enter text to speak:', 'Hello, this is a test of the Pocket TTS engine.');
  if (text !== null && text.trim() !== '') {
    speak(text);
  }
});

// Stop button
stopBtn.addEventListener('click', stopSpeech);

// Quick test buttons
document.querySelectorAll('.quick-test .btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const text = btn.dataset.text;
    if (text) speak(text);
  });
});

// Refresh
refreshBtn.addEventListener('click', () => {
  addLog('Refreshing...', 'info');
  checkStatus();
  loadVoices();
});

// Options
optionsBtn.addEventListener('click', () => {
  openSidePanel();
});

openOptionsLink.addEventListener('click', () => {
  openSidePanel();
});

// Clear log
clearLogBtn.addEventListener('click', () => {
  logArea.innerHTML = '';
  addLog('Log cleared', 'info');
});

// Voice selection saves preference
voiceSelect.addEventListener('change', () => {
  settings.defaultVoice = voiceSelect.value;
  chrome.storage.local.set({ [STORAGE_KEY]: settings });
});

bridgeExtensionIdInput.addEventListener('blur', () => {
  const normalized = normalizeExtensionId(bridgeExtensionIdInput.value);
  if (!normalized) {
    return;
  }

  bridgeExtensionIdInput.value = normalized;
  settings[INSTALLER_EXTENSION_ID_KEY] = normalized;
  chrome.storage.local.set({ [STORAGE_KEY]: settings });
});

// ============================================
// Init
// ============================================

function init() {
  extensionId.textContent = `v0.1.0 (${chrome.runtime.id.substring(0, 8)}...)`;
  loadSettings();
  addLog('🚀 Pocket TTS Engine ready', 'info');

  // Check status and load voices after a moment
  setTimeout(() => {
    checkStatus();
    loadVoices();
  }, 300);
}

init();
