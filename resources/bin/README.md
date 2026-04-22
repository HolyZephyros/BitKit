# Binaries Directory

This directory is kept out of Git to keep the repository lightweight. 
The binaries (`ffmpeg.exe`, `ffprobe.exe`, `yt-dlp.exe`) are handled locally for development.

For the production `.exe`, `electron-builder` packs the local content of this folder directly into the app.
`yt-dlp.exe` is copied to the user's `AppData` folder on startup to ensure it can auto-update without `Permission Denied` errors in `Program Files`.
