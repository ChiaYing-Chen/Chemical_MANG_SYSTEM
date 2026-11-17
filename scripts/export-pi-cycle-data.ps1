param(
    [Parameter(Mandatory=$true)][string]$OutputDirectory,
    [Parameter(Mandatory=$true)][ValidatePattern('^\d{4}-\d{2}-\d{2}$')][string]$AsOf
)
# 唯讀匯出近 18 個月資料；不讀取補藥欄位、不修改正式資料。
$ErrorActionPreference='Stop'
$endDate=[datetime]::ParseExact($AsOf,'yyyy-MM-dd',$null)
$startDate=$endDate.AddMonths(-18).ToString('yyyy-MM-dd')
$startTime=[uri]::EscapeDataString($startDate+'T00:00:00+08:00')
$endTime=[uri]::EscapeDataString($AsOf+'T00:00:00+08:00')
New-Item -ItemType Directory -Force $OutputDirectory | Out-Null
$tanks=Invoke-RestMethod 'http://10.122.51.61/WTCA/api/tanks'
$readings=Invoke-RestMethod 'http://10.122.51.61/WTCA/api/readings'
$tanks | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $OutputDirectory 'tanks.json') -Encoding utf8
$readings | Select-Object tank_id,timestamp,level_cm | ConvertTo-Json | Set-Content (Join-Path $OutputDirectory 'readings.json') -Encoding utf8
$base='https://10.122.51.61/piwebapi'
$servers=Invoke-RestMethod "$base/dataservers" -UseDefaultCredentials -SkipCertificateCheck
$server=$servers.Items | Where-Object Name -eq '10.122.51.60' | Select-Object -First 1
if(-not $server){throw '找不到預期的 PI Server 10.122.51.60'}
foreach($tank in ($tanks | Where-Object {$_.pi_level_tag -and $_.name -notmatch '氨水|消泡劑|微生物分散劑|非氧化型殺菌劑'})) {
    $tag=[uri]::EscapeDataString($tank.pi_level_tag)
    $points=Invoke-RestMethod "$base/dataservers/$($server.WebId)/points?nameFilter=$tag" -UseDefaultCredentials -SkipCertificateCheck
    $point=$points.Items | Where-Object Name -eq $tank.pi_level_tag | Select-Object -First 1
    if(-not $point){throw "找不到 Tag：$($tank.pi_level_tag)"}
    $series=Invoke-RestMethod "$base/streams/$($point.WebId)/interpolated?startTime=$startTime&endTime=$endTime&interval=1h" -UseDefaultCredentials -SkipCertificateCheck -TimeoutSec 120
    $series.Items | Select-Object Timestamp,Value,Good,Questionable | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $OutputDirectory ($tank.id+'.json')) -Encoding utf8
    Write-Output "$($tank.name)：$($series.Items.Count) 筆"
}
