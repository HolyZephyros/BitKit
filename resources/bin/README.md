# Binaries Directory

This directory is kept out of Git to keep the repository lightweight.
Run `npm run fetch-bins` (or `.\scripts\fetch-bins.ps1`) to download all local runtime binaries:

- `yt-dlp.exe` — media downloader
- `deno.exe` — fast JS runtime for YouTube extraction
- `ffmpeg.exe`, `ffprobe.exe`, and shared `*.dll` libraries — media conversion & probing (shared GPL build to avoid duplicating codec libraries)

For production builds, Tauri (`src-tauri/tauri.conf.json`) bundles this folder into the installer's `bin/` resources.
On startup, BitKit automatically syncs these binaries into `%APPDATA%\BitKit\bin` so `yt-dlp` and `FFmpeg` can self-update cleanly without Administrator permissions.
