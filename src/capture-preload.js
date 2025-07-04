// capture-preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('captureAPI', {
  sendBounds: (bounds) => ipcRenderer.send('capture-area', bounds),
  cancel: () => ipcRenderer.send('capture-cancelled')
});