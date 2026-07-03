# Pocket TTS Browser Engine

Pocket TTS Browser Engine is a fully local text-to-speech extension stack for Chrome and Edge. It exposes Pocket TTS voices through the browser TTS API so extensions and websites that already use `chrome.tts` can speak through a local `audio.cpp` server without any cloud API, subscription, or token cost.

## What We Built

This project has four main parts:

1. A Manifest V3 browser extension in [extension](C:/Projects/pocket-tts-engine/extension) that registers Pocket voices with `chrome.ttsEngine`.
2. A local `audio.cpp` inference server that serves Pocket TTS audio over `http://127.0.0.1:8080`.
3. A native messaging bridge installer in [scripts](C:/Projects/pocket-tts-engine/scripts) that registers a per-user native host in Windows for Chrome and Edge.
4. A browser UI for status, testing, bridge validation, side panel controls, and installer ID management.

## Current Capabilities

- Registers 8 Pocket voices for Chrome and Edge.
- Verifies local server health from the extension UI.
- Verifies native messaging registration in `HKCU` for both Chrome and Edge.
- Supports popup controls and a full side-panel UI based on `options.html`.
- Plays speech entirely locally using Pocket TTS through `audio.cpp`.
- Supports Microsoft Read Aloud style chunked `onSpeak` traffic with queued fallback playback.

## Prerequisites

Before this extension can speak, you need a working local `audio.cpp` build on the same Windows machine.

Required pieces:

- `audiocpp_server.exe`
- `audiocpp_cli.exe`
- Pocket TTS model files
- a valid `server.json`

The current extension defaults expect these paths:

```text
C:\Projects\audio.cpp\build\windows-cuda-release\bin\audiocpp_server.exe
C:\Projects\audio.cpp\build\windows-cuda-release\bin\audiocpp_cli.exe
C:\Projects\audio.cpp\server.json
C:\Projects\audio.cpp\models\pocket-tts
```

Important:

- `audio.cpp` produces both the server and the CLI from the same build tree.
- Built-in Pocket voices use the HTTP server on `127.0.0.1:8080`.
- Custom reference voices use `audiocpp_cli.exe` through the native bridge.
- This repo does not build `audio.cpp` for you. It expects those binaries and models to already exist.

## Runtime Model

There are two local synthesis paths:

1. Built-in Pocket voices

- Browser TTS request -> extension -> local `audiocpp_server.exe` over HTTP

2. Custom reference voices

- Browser TTS request -> extension -> native messaging host -> local `audiocpp_cli.exe --voice-ref`

Both paths are local-only when you are using Pocket voices from this extension.

## Architecture

### Extension

The extension service worker in [background.js](C:/Projects/pocket-tts-engine/extension/background.js) handles:

- Voice registration and voice mapping.
- Native messaging calls for bridge status and server launch.
- Browser TTS requests through both:
  - `chrome.ttsEngine.onSpeakWithAudioStream`
  - `chrome.ttsEngine.onSpeak`

The stream path is present for browsers that route TTS through `onSpeakWithAudioStream`.

The production fallback path currently matters most: Chrome/Edge often routes requests through `onSpeak`, especially from consumers like Microsoft Read Aloud. In that case the extension fetches WAV audio from the local Pocket TTS server and plays it through an offscreen document.

### Offscreen Playback

Because MV3 service workers do not have direct DOM audio playback, the extension uses:

- [offscreen.html](C:/Projects/pocket-tts-engine/extension/offscreen.html)
- [offscreen.js](C:/Projects/pocket-tts-engine/extension/offscreen.js)

This offscreen document receives WAV bytes from the service worker and plays them using Web Audio.

### Native Messaging Bridge

The native bridge consists of:

- [install-native-bridge.ps1](C:/Projects/pocket-tts-engine/scripts/install-native-bridge.ps1)
- [PocketTtsNativeHost.cs](C:/Projects/pocket-tts-engine/scripts/PocketTtsNativeHost.cs)

The installer:

- Compiles the native host into `%LOCALAPPDATA%\PocketTTSEngine\native-host`
- Writes the manifest for `com.pockettts.engine`
- Registers it in:
  - `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.pockettts.engine`
  - `HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.pockettts.engine`

The host supports:

- `ping`
- `startServer`
- `verifyRegistration`
- `health`

## Why The Final Design Looks Like This

During integration we confirmed a few important browser behaviors:

