$ErrorActionPreference = 'Stop'
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

Write-Host "Checking yt-dlp version..." -ForegroundColor Cyan
$ytdlpApi = Invoke-RestMethod -Uri "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest"
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
    Expand-Archive -Path $tempZip -DestinationPath $tempExt -Force

    $denoSrc = Join-Path $tempExt "deno.exe"
    Copy-Item -Path $denoSrc -Destination $denoDest -Force

    Write-Host "Deno extracted successfully!" -ForegroundColor Green
    Remove-Item -Path $tempZip -Force
    Remove-Item -Recurse -Force $tempExt
    $currentVersions."deno" = "latest"
}

Write-Host "Checking FFmpeg..." -ForegroundColor Cyan
$ffmpegDest = Join-Path $binFolder "ffmpeg.exe"

if ((Test-Path $ffmpegDest) -and $currentVersions."ffmpeg") {
    Write-Host "FFmpeg is already installed. Skipping download to save time." -ForegroundColor Green
}
else {
    $api = Invoke-RestMethod -Uri "https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/latest"
    $ffmpegVersion = $api.published_at
    Write-Host "Downloading FFmpeg ($ffmpegVersion)..." -ForegroundColor Yellow
    $asset = $api.assets | Where-Object { $_.name -like '*win64-gpl.zip' } | Select-Object -First 1
    if (!$asset) { throw "FFmpeg release not found" }

    $tempDir = [System.IO.Path]::GetTempPath()
    $tempZip = Join-Path $tempDir "ffmpeg_prebuild.zip"
    $tempExt = Join-Path $tempDir "ffmpeg_ext_prebuild"
    if (Test-Path $tempExt) { Remove-Item -Recurse -Force $tempExt }

    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $tempZip -UseBasicParsing
    Write-Host "Extracting FFmpeg zip archive..." -ForegroundColor Yellow
    Expand-Archive -Path $tempZip -DestinationPath $tempExt -Force

    $extractedFolder = Get-ChildItem -Path $tempExt -Directory | Select-Object -First 1
    $ffmpegSrc = Join-Path $extractedFolder.FullName "bin\ffmpeg.exe"
    $ffprobeSrc = Join-Path $extractedFolder.FullName "bin\ffprobe.exe"

    Copy-Item -Path $ffmpegSrc -Destination $ffmpegDest -Force
    Copy-Item -Path $ffprobeSrc -Destination (Join-Path $binFolder "ffprobe.exe") -Force

    Write-Host "FFmpeg & FFprobe extracted successfully!" -ForegroundColor Green
    Remove-Item -Path $tempZip -Force
    Remove-Item -Recurse -Force $tempExt
    $currentVersions."ffmpeg" = $ffmpegVersion
}

$currentVersions | ConvertTo-Json | Out-File -FilePath $versionFile -Encoding UTF8
Write-Host "All tools are ready for build!" -ForegroundColor Green