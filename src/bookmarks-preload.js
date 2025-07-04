// Preload script for bookmarks viewer window

const { contextBridge, ipcRenderer } = require('electron');

// Expose bookmark APIs to the renderer
contextBridge.exposeInMainWorld('bookmarksAPI', {
  // Window controls
  minimize: () => ipcRenderer.send('bookmarks-minimize'),
  maximize: () => ipcRenderer.send('bookmarks-maximize'),
  close: () => ipcRenderer.send('bookmarks-close'),
  
  // Bookmark operations
  loadBookmarks: () => ipcRenderer.invoke('bookmarks-load'),
  searchBookmarks: (query) => ipcRenderer.invoke('bookmarks-search', query),
  deleteBookmark: (bookmarkId) => ipcRenderer.invoke('bookmarks-delete', bookmarkId),
  updateBookmark: (bookmarkId, updates) => ipcRenderer.invoke('bookmarks-update', bookmarkId, updates),
  
  // Export functionality - triggers dialog in main process
  exportBookmarks: () => ipcRenderer.invoke('bookmarks-export-dialog'),
  
  // Import functionality - triggers dialog in main process
  importBookmarks: () => ipcRenderer.invoke('bookmarks-import-dialog')
});

// Listen for updates from main process
ipcRenderer.on('bookmark-created', (event, bookmark) => {
  // Dispatch a custom event that the renderer can listen to
  window.dispatchEvent(new CustomEvent('bookmark-created', { detail: bookmark }));
});

ipcRenderer.on('bookmark-deleted', (event, bookmarkId) => {
  window.dispatchEvent(new CustomEvent('bookmark-deleted', { detail: bookmarkId }));
});