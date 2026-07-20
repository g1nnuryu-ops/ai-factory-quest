# render-b.ps1 - render poster.html (relative-src B branch) to 2000x3000 PNG.
# Inlines every local <img src="..."> as a base64 data URI, then screenshots from an
# ASCII temp dir so the Hangul project path never reaches Chrome. Keep ASCII-only.
# Usage: powershell -File render-b.ps1 [-Html poster.html] [-Out poster.png]
param(
  [string]$Html = 'poster.html',
  [string]$Out  = 'poster.png'
)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

$candidates = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
)
$chrome = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) { throw "No Chrome/Edge found" }

$htmlPath = Join-Path $here $Html
$content = Get-Content $htmlPath -Raw -Encoding UTF8

# Inline local raster src="..." references as data URIs
$rx = [regex]'src="(?<p>[^"]+\.(?:jpg|jpeg|png|webp))"'
$content = $rx.Replace($content, {
  param($m)
  $rel = $m.Groups['p'].Value
  $full = Join-Path $here $rel
  if (-not (Test-Path $full)) { return $m.Value }  # leave untouched if missing
  $ext = [IO.Path]::GetExtension($full).TrimStart('.').ToLower()
  $mime = if ($ext -eq 'png') { 'image/png' } elseif ($ext -eq 'webp') { 'image/webp' } else { 'image/jpeg' }
  $b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($full))
  Write-Output ("  inlined {0}" -f (Split-Path -Leaf $rel)) | Out-Host
  'src="data:' + $mime + ';base64,' + $b64 + '"'
})

$tmp = Join-Path $env:TEMP ("posterb-" + [Guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$tmpHtml = Join-Path $tmp 'p.html'
$tmpPng  = Join-Path $tmp 'p.png'
[IO.File]::WriteAllText($tmpHtml, $content, (New-Object Text.UTF8Encoding $true))

$fileUrl = 'file:///' + ($tmpHtml -replace '\\','/')
$profDir = Join-Path $tmp 'prof'
& $chrome --headless --disable-gpu --hide-scrollbars --user-data-dir="$profDir" --screenshot="$tmpPng" --window-size=1000,1500 --force-device-scale-factor=2 $fileUrl | Out-Null

if (-not (Test-Path $tmpPng)) { throw "render failed: no screenshot" }
$outPath = Join-Path $here $Out
Copy-Item $tmpPng $outPath -Force
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue

Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile((Resolve-Path $outPath))
Write-Output ("SAVED {0}  {1}x{2}  {3} KB" -f $Out, $img.Width, $img.Height, [math]::Round((Get-Item $outPath).Length/1KB))
$img.Dispose()
