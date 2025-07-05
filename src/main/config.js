// Configuration file for Atlas
import { settings } from './settings.js';

// Check persisted settings first, then env variable, then default to false
const rewindEnabled = settings.get('features.rewind.enabled') ?? 
                     (process.env.ENABLE_REWIND === 'true') ?? 
                     false;

export const config = {
  // AI Model Configuration
  ai: {
    model: process.env.AI_MODEL || 'gemini-1.5-flash',
    // You can add more AI-related config here in the future
    // temperature: 0.7,
    // maxTokens: 1000,
  },
  
  // Feature Flags
  features: {
    rewind: {
      enabled: rewindEnabled,
      bufferDuration: 10, // seconds
      maxFrames: 30
    },
    bookmarks: {
      enabled: true,
      maxBookmarks: 100, // Maximum number of bookmarks to store
      storagePath: '.atlas/bookmarks' // Relative to user home
    }
  },
  
  // Window Configuration
  window: {
    overlay: {
      width: 860,
      height: 600,
      yOffset: 10
    },
    welcome: {
      width: 900,
      height: 700
    }
  },
  
  // Keyboard Shortcuts
  shortcuts: {
    main: 'CommandOrControl+Shift+Enter',
    rewind: "CommandOrControl+Shift+'", // Ctrl+Shift+' or Cmd+Shift+'
    bookmarkCreate: 'CommandOrControl+Shift+/', // Ctrl+Shift+? (/ key with shift)
    bookmarkView: 'CommandOrControl+Shift+;' // Ctrl+Shift+;
  }
};