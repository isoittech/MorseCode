#Requires -RunAsAdministrator
[CmdletBinding()]
param(
    [string]$Distribution = 'Ubuntu',
    [switch]$Remove
)

$ErrorActionPreference = 'Stop'
$MorsePort = 7631
$MorseRuleName = 'MorseCode-LAN-7631'

if ($Remove) {
    & netsh interface portproxy delete v4tov4 listenaddress=0.0.0.0 listenport=$MorsePort
    if ($LASTEXITCODE -ne 0) { throw 'Could not remove the port proxy.' }
    $MorseRule = Get-NetFirewallRule -Name $MorseRuleName -ErrorAction SilentlyContinue
    if ($MorseRule) { $MorseRule | Remove-NetFirewallRule }
    Write-Host 'MorseCode LAN forwarding removed.'
    exit 0
}

$MorseAddresses = & wsl.exe -d $Distribution --exec ip -4 -o addr show dev eth0
if ($LASTEXITCODE -ne 0) { throw 'Could not query the WSL network address.' }
$MorseMatch = [regex]::Match(($MorseAddresses -join ' '), '\binet\s+(\d{1,3}(?:\.\d{1,3}){3})/')
if (-not $MorseMatch.Success) { throw 'No WSL eth0 IPv4 address was found.' }
$MorseAddress = [System.Net.IPAddress]::Parse($MorseMatch.Groups[1].Value).ToString()

# Check the application before modifying the host's networking.
$MorseHealth = Invoke-RestMethod -Uri "http://${MorseAddress}:${MorsePort}/api/health" -TimeoutSec 5
if ($MorseHealth.status -ne 'ok') { throw 'MorseCode is not running. Run pnpm start first.' }

& netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=$MorsePort connectaddress=$MorseAddress connectport=$MorsePort
if ($LASTEXITCODE -ne 0) { throw 'Could not configure the port proxy.' }

$MorseRule = Get-NetFirewallRule -Name $MorseRuleName -ErrorAction SilentlyContinue
if ($MorseRule) {
    $MorseRule | Set-NetFirewallRule -Enabled True -Direction Inbound -Action Allow -Profile Any
    $MorseRule | Get-NetFirewallAddressFilter | Set-NetFirewallAddressFilter -RemoteAddress LocalSubnet
    $MorseRule | Get-NetFirewallPortFilter | Set-NetFirewallPortFilter -Protocol TCP -LocalPort $MorsePort
} else {
    New-NetFirewallRule -Name $MorseRuleName -DisplayName 'MorseCode LAN TCP 7631' -Direction Inbound -Action Allow -Enabled True -Protocol TCP -LocalPort $MorsePort -RemoteAddress LocalSubnet -Profile Any | Out-Null
}

Write-Host "MorseCode LAN forwarding is ready: TCP ${MorsePort} -> ${MorseAddress}:${MorsePort}"
Write-Host 'Use this Windows computer LAN address in the browser. Rerun after the WSL IP changes.'
