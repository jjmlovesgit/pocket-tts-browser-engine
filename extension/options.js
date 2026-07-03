const SERVER_URL = "http://127.0.0.1:8080";
const STORAGE_KEY = "pocket-tts-settings";

const statusDisplay = document.getElementById("statusDisplay");
const statusText = document.getElementById("statusText");
const progressBar = document.getElementById("progressBar");
const progressFill = document.getElementById("progressFill");
const serverUrlDisplay = document.getElementById("serverUrlDisplay");
const extensionIdDisplay = document.getElementById("extensionIdDisplay");
const modelStatusDisplay = document.getElementById("modelStatusDisplay");
const backendDisplay = document.getElementById("backendDisplay");
const bridgeStatusDisplay = document.getElementById("bridgeStatusDisplay");
const voiceList = document.getElementById("voiceList");
const defaultVoiceSelect = document.getElementById("defaultVoiceSelect");
const speedSlider = document.getElementById("speedSlider");
const speedDisplay = document.getElementById("speedDisplay");
const pitchSlider = document.getElementById("pitchSlider");
const pitchDisplay = document.getElementById("pitchDisplay");
const volumeSlider = document.getElementById("volumeSlider");
const volumeDisplay = document.getElementById("volumeDisplay");
const testText = document.getElementById("testText");
const testSpeakBtn = document.getElementById("testSpeakBtn");
const testStopBtn = document.getElementById("testStopBtn");
const testStatus = document.getElementById("testStatus");
const logArea = document.getElementById("logArea");
const clearLogBtn = document.getElementById("clearLogBtn");
const refreshLogBtn = document.getElementById("refreshLogBtn");
const checkStatusBtn = document.getElementById("checkStatusBtn");
const installBridgeBtn = document.getElementById("installBridgeBtn");
const startServerBtn = document.getElementById("startServerBtn");
const saveSettingsBtn = document.getElementById("saveSettingsBtn");
const bridgeExtensionIdInput = document.getElementById("bridgeExtensionIdInput");

let settings = {};
let isSpeaking = false;

const FALLBACK_VOICE_NAMES = [
  "Pocket US Female",
  "Pocket US Male",
  "Pocket UK Female",
  "Pocket UK Male",
  "Pocket AU Female",
  "Pocket AU Male",
  "Pocket US Child",
  "Pocket UK Child"
];

const INSTALLER_EXTENSION_ID_KEY = "bridgeExtensionId";

function sendBackgroundMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      if (!response) {
        reject(new Error("No response from background service worker."));
        return;
      }

      if (!response.ok) {
        reject(new Error(response.error || "Unknown background error."));
        return;
      }

      resolve(response);
    });
  });
}

function addLog(message, type = "info") {
  const timestamp = new Date().toLocaleTimeString();
  const prefix = type === "error" ? "[error]" : type === "success" ? "[ok]" : "[info]";
  const className = type === "error" ? "log-error" : type === "success" ? "log-success" : "log-info";
  const line = document.createElement("div");
  line.className = className;
  line.textContent = `[${timestamp}] ${prefix} ${message}`;
  logArea.appendChild(line);
  logArea.scrollTop = logArea.scrollHeight;
}

function setStatus(state, message) {
  statusDisplay.className = `status-row ${state}`;
  statusText.textContent = message;
}

async function checkStatus() {
  setStatus("loading", "Checking server...");
  addLog("Checking server status...");

  try {
    const response = await fetch(`${SERVER_URL}/health`, {
      signal: AbortSignal.timeout(2000)
    });

    if (response.ok) {
      const data = await response.json();
      setStatus("ready", "Server is running");
      modelStatusDisplay.textContent = "Loaded";
      backendDisplay.textContent = data.backend || "CUDA";
      addLog("Server is healthy", "success");
      return true;
    }

    setStatus("error", "Server returned error");
    addLog(`Server error: ${response.status}`, "error");
    return false;
  } catch (error) {
    setStatus("error", "Server not running");
    modelStatusDisplay.textContent = "Not connected";
    backendDisplay.textContent = "N/A";
    addLog(`Server not reachable: ${error.message}`, "error");
    return false;
  }
}

