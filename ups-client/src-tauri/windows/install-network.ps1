param([switch]$Elevated)

$ErrorActionPreference = 'Stop'
try {
    $ruleName = 'TMS UPS Monitor Discovery'
    $nativeSystem = if (Test-Path "$env:SystemRoot\Sysnative") { "$env:SystemRoot\Sysnative" } else { "$env:SystemRoot\System32" }
    Import-Module "$nativeSystem\WindowsPowerShell\v1.0\Modules\NetSecurity\NetSecurity.psd1" -ErrorAction Stop
    $rule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue |
        Where-Object { $_.Enabled -eq 'True' -and $_.Direction -eq 'Inbound' -and $_.Action -eq 'Allow' } |
        Get-NetFirewallPortFilter | Where-Object { $_.Protocol -eq 'UDP' -and $_.LocalPort -eq '7792' }
    if ($rule) { exit 0 }

    $admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $admin) {
        if ($Elevated) { throw '관리자 권한을 얻지 못했습니다.' }
        $arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $PSCommandPath + '" -Elevated'
        $process = Start-Process -FilePath "$PSHOME\powershell.exe" -ArgumentList $arguments -Verb RunAs -WindowStyle Hidden -Wait -PassThru
        exit $process.ExitCode
    }
    New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol UDP -LocalPort 7792 -Profile Any | Out-Null
    exit 0
} catch {
    Write-Error -ErrorRecord $_ -ErrorAction Continue
    exit 20
}
