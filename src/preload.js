// src/preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlayAPI', {
  // replace getText() entirely
  onText: callback => ipcRenderer.on('overlay-text', (_ev, text) => callback(text)),
  askFollowUp: q => ipcRenderer.invoke('overlay-followup', q),
  closeOverlay: () => ipcRenderer.send('overlay-close')
});
