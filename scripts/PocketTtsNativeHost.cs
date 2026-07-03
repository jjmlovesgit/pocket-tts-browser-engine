using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
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
    }

    internal static class Program
    {
        private const string HostVersion = "1.0.0";

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
            startInfo.WorkingDirectory = Path.GetDirectoryName(serverExePath) ?? Environment.CurrentDirectory;
            startInfo.UseShellExecute = false;
            startInfo.CreateNoWindow = true;

            var process = Process.Start(startInfo);
            var startResponse = Response(true, null);
            startResponse.Add("alreadyRunning", false);
            startResponse.Add("pid", process != null ? process.Id : 0);
            return startResponse;
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
    }
}
