const SERVER_URL = "http://127.0.0.1:8080";
const BRIDGE_HOST_NAME = "com.pockettts.engine";
const DEFAULT_SERVER_EXE_PATH = "C:\\Projects\\audio.cpp\\build\\windows-cuda-release\\bin\\audiocpp_server.exe";
const DEFAULT_SERVER_CONFIG_PATH = "C:\\Projects\\audio.cpp\\server.json";
const BRIDGE_INSTALL_SCRIPT_PATH = "C:\\Projects\\pocket-tts-engine\\scripts\\install-native-bridge.ps1";

const VOICE_MAP = {
  "Pocket US Female": "alba",
  "Pocket US Male": "michael",
  "Pocket UK Female": "anna",
  "Pocket UK Male": "michael",
  "Pocket AU Female": "alba",
  "Pocket AU Male": "michael",
  "Pocket US Child": "emma",
  "Pocket UK Child": "isla"
};

let activeRequestId = 0;
let activeAbortController = null;

function sendNativeCommand(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendNativeMessage(BRIDGE_HOST_NAME, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve(response);
    });
  });
}

function getBridgeInstallCommand(extensionId = chrome.runtime.id) {
  return `powershell -ExecutionPolicy Bypass -File "${BRIDGE_INSTALL_SCRIPT_PATH}" -ExtensionId "${extensionId}"`;
}

function clamp(value, min, max, fallback) {
  const numeric = Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, numeric));
}

function getVoiceName(voiceName) {
  return VOICE_MAP[voiceName] || VOICE_MAP["Pocket US Female"];
}

function readAscii(view, start, length) {
  let text = "";
  for (let i = 0; i < length; i += 1) {
    text += String.fromCharCode(view.getUint8(start + i));
  }
  return text;
}

function decodePcmSample(view, offset, bytesPerSample, audioFormat) {
  if (audioFormat === 3 && bytesPerSample === 4) {
    return view.getFloat32(offset, true);
  }

  if (audioFormat !== 1) {
    throw new Error(`Unsupported WAV audio format: ${audioFormat}`);
  }

  if (bytesPerSample === 1) {
    return (view.getUint8(offset) - 128) / 128;
  }

  if (bytesPerSample === 2) {
    return view.getInt16(offset, true) / 32768;
  }

  if (bytesPerSample === 3) {
    const byte0 = view.getUint8(offset);
    const byte1 = view.getUint8(offset + 1);
    const byte2 = view.getUint8(offset + 2);
    let value = byte0 | (byte1 << 8) | (byte2 << 16);
    if (value & 0x800000) {
      value |= ~0xffffff;
    }
    return value / 8388608;
  }

  if (bytesPerSample === 4) {
    return view.getInt32(offset, true) / 2147483648;
  }

  throw new Error(`Unsupported sample width: ${bytesPerSample * 8} bits`);
}

function decodeWavToMonoFloat32(arrayBuffer) {
  const view = new DataView(arrayBuffer);

  if (readAscii(view, 0, 4) !== "RIFF" || readAscii(view, 8, 4) !== "WAVE") {
    throw new Error("Server returned an invalid WAV file.");
  }

  let offset = 12;
  let audioFormat = 0;
  let channelCount = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataOffset = 0;
  let dataSize = 0;

  while (offset + 8 <= view.byteLength) {
    const chunkId = readAscii(view, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const chunkDataOffset = offset + 8;

    if (chunkId === "fmt ") {
      audioFormat = view.getUint16(chunkDataOffset, true);
      channelCount = view.getUint16(chunkDataOffset + 2, true);
      sampleRate = view.getUint32(chunkDataOffset + 4, true);
      bitsPerSample = view.getUint16(chunkDataOffset + 14, true);
    } else if (chunkId === "data") {
      dataOffset = chunkDataOffset;
      dataSize = chunkSize;
      break;
    }

    offset = chunkDataOffset + chunkSize + (chunkSize % 2);
  }

  if (!dataOffset || !sampleRate || !channelCount || !bitsPerSample) {
    throw new Error("WAV file is missing required audio metadata.");
  }

  const bytesPerSample = bitsPerSample / 8;
  const frameSize = bytesPerSample * channelCount;
  const frameCount = Math.floor(dataSize / frameSize);
  const samples = new Float32Array(frameCount);

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    let sum = 0;
    const frameOffset = dataOffset + (frameIndex * frameSize);

    for (let channel = 0; channel < channelCount; channel += 1) {
      sum += decodePcmSample(
        view,
        frameOffset + (channel * bytesPerSample),
        bytesPerSample,
        audioFormat
      );
    }

    samples[frameIndex] = Math.max(-1, Math.min(1, sum / channelCount));
  }

  return { sampleRate, samples };
}

