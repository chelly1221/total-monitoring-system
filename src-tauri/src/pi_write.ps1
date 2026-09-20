param([Parameter(Mandatory=$true)][string]$JobPath)
$ErrorActionPreference = 'Stop'
$job = Get-Content -LiteralPath $JobPath -Raw -Encoding UTF8 | ConvertFrom-Json
$statusPath = Join-Path (Split-Path -Parent $JobPath) 'status.json'
function Report([string]$phase, [long]$done, [long]$total, [string]$message) {
    $json = @{ phase=$phase; done=$done; total=$total; message=$message } | ConvertTo-Json -Compress
    [IO.File]::WriteAllText($statusPath + '.tmp', $json, [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath ($statusPath + '.tmp') -Destination $statusPath -Force
}
$locks = [Collections.Generic.List[Microsoft.Win32.SafeHandles.SafeFileHandle]]::new()
$diskStream = $null
$imageStream = $null
try {
    $disk = Get-Disk -Number $job.disk.number
    if ($disk.IsBoot -or $disk.IsSystem -or $disk.IsOffline -or $disk.IsReadOnly -or
        $disk.BusType.ToString() -notin @('USB','SD','MMC') -or
        $disk.UniqueId -cne $job.disk.uniqueId -or [long]$disk.Size -ne [long]$job.disk.size -or
        $disk.SerialNumber -cne $job.disk.serial -or -not $disk.UniqueId -or
        $disk.Size -lt 4GB -or $disk.Size -gt 512GB) {
        throw '선택한 카드가 변경되었거나 시스템 디스크입니다. 다시 선택하세요.'
    }
    $source = Get-Item -LiteralPath $job.image
    if ($source.Length -gt $disk.Size -or $source.Length -le 0 -or $source.Length % $disk.LogicalSectorSize -ne 0) {
        throw '카드 용량 또는 섹터 크기가 이미지와 맞지 않습니다.'
    }
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class TmsDiskNative {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern SafeFileHandle CreateFile(string p, uint access, uint share, IntPtr security, uint mode, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool DeviceIoControl(SafeFileHandle h, uint code, IntPtr input, uint inSize, IntPtr output, uint outSize, out uint bytes, IntPtr overlapped);
}
'@
    # Hold every mounted volume locked until both writing and readback have completed.
    $volumes = @(Get-Partition -DiskNumber $disk.Number | ForEach-Object { $_.AccessPaths } | Where-Object { $_ -like '\\?\Volume{*' } | Select-Object -Unique)
    foreach ($volume in $volumes) {
        $handle = [TmsDiskNative]::CreateFile($volume.TrimEnd([char]92), [uint32]3221225472, 3, [IntPtr]::Zero, 3, 0, [IntPtr]::Zero)
        if ($handle.IsInvalid) { throw '카드 볼륨을 열지 못했습니다. 사용 중인 프로그램을 닫으세요.' }
        $locks.Add($handle)
        [uint32]$returned = 0
        if (-not [TmsDiskNative]::DeviceIoControl($handle, 0x90018, [IntPtr]::Zero, 0, [IntPtr]::Zero, 0, [ref]$returned, [IntPtr]::Zero)) {
            throw '카드를 잠글 수 없습니다. 탐색기와 카드 사용 프로그램을 닫으세요.'
        }
        if (-not [TmsDiskNative]::DeviceIoControl($handle, 0x90020, [IntPtr]::Zero, 0, [IntPtr]::Zero, 0, [ref]$returned, [IntPtr]::Zero)) { throw '카드 볼륨 해제 실패' }
    }
    $diskStream = [IO.FileStream]::new(('\\.\PhysicalDrive' + $disk.Number), [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::ReadWrite, 1048576, [IO.FileOptions]::WriteThrough)
    $imageStream = [IO.File]::OpenRead($source.FullName)
    $buffer = [byte[]]::new(1048576)
    [long]$done = 0
    $lastReport = [DateTime]::MinValue
    Report 'writing' 0 $source.Length 'OS와 센서 프로그램 기록 중'
    while (($read = $imageStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
        $diskStream.Write($buffer, 0, $read)
        $done += $read
        if (([DateTime]::UtcNow - $lastReport).TotalMilliseconds -ge 500) {
            Report 'writing' $done $source.Length 'OS와 센서 프로그램 기록 중'
            $lastReport = [DateTime]::UtcNow
        }
    }
    $diskStream.Flush($true)
    $diskStream.Position = 0
    $imageStream.Position = 0
    $actual = [byte[]]::new(1048576)
    [long]$done = 0
    $expectedHash = [Security.Cryptography.SHA256]::Create()
    $actualHash = [Security.Cryptography.SHA256]::Create()
    Report 'verifying' 0 $source.Length '기록한 카드 전체를 다시 읽어 검증 중'
    while (($read = $imageStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
        $offset = 0
        while ($offset -lt $read) {
            $count = $diskStream.Read($actual, $offset, $read - $offset)
            if ($count -eq 0) { throw '카드 읽기가 중단되었습니다.' }
            $offset += $count
        }
        $null = $expectedHash.TransformBlock($buffer, 0, $read, $null, 0)
        $null = $actualHash.TransformBlock($actual, 0, $read, $null, 0)
        $done += $read
        if (([DateTime]::UtcNow - $lastReport).TotalMilliseconds -ge 500) {
            Report 'verifying' $done $source.Length '기록한 카드 전체를 다시 읽어 검증 중'
            $lastReport = [DateTime]::UtcNow
        }
    }
    $null = $expectedHash.TransformFinalBlock([byte[]]::new(0), 0, 0)
    $null = $actualHash.TransformFinalBlock([byte[]]::new(0), 0, 0)
    if ([BitConverter]::ToString($expectedHash.Hash) -cne [BitConverter]::ToString($actualHash.Hash)) { throw '카드 기록 검증 실패. 카드를 다시 설치하세요.' }
    Report 'done' $done $source.Length '기록·검증 완료. 안전하게 제거한 후 라즈베리파이에 꽂으세요.'
} catch {
    Report 'error' 0 0 $_.Exception.Message
    exit 1
} finally {
    if ($diskStream) { $diskStream.Dispose() }
    if ($imageStream) { $imageStream.Dispose() }
    foreach ($handle in $locks) { $handle.Dispose() }
}
