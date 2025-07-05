// Preload script for action chip window

const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods to the renderer
contextBridge.exposeInMainWorld('actionChipAPI', {
  // Listen for actions
  onSetActions: (callback) => {
    ipcRenderer.on('set-actions', (event, data) => callback(data));
  },
  
  onUpdateActions: (callback) => {
    ipcRenderer.on('update-actions', (event, data) => callback(data));
  },
  
  // Send action selection
  selectAction: (actionId) => {
    ipcRenderer.send('action-selected', actionId);
  }
});