using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Management;
using System.Net;
using System.Text;
using System.Web.Script.Serialization;
using Microsoft.Win32;

namespace PocketTtsNativeHost
{
    internal sealed class NativeRequest
    {
        public string command { get; set; }
        public string serverExePath { get; set; }
        public string serverConfigPath { get; set; }
        public string extensionId { get; set; }
        public string cliExePath { get; set; }
        public string modelPath { get; set; }
        public string backend { get; set; }
        public string text { get; set; }
        public string voiceRefBase64 { get; set; }
        public string voiceRefFileName { get; set; }
        public string family { get; set; }
        public string installScriptPath { get; set; }
    }

    internal static class Program
    {
        private const string HostVersion = "1.4.0";

        private static int Main()
        {
            try
            {
                var request = ReadRequest();
                if (request == null)
                {
                    WriteResponse(Response(false, "No request received."));
                    return 1;
                }

                var command = (request.command ?? string.Empty).Trim();
                if (command == "ping")
                {
                    var response = Response(true, null);
                    response.Add("hostVersion", HostVersion);
                    WriteResponse(response);
                    return 0;
                }

                if (command == "startServer")
                {
                    WriteResponse(StartServer(request.serverExePath, request.serverConfigPath));
                    return 0;
                }

                if (command == "validateRuntimePaths")
                {
                    WriteResponse(ValidateRuntimePaths(request));
                    return 0;
                }

                if (command == "installOrUpdateBridge")
                {
                    WriteResponse(InstallOrUpdateBridge(request.installScriptPath, request.extensionId));
                    return 0;
                }

                if (command == "stopServer")
                {
                    WriteResponse(StopServer(request.serverExePath));
                    return 0;
                }

                if (command == "health")
                {
                    WriteResponse(CheckHealth());
                    return 0;
                }

                if (command == "verifyRegistration")
                {
                    WriteResponse(VerifyRegistration(request.extensionId));
                    return 0;
                }

                if (command == "synthReferenceSpeech")
                {
                    WriteResponse(SynthesizeReferenceSpeech(request));
                    return 0;
                }

                WriteResponse(Response(false, "Unsupported command."));
                return 1;
            }
            catch (Exception ex)
            {
                WriteResponse(Response(false, ex.Message));
                return 1;
            }
        }

        private static NativeRequest ReadRequest()
        {
            using (var stream = Console.OpenStandardInput())
            using (var reader = new BinaryReader(stream, Encoding.UTF8))
            {
                var lengthBytes = reader.ReadBytes(4);
                if (lengthBytes.Length < 4)
                {
                    return null;
                }

                var length = BitConverter.ToInt32(lengthBytes, 0);
                var payload = reader.ReadBytes(length);
                var json = Encoding.UTF8.GetString(payload);
                var serializer = new JavaScriptSerializer();
                return serializer.Deserialize<NativeRequest>(json);
            }
        }

        private static void WriteResponse(object payload)
        {
            var serializer = new JavaScriptSerializer();
            var json = serializer.Serialize(payload);
            var bytes = Encoding.UTF8.GetBytes(json);
            var lengthBytes = BitConverter.GetBytes(bytes.Length);

            using (var stream = Console.OpenStandardOutput())
            using (var writer = new BinaryWriter(stream, Encoding.UTF8))
            {
                writer.Write(lengthBytes);
                writer.Write(bytes);
                writer.Flush();
            }
        }

        private static Dictionary<string, object> Response(bool ok, string error)
        {
            var response = new Dictionary<string, object>();
            response.Add("ok", ok);

            if (!string.IsNullOrEmpty(error))
            {
                response.Add("error", error);
            }

            return response;
        }

        private static Dictionary<string, object> StartServer(string serverExePath, string serverConfigPath)
        {
            if (string.IsNullOrWhiteSpace(serverExePath) || !File.Exists(serverExePath))
            {
                return Response(false, string.Format("Server executable not found: {0}", serverExePath));
            }

            if (string.IsNullOrWhiteSpace(serverConfigPath) || !File.Exists(serverConfigPath))
            {
                return Response(false, string.Format("Server config not found: {0}", serverConfigPath));
            }

            var processName = Path.GetFileNameWithoutExtension(serverExePath);
            var existing = Process.GetProcessesByName(processName);
            if (existing.Length > 0)
            {
                var existingResponse = Response(true, null);
                existingResponse.Add("alreadyRunning", true);
                existingResponse.Add("pid", existing[0].Id);
                return existingResponse;
            }

            var startInfo = new ProcessStartInfo();
            startInfo.FileName = serverExePath;
            startInfo.Arguments = string.Format("--config \"{0}\"", serverConfigPath);
            startInfo.WorkingDirectory = Path.GetDirectoryName(serverConfigPath) ?? Path.GetDirectoryName(serverExePath) ?? Environment.CurrentDirectory;
            startInfo.UseShellExecute = false;
            startInfo.CreateNoWindow = true;

            var process = Process.Start(startInfo);
            var startResponse = Response(true, null);
            startResponse.Add("alreadyRunning", false);
            startResponse.Add("pid", process != null ? process.Id : 0);
            return startResponse;
        }

