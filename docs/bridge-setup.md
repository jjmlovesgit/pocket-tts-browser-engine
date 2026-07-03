# Pocket TTS Native Bridge

Install the native messaging bridge for the current extension ID:

```powershell
powershell -ExecutionPolicy Bypass -File "C:\Projects\pocket-tts-engine\scripts\install-native-bridge.ps1" -ExtensionId "hijmjnmdgkcjlnhoimfnhkgkdaaeeaha"
```

What it does:

- Compiles a small local native host executable into `%LOCALAPPDATA%\PocketTTSEngine\native-host`
- Writes the native messaging manifest for `com.pockettts.engine`
- Registers the manifest under both Chrome and Edge in `HKCU`

After install:

1. Reload the unpacked extension.
2. Open the options page.
3. Verify `Bridge` shows as installed.
4. Use `Start Server` to launch `audio.cpp` through the bridge.
