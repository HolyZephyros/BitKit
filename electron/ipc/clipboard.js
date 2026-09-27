const { clipboard } = require('electron');

let watcherInterval = null;
let lastClipboardText = '';

function extractUrls(text) {
  if (!text || typeof text !== 'string') return [];
  const urlRegex = /(https?:\/\/[^\s<>"'{}|\\^`]+)/gi;
  const matches = text.match(urlRegex) || [];

  const cleaned = matches.map(url => {
    return url.replace(/[.,;:!?)\]]+$/, '');
  }).filter(url => {
    try {
      const u = new URL(url);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  });

  return [...new Set(cleaned)];
}

function register(ipcMain, getMainWindow) {
  ipcMain.handle('clipboard:startWatch', () => {
    if (watcherInterval) {
      clearInterval(watcherInterval);
    }

    try {
      lastClipboardText = clipboard.readText().trim();
    } catch {
      lastClipboardText = '';
    }

    watcherInterval = setInterval(() => {
      try {
        const currentText = clipboard.readText().trim();
        if (currentText && currentText !== lastClipboardText) {
          lastClipboardText = currentText;
          const urls = extractUrls(currentText);
          if (urls.length > 0) {
            const win = getMainWindow ? getMainWindow() : null;
            if (win && !win.isDestroyed()) {
              win.webContents.send('clipboard:urlsDetected', urls);
            }
          }
        }
      } catch (err) {
        // Ignore clipboard access errors (e.g. OS lock)
      }
    }, 400);

    return { success: true };
  });

  ipcMain.handle('clipboard:stopWatch', () => {
    if (watcherInterval) {
      clearInterval(watcherInterval);
      watcherInterval = null;
    }
    return { success: true };
  });

  ipcMain.handle('clipboard:readText', () => {
    try {
      return clipboard.readText();
    } catch {
      return '';
    }
  });
}

function stopWatch() {
  if (watcherInterval) {
    clearInterval(watcherInterval);
    watcherInterval = null;
  }
}

module.exports = { register, stopWatch, extractUrls };
