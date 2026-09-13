param(
    [ValidateSet('Install', 'Verify', 'VerifyOffline')][string]$Action = 'Install',
    [switch]$Capture,
    [string]$Installer,
    [string]$ExpectedHash,
    [switch]$Oem,
    [switch]$Elevated
)

$ErrorActionPreference = 'Stop'
function Assert-Installer([string]$Path, [string]$Hash, [bool]$VerifySignature = $false) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw 'Npcap 설치 파일이 없습니다.' }
    $stream = [IO.File]::OpenRead($Path)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $actualHash = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '') }
    finally { $sha.Dispose(); $stream.Dispose() }
    if (-not $Hash -or $actualHash -ne $Hash) {
        throw 'Npcap 설치 파일의 SHA-256이 일치하지 않습니다.'
    }
    # Check the certificate chain on the build PC. Offline installs use the hash pinned
    # inside Setup, avoiding certificate/CRL downloads on the isolated facility PC.
    if ($VerifySignature) {
        Import-Module "$PSHOME\Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1" -ErrorAction Stop
        $signature = Get-AuthenticodeSignature -LiteralPath $Path
        if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch '(^|,\s*)CN=Nmap Software LLC(,|$)') {
            throw 'Npcap 설치 파일의 Nmap 전자서명을 확인할 수 없습니다.'
        }
    }
}

function Get-NpcapReady {
    $nativeSystem = if (Test-Path "$env:SystemRoot\Sysnative") { "$env:SystemRoot\Sysnative" } else { "$env:SystemRoot\System32" }
    return ((Test-Path "$nativeSystem\Npcap\wpcap.dll") -and ($null -ne (Get-Service npcap -ErrorAction SilentlyContinue)))
}

try {
    if ($Action -eq 'Verify') {
        Assert-Installer $Installer $ExpectedHash $true
        exit 0
    }
    if ($Action -eq 'VerifyOffline') {
        Assert-Installer $Installer $ExpectedHash
        exit 0
    }
    $ruleName = 'TMS Ping Monitor Discovery'
    $nativeSystem = if (Test-Path "$env:SystemRoot\Sysnative") { "$env:SystemRoot\Sysnative" } else { "$env:SystemRoot\System32" }
    Import-Module "$nativeSystem\WindowsPowerShell\v1.0\Modules\NetSecurity\NetSecurity.psd1" -ErrorAction Stop
    $rule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue |
        Where-Object { $_.Enabled -eq 'True' -and $_.Direction -eq 'Inbound' -and $_.Action -eq 'Allow' } |
        Get-NetFirewallPortFilter | Where-Object { $_.Protocol -eq 'UDP' -and $_.LocalPort -eq '7791' }
    $needsCapture = $Capture -and -not (Get-NpcapReady)
    if ($rule -and -not $needsCapture) { exit 0 }

    $admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $admin) {
        if ($Elevated) { throw '관리자 권한을 얻지 못했습니다.' }
        $arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $PSCommandPath + '" -Action Install -Elevated'
        if ($Capture) { $arguments += ' -Capture' }
        if ($Oem) { $arguments += ' -Oem' }
        if ($Installer) { $arguments += ' -Installer "' + $Installer + '"' }
        if ($ExpectedHash) { $arguments += ' -ExpectedHash "' + $ExpectedHash + '"' }
        $process = Start-Process -FilePath "$PSHOME\powershell.exe" -ArgumentList $arguments -Verb RunAs -WindowStyle Hidden -Wait -PassThru
        exit $process.ExitCode
    }

    $reboot = $false
    if ($needsCapture) {
        if (-not $Installer) { throw 'Setup에 포함된 Npcap 설치 파일이 필요합니다.' }
        Assert-Installer $Installer $ExpectedHash
        # The free installer stays interactive for its EULA. Only licensed OEM builds use /S.
        # Preserve existing WinPcap and never terminate another program using a capture driver.
        $options = '/winpcap_mode=no /no_kill=yes'
        if ($Oem) { $options = '/S ' + $options }
        $process = Start-Process -FilePath $Installer -ArgumentList $options -Wait -PassThru
        if ($process.ExitCode -eq 3010) { $reboot = $true }
        elseif ($process.ExitCode -ne 0 -or -not (Get-NpcapReady)) { throw "Npcap 설치가 완료되지 않았습니다 (코드 $($process.ExitCode))." }
    }
    if (-not $rule) {
        New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol UDP -LocalPort 7791 -Profile Any | Out-Null
    }
    if ($reboot) { exit 3010 }
    exit 0
} catch {
    Write-Error -ErrorRecord $_ -ErrorAction Continue
    exit 20
}
