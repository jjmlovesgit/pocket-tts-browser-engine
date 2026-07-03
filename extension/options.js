const SERVER_URL = "http://127.0.0.1:8080";
const STORAGE_KEY = "pocket-tts-settings";
const CUSTOM_VOICES_STORAGE_KEY = "pocket-tts-custom-voices";
const CUSTOM_VOICE_DB_NAME = "pocket-tts-custom-voices-db";
const CUSTOM_VOICE_STORE_NAME = "voices";
const CUSTOM_VOICE_DB_VERSION = 1;
const CUSTOM_VOICE_FILE_PREFIX = "custom-voice:";
const DEFAULT_THEME = "light";

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
const testVoiceSelect = document.getElementById("testVoiceSelect");
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
const themeToggleBtn = document.getElementById("themeToggleBtn");
const cloneNameInput = document.getElementById("cloneNameInput");
const cloneBaseVoiceSelect = document.getElementById("cloneBaseVoiceSelect");
const cloneWavInput = document.getElementById("cloneWavInput");
const cloneVoiceBtn = document.getElementById("cloneVoiceBtn");
const cloneStatus = document.getElementById("cloneStatus");
const cloneRegisteredList = document.getElementById("cloneRegisteredList");

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
const BACKEND_VOICE_LABELS = {
  "Pocket US Female": "alba",
  "Pocket US Male": "michael",
  "Pocket UK Female": "anna",
  "Pocket UK Male": "michael",
  "Pocket AU Female": "alba",
  "Pocket AU Male": "michael",
  "Pocket US Child": "emma",
  "Pocket UK Child": "isla"
};

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

function getStorageLocal(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, resolve);
  });
}

function removeStorageLocal(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.remove(keys, resolve);
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

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "debug.log" || !message.entry) {
    return;
  }

  const detail = message.entry.detail ? ` ${JSON.stringify(message.entry.detail)}` : "";
  addLog(`[worker] ${message.entry.message}${detail}`, "info");
});

function setStatus(state, message) {
  statusDisplay.className = `status-row ${state}`;
  statusText.textContent = message;
}

function setCloneStatus(message, type = "info") {
  cloneStatus.textContent = message;
  cloneStatus.style.color = type === "error"
    ? "var(--danger)"
    : type === "success"
      ? "var(--success)"
      : "var(--muted)";
}

function applyTheme(theme) {
  const normalizedTheme = theme === "dark" ? "dark" : "light";
  document.body.dataset.theme = normalizedTheme;
  themeToggleBtn.textContent = normalizedTheme === "dark" ? "Switch to Light" : "Switch to Dark";
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getBackendVoiceId(voiceName) {
  if (BACKEND_VOICE_LABELS[voiceName]) {
    return BACKEND_VOICE_LABELS[voiceName];
  }

  if (voiceName.startsWith("Pocket Clone - ")) {
    return `ref:${voiceName.slice("Pocket Clone - ".length)}`;
  }

  return "unknown";
}

function formatVoiceLabel(voiceName) {
  return `${voiceName} (${getBackendVoiceId(voiceName)})`;
}

async function logRuntimeSummary() {
  try {
    const customVoices = await getCustomVoices();
    addLog("Runtime: built-in Pocket voices use local server HTTP on 127.0.0.1:8080", "info");
    addLog("Runtime: custom Pocket voices use native bridge + audiocpp_cli with --voice-ref", "info");
    addLog(`Runtime: ${customVoices.length} custom reference voice${customVoices.length === 1 ? "" : "s"} saved locally`, "info");
  } catch (error) {
    addLog(`Runtime summary unavailable: ${error.message}`, "error");
  }
}

function renderVoiceSelectOptions(selectElement, voices) {
  selectElement.innerHTML = voices.map((voice) => {
    const voiceName = typeof voice === "string" ? voice : voice.voiceName;
    return `<option value="${escapeHtml(voiceName)}">${escapeHtml(formatVoiceLabel(voiceName))}</option>`;
  }).join("");
}

async function checkStatus() {
  setStatus("loading", "Checking server and bridge...");
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
      await verifyBridgeRegistration();
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
    await verifyBridgeRegistration();
    return false;
  }
}

