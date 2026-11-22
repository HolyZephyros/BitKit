$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.IO.Compression.FileSystem
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$binFolder = Join-Path $PSScriptRoot "..\resources\bin"

if (!(Test-Path $binFolder)) {
    New-Item -ItemType Directory -Force -Path $binFolder | Out-Null
}

$versionFile = Join-Path $binFolder "versions.json"
$currentVersions = @{}
if (Test-Path $versionFile) {
    $json = Get-Content $versionFile -Raw | ConvertFrom-Json
    if ($json) {
        foreach ($prop in $json.PSObject.Properties) {
            $currentVersions[$prop.Name] = $prop.Value
        }
    }
}

$ghHeaders = @{ "User-Agent" = "BitKit" }
if ($env:GITHUB_TOKEN) {
    $ghHeaders["Authorization"] = "Bearer $($env:GITHUB_TOKEN)"
}

Write-Host "Checking yt-dlp version..." -ForegroundColor Cyan
$ytdlpApi = Invoke-RestMethod -Uri "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest" -Headers $ghHeaders
$ytdlpVersion = $ytdlpApi.tag_name
$ytdlpDest = Join-Path $binFolder "yt-dlp.exe"

if ((Test-Path $ytdlpDest) -and ($currentVersions."yt-dlp" -eq $ytdlpVersion)) {
    Write-Host "yt-dlp is already up to date ($ytdlpVersion). Skipping." -ForegroundColor Green
}
else {
    Write-Host "Downloading yt-dlp ($ytdlpVersion)..." -ForegroundColor Yellow
    $ytdlpUrl = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
    Invoke-WebRequest -Uri $ytdlpUrl -OutFile $ytdlpDest -UseBasicParsing
    Write-Host "yt-dlp downloaded successfully!" -ForegroundColor Green
    $currentVersions."yt-dlp" = $ytdlpVersion
}

Write-Host "Checking Deno..." -ForegroundColor Cyan
$denoDest = Join-Path $binFolder "deno.exe"

if ((Test-Path $denoDest) -and $currentVersions."deno") {
    Write-Host "Deno is already installed. Skipping download." -ForegroundColor Green
}
else {
    Write-Host "Downloading Deno..." -ForegroundColor Yellow
    $denoUrl = "https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip"
    $tempDir = [System.IO.Path]::GetTempPath()
    $tempZip = Join-Path $tempDir "deno_prebuild.zip"
    $tempExt = Join-Path $tempDir "deno_ext_prebuild"
    if (Test-Path $tempExt) { Remove-Item -Recurse -Force $tempExt }

    Invoke-WebRequest -Uri $denoUrl -OutFile $tempZip -UseBasicParsing
    Write-Host "Extracting Deno zip archive..." -ForegroundColor Yellow
    [System.IO.Compression.ZipFile]::ExtractToDirectory($tempZip, $tempExt)

    $denoSrc = Join-Path $tempExt "deno.exe"
    Copy-Item -Path $denoSrc -Destination $denoDest -Force

    Write-Host "Deno extracted successfully!" -ForegroundColor Green
    Remove-Item -Path $tempZip -Force
    Remove-Item -Recurse -Force $tempExt
    $currentVersions."deno" = "latest"
}

Write-Host "Checking FFmpeg (shared GPL build — ~240 MB smaller, 100% same codecs)..." -ForegroundColor Cyan
$ffmpegDest = Join-Path $binFolder "ffmpeg.exe"
$ffprobeDest = Join-Path $binFolder "ffprobe.exe"
$hasSharedDlls = (Get-ChildItem -Path $binFolder -Filter "avcodec-*.dll" -ErrorAction SilentlyContinue).Count -gt 0

if ((Test-Path $ffmpegDest) -and (Test-Path $ffprobeDest) -and $hasSharedDlls -and ($currentVersions."ffmpeg_mode" -eq "shared") -and $currentVersions."ffmpeg") {
    Write-Host "FFmpeg shared build is already installed. Skipping download." -ForegroundColor Green
}
else {
    $api = Invoke-RestMethod -Uri "https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/latest" -Headers $ghHeaders
    $ffmpegVersion = $api.published_at
    Write-Host "Downloading FFmpeg shared build ($ffmpegVersion)..." -ForegroundColor Yellow
    $asset = $api.assets | Where-Object { $_.name -like '*win64-gpl-shared.zip' } | Select-Object -First 1
    if (!$asset) { throw "FFmpeg shared release not found" }

    $tempDir = [System.IO.Path]::GetTempPath()
    $tempZip = Join-Path $tempDir "ffmpeg_prebuild.zip"
    $tempExt = Join-Path $tempDir "ffmpeg_ext_prebuild"
    if (Test-Path $tempExt) { Remove-Item -Recurse -Force $tempExt }

    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $tempZip -UseBasicParsing
    Write-Host "Extracting FFmpeg shared zip archive..." -ForegroundColor Yellow
    [System.IO.Compression.ZipFile]::ExtractToDirectory($tempZip, $tempExt)

    # Clean stale FFmpeg DLLs before copying new ones
    Get-ChildItem -Path $binFolder -Filter "*.dll" -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue

    $extractedFolder = Get-ChildItem -Path $tempExt -Directory | Select-Object -First 1
    $srcBinDir = Join-Path $extractedFolder.FullName "bin"

    Copy-Item -Path (Join-Path $srcBinDir "ffmpeg.exe") -Destination $ffmpegDest -Force
    Copy-Item -Path (Join-Path $srcBinDir "ffprobe.exe") -Destination $ffprobeDest -Force
    Get-ChildItem -Path $srcBinDir -Filter "*.dll" | ForEach-Object {
        Copy-Item -Path $_.FullName -Destination (Join-Path $binFolder $_.Name) -Force
    }

    Write-Host "FFmpeg & FFprobe (shared) extracted successfully!" -ForegroundColor Green
    Remove-Item -Path $tempZip -Force
    Remove-Item -Recurse -Force $tempExt
    $currentVersions."ffmpeg" = $ffmpegVersion
    $currentVersions."ffmpeg_mode" = "shared"
}

$currentVersions | ConvertTo-Json | Out-File -FilePath $versionFile -Encoding UTF8
Write-Host "All tools are ready for build!" -ForegroundColor Green