        private static Dictionary<string, object> BuildPathValidationResult(string label, string path, bool exists, string kind)
        {
            var result = new Dictionary<string, object>();
            result.Add("label", label);
            result.Add("path", path ?? string.Empty);
            result.Add("exists", exists);
            result.Add("kind", kind);
            return result;
        }

        private static Dictionary<string, object> ValidateRuntimePaths(NativeRequest request)
        {
            var checks = new List<Dictionary<string, object>>();

            var serverExePath = request.serverExePath ?? string.Empty;
            var serverConfigPath = request.serverConfigPath ?? string.Empty;
            var cliExePath = request.cliExePath ?? string.Empty;
            var modelPath = request.modelPath ?? string.Empty;

            var serverExeExists = !string.IsNullOrWhiteSpace(serverExePath) && File.Exists(serverExePath);
            var serverConfigExists = !string.IsNullOrWhiteSpace(serverConfigPath) && File.Exists(serverConfigPath);
            var cliExeExists = !string.IsNullOrWhiteSpace(cliExePath) && File.Exists(cliExePath);
            var modelPathExists = !string.IsNullOrWhiteSpace(modelPath) && Directory.Exists(modelPath);

            checks.Add(BuildPathValidationResult("serverExePath", serverExePath, serverExeExists, "file"));
            checks.Add(BuildPathValidationResult("serverConfigPath", serverConfigPath, serverConfigExists, "file"));
            checks.Add(BuildPathValidationResult("cliExePath", cliExePath, cliExeExists, "file"));
            checks.Add(BuildPathValidationResult("modelPath", modelPath, modelPathExists, "directory"));

            var response = Response(serverExeExists && serverConfigExists && cliExeExists && modelPathExists, null);
            response.Add("checks", checks.ToArray());

            if (!(serverExeExists && serverConfigExists && cliExeExists && modelPathExists))
            {
                response["error"] = "One or more runtime paths are missing.";
            }

            return response;
        }

        private static Dictionary<string, object> InstallOrUpdateBridge(string installScriptPath, string extensionId)
        {
            if (string.IsNullOrWhiteSpace(installScriptPath) || !File.Exists(installScriptPath))
            {
                return Response(false, string.Format("Install script not found: {0}", installScriptPath));
            }

            if (string.IsNullOrWhiteSpace(extensionId))
            {
                return Response(false, "Extension ID is required.");
            }

            var powershellPath = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.System),
                @"WindowsPowerShell\v1.0\powershell.exe"
            );
            if (!File.Exists(powershellPath))
            {
                powershellPath = "powershell.exe";
            }

            var currentProcessId = Process.GetCurrentProcess().Id;
            var startInfo = new ProcessStartInfo();
            startInfo.FileName = powershellPath;
            startInfo.Arguments = string.Format(
                "-ExecutionPolicy Bypass -File \"{0}\" -ExtensionId \"{1}\" -WaitForProcessId {2}",
                installScriptPath,
                EscapeArgument(extensionId),
                currentProcessId
            );
            startInfo.WorkingDirectory = Path.GetDirectoryName(installScriptPath) ?? Environment.CurrentDirectory;
            startInfo.UseShellExecute = false;
            startInfo.CreateNoWindow = true;