function renderBaseVoiceOptions(voices) {
  const normalizedVoices = voices.map((voice) => typeof voice === "string" ? { voiceName: voice } : voice);
  const currentValue = cloneBaseVoiceSelect.value;

  cloneBaseVoiceSelect.innerHTML = normalizedVoices.map((voice) => `
    <option value="${escapeHtml(voice.voiceName)}">${escapeHtml(formatVoiceLabel(voice.voiceName))}</option>
  `).join("");

  if (currentValue && cloneBaseVoiceSelect.querySelector(`option[value="${currentValue}"]`)) {
    cloneBaseVoiceSelect.value = currentValue;
    return;
  }

  cloneBaseVoiceSelect.value = "Pocket US Female";
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
          ${escapeHtml(formatVoiceLabel(voiceName))} <span style="color:var(--muted);font-size:12px;">(fallback)</span>
        </div>
      `).join("");
      renderVoiceSelectOptions(defaultVoiceSelect, FALLBACK_VOICE_NAMES);
      renderVoiceSelectOptions(testVoiceSelect, FALLBACK_VOICE_NAMES);
      renderBaseVoiceOptions(FALLBACK_VOICE_NAMES);
      if (settings.defaultVoice && testVoiceSelect.querySelector(`option[value="${settings.defaultVoice}"]`)) {
        testVoiceSelect.value = settings.defaultVoice;
      }
      addLog("No Pocket voices found", "error");
      return;
    }

    voiceList.innerHTML = pocketVoices.map((voice) => `
      <div class="voice-item">
        <span class="check">+</span>
        ${escapeHtml(formatVoiceLabel(voice.voiceName))} <span style="color:var(--muted);font-size:12px;">(${escapeHtml(voice.lang || "n/a")})</span>
      </div>
    `).join("");

    renderVoiceSelectOptions(defaultVoiceSelect, pocketVoices);
    renderVoiceSelectOptions(testVoiceSelect, pocketVoices);

    renderBaseVoiceOptions(pocketVoices.filter((voice) => !voice.voiceName.startsWith("Pocket Clone - ")));
    if (settings.defaultVoice && defaultVoiceSelect.querySelector(`option[value="${settings.defaultVoice}"]`)) {
      defaultVoiceSelect.value = settings.defaultVoice;
    }
    if (settings.defaultVoice && testVoiceSelect.querySelector(`option[value="${settings.defaultVoice}"]`)) {
      testVoiceSelect.value = settings.defaultVoice;
    }
    addLog(`Loaded ${pocketVoices.length} Pocket voices`, "success");
  } catch (error) {
    renderVoiceSelectOptions(testVoiceSelect, FALLBACK_VOICE_NAMES);
    renderBaseVoiceOptions(FALLBACK_VOICE_NAMES);
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
      bridgeExtensionId: chrome.runtime.id,
      theme: DEFAULT_THEME
    };

    defaultVoiceSelect.value = settings.defaultVoice || "Pocket US Female";
    testVoiceSelect.value = settings.defaultVoice || "Pocket US Female";
    speedSlider.value = settings.speed || 1.0;
    speedDisplay.textContent = `${(settings.speed || 1.0).toFixed(1)}x`;
    pitchSlider.value = settings.pitch || 1.0;
    pitchDisplay.textContent = `${(settings.pitch || 1.0).toFixed(1)}x`;
    volumeSlider.value = settings.volume || 1.0;
    volumeDisplay.textContent = `${Math.round((settings.volume || 1.0) * 100)}%`;
    bridgeExtensionIdInput.value = settings.bridgeExtensionId || chrome.runtime.id;
    applyTheme(settings.theme || DEFAULT_THEME);
  });
}

function saveSettings() {
  settings = {
    ...settings,
    defaultVoice: defaultVoiceSelect.value,
    speed: parseFloat(speedSlider.value),
    pitch: parseFloat(pitchSlider.value),
    volume: parseFloat(volumeSlider.value),
    bridgeExtensionId: bridgeExtensionIdInput.value.trim() || chrome.runtime.id,
    theme: document.body.dataset.theme || DEFAULT_THEME
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

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function openCustomVoiceDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CUSTOM_VOICE_DB_NAME, CUSTOM_VOICE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CUSTOM_VOICE_STORE_NAME)) {
        db.createObjectStore(CUSTOM_VOICE_STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function buildCustomVoiceFilePath(id) {
  return `${CUSTOM_VOICE_FILE_PREFIX}${id}`;
}

function dataUrlToArrayBuffer(dataUrl) {
  const commaIndex = String(dataUrl).indexOf(",");
  if (commaIndex < 0) {
    throw new Error("Invalid data URL.");
  }
  const base64 = String(dataUrl).slice(commaIndex + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("Failed to read WAV file."));
    reader.readAsArrayBuffer(file);
  });
}

async function listCustomVoices() {
  const db = await openCustomVoiceDatabase();
  const records = await new Promise((resolve, reject) => {
    const tx = db.transaction(CUSTOM_VOICE_STORE_NAME, "readonly");
    const request = tx.objectStore(CUSTOM_VOICE_STORE_NAME).getAll();
    request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return records.sort((left, right) => Number(left?.createdAt || 0) - Number(right?.createdAt || 0));
}

async function saveCustomVoiceRecord(record) {
  const db = await openCustomVoiceDatabase();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(CUSTOM_VOICE_STORE_NAME, "readwrite");
    tx.objectStore(CUSTOM_VOICE_STORE_NAME).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function deleteCustomVoiceRecord(id) {
  const db = await openCustomVoiceDatabase();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(CUSTOM_VOICE_STORE_NAME, "readwrite");
    tx.objectStore(CUSTOM_VOICE_STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function migrateLegacyCustomVoices() {
  const result = await getStorageLocal([CUSTOM_VOICES_STORAGE_KEY]);
  const legacyVoices = Array.isArray(result[CUSTOM_VOICES_STORAGE_KEY]) ? result[CUSTOM_VOICES_STORAGE_KEY] : [];
  if (legacyVoices.length === 0) {
    return;
  }

  const existingVoices = await listCustomVoices();
  const existingIds = new Set(existingVoices.map((voice) => voice.id));

  for (const legacyVoice of legacyVoices) {
    if (!legacyVoice?.id || existingIds.has(legacyVoice.id)) {
      continue;
    }

    await saveCustomVoiceRecord({
      id: legacyVoice.id,
      voiceName: legacyVoice.voiceName,
      lang: legacyVoice.lang || "en-US",
      baseVoiceName: legacyVoice.baseVoiceName || "Pocket US Female",
      fileName: legacyVoice.referenceSample?.name || "reference.wav",
      mimeType: legacyVoice.referenceSample?.type || "audio/wav",
      size: legacyVoice.referenceSample?.size || 0,
      arrayBuffer: dataUrlToArrayBuffer(legacyVoice.referenceSample?.dataUrl || ""),
      createdAt: legacyVoice.createdAt || Date.now(),
      filePath: buildCustomVoiceFilePath(legacyVoice.id),
      source: "custom"
    });
  }

  await removeStorageLocal([CUSTOM_VOICES_STORAGE_KEY]);
}

async function getCustomVoices() {
  await migrateLegacyCustomVoices();
  const voices = await listCustomVoices();
  return voices.map((voice) => ({
    id: voice.id,
    voiceName: voice.voiceName,
    lang: voice.lang || "en-US",
    baseVoiceName: voice.baseVoiceName || "Pocket US Female",
    filePath: voice.filePath || buildCustomVoiceFilePath(voice.id),
    fileName: voice.fileName || "reference.wav",
    mimeType: voice.mimeType || "audio/wav",
    size: voice.size || 0,
    createdAt: voice.createdAt || 0
  }));
}

async function renderCustomVoiceList() {
  const customVoices = await getCustomVoices();

  if (customVoices.length === 0) {
    cloneRegisteredList.innerHTML = `<div class="field-note">No reference voices added yet.</div>`;
    return;
  }

  cloneRegisteredList.innerHTML = customVoices.map((voice) => `
    <div class="reference-voice-item">
      <div class="reference-voice-meta">
        <strong>${escapeHtml(formatVoiceLabel(voice.voiceName))}</strong>
        <span class="field-note">Base: ${escapeHtml(formatVoiceLabel(voice.baseVoiceName || "Pocket US Female"))} • ${escapeHtml(voice.fileName || "reference.wav")}</span>
      </div>
      <button class="btn btn-secondary remove-reference-voice-btn" data-voice-id="${escapeHtml(voice.id)}">Remove</button>
    </div>
  `).join("");
}

async function createClonedVoice() {
  const cloneName = cloneNameInput.value.trim();
  const file = cloneWavInput.files?.[0];
  const baseVoiceName = cloneBaseVoiceSelect.value || "Pocket US Female";

  if (!cloneName) {
    setCloneStatus("Enter a voice name.", "error");
    return;
  }

  if (!file) {
    setCloneStatus("Select a .wav reference file first.", "error");
    return;
  }

  if (!file.name.toLowerCase().endsWith(".wav")) {
    setCloneStatus("Reference file must be a .wav file.", "error");
    return;
  }

  cloneVoiceBtn.disabled = true;
  setCloneStatus("Saving reference WAV...", "info");
  addLog(`Saving local reference voice "${cloneName}"`, "info");

  try {
    const arrayBuffer = await readFileAsArrayBuffer(file);
    const customVoices = await getCustomVoices();
    const normalizedName = `Pocket Clone - ${cloneName}`;
    const id = `reference-${slugify(cloneName) || "voice"}-${Date.now()}`;

    if (customVoices.some((voice) => voice.voiceName === normalizedName)) {
      throw new Error(`A reference voice named "${normalizedName}" already exists.`);
    }

    await saveCustomVoiceRecord({
      id,
      voiceName: normalizedName,
      lang: "en-US",
      baseVoiceName,
      fileName: file.name,
      mimeType: file.type || "audio/wav",
      size: file.size,
      arrayBuffer,
      createdAt: Date.now(),
      filePath: buildCustomVoiceFilePath(id),
      source: "custom"
    });

    await sendBackgroundMessage({ type: "voices.refresh" });
    await renderCustomVoiceList();
    await loadVoices();

    cloneNameInput.value = "";
    cloneWavInput.value = "";
    setCloneStatus(`Added ${normalizedName}.`, "success");
    addLog(`Registered ${normalizedName} using ${file.name}`, "success");
  } catch (error) {
    setCloneStatus(error.message, "error");
    addLog(`Reference voice save failed: ${error.message}`, "error");
  } finally {
    cloneVoiceBtn.disabled = false;
  }
}

function testSpeak() {
  const text = testText.value || "Hello, this is a test.";
  const voice = testVoiceSelect.value || defaultVoiceSelect.value || "Pocket US Female";
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

async function verifyBridgeRegistration() {
  try {
    const extensionId = getInstallerExtensionId();
    const response = await sendBackgroundMessage({
      type: "bridge.verifyRegistration",
      extensionId
    });

    const chromeStatus = response.response?.chrome;
    const edgeStatus = response.response?.edge;
    const chromeRegistered = !!chromeStatus?.registered;
    const edgeRegistered = !!edgeStatus?.registered;

    if (chromeRegistered || edgeRegistered) {
      const targets = [];
      if (chromeRegistered) {
        targets.push("Chrome");
      }
      if (edgeRegistered) {
        targets.push("Edge");
      }

      addLog(`Bridge registered in ${targets.join(" and ")}`, "success");
    } else {
      addLog("Bridge registry entry not confirmed for Chrome or Edge", "error");
    }

    if (chromeStatus?.manifestPath) {
      addLog(`Chrome HKCU: ${chromeStatus.manifestPath}`, chromeRegistered ? "info" : "error");
    }
    if (edgeStatus?.manifestPath) {
      addLog(`Edge HKCU: ${edgeStatus.manifestPath}`, edgeRegistered ? "info" : "error");
    }

    if (chromeStatus?.error && !chromeRegistered) {
      addLog(`Chrome registration: ${chromeStatus.error}`, "error");
    }
    if (edgeStatus?.error && !edgeRegistered) {
      addLog(`Edge registration: ${edgeStatus.error}`, "error");
    }
  } catch (error) {
    addLog(`Bridge registration check failed: ${error.message}`, "error");
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

themeToggleBtn.addEventListener("click", () => {
  const nextTheme = document.body.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(nextTheme);
  settings.theme = nextTheme;
  chrome.storage.local.set({ [STORAGE_KEY]: settings });
  addLog(`Theme set to ${nextTheme}`, "success");
});

checkStatusBtn.addEventListener("click", checkStatus);
saveSettingsBtn.addEventListener("click", saveSettings);
testSpeakBtn.addEventListener("click", testSpeak);
testStopBtn.addEventListener("click", testStop);
cloneVoiceBtn.addEventListener("click", createClonedVoice);

cloneRegisteredList.addEventListener("click", async (event) => {
  const button = event.target.closest(".remove-reference-voice-btn");
  if (!button) {
    return;
  }

  const voiceId = button.dataset.voiceId;
  await deleteCustomVoiceRecord(voiceId);
  await sendBackgroundMessage({ type: "voices.refresh" });
  await renderCustomVoiceList();
  await loadVoices();
  setCloneStatus("Reference voice removed.", "success");
  addLog("Reference voice removed", "success");
});

clearLogBtn.addEventListener("click", () => {
  logArea.innerHTML = "";
  addLog("Log cleared", "info");
});

refreshLogBtn.addEventListener("click", () => {
  addLog("Refreshing...", "info");
  loadVoices();
  renderCustomVoiceList();
  checkStatus();
  refreshBridgeStatus();
  logRuntimeSummary();
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
  renderBaseVoiceOptions(FALLBACK_VOICE_NAMES);
  renderCustomVoiceList();
  setCloneStatus("Ready", "info");
  addLog("Pocket TTS Engine options loaded", "info");
  addLog(`Extension ID: ${chrome.runtime.id}`, "info");
  logRuntimeSummary();

  progressBar.classList.remove("active");
  progressFill.style.width = "0%";

  loadVoices();
  refreshBridgeStatus();
  checkStatus();
}

document.addEventListener("DOMContentLoaded", init);
