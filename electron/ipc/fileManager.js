function register(ipcMain, dialog) {

  ipcMain.handle('file:select', async (event, options = {}) => {
    const filters = options.filters || [
      { name: 'Video', extensions: ['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'wmv', 'ts', 'm4v', 'm2ts', 'vob', 'mxf', '3gp', '3g2', 'ogv', 'asf', 'mpg', 'mpeg', 'gif'] },
      { name: 'Audio', extensions: ['mp3', 'flac', 'wav', 'aac', 'ogg', 'opus', 'wma', 'm4a', 'alac', 'aiff', 'ac3', 'eac3', 'ape', 'mka'] },
      { name: 'All Files', extensions: ['*'] }
    ];

    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: options.type === 'cookies'
        ? [{ name: 'Cookies', extensions: ['txt'] }, { name: 'All Files', extensions: ['*'] }]
        : filters
    });

    if (result.canceled) return { canceled: true };

    const filePath = result.filePaths[0];

    if (options.type === 'cookies') {
      try {
        const fs = require('fs');
        const path = require('path');
        const content = fs.readFileSync(filePath, 'utf-8');
        const hasYoutube = content.includes('.youtube.com') || content.includes('youtube.com');

        const { app } = require('electron');
        const safePath = path.join(app.getPath('userData'), 'cookies.txt');

        if (fs.existsSync(safePath)) {
          fs.unlinkSync(safePath);
        }

        fs.copyFileSync(filePath, safePath);

        return { canceled: false, path: safePath, hasYoutube };
      } catch (e) {
        return { canceled: false, path: filePath, hasYoutube: false };
      }
    }

    return { canceled: false, path: filePath };
  });

  ipcMain.handle('file:selectMultiple', async (event, options = {}) => {
    const defaultFilters = [
      { name: 'Media', extensions: ['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'wmv', 'ts', 'm4v', 'm2ts', 'vob', 'mxf', '3gp', '3g2', 'ogv', 'asf', 'mpg', 'mpeg', 'gif', 'mp3', 'flac', 'wav', 'aac', 'ogg', 'opus', 'wma', 'm4a', 'alac', 'aiff', 'ac3', 'eac3', 'ape', 'mka'] },
      { name: 'All Files', extensions: ['*'] }
    ];

    const result = await dialog.showOpenDialog({
      title: options.title || undefined,
      properties: ['openFile', 'multiSelections'],
      filters: options.filters || defaultFilters
    });

    if (result.canceled) return { canceled: true };
    return { canceled: false, paths: result.filePaths };
  });

  ipcMain.handle('file:selectFolder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory']
    });

    if (result.canceled) return { canceled: true };
    return { canceled: false, path: result.filePaths[0] };
  });

  ipcMain.handle('file:deleteCookies', async () => {
    try {
      const fs = require('fs');
      const path = require('path');
      const { app } = require('electron');
      const safePath = path.join(app.getPath('userData'), 'cookies.txt');
      if (fs.existsSync(safePath)) {
        fs.unlinkSync(safePath);
      }
      return true;
    } catch (e) {
      return false;
    }
  });
}

module.exports = { register };
