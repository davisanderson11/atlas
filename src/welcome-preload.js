// src/welcome-preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('welcomeAPI', {
  minimizeWindow: () => ipcRenderer.send('welcome-minimize'),
  maximizeWindow: () => ipcRenderer.send('welcome-maximize'),
  closeWindow: () => ipcRenderer.send('welcome-close')
});