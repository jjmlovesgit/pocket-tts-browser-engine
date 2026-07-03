const SERVER_URL = 'http://127.0.0.1:8080';
const STORAGE_KEY = 'pocket-tts-settings';

const statusBadge = document.getElementById('statusBadge');
const statusDot = document.getElementById('statusDot');
const serverStatus = document.getElementById('serverStatus');
const voiceSelect = document.getElementById('voiceSelect');
const speakBtn = document.getElementById('speakBtn');
const stopBtn = document.getElementById('stopBtn');
const startServerBtn = document.getElementById('startServerBtn');
const stopServerBtn = document.getElementById('stopServerBtn');
const optionsBtn = document.getElementById('optionsBtn');
const clearLogBtn = document.getElementById('clearLogBtn');
const logArea = document.getElementById('logArea');
const extensionId = document.getElementById('extensionId');
const openOptionsLink = document.getElementById('openOptionsLink');
const bridgeExtensionIdInput = document.getElementById('bridgeExtensionIdInput');
const themeToggleBtn = document.getElementById('themeToggleBtn');
const launchProgress = document.getElementById('launchProgress');
const launchProgressNote = document.getElementById('launchProgressNote');
const quickTestButtons = Array.from(document.querySelectorAll('.quick-test .btn'));

let settings = {};
let isSpeaking = false;
const DEFAULT_THEME = 'light';
const SERVER_START_TIMEOUT_MS = 20000;
const SERVER_START_POLL_MS = 1000;
let isServerLaunching = false;

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
const BACKEND_VOICE_LABELS = {
  'Pocket US Female': 'alba',
  'Pocket US Male': 'michael',
  'Pocket UK Female': 'anna',
  'Pocket UK Male': 'michael',
  'Pocket AU Female': 'alba',
  'Pocket AU Male': 'michael',
  'Pocket US Child': 'emma',
  'Pocket UK Child': 'isla'
};
const VOICE_DISPLAY_LABELS = {
  'Pocket US Female': 'Female',
  'Pocket US Male': 'Male',
  'Pocket UK Female': 'Female',
  'Pocket UK Male': 'Male',
  'Pocket AU Female': 'Male',
  'Pocket AU Male': 'Male',
  'Pocket US Child': 'Child',
  'Pocket UK Child': 'Child'
};

function applyTheme(theme) {
  const normalizedTheme = theme === 'dark' ? 'dark' : 'light';
  document.body.dataset.theme = normalizedTheme;
  themeToggleBtn.textContent = normalizedTheme === 'dark' ? 'Light' : 'Dark';
}

function sendBackgroundMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      if (!response) {
        reject(new Error('No response from background service worker.'));
        return;
      }

      if (!response.ok) {
        reject(new Error(response.error || 'Unknown background error.'));
        return;
      }

      resolve(response);
    });
  });
}

function getNativeBridgePayload(response) {
  const payload = response?.response;
  if (!payload) {
    throw new Error('No native host response payload was returned.');
  }

  if (payload.ok !== true) {
    const message = payload.error || 'Native host command failed.';
    if (/Unsupported command/i.test(message)) {
      throw new Error(`${message} Reinstall the native bridge to pick up the latest host version.`);
    }
    throw new Error(message);
  }

  return payload;
}

