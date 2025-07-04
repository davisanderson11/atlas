// src/preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlayAPI', {
  // replace getText() entirely
  onText: callback => ipcRenderer.on('overlay-text', (_ev, text) => callback(text)),
  onData: callback => ipcRenderer.on('overlay-data', (_ev, data) => callback(data)),
  askFollowUp: q => ipcRenderer.invoke('overlay-followup', q),
  processRewind: q => ipcRenderer.invoke('rewind-process', q),
  closeOverlay: () => ipcRenderer.send('overlay-close'),
  setIgnoreMouseEvents: (ignore) => ipcRenderer.send('set-ignore-mouse-events', ignore)
});
