# render.ps1 - render a poster HTML to a 2000x3000 PNG via headless Chrome
# Usage: powershell -File render.ps1 -Html poster.html -Out out.png -Images a.png[,b.jpg,c.jpg]
#   Placeholders in the HTML are replaced with base64 data URIs, in order:
#     ART_SRC / IMG1 -> Images[0],  IMG2 -> Images[1],  IMG3 -> Images[2], ...
# NOTE: keep this file ASCII-only. PowerShell 5.1 mangles UTF-8 .ps1 without a BOM.
# Hangul-path workaround: images are inlined; Chrome writes to an ASCII temp dir, then we copy.
param(
  [Parameter(Mandatory = $true)][string]$Html,
  [Parameter(Mandatory = $true)][string]$Out,
  [Parameter(Mandatory = $true)][string[]]$Images
)
$ErrorActionPreference = 'Stop'

$candidates = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
)
$chrome = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) { throw "No Chrome/Edge found" }

function Get-DataUri([string]$p) {
  $full = (Resolve-Path $p).Path
  $ext = [IO.Path]::GetExtension($full).TrimStart('.').ToLower()
  $mime = if ($ext -eq 'png') { 'image/png' } elseif ($ext -eq 'webp') { 'image/webp' } else { 'image/jpeg' }
  return 'data:' + $mime + ';base64,' + [Convert]::ToBase64String([IO.File]::ReadAllBytes($full))
}

$content = Get-Content $Html -Raw -Encoding UTF8
for ($i = 0; $i -lt $Images.Count; $i++) {
  $uri = Get-DataUri $Images[$i]
  $content = $content.Replace(('IMG' + ($i + 1)), $uri)
  if ($i -eq 0) { $content = $content.Replace('ART_SRC', $uri) }
  Write-Output ("  IMG{0} <- {1}" -f ($i + 1), (Split-Path -Leaf $Images[$i]))
}

$tmp = Join-Path $env:TEMP ("poster-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$htmlPath = Join-Path $tmp 'p.html'
$pngPath = Join-Path $tmp 'p.png'
[IO.File]::WriteAllText($htmlPath, $content, (New-Object Text.UTF8Encoding $true))

$fileUrl = 'file:///' + ($htmlPath -replace '\\', '/')
$profDir = Join-Path $tmp 'prof'
& $chrome --headless --disable-gpu --hide-scrollbars --user-data-dir="$profDir" --screenshot="$pngPath" --window-size=1000,1500 --force-device-scale-factor=2 $fileUrl | Out-Null

if (-not (Test-Path $pngPath)) { throw "render failed: no screenshot produced" }

$outDir = Split-Path -Parent $Out
if ($outDir -and -not (Test-Path $outDir)) { New-Item -ItemType Directory -Force -Path $outDir | Out-Null }
Copy-Item $pngPath $Out -Force
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue

Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile((Resolve-Path $Out))
Write-Output ("SAVED {0}  {1}x{2}  {3} KB" -f $Out, $img.Width, $img.Height, [math]::Round((Get-Item $Out).Length / 1KB))
$img.Dispose()
