// Preload script for status window

const { contextBridge, ipcRenderer } = require('electron');

// Expose status API to the renderer
contextBridge.exposeInMainWorld('statusAPI', {
  // Listen for status updates
  onStatusUpdate: (callback) => {
    ipcRenderer.on('status-update', (event, data) => {
      callback(data);
    });
  }
});