- The extension is correctly registered when voices appear in `chrome.tts.getVoices`.
- Chrome/Edge can route speech through `onSpeak`, not just `onSpeakWithAudioStream`.
- Microsoft Read Aloud sends many small `onSpeak` requests rapidly, so fallback playback must be queued instead of handled in parallel.
- Offscreen playback is the reliable MV3-compatible solution for local audio playback from extension code.

That is why the extension now includes:

- stream support
- queued fallback playback
- offscreen audio
- side panel support
- bridge registration verification

## Installation

### 1. Build or obtain `audio.cpp`

Make sure your `audio.cpp` checkout already contains:

- `build\windows-cuda-release\bin\audiocpp_server.exe`
- `build\windows-cuda-release\bin\audiocpp_cli.exe`
- `models\pocket-tts\...`
- `server.json`

If your current workflow is:

```powershell
(venv) (base) PS C:\Projects\audio.cpp> .\build\windows-cuda-release\bin\audiocpp_server.exe --config server.json
```

that is fine for manual launch and validation.

### 2. Verify the server can run locally

Manual validation command:

```powershell
cd C:\Projects\audio.cpp
.\build\windows-cuda-release\bin\audiocpp_server.exe --config server.json
```

Expected listening endpoint:

```text
http://127.0.0.1:8080
```

### 3. Load the extension unpacked

Load [extension](C:/Projects/pocket-tts-engine/extension) as an unpacked extension in Chrome or Edge.

### 4. Install the native bridge

Run:

```powershell
powershell -ExecutionPolicy Bypass -File "C:\Projects\pocket-tts-engine\scripts\install-native-bridge.ps1" -ExtensionId "<your-extension-id>"
```

You can also use the extension UI to generate the install command from either:

- a raw extension ID
- a full `chrome-extension://.../` URL

### 5. Reload the extension

Reload the unpacked extension after installing or updating the native bridge.

### 6. Open the side panel and verify status

The options UI should confirm:

- server health
- bridge install status
- Chrome and Edge native host registration
- loaded Pocket voices

## Using The UI

### Popup

The popup provides:

- quick speech tests
- voice selection
- side panel opening
- a collapsible `Add Installer Extension ID` section

### Side Panel / Options UI

The side panel uses [options.html](C:/Projects/pocket-tts-engine/extension/options.html) and provides:

- server health checks
- bridge readiness checks
- registry verification for Chrome and Edge
- voice listing
- speech testing
- native bridge install command generation
- server start via native bridge

## Start Server Button

The extension includes a `Start Server` button in the options UI.

What it does:

- calls the native messaging host
- launches `audiocpp_server.exe --config <server.json>`
- does not require an activated Python `venv`
- does not require an activated Conda `base` environment

Why that works:

- the extension is starting the compiled `.exe`, not a Python entry point
- the native host uses `Process.Start(...)` directly

Important caveat:

- the native host currently sets the process working directory to the server executable folder, not the `audio.cpp` repo root

That means the button is reliable when:

- `server.json` is valid at the configured absolute path, and
- any paths inside `server.json` are absolute, or otherwise resolve correctly from the server executable location

Manual launch from `C:\Projects\audio.cpp` may still be safer when:

- `server.json` uses relative model paths that assume the repo root as the working directory
- you are still iterating on your `audio.cpp` layout

In other words:

- no, the server does not need `(venv) (base)` specifically for runtime
- yes, working-directory-sensitive configs can still matter
- the current UI button is useful, but path handling should be considered part of the prerequisite setup

## Verification Checklist

When the stack is working, the UI should show logs like:

- `Loaded 8 Pocket voices`
- `Server is healthy`
- `Bridge ready: 1.x.x`
- `Bridge registered in Chrome and Edge`

And speech requests should produce playback instead of immediate `Speech stopped`.

## Repo Layout

```text
pocket-tts-engine/
|-- README.md
|-- docs/
|   |-- bridge-setup.md
|   `-- notes.md
|-- extension/
|   |-- background.js
|   |-- manifest.json
|   |-- offscreen.html
|   |-- offscreen.js
|   |-- options.html
|   |-- options.js
|   |-- popup.html
|   |-- popup.js
|   `-- icons/
`-- scripts/
    |-- install-native-bridge.ps1
    `-- PocketTtsNativeHost.cs
```

## Notes

- This repo contains the browser-side engine and native bridge pieces.
- The Pocket TTS model files and `audio.cpp` server binary live outside this repo.
- The current implementation is optimized for fully local use on Windows with Chrome/Edge.
- If you want a more portable install later, the next improvement is making the server, CLI, config, and model paths configurable instead of assuming `C:\Projects\audio.cpp`.
