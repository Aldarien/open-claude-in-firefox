# Registers the native messaging host for Firefox (current user) and builds/starts the Docker hub.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$bat = Join-Path $PSScriptRoot 'native-host.bat'
$manifest = Join-Path $PSScriptRoot 'com.anthropic.open_claude_in_firefox.json'
$tpl = Get-Content (Join-Path $PSScriptRoot 'com.anthropic.open_claude_in_firefox.json.template') -Raw
$tpl.Replace('__NATIVE_HOST_BAT__', ($bat -replace '\\','\\')) | Set-Content $manifest -Encoding ascii
$keys = 'HKCU:\SOFTWARE\Mozilla\NativeMessagingHosts\com.anthropic.open_claude_in_firefox',
        'HKCU:\SOFTWARE\LibreWolf\NativeMessagingHosts\com.anthropic.open_claude_in_firefox'
foreach ($key in $keys) {
  New-Item -Path $key -Force | Out-Null
  Set-ItemProperty -Path $key -Name '(Default)' -Value $manifest
}
docker compose -f (Join-Path $root 'docker-compose.yml') up -d --build
Write-Host "Registered $manifest. Restart Firefox, then load/install the extension."
