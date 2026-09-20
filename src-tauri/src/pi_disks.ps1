$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$items = @(Get-Disk | Where-Object {
    -not $_.IsBoot -and -not $_.IsSystem -and -not $_.IsOffline -and -not $_.IsReadOnly -and
    $_.BusType.ToString() -in @('USB', 'SD', 'MMC') -and $_.Size -ge 4GB -and $_.Size -le 512GB -and $_.UniqueId
} | ForEach-Object {
    [ordered]@{ number = [int]$_.Number; name = $_.FriendlyName; size = [long]$_.Size;
        uniqueId = $_.UniqueId; serial = $_.SerialNumber; bus = $_.BusType.ToString() }
})
ConvertTo-Json -InputObject $items -Compress
