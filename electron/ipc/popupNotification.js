const { BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');

let popupWindow = null;
let hideTimer = null;
let closeTimer = null;

function createPopupWindow() {
  if (popupWindow && !popupWindow.isDestroyed()) {
    return popupWindow;
  }

  popupWindow = new BrowserWindow({
    width: 340,
    height: 84,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    resizable: false,
    show: false,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, '../preload-popup.js')
    }
  });

  popupWindow.loadFile(path.join(__dirname, '../popup.html'));

  popupWindow.on('closed', () => {
    popupWindow = null;
  });

  return popupWindow;
}

function showPopup(data) {
  const win = createPopupWindow();

  if (hideTimer) clearTimeout(hideTimer);
  if (closeTimer) clearTimeout(closeTimer);

  const display = screen.getPrimaryDisplay();
  const { x, y, width, height } = display.workArea;
  const winWidth = 340;
  const winHeight = 84;
  const posX = Math.round(x + width - winWidth - 16);
  const posY = Math.round(y + height - winHeight - 16);

  win.setBounds({
    x: posX,
    y: posY,
    width: winWidth,
    height: winHeight
  });

  // showInactive ensures it doesn't steal focus from active windows
  if (!win.isVisible()) {
    win.showInactive();
  }

  const sendData = () => {
    if (win && !win.isDestroyed() && win.webContents) {
      win.webContents.send('popup:data', data || {});
    }
  };

  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', sendData);
  } else {
    sendData();
  }

  hideTimer = setTimeout(() => {
    if (win && !win.isDestroyed() && win.webContents) {
      win.webContents.send('popup:hide');
      closeTimer = setTimeout(() => {
        if (win && !win.isDestroyed()) {
          win.hide();
        }
      }, 250);
    }
  }, 2500);
}

function register(ipcMain, getMainWindow) {
  ipcMain.handle('popup:show', (event, data) => {
    showPopup(data);
    return true;
  });

  ipcMain.handle('popup:close', () => {
    if (popupWindow && !popupWindow.isDestroyed()) {
      popupWindow.hide();
    }
    return true;
  });

  ipcMain.on('popup:clicked', () => {
    const main = getMainWindow ? getMainWindow() : null;
    if (main && !main.isDestroyed()) {
      if (main.isMinimized()) main.restore();
      main.show();
      main.focus();
    }
    if (popupWindow && !popupWindow.isDestroyed()) {
      popupWindow.hide();
    }
  });
}

function destroy() {
  if (hideTimer) clearTimeout(hideTimer);
  if (closeTimer) clearTimeout(closeTimer);
  if (popupWindow && !popupWindow.isDestroyed()) {
    popupWindow.destroy();
    popupWindow = null;
  }
}

module.exports = { register, showPopup, destroy };