            var process = Process.Start(startInfo);
            var response = Response(true, null);
            response.Add("launched", process != null);
            response.Add("updaterPid", process != null ? process.Id : 0);
            response.Add("nextStep", "Reload the extension after the bridge update finishes.");
            return response;
        }

        private static string EscapeWmiString(string value)
        {
            return (value ?? string.Empty).Replace("\\", "\\\\").Replace("'", "\\'");
        }

        private static IEnumerable<Tuple<int, string>> FindMatchingServerProcesses(string serverExePath)
        {
            var processName = Path.GetFileName(serverExePath);
            var normalizedPath = Path.GetFullPath(serverExePath ?? string.Empty);
            var query = string.Format(
                "SELECT ProcessId, ExecutablePath FROM Win32_Process WHERE Name = '{0}'",
                EscapeWmiString(processName)
            );

            using (var searcher = new ManagementObjectSearcher(query))
            {
                foreach (ManagementObject process in searcher.Get())
                {
                    using (process)
                    {
                        var executablePath = process["ExecutablePath"] as string;
                        if (string.IsNullOrWhiteSpace(executablePath))
                        {
                            continue;
                        }

                        string candidatePath;
                        try
                        {
                            candidatePath = Path.GetFullPath(executablePath);
                        }
                        catch
                        {
                            continue;
                        }

                        if (!string.Equals(candidatePath, normalizedPath, StringComparison.OrdinalIgnoreCase))
                        {
                            continue;
                        }

                        var processId = Convert.ToInt32(process["ProcessId"]);
                        yield return Tuple.Create(processId, candidatePath);
                    }
                }
            }
        }

        private static Dictionary<string, object> StopServer(string serverExePath)
        {
            if (string.IsNullOrWhiteSpace(serverExePath))
            {
                return Response(false, "Server executable path is required.");
            }

            var stoppedPids = new List<int>();

            foreach (var match in FindMatchingServerProcesses(serverExePath))
            {
                try
                {
                    using (var process = Process.GetProcessById(match.Item1))
                    {
                        stoppedPids.Add(process.Id);
                        process.Kill();
                        process.WaitForExit(5000);
                    }
                }
                catch (Exception ex)
                {
                    return Response(false, string.Format("Failed to stop server process {0}: {1}", match.Item1, ex.Message));
                }
            }

            var response = Response(true, null);
            response.Add("stopped", stoppedPids.Count > 0);
            response.Add("stoppedPids", stoppedPids.ToArray());
            return response;
        }

        private static Dictionary<string, object> CheckHealth()
        {
            var request = WebRequest.CreateHttp("http://127.0.0.1:8080/health");
            request.Method = "GET";
            request.Timeout = 1500;

            using (var response = (HttpWebResponse)request.GetResponse())
            using (var stream = response.GetResponseStream())
            using (var reader = new StreamReader(stream ?? Stream.Null))
            {
                var body = reader.ReadToEnd();
                var healthResponse = Response(true, null);
                healthResponse.Add("statusCode", (int)response.StatusCode);
                healthResponse.Add("body", body);
                return healthResponse;
            }
        }

        private static Dictionary<string, object> VerifyRegistration(string extensionId)
        {
            if (string.IsNullOrWhiteSpace(extensionId))
            {
                return Response(false, "Extension ID is required.");
            }

            var expectedOrigin = string.Format("chrome-extension://{0}/", extensionId.Trim());
            var response = Response(true, null);
            response.Add("expectedOrigin", expectedOrigin);
            response.Add("chrome", ReadRegistration(@"Software\Google\Chrome\NativeMessagingHosts\com.pockettts.engine", expectedOrigin));
            response.Add("edge", ReadRegistration(@"Software\Microsoft\Edge\NativeMessagingHosts\com.pockettts.engine", expectedOrigin));
            return response;
        }

        private static Dictionary<string, object> ReadRegistration(string subKeyPath, string expectedOrigin)
        {
            var result = new Dictionary<string, object>();
            result.Add("keyPath", string.Format(@"HKCU\{0}", subKeyPath));

            using (var key = Registry.CurrentUser.OpenSubKey(subKeyPath))
            {
                if (key == null)
                {
                    result.Add("registered", false);
                    result.Add("error", "Registry key not found.");
                    return result;
                }

                var manifestPath = key.GetValue(null) as string;
                result.Add("manifestPath", manifestPath ?? string.Empty);

                if (string.IsNullOrWhiteSpace(manifestPath) || !File.Exists(manifestPath))
                {
                    result.Add("registered", false);
                    result.Add("error", "Manifest file not found.");
                    return result;
                }

                var manifestJson = File.ReadAllText(manifestPath);
                var registered = manifestJson.IndexOf(expectedOrigin, StringComparison.OrdinalIgnoreCase) >= 0;
                result.Add("registered", registered);
                result.Add("originMatched", registered);

                if (!registered)
                {
                    result.Add("error", "Expected extension origin was not found in the manifest.");
                }

                return result;
            }
        }

        private static Dictionary<string, object> SynthesizeReferenceSpeech(NativeRequest request)
        {
            var cliExePath = request.cliExePath;
            if (string.IsNullOrWhiteSpace(cliExePath) || !File.Exists(cliExePath))
            {
                return Response(false, string.Format("CLI executable not found: {0}", cliExePath));
            }

            var modelPath = request.modelPath;
            if (string.IsNullOrWhiteSpace(modelPath) || !Directory.Exists(modelPath))
            {
                return Response(false, string.Format("Pocket model path not found: {0}", modelPath));
            }

            if (string.IsNullOrWhiteSpace(request.text))
            {
                return Response(false, "Text is required.");
            }

            if (string.IsNullOrWhiteSpace(request.voiceRefBase64))
            {
                return Response(false, "Reference voice WAV is required.");
            }

            var backend = string.IsNullOrWhiteSpace(request.backend) ? "cuda" : request.backend.Trim();
            var family = string.IsNullOrWhiteSpace(request.family) ? "pocket_tts" : request.family.Trim();
            var tempRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PocketTTSEngine", "tmp");
            Directory.CreateDirectory(tempRoot);

            var requestId = Guid.NewGuid().ToString("N");
            var voiceRefName = SanitizeFileName(string.IsNullOrWhiteSpace(request.voiceRefFileName) ? "reference.wav" : request.voiceRefFileName.Trim());
            var voiceRefPath = Path.Combine(tempRoot, requestId + "-" + voiceRefName);
            var outputPath = Path.Combine(tempRoot, requestId + "-tts.wav");

            try
            {
                File.WriteAllBytes(voiceRefPath, Convert.FromBase64String(request.voiceRefBase64));

                var startInfo = new ProcessStartInfo();
                startInfo.FileName = cliExePath;
                startInfo.Arguments = string.Format(
                    "--task tts --family {0} --model \"{1}\" --backend {2} --text \"{3}\" --voice-ref \"{4}\" --out \"{5}\"",
                    family,
                    modelPath,
                    backend,
                    EscapeArgument(request.text),
                    voiceRefPath,
                    outputPath
                );
                startInfo.WorkingDirectory = Path.GetDirectoryName(cliExePath) ?? Environment.CurrentDirectory;
                startInfo.UseShellExecute = false;
                startInfo.CreateNoWindow = true;
                startInfo.RedirectStandardOutput = true;
                startInfo.RedirectStandardError = true;

                using (var process = Process.Start(startInfo))
                {
                    if (process == null)
                    {
                        return Response(false, "Failed to start audiocpp_cli.");
                    }

                    var stdout = process.StandardOutput.ReadToEnd();
                    var stderr = process.StandardError.ReadToEnd();
                    if (!process.WaitForExit(120000))
                    {
                        try
                        {
                            process.Kill();
                        }
                        catch
                        {
                        }

                        return Response(false, "audiocpp_cli timed out during reference synthesis.");
                    }

                    if (process.ExitCode != 0)
                    {
                        return Response(false, string.Format("audiocpp_cli failed with exit code {0}: {1}", process.ExitCode, string.IsNullOrWhiteSpace(stderr) ? stdout : stderr));
                    }

                    if (!File.Exists(outputPath))
                    {
                        return Response(false, "Reference synthesis completed but no WAV output was created.");
                    }

                    var wavBytes = File.ReadAllBytes(outputPath);
                    var response = Response(true, null);
                    response.Add("wavBase64", Convert.ToBase64String(wavBytes));
                    response.Add("byteLength", wavBytes.Length);
                    response.Add("stdout", stdout);
                    response.Add("stderr", stderr);
                    return response;
                }
            }
            catch (Exception ex)
            {
                return Response(false, ex.Message);
            }
            finally
            {
                TryDeleteFile(voiceRefPath);
                TryDeleteFile(outputPath);
            }
        }

        private static string EscapeArgument(string value)
        {
            return (value ?? string.Empty).Replace("\"", "\\\"");
        }

        private static string SanitizeFileName(string value)
        {
            var invalidChars = Path.GetInvalidFileNameChars();
            var builder = new StringBuilder(value.Length);
            foreach (var character in value)
            {
                builder.Append(Array.IndexOf(invalidChars, character) >= 0 ? '_' : character);
            }

            var sanitized = builder.ToString();
            return string.IsNullOrWhiteSpace(sanitized) ? "reference.wav" : sanitized;
        }

        private static void TryDeleteFile(string path)
        {
            try
            {
                if (!string.IsNullOrWhiteSpace(path) && File.Exists(path))
                {
                    File.Delete(path);
                }
            }
            catch
            {
            }
        }
    }
}