function addLog(message, type = 'info') {
  const timestamp = new Date().toLocaleTimeString();
  const prefix = type === 'error' ? '[error]' : type === 'success' ? '[ok]' : '[info]';
  const className = type === 'error' ? 'log-error' : type === 'success' ? 'log-success' : 'log-info';
  const line = document.createElement('div');
  line.className = className;
  line.textContent = `[${timestamp}] ${prefix} ${message}`;
  logArea.appendChild(line);
  logArea.scrollTop = logArea.scrollHeight;

  while (logArea.children.length > 50) {
    logArea.removeChild(logArea.firstChild);
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getBackendVoiceId(voiceName) {
  if (BACKEND_VOICE_LABELS[voiceName]) {
    return BACKEND_VOICE_LABELS[voiceName];
  }

  if (voiceName.startsWith('Pocket Clone - ')) {
    return `ref:${voiceName.slice('Pocket Clone - '.length)}`;
  }

  return 'unknown';
}

function getBackendVoiceDisplayLabel(voiceName) {
  if (VOICE_DISPLAY_LABELS[voiceName]) {
    return VOICE_DISPLAY_LABELS[voiceName];
  }

  const backendVoiceId = getBackendVoiceId(voiceName);
  return backendVoiceId;
}

function formatVoiceLabel(voiceName) {
  return `${voiceName} (${getBackendVoiceDisplayLabel(voiceName)})`;
}

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

function setServerStoppedState() {
  statusBadge.textContent = 'START SERVER';
  statusBadge.className = 'status-badge loading';
  serverStatus.textContent = 'Not running';
  statusDot.className = 'status-dot red';
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function setLaunchProgress(active, message = 'Waiting for local server to respond...') {
  isServerLaunching = active;
  launchProgress.classList.toggle('active', active);
  launchProgressNote.classList.toggle('active', active);
  launchProgressNote.textContent = message;
  startServerBtn.disabled = active;
  stopServerBtn.disabled = active;
  speakBtn.disabled = active || isSpeaking;
  stopBtn.disabled = active;
  voiceSelect.disabled = active;
  quickTestButtons.forEach((button) => {
    button.disabled = active;
  });
}

async function checkStatus() {
  setStatus('loading', 'Checking...');
  try {
    const response = await fetch(`${SERVER_URL}/health`, {
      signal: AbortSignal.timeout(1500)
    });
    if (response.ok) {
      setStatus('ready', 'Running');
      addLog('Server healthy', 'success');
      return true;
    }

    setStatus('error', `${response.status}`);
    addLog(`Server error: ${response.status}`, 'error');
    return false;
  } catch (error) {
    setServerStoppedState();
    addLog('Server is not running. Click Start Server.', 'info');
    addLog(`Server not reachable: ${error.message}`, 'error');
    return false;
  }
}

async function waitForServerHealthy(timeoutMs = SERVER_START_TIMEOUT_MS) {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < timeoutMs) {
    const healthy = await checkStatus();
    if (healthy) {
      return true;
    }
    await sleep(SERVER_START_POLL_MS);
  }
  return false;
}

async function loadVoices() {
  try {
    const voices = await new Promise((resolve) => {
      chrome.tts.getVoices(resolve);
    });

    const pocketVoices = voices.filter((voice) => voice.voiceName && voice.voiceName.startsWith('Pocket'));

    if (pocketVoices.length === 0) {
      voiceSelect.innerHTML = FALLBACK_VOICE_NAMES.map((voiceName) => `
        <option value="${escapeHtml(voiceName)}">${escapeHtml(formatVoiceLabel(voiceName))}</option>
      `).join('');
      if (settings.defaultVoice && voiceSelect.querySelector(`option[value="${settings.defaultVoice}"]`)) {
        voiceSelect.value = settings.defaultVoice;
      }
      addLog('Using fallback voice list', 'info');
      return 0;
    }

    voiceSelect.innerHTML = pocketVoices.map((voice) => `
      <option value="${escapeHtml(voice.voiceName)}">${escapeHtml(formatVoiceLabel(voice.voiceName))}</option>
    `).join('');

    if (settings.defaultVoice && voiceSelect.querySelector(`option[value="${settings.defaultVoice}"]`)) {
      voiceSelect.value = settings.defaultVoice;
    }

    addLog(`Loaded ${pocketVoices.length} Pocket voices`, 'success');
    return pocketVoices.length;
  } catch (error) {
    addLog(`Failed to load voices: ${error.message}`, 'error');
    return 0;
  }
}

function loadSettings() {
  chrome.storage.local.get([STORAGE_KEY], (result) => {
    settings = result[STORAGE_KEY] || {
      defaultVoice: 'Pocket US Female',
      speed: 1.0,
      pitch: 1.0,
      volume: 1.0,
      bridgeExtensionId: chrome.runtime.id,
      theme: DEFAULT_THEME
    };
    applyTheme(settings.theme || DEFAULT_THEME);
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

function speak(text) {
  if (isServerLaunching) {
    addLog('Wait for server startup to finish before testing speech.', 'info');
    return;
  }

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
  speakBtn.textContent = 'Speaking...';
  addLog(`Speaking: "${text.substring(0, 40)}${text.length > 40 ? '...' : ''}"`, 'info');

  chrome.tts.speak(text, {
    voiceName: voice,
    rate,
    pitch,
    volume,
    onEvent: (event) => {
      if (event.type === 'start') {
        isSpeaking = true;
      } else if (event.type === 'end') {
        isSpeaking = false;
        speakBtn.disabled = false;
        speakBtn.textContent = 'Speak';
        if (isServerLaunching) {
          speakBtn.disabled = true;
        }
        addLog('Speech complete', 'success');
      } else if (event.type === 'error') {
        isSpeaking = false;
        speakBtn.disabled = false;
        speakBtn.textContent = 'Speak';
        if (isServerLaunching) {
          speakBtn.disabled = true;
        }
        addLog(`Speech error: ${event.errorMessage}`, 'error');
      } else if (event.type === 'interrupted' || event.type === 'cancelled') {
        isSpeaking = false;
        speakBtn.disabled = false;
        speakBtn.textContent = 'Speak';
        if (isServerLaunching) {
          speakBtn.disabled = true;
        }
        addLog('Speech stopped', 'info');
      }
    }
  });
}

function stopSpeech() {
  chrome.tts.stop();
  isSpeaking = false;
  speakBtn.disabled = false;
  speakBtn.textContent = 'Speak';
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

speakBtn.addEventListener('click', () => {
  const text = prompt('Enter text to speak:', 'Hello, this is a test of the Pocket TTS engine.');
  if (text !== null && text.trim() !== '') {
    speak(text);
  }
});

stopBtn.addEventListener('click', stopSpeech);

document.querySelectorAll('.quick-test .btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const text = btn.dataset.text;
    if (text) {
      speak(text);
    }
  });
});

startServerBtn.addEventListener('click', async () => {
  addLog('Starting server through native bridge...', 'info');
  setLaunchProgress(true, 'Launching local Pocket TTS server...');

  try {
    const response = await sendBackgroundMessage({
      type: 'bridge.startServer'
    });
    const result = getNativeBridgePayload(response);
    if (result.alreadyRunning) {
      addLog('Server is already running', 'success');
    } else {
      addLog(`Server launch requested (pid: ${result.pid || 'n/a'})`, 'success');
    }

    setLaunchProgress(true, 'Waiting for server health check...');
    const healthy = await waitForServerHealthy();
    if (healthy) {
      setLaunchProgress(true, 'Refreshing Pocket voice registrations...');
      await sendBackgroundMessage({ type: 'voices.refresh' });
      await sleep(250);
      const voiceCount = await loadVoices();
      if (voiceCount > 0) {
        addLog('Pocket voices refreshed after startup', 'success');
      } else {
        addLog('Server is healthy, but Pocket voices are still loading', 'info');
      }
      addLog('Server became healthy', 'success');
    } else {
      addLog('Server launch timed out before health check passed', 'error');
      setStatus('error', 'Launch timeout');
    }
  } catch (error) {
    addLog(`Bridge start failed: ${error.message}`, 'error');
  } finally {
    setLaunchProgress(false);
  }
});

stopServerBtn.addEventListener('click', async () => {
  addLog('Stopping server through native bridge...', 'info');
  setLaunchProgress(true, 'Stopping local Pocket TTS server...');

  try {
    const response = await sendBackgroundMessage({
      type: 'bridge.stopServer'
    });
    const result = getNativeBridgePayload(response);
    const stoppedPids = Array.isArray(result.stoppedPids) ? result.stoppedPids : [];

    if (result.stopped) {
      addLog(`Server stopped (${stoppedPids.length > 0 ? `pid ${stoppedPids.join(', ')}` : 'matched process'})`, 'success');
    } else {
      addLog('No matching server process was running', 'info');
    }

    await sleep(400);
    await checkStatus();
  } catch (error) {
    addLog(`Bridge stop failed: ${error.message}`, 'error');
  } finally {
    setLaunchProgress(false);
  }
});

optionsBtn.addEventListener('click', () => {
  openSidePanel();
});

openOptionsLink.addEventListener('click', () => {
  openSidePanel();
});

clearLogBtn.addEventListener('click', () => {
  logArea.innerHTML = '';
  addLog('Log cleared', 'info');
});

themeToggleBtn.addEventListener('click', () => {
  const nextTheme = document.body.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(nextTheme);
  settings.theme = nextTheme;
  chrome.storage.local.set({ [STORAGE_KEY]: settings });
  addLog(`Theme set to ${nextTheme}`, 'success');
});

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

function init() {
  extensionId.textContent = `v0.1.0 (${chrome.runtime.id.substring(0, 8)}...)`;
  loadSettings();
  addLog('Pocket TTS Engine ready', 'info');

  setTimeout(() => {
    checkStatus();
    loadVoices();
  }, 300);
}

init();
