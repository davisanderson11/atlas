// src/welcome-preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('welcomeAPI', {
  minimizeWindow: () => ipcRenderer.send('welcome-minimize'),
  maximizeWindow: () => ipcRenderer.send('welcome-maximize'),
  closeWindow: () => ipcRenderer.send('welcome-close'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  updateSetting: (setting, value) => ipcRenderer.invoke('update-setting', setting, value)
});