async function loadVoices() {
  try {
    const voices = await new Promise((resolve) => {
      chrome.tts.getVoices(resolve);
    });

    const pocketVoices = voices.filter((voice) => voice.voiceName && voice.voiceName.startsWith("Pocket"));

    if (pocketVoices.length === 0) {
      voiceList.innerHTML = FALLBACK_VOICE_NAMES.map((voiceName) => `
        <div class="voice-item">
          <span class="check">?</span>
          ${voiceName} <span style="color:#999;font-size:12px;">(fallback)</span>
        </div>
      `).join("");
      defaultVoiceSelect.innerHTML = FALLBACK_VOICE_NAMES.map((voiceName) => `
        <option value="${voiceName}">${voiceName}</option>
      `).join("");
      addLog("No Pocket voices found", "error");
      return;
    }

    voiceList.innerHTML = pocketVoices.map((voice) => `
      <div class="voice-item">
        <span class="check">+</span>
        ${voice.voiceName} <span style="color:#999;font-size:12px;">(${voice.lang})</span>
      </div>
    `).join("");

    defaultVoiceSelect.innerHTML = pocketVoices.map((voice) => `
      <option value="${voice.voiceName}">${voice.voiceName}</option>
    `).join("");

    addLog(`Loaded ${pocketVoices.length} Pocket voices`, "success");
  } catch (error) {
    addLog(`Failed to load voices: ${error.message}`, "error");
  }
}

function loadSettings() {
  chrome.storage.local.get([STORAGE_KEY], (result) => {
    settings = result[STORAGE_KEY] || {
      defaultVoice: "Pocket US Female",
      speed: 1.0,
      pitch: 1.0,
      volume: 1.0,
      bridgeExtensionId: chrome.runtime.id
    };

    defaultVoiceSelect.value = settings.defaultVoice || "Pocket US Female";
    speedSlider.value = settings.speed || 1.0;
    speedDisplay.textContent = `${(settings.speed || 1.0).toFixed(1)}x`;
    pitchSlider.value = settings.pitch || 1.0;
    pitchDisplay.textContent = `${(settings.pitch || 1.0).toFixed(1)}x`;
    volumeSlider.value = settings.volume || 1.0;
    volumeDisplay.textContent = `${Math.round((settings.volume || 1.0) * 100)}%`;
    bridgeExtensionIdInput.value = settings.bridgeExtensionId || chrome.runtime.id;
  });
}

function saveSettings() {
  settings = {
    defaultVoice: defaultVoiceSelect.value,
    speed: parseFloat(speedSlider.value),
    pitch: parseFloat(pitchSlider.value),
    volume: parseFloat(volumeSlider.value),
    bridgeExtensionId: bridgeExtensionIdInput.value.trim() || chrome.runtime.id
  };

  chrome.storage.local.set({ [STORAGE_KEY]: settings }, () => {
    addLog("Settings saved", "success");
  });
}

function normalizeExtensionId(value) {
  const trimmed = (value || "").trim();
  if (!trimmed) {
    return "";
  }

  const urlMatch = trimmed.match(/^chrome-extension:\/\/([a-z]{32})\/?$/i);
  if (urlMatch) {
    return urlMatch[1].toLowerCase();
  }

  if (/^[a-z]{32}$/i.test(trimmed)) {
    return trimmed.toLowerCase();
  }

  return "";
}

function getInstallerExtensionId() {
  const normalized = normalizeExtensionId(bridgeExtensionIdInput.value);
  if (!normalized) {
    throw new Error("Enter a valid extension ID or chrome-extension URL.");
  }

  bridgeExtensionIdInput.value = normalized;
  settings[INSTALLER_EXTENSION_ID_KEY] = normalized;
  chrome.storage.local.set({ [STORAGE_KEY]: settings });
  return normalized;
}

function testSpeak() {
  const text = testText.value || "Hello, this is a test.";
  const voice = defaultVoiceSelect.value || "Pocket US Female";
  const rate = parseFloat(speedSlider.value) || 1.0;
  const pitch = parseFloat(pitchSlider.value) || 1.0;
  const volume = parseFloat(volumeSlider.value) || 1.0;

  if (isSpeaking) {
    chrome.tts.stop();
    isSpeaking = false;
  }

  testStatus.textContent = "Speaking...";
  addLog(`Speaking: "${text.substring(0, 50)}..." with ${voice}`, "info");

  chrome.tts.speak(text, {
    voiceName: voice,
    rate,
    pitch,
    volume,
    onEvent: (event) => {
      if (event.type === "start") {
        testStatus.textContent = "Speaking...";
        isSpeaking = true;
      } else if (event.type === "end") {
        testStatus.textContent = "Done";
        isSpeaking = false;
        addLog("Speech complete", "success");
      } else if (event.type === "error") {
        testStatus.textContent = `Error: ${event.errorMessage}`;
        isSpeaking = false;
        addLog(`Speech error: ${event.errorMessage}`, "error");
      } else if (event.type === "interrupted" || event.type === "cancelled") {
        testStatus.textContent = "Stopped";
        isSpeaking = false;
        addLog("Speech stopped", "info");
      }
    }
  });
}

