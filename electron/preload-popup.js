const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('popupBridge', {
  onData: (callback) => {
    ipcRenderer.on('popup:data', (event, data) => callback(data));
  },
  onHide: (callback) => {
    ipcRenderer.on('popup:hide', () => callback());
  },
  click: () => {
    ipcRenderer.send('popup:clicked');
  }
});
