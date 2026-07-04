[CmdletBinding()]
param(
    [string]$ExtensionId = "hijmjnmdgkcjlnhoimfnhkgkdaaeeaha",
    [string]$HostName = "com.pockettts.engine",
    [int]$WaitForProcessId = 0
)

$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$sourceFile = Join-Path $scriptRoot "PocketTtsNativeHost.cs"
$installRoot = Join-Path $env:LOCALAPPDATA "PocketTTSEngine\native-host"
$exePath = Join-Path $installRoot "PocketTtsNativeHost.exe"
$manifestPath = Join-Path $installRoot "$HostName.json"

New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
if ($WaitForProcessId -gt 0) {
    try {
        $existingProcess = Get-Process -Id $WaitForProcessId -ErrorAction Stop
        $existingProcess.WaitForExit()
        Start-Sleep -Milliseconds 250
    } catch {
        Start-Sleep -Milliseconds 250
    }
}
if (Test-Path -LiteralPath $exePath) {
    Remove-Item -LiteralPath $exePath -Force
}

Add-Type `
  -TypeDefinition (Get-Content -LiteralPath $sourceFile -Raw) `
  -Language CSharp `
  -OutputAssembly $exePath `
  -OutputType ConsoleApplication `
  -ReferencedAssemblies @("System.dll", "System.Core.dll", "System.Management.dll", "System.Web.Extensions.dll")

$manifest = @{
    name = $HostName
    description = "Pocket TTS local native messaging bridge"
    path = $exePath
    type = "stdio"
    allowed_origins = @("chrome-extension://$ExtensionId/")
}

$manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $manifestPath -Encoding UTF8

$chromeKey = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HostName"
$edgeKey = "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$HostName"

New-Item -Path $chromeKey -Force | Out-Null
Set-Item -Path $chromeKey -Value $manifestPath
New-Item -Path $edgeKey -Force | Out-Null
Set-Item -Path $edgeKey -Value $manifestPath

Write-Host "Installed Pocket TTS native bridge."
Write-Host "Extension ID: $ExtensionId"
Write-Host "Manifest: $manifestPath"
Write-Host "Executable: $exePath"