function testStop() {
  chrome.tts.stop();
  isSpeaking = false;
  testStatus.textContent = "Stopped";
  addLog("Speech stopped by user", "info");
}

function loadExtensionInfo() {
  extensionIdDisplay.textContent = chrome.runtime.id || "Unknown";
  serverUrlDisplay.textContent = SERVER_URL;
}

async function refreshBridgeStatus() {
  bridgeStatusDisplay.textContent = "Checking...";

  try {
    const response = await sendBackgroundMessage({ type: "bridge.ping" });
    const hostVersion = response.response?.hostVersion || "unknown";
    bridgeStatusDisplay.textContent = `Installed (${hostVersion})`;
    addLog(`Bridge ready: ${hostVersion}`, "success");
    return true;
  } catch (error) {
    bridgeStatusDisplay.textContent = "Not installed";
    addLog(`Bridge unavailable: ${error.message}`, "info");
    return false;
  }
}

speedSlider.addEventListener("input", () => {
  speedDisplay.textContent = `${parseFloat(speedSlider.value).toFixed(1)}x`;
});

pitchSlider.addEventListener("input", () => {
  pitchDisplay.textContent = `${parseFloat(pitchSlider.value).toFixed(1)}x`;
});

volumeSlider.addEventListener("input", () => {
  volumeDisplay.textContent = `${Math.round(parseFloat(volumeSlider.value) * 100)}%`;
});

checkStatusBtn.addEventListener("click", checkStatus);
saveSettingsBtn.addEventListener("click", saveSettings);
testSpeakBtn.addEventListener("click", testSpeak);
testStopBtn.addEventListener("click", testStop);

clearLogBtn.addEventListener("click", () => {
  logArea.innerHTML = "";
  addLog("Log cleared", "info");
});

refreshLogBtn.addEventListener("click", () => {
  addLog("Refreshing...", "info");
  loadVoices();
  checkStatus();
  refreshBridgeStatus();
});

installBridgeBtn.addEventListener("click", async () => {
  try {
    const extensionId = getInstallerExtensionId();
    const response = await sendBackgroundMessage({
      type: "bridge.installCommand",
      extensionId
    });
    await navigator.clipboard.writeText(response.command);
    addLog("Bridge install command copied to clipboard", "success");
    addLog(response.command, "info");
  } catch (error) {
    addLog(`Failed to prepare bridge install command: ${error.message}`, "error");
  }
});

bridgeExtensionIdInput.addEventListener("blur", () => {
  const normalized = normalizeExtensionId(bridgeExtensionIdInput.value);
  if (!normalized) {
    return;
  }

  bridgeExtensionIdInput.value = normalized;
  settings[INSTALLER_EXTENSION_ID_KEY] = normalized;
  chrome.storage.local.set({ [STORAGE_KEY]: settings });
});

startServerBtn.addEventListener("click", async () => {
  addLog("Starting server through native bridge...", "info");

  try {
    const response = await sendBackgroundMessage({
      type: "bridge.startServer"
    });
    const result = response.response || {};
    if (result.alreadyRunning) {
      addLog("Server is already running", "success");
    } else {
      addLog(`Server launch requested (pid: ${result.pid || "n/a"})`, "success");
    }

    setTimeout(() => {
      checkStatus();
    }, 1200);
  } catch (error) {
    addLog(`Bridge start failed: ${error.message}`, "error");
    addLog("Run the install script first, then retry.", "info");
  }
});

function init() {
  loadExtensionInfo();
  loadSettings();
  addLog("Pocket TTS Engine options loaded", "info");
  addLog(`Extension ID: ${chrome.runtime.id}`, "info");

  progressBar.classList.remove("active");
  progressFill.style.width = "0%";

  setTimeout(() => {
    checkStatus();
    loadVoices();
    refreshBridgeStatus();
  }, 500);
}

init();
