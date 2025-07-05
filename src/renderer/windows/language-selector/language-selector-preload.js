// Language selector preload script
const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('languageSelectorAPI', {
  selectLanguage: (language) => ipcRenderer.send('language-selected', language)
});