function resampleLinear(samples, sourceRate, targetRate) {
  if (sourceRate === targetRate) {
    return samples;
  }

  const outputLength = Math.max(1, Math.round(samples.length * targetRate / sourceRate));
  const output = new Float32Array(outputLength);
  const ratio = sourceRate / targetRate;

  for (let i = 0; i < outputLength; i += 1) {
    const sourceIndex = i * ratio;
    const indexFloor = Math.floor(sourceIndex);
    const indexCeil = Math.min(indexFloor + 1, samples.length - 1);
    const mix = sourceIndex - indexFloor;
    output[i] = samples[indexFloor] + ((samples[indexCeil] - samples[indexFloor]) * mix);
  }

  return output;
}

function applyVolume(samples, volume) {
  if (volume === 1) {
    return samples;
  }

  const scaled = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    scaled[i] = Math.max(-1, Math.min(1, samples[i] * volume));
  }

  return scaled;
}

function sendAudioChunks(samples, audioStreamOptions, utteranceLength, sendTtsAudio) {
  const chunkSize = audioStreamOptions.bufferSize;

  for (let offset = 0; offset < samples.length; offset += chunkSize) {
    const end = Math.min(offset + chunkSize, samples.length);
    const chunk = new Float32Array(chunkSize);
    chunk.set(samples.subarray(offset, end));

    const progress = end / samples.length;
    const charIndex = Math.min(utteranceLength, Math.floor(progress * utteranceLength));

    sendTtsAudio({
      audioBuffer: chunk.buffer,
      charIndex,
      isLastBuffer: end >= samples.length
    });
  }
}

async function synthesizeSpeech(utterance, options, audioStreamOptions, sendTtsAudio) {
  activeRequestId += 1;
  const requestId = activeRequestId;

  if (activeAbortController) {
    activeAbortController.abort();
  }

  activeAbortController = new AbortController();

  const response = await fetch(`${SERVER_URL}/v1/audio/speech`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: activeAbortController.signal,
    body: JSON.stringify({
      model: "pocket-tts",
      input: utterance,
      voice: getVoiceName(options.voiceName),
      speed: clamp(options.rate, 0.1, 10, 1),
      pitch: clamp(options.pitch, 0, 2, 1),
      response_format: "wav"
    })
  });

  if (!response.ok) {
    throw new Error(`Pocket TTS server returned HTTP ${response.status}`);
  }

  const wavData = await response.arrayBuffer();
  if (requestId !== activeRequestId) {
    return;
  }

  const decoded = decodeWavToMonoFloat32(wavData);
  const resampled = resampleLinear(
    decoded.samples,
    decoded.sampleRate,
    audioStreamOptions.sampleRate
  );
  const finalSamples = applyVolume(
    resampled,
    clamp(options.volume, 0, 1, 1)
  );

  sendAudioChunks(finalSamples, audioStreamOptions, utterance.length, sendTtsAudio);
}

chrome.ttsEngine.onSpeakWithAudioStream.addListener(
  async (utterance, options, audioStreamOptions, sendTtsAudio, sendError) => {
    try {
      await synthesizeSpeech(
        utterance,
        options,
        audioStreamOptions,
        sendTtsAudio
      );
    } catch (error) {
      if (error?.name === "AbortError") {
        return;
      }

      console.error("Pocket TTS stream failed:", error);
      sendError(error instanceof Error ? error.message : String(error));
    }
  }
);

chrome.ttsEngine.onStop.addListener(() => {
  activeRequestId += 1;

  if (activeAbortController) {
    activeAbortController.abort();
    activeAbortController = null;
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message?.type) {
    return false;
  }

  (async () => {
    switch (message.type) {
      case "bridge.installCommand":
        sendResponse({
          ok: true,
          command: getBridgeInstallCommand(message.extensionId)
        });
        return;
      case "bridge.ping": {
        const response = await sendNativeCommand({ command: "ping" });
        sendResponse({ ok: true, response });
        return;
      }
      case "bridge.startServer": {
        const response = await sendNativeCommand({
          command: "startServer",
          serverExePath: message.serverExePath || DEFAULT_SERVER_EXE_PATH,
          serverConfigPath: message.serverConfigPath || DEFAULT_SERVER_CONFIG_PATH
        });
        sendResponse({ ok: true, response });
        return;
      }
      default:
        sendResponse({
          ok: false,
          error: `Unsupported message type: ${message.type}`
        });
    }
  })().catch((error) => {
    sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  });

  return true;
});

fetch(`${SERVER_URL}/health`)
  .then((response) => response.json())
  .then((data) => console.log("Pocket TTS server healthy:", data))
  .catch((error) => console.warn("Pocket TTS server not running:", error.message));

console.log(`Pocket TTS extension loaded: ${chrome.runtime.id}`);
