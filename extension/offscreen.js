let audioContext = null;
let currentSource = null;

function normalizeArrayBufferLike(value) {
  if (value instanceof ArrayBuffer) {
    return value.slice(0);
  }

  if (ArrayBuffer.isView(value)) {
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  }

  if (value && typeof value === "object") {
    if (Array.isArray(value)) {
      return new Uint8Array(value).buffer;
    }

    if (typeof value.byteLength === "number") {
      const numericKeys = Object.keys(value)
        .filter((key) => /^\d+$/.test(key))
        .sort((a, b) => Number(a) - Number(b));

      if (numericKeys.length > 0) {
        const bytes = new Uint8Array(Number(value.byteLength));
        for (const key of numericKeys) {
          const index = Number(key);
          if (index < bytes.length) {
            bytes[index] = value[key];
          }
        }
        return bytes.buffer;
      }
    }
  }

  throw new Error("Unsupported wavBuffer payload type.");
}

function getAudioContext() {
  if (!audioContext) {
    audioContext = new AudioContext();
  }

  return audioContext;
}

function stopCurrentPlayback() {
  if (currentSource) {
    try {
      currentSource.stop();
    } catch (_error) {
      // Ignore stop races when playback has already ended.
    }

    currentSource.disconnect();
    currentSource = null;
  }
}

async function playAudioBuffer(wavBuffer, volume) {
  stopCurrentPlayback();

  const context = getAudioContext();
  if (context.state === "suspended") {
    await context.resume();
  }

  const normalizedBuffer = normalizeArrayBufferLike(wavBuffer);
  let decodedBuffer;
  try {
    decodedBuffer = await context.decodeAudioData(normalizedBuffer);
  } catch (error) {
    throw new Error(`decodeAudioData failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const source = context.createBufferSource();
  const gainNode = context.createGain();
  gainNode.gain.value = typeof volume === "number" ? volume : 1;

  source.buffer = decodedBuffer;
  source.connect(gainNode);
  gainNode.connect(context.destination);
  currentSource = source;

  await new Promise((resolve, reject) => {
    source.addEventListener("ended", () => {
      if (currentSource === source) {
        currentSource.disconnect();
        currentSource = null;
      }
      resolve();
    }, { once: true });

    try {
      source.start();
    } catch (error) {
      reject(new Error(`AudioBufferSource start failed: ${error instanceof Error ? error.message : String(error)}`));
    }
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "offscreen.playAudio") {
    playAudioBuffer(message.wavBytes ?? message.wavBuffer, message.volume)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      }));
    return true;
  }

  if (message?.type === "offscreen.stopAudio") {
    stopCurrentPlayback();
    sendResponse({ ok: true });
    return false;
  }

  return false;
});
