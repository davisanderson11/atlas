// src/main.js

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import 'dotenv/config.js';
import {
  app,
  globalShortcut,
  BrowserWindow,
  clipboard,
  screen,
  ipcMain,
  dialog
} from 'electron';
import { GoogleGenAI } from '@google/genai';
import { homedir } from 'os';
import { mkdirSync, existsSync } from 'fs';

// Import config and handlers
import { config } from './config.js';
import { settings } from './settings.js';
import { TextHandler } from '../handlers/textHandler.js';
import { ScreenshotHandler } from '../handlers/screenshotHandler.js';
import { MathHandler } from '../handlers/mathHandler.js';
import { DataHandler } from '../handlers/dataHandler.js';
import { RewindHandler } from '../handlers/rewindHandler.js';
import { BookmarkHandler } from '../handlers/bookmarkHandler.js';
import { ActionSuggestionsHandler } from '../handlers/actionSuggestionsHandler.js';

// Derive __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Set custom cache directory to avoid Windows permission issues
const userDataPath = join(homedir(), '.atlas');

// Ensure directories exist
try {
  if (!existsSync(userDataPath)) {
    mkdirSync(userDataPath, { recursive: true });
  }
  const cachePath = join(userDataPath, 'cache');
  if (!existsSync(cachePath)) {
    mkdirSync(cachePath, { recursive: true });
  }
  const sessionPath = join(userDataPath, 'session');
  if (!existsSync(sessionPath)) {
    mkdirSync(sessionPath, { recursive: true });
  }
} catch (error) {
  console.warn('[Directory creation warning]:', error.message);
}

app.setPath('userData', userDataPath);

// Set cache path before app is ready to avoid permission issues
try {
  app.setPath('cache', join(userDataPath, 'cache'));
  // Also set sessionData path to avoid disk cache errors
  app.setPath('sessionData', join(userDataPath, 'session'));
} catch (error) {
  console.warn('[Cache setup warning]:', error.message);
}

console.log('[main.js] loading...');

// Add command line switches to help with cache issues
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('no-sandbox');

// Initialize Gemini client
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Initialize handlers
const textHandler = new TextHandler(ai);
const screenshotHandler = new ScreenshotHandler(ai);
const mathHandler = new MathHandler(ai);
const dataHandler = new DataHandler(ai);
const rewindHandler = new RewindHandler(ai);
const bookmarkHandler = new BookmarkHandler(ai);
const actionSuggestionsHandler = new ActionSuggestionsHandler(ai);

let overlayWindow;
let welcomeWindow;
let bookmarkWindow;
let statusWindow;
let privacyMonitorInterval = null;

// Store original context for follow-ups
let originalSelectedText = '';
let lastScreenshotData = null;

/**
 * Create or update overlay at top-center
 */
function createOverlay(content) {
  console.log('[createOverlay] called with:', typeof content === 'string' ? 'text' : 'data object');
  console.log('[createOverlay] content type:', typeof content === 'string' ? 'string' : content.type);
  
  // If window exists, close it and wait a bit
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    try {
      overlayWindow.close();
    } catch (e) {
      console.error('[Error closing overlay]:', e);
    }
    overlayWindow = null;
    // Small delay to ensure window is fully closed
    return setTimeout(() => createOverlay(content), 100);
  }
  const { width: sw } = screen.getPrimaryDisplay().workAreaSize;
  const w = config.window.overlay.width;
  const h = config.window.overlay.height;
  const x = Math.round((sw - w) / 2);
  const y = config.window.overlay.yOffset;
  overlayWindow = new BrowserWindow({
    x, y, width: w, height: h,
    frame: false, 
    alwaysOnTop: true,
    skipTaskbar: true, 
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    movable: false,
    resizable: false,
    webPreferences: { 
      preload: join(__dirname, '../renderer/windows/overlay/preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  
  overlayWindow.on('closed', () => {
    overlayWindow = null;
  });
  
  // Make window click-through in transparent areas
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  }
  
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    console.log('[Overlay window created successfully]');
    overlayWindow.loadFile(join(__dirname, '../renderer/windows/overlay/index.html'));
    overlayWindow.webContents.once('did-finish-load', () => {
      console.log('[Sending content to overlay]:', typeof content === 'string' ? 'text' : content.type || 'visualization');
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        // Small delay to ensure the window is ready
        setTimeout(() => {
          if (overlayWindow && !overlayWindow.isDestroyed()) {
            if (typeof content === 'string') {
              overlayWindow.webContents.send('overlay-text', content);
            } else {
              overlayWindow.webContents.send('overlay-data', content);
            }
            console.log('[Content sent to overlay]');
          }
        }, 50);
      }
    });
  } else {
    console.error('[Failed to create overlay window]');
  }
}

/**
 * Main hotkey handler: reads clipboard only
 */
async function summarizeSelection() {
  console.log('[Hotkey pressed]');
  
  // Store current clipboard content
  const originalClipboard = clipboard.readText();
  
  // Clear clipboard first to ensure we can detect new content
  clipboard.clear();
  
  // Get the focused window to send copy command
  const focusedWindow = BrowserWindow.getFocusedWindow();
  
  // Import nut-js for keyboard simulation
  const { keyboard, Key } = await import('@nut-tree-fork/nut-js');
  
  try {
    // Cross-platform copy
    if (process.platform === 'darwin') {
      // Mac: Cmd+C
      await keyboard.pressKey(Key.LeftCmd, Key.C);
      await keyboard.releaseKey(Key.LeftCmd, Key.C);
    } else {
      // Windows/Linux: Ctrl+C
      await keyboard.pressKey(Key.LeftControl, Key.C);
      await keyboard.releaseKey(Key.LeftControl, Key.C);
    }
    
    // Small delay to ensure clipboard is updated
    await new Promise(resolve => setTimeout(resolve, 150));
    
    // Read the potentially new clipboard content
    const newClipboard = clipboard.readText();
    console.log('[Original clipboard]:', JSON.stringify(originalClipboard));
    console.log('[New clipboard]:', JSON.stringify(newClipboard));
    
    // Check if clipboard changed (meaning text was selected and copied)
    if (!newClipboard || newClipboard.length === 0) {
      // No new text was copied - trigger screenshot mode
      console.log('[No text selected - starting screen capture]');
      // Restore original clipboard before screenshot
      clipboard.writeText(originalClipboard);
      return startScreenCapture();
    }
    
    // We have new text that was selected
    const selectedText = newClipboard.trim();
    
    // Store original text for follow-ups
    originalSelectedText = selectedText;
    lastScreenshotData = null; // Clear any previous screenshot data
    
    // Restore original clipboard content immediately
    clipboard.writeText(originalClipboard);

    // Process the selected text through handlers in order
    await processSelectedText(selectedText);
    
  } catch (error) {
    console.error('[Copy error]:', error);
    // Fallback to clipboard content if copy fails
    const clipboardText = clipboard.readText().trim();
    if (clipboardText) {
      originalSelectedText = clipboardText;
      await processSelectedText(clipboardText);
    } else {
      createOverlay('Please copy text (Ctrl+C) before pressing the hotkey.');
    }
  }
}

/**
 * Process selected text through appropriate handler
 */
async function processSelectedText(selectedText) {
  try {
    // 1. Check for math equations first
    if (mathHandler.isMathEquation(selectedText)) {
      console.log('[Math equation detected]');
      
      // Show processing status
      createStatus('Solving equation...', 'info', 30000); // Long timeout, will close when done
      
      const result = await mathHandler.process(selectedText);
      
      // Close status window
      if (statusWindow && !statusWindow.isDestroyed()) {
        statusWindow.close();
        statusWindow = null;
      }
      
      if (result.graphableFunction) {
        // Show with visualization
        createOverlay({
          type: 'visualization',
          dataType: 'math',
          data: {
            solution: result.solution,
            function: result.graphableFunction,
            original: selectedText
          },
          originalText: selectedText
        });
      } else {
        // Show just the solution
        createOverlay(result.solution);
      }
      return;
    }
    
    // 2. Check if it looks like code (before checking for data)
    const hasCodePatterns = selectedText.includes('function') || selectedText.includes('=>') || 
                           selectedText.includes('const ') || selectedText.includes('let ') ||
                           selectedText.includes('if (') || selectedText.includes('class ') ||
                           (selectedText.includes('{') && selectedText.includes('}'));
    
    // 3. Check for structured data only if it doesn't look like code
    if (!hasCodePatterns) {
      // Show processing status
      createStatus('Analyzing data...', 'info', 30000);
      
      const dataResult = await dataHandler.process(selectedText);
      if (dataResult) {
        console.log('[Structured data detected]:', dataResult.dataType);
        
        // Close status window
        if (statusWindow && !statusWindow.isDestroyed()) {
          statusWindow.close();
          statusWindow = null;
        }
        
        createOverlay(dataResult);
        return;
      }
      
      // If not data, continue to text processing
      // Status window stays open
    }
    
    // 4. Process as regular text (including code)
    console.log('[Processing as regular text]');
    
    // Show processing status if not already shown
    if (!statusWindow || statusWindow.isDestroyed()) {
      createStatus('Processing text...', 'info', 30000);
    }
    
    const textResult = await textHandler.process(selectedText);
    
    // Close status window
    if (statusWindow && !statusWindow.isDestroyed()) {
      statusWindow.close();
      statusWindow = null;
    }
    
    createOverlay(textResult);
    
  } catch (error) {
    console.error('[Processing error]:', error);
    
    // Close status window if open
    if (statusWindow && !statusWindow.isDestroyed()) {
      statusWindow.close();
      statusWindow = null;
    }
    
    createOverlay(`Error: ${error.message}`);
  }
}

/**
 * Start screen capture mode
 */
async function startScreenCapture() {
  try {
    // Close overlay if it's open
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.close();
      overlayWindow = null;
    }
    
    const captureResult = await screenshotHandler.startCapture();
    if (!captureResult) {
      console.log('[Screenshot capture already in progress or cancelled]');
      return;
    }
    
    const { screenshot, bounds } = captureResult;
    
    // Show processing status
    createStatus('Analyzing screenshot...', 'info', 30000);
    
    const result = await screenshotHandler.process(screenshot);
    
    // Close status window
    if (statusWindow && !statusWindow.isDestroyed()) {
      statusWindow.close();
      statusWindow = null;
    }
    
    // Store for follow-ups
    originalSelectedText = '[Screenshot]';
    lastScreenshotData = screenshot;
    
    createOverlay(result.text);
  } catch (error) {
    // Close status window if open
    if (statusWindow && !statusWindow.isDestroyed()) {
      statusWindow.close();
      statusWindow = null;
    }
    
    if (error.message !== 'Capture cancelled') {
      console.error('[Screenshot error]:', error);
      createOverlay(`Error: ${error.message}`);
    }
  }
}

// Close overlay request
ipcMain.on('overlay-close', () => {
  console.log('[Close request received]');
  if (overlayWindow) {
    overlayWindow.close();
    overlayWindow = null;
  }
  // Clear screenshot data when closing overlay
  lastScreenshotData = null;
  originalSelectedText = '';
});

// Handle mouse event ignoring
ipcMain.on('set-ignore-mouse-events', (event, ignore) => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.setIgnoreMouseEvents(ignore, { forward: true });
  }
});

// Rewind process handler
ipcMain.handle('rewind-process', async (_, question) => {
  console.log('[Rewind process] Question:', question);
  
  try {
    const result = await rewindHandler.processRewind(question);
    return result.response;
  } catch (error) {
    console.error('[Rewind process error]:', error);
    return `Error: ${error.message}`;
  }
});

// Action chip trigger handler
ipcMain.handle('trigger-atlas-action', async (_, content) => {
  console.log('[Action chip trigger] Content:', content.substring(0, 50) + '...');
  
  // Set clipboard and trigger summarization
  clipboard.writeText(content);
  
  // Call summarizeSelection directly
  await summarizeSelection();
  
  return true;
});

// Follow-up handler via IPC
ipcMain.handle('overlay-followup', async (_, question) => {
  console.log('[Follow-up question]:', question);
  console.log('[Original context]:', originalSelectedText);
  console.log('[Has screenshot data]:', lastScreenshotData !== null);
  
  try {
    let response;
    
    if (lastScreenshotData && originalSelectedText === '[Screenshot]') {
      // Screenshot follow-up
      response = await screenshotHandler.processFollowUp(question, lastScreenshotData);
    } else {
      // Text-based follow-up
      const contents = `Original text that was selected: "${originalSelectedText}"

Follow-up question: ${question}`;
      
      const result = await ai.models.generateContent({
        model: config.ai.model,
        contents: contents
      });
      response = result.text.trim();
    }
    
    return response;
  } catch (error) {
    console.error('[Follow-up error]:', error);
    return `API Error: ${error.message}`;
  }
});

/**
 * Create welcome window
 */
function createWelcomeWindow() {
  welcomeWindow = new BrowserWindow({
    width: config.window.welcome.width,
    height: config.window.welcome.height,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: join(__dirname, '../renderer/windows/welcome/welcome-preload.js')
    },
    center: true,
    resizable: true,
    minimizable: true,
    maximizable: true,
    frame: false,
    transparent: true,
    title: 'Atlas',
    show: false,
    backgroundColor: '#1a1a1a'
  });

  welcomeWindow.loadFile(join(__dirname, '../renderer/windows/welcome/welcome.html'));
  
  welcomeWindow.once('ready-to-show', () => {
    welcomeWindow.show();
  });

  // Don't quit app when welcome window is closed
  welcomeWindow.on('closed', () => {
    welcomeWindow = null;
    console.log('[Welcome window closed, app continues running]');
  });
}

// Welcome window controls
ipcMain.on('welcome-minimize', () => {
  if (welcomeWindow && !welcomeWindow.isDestroyed()) {
    welcomeWindow.minimize();
  }
});

ipcMain.on('welcome-maximize', () => {
  if (welcomeWindow && !welcomeWindow.isDestroyed()) {
    if (welcomeWindow.isMaximized()) {
      welcomeWindow.unmaximize();
    } else {
      welcomeWindow.maximize();
    }
  }
});

ipcMain.on('welcome-close', () => {
  if (welcomeWindow && !welcomeWindow.isDestroyed()) {
    welcomeWindow.close();
  }
});

// Bookmark window controls
ipcMain.on('bookmarks-minimize', () => {
  if (bookmarkWindow && !bookmarkWindow.isDestroyed()) {
    bookmarkWindow.minimize();
  }
});

ipcMain.on('bookmarks-maximize', () => {
  if (bookmarkWindow && !bookmarkWindow.isDestroyed()) {
    if (bookmarkWindow.isMaximized()) {
      bookmarkWindow.unmaximize();
    } else {
      bookmarkWindow.maximize();
    }
  }
});

ipcMain.on('bookmarks-close', () => {
  if (bookmarkWindow && !bookmarkWindow.isDestroyed()) {
    bookmarkWindow.close();
  }
});

// Bookmark IPC handlers
ipcMain.handle('bookmarks-load', async () => {
  try {
    return await bookmarkHandler.loadBookmarks();
  } catch (error) {
    console.error('[IPC] Failed to load bookmarks:', error);
    throw error;
  }
});

ipcMain.handle('bookmarks-search', async (event, query) => {
  try {
    return await bookmarkHandler.searchBookmarks(query);
  } catch (error) {
    console.error('[IPC] Failed to search bookmarks:', error);
    throw error;
  }
});

ipcMain.handle('bookmarks-delete', async (event, bookmarkId) => {
  try {
    const result = await bookmarkHandler.deleteBookmark(bookmarkId);
    
    // Notify viewer window if open
    if (bookmarkWindow && !bookmarkWindow.isDestroyed()) {
      bookmarkWindow.webContents.send('bookmark-deleted', bookmarkId);
    }
    
    return result;
  } catch (error) {
    console.error('[IPC] Failed to delete bookmark:', error);
    throw error;
  }
});

ipcMain.handle('bookmarks-update', async (event, bookmarkId, updates) => {
  try {
    return await bookmarkHandler.updateBookmark(bookmarkId, updates);
  } catch (error) {
    console.error('[IPC] Failed to update bookmark:', error);
    throw error;
  }
});

ipcMain.handle('bookmarks-export', async (event, exportPath) => {
  try {
    const count = await bookmarkHandler.exportBookmarks(exportPath);
    return { success: true, count };
  } catch (error) {
    console.error('[IPC] Failed to export bookmarks:', error);
    throw error;
  }
});

ipcMain.handle('bookmarks-import', async (event, importPath) => {
  try {
    const count = await bookmarkHandler.importBookmarks(importPath);
    
    // Refresh viewer if open
    if (bookmarkWindow && !bookmarkWindow.isDestroyed()) {
      bookmarkWindow.webContents.send('bookmarks-refresh');
    }
    
    return { success: true, count };
  } catch (error) {
    console.error('[IPC] Failed to import bookmarks:', error);
    throw error;
  }
});

// File dialog handlers for bookmarks
ipcMain.handle('bookmarks-export-dialog', async () => {
  const result = await dialog.showSaveDialog(bookmarkWindow, {
    title: 'Export Bookmarks',
    defaultPath: `atlas-bookmarks-${new Date().toISOString().split('T')[0]}.json`,
    filters: [
      { name: 'JSON Files', extensions: ['json'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  
  if (!result.canceled && result.filePath) {
    try {
      const count = await bookmarkHandler.exportBookmarks(result.filePath);
      return { success: true, count };
    } catch (error) {
      console.error('[IPC] Failed to export bookmarks:', error);
      throw error;
    }
  }
  
  return { success: false };
});

ipcMain.handle('bookmarks-import-dialog', async () => {
  const result = await dialog.showOpenDialog(bookmarkWindow, {
    title: 'Import Bookmarks',
    filters: [
      { name: 'JSON Files', extensions: ['json'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    properties: ['openFile']
  });
  
  if (!result.canceled && result.filePaths.length > 0) {
    try {
      const count = await bookmarkHandler.importBookmarks(result.filePaths[0]);
      
      // Refresh viewer
      if (bookmarkWindow && !bookmarkWindow.isDestroyed()) {
        bookmarkWindow.webContents.send('bookmarks-refresh');
      }
      
      return { success: true, count };
    } catch (error) {
      console.error('[IPC] Failed to import bookmarks:', error);
      throw error;
    }
  }
  
  return { success: false };
});

// Settings handlers
ipcMain.handle('get-settings', () => {
  return config;
});

ipcMain.handle('update-setting', async (event, setting, value) => {
  console.log(`[Settings] Updating ${setting} to ${value}`);
  
  // Update config based on setting
  if (setting === 'rewind') {
    config.features.rewind.enabled = value;
    
    // Persist the setting
    settings.set('features.rewind.enabled', value);
    
    // Handle rewind feature toggle
    if (value) {
      // Enable rewind
      const registered = globalShortcut.register(config.shortcuts.rewind, triggerRewind);
      if (registered) {
        rewindHandler.startRecording();
        console.log('[Settings] Rewind feature enabled');
        
        // Start privacy monitoring
        if (!privacyMonitorInterval) {
          privacyMonitorInterval = setInterval(() => {
            const focusedWindow = BrowserWindow.getFocusedWindow();
            if (focusedWindow && focusedWindow !== welcomeWindow && focusedWindow !== overlayWindow) {
              const title = focusedWindow.getTitle();
              if (rewindHandler.shouldPauseRecording(title)) {
                console.log('[Privacy] Pausing recording for sensitive app:', title);
                rewindHandler.clearBuffer();
              }
            }
          }, 1000);
        }
      }
    } else {
      // Disable rewind
      globalShortcut.unregister(config.shortcuts.rewind);
      rewindHandler.stopRecording();
      console.log('[Settings] Rewind feature disabled');
      
      // Stop privacy monitoring
      if (privacyMonitorInterval) {
        clearInterval(privacyMonitorInterval);
        privacyMonitorInterval = null;
      }
    }
  }
  
  // You can add more settings handlers here in the future
  
  return true;
});

// App lifecycle
app.whenReady().then(() => {
  console.log('[App ready]');
  
  // Create welcome window on launch
  createWelcomeWindow();
  
  // Register global shortcuts with better error handling
  try {
    // Check if the shortcut is already registered
    const isMainRegistered = globalShortcut.isRegistered(config.shortcuts.main);
    console.log('[Main shortcut already registered?]:', isMainRegistered);
    
    if (isMainRegistered) {
      // If it's already registered, it might be from a previous instance
      // Try to use it as-is first
      console.log('[Main shortcut appears to be working from previous registration]');
    } else {
      // Try to register it
      const mainRegistered = globalShortcut.register(config.shortcuts.main, summarizeSelection);
      console.log('[Main shortcut registration attempt]:', mainRegistered);
      
      if (!mainRegistered) {
        // Only fall back if we truly can't register it
        console.log('[Failed to register main shortcut, checking if it still works...]');
        
        // Sometimes the shortcut works even if registration returns false
        // This can happen with Electron on Windows
        setTimeout(() => {
          if (!globalShortcut.isRegistered(config.shortcuts.main)) {
            console.log('[Main shortcut truly not working, using fallback]');
            const altRegistered = globalShortcut.register('CommandOrControl+Shift+Space', summarizeSelection);
            console.log('[Alternative shortcut registered]:', altRegistered);
          } else {
            console.log('[Main shortcut is working despite registration failure]');
          }
        }, 100);
      }
    }
  } catch (error) {
    console.error('[Shortcut registration error]:', error);
  }
  
  // Only register rewind shortcut if feature is enabled
  if (config.features.rewind.enabled) {
    try {
      if (globalShortcut.isRegistered(config.shortcuts.rewind)) {
        globalShortcut.unregister(config.shortcuts.rewind);
      }
      
      const rewindRegistered = globalShortcut.register(config.shortcuts.rewind, triggerRewind);
      console.log('[Rewind shortcut registered]:', rewindRegistered);
      
      if (rewindRegistered) {
        // Start rewind recording
        rewindHandler.startRecording();
      }
    } catch (error) {
      console.error('[Rewind shortcut registration error]:', error);
    }
  } else {
    console.log('[Rewind feature disabled]');
  }
  
  // Register bookmark shortcuts
  if (config.features.bookmarks.enabled) {
    try {
      // Register create bookmark shortcut
      const bookmarkCreateRegistered = globalShortcut.register(config.shortcuts.bookmarkCreate, createBookmark);
      console.log('[Bookmark create shortcut registered]:', bookmarkCreateRegistered);
      
      // Register view bookmarks shortcut
      const bookmarkViewRegistered = globalShortcut.register(config.shortcuts.bookmarkView, showBookmarkViewer);
      console.log('[Bookmark view shortcut registered]:', bookmarkViewRegistered);
    } catch (error) {
      console.error('[Bookmark shortcut registration error]:', error);
    }
  }
  
  // Initialize Action Suggestions
  console.log('[Action Suggestions] Initializing context menu handler');
  actionSuggestionsHandler.initialize();
  
  // Listen for action chip triggers
  process.on('action-chip-trigger', async (content) => {
    console.log('[Main] Action chip triggered with content');
    // Don't use summarizeSelection as it will clear clipboard
    // Instead, directly create overlay with the content
    originalSelectedText = content;
    createOverlay(content);
  });
  
  // Listen for specific action chip actions
  process.on('action-chip-action', async (data) => {
    console.log('[Main] Action chip action triggered:', data.type);
    const { type, content } = data;
    
    // Store original content
    originalSelectedText = content;
    
    // Show processing status
    createStatus('Processing...', 'info', 30000);
    
    try {
      let result;
      
      switch (type) {
        case 'summarize':
          const summarizeResult = await ai.models.generateContent({
            model: config.ai.model,
            contents: `Summarize this text concisely:\n\n${content}`
          });
          result = summarizeResult.text.trim();
          break;
          
        case 'explain':
          const explainResult = await ai.models.generateContent({
            model: config.ai.model,
            contents: `Explain this code:\n\n${content}`
          });
          result = explainResult.text.trim();
          break;
          
        case 'optimize':
          const optimizeResult = await ai.models.generateContent({
            model: config.ai.model,
            contents: `Optimize this code for performance:\n\n${content}`
          });
          result = optimizeResult.text.trim();
          break;
          
        case 'add-comments':
          const commentResult = await ai.models.generateContent({
            model: config.ai.model,
            contents: `Add helpful comments to this code:\n\n${content}`
          });
          result = commentResult.text.trim();
          break;
          
        case 'to-python':
          const toPythonResult = await ai.models.generateContent({
            model: config.ai.model,
            contents: `Convert this JavaScript code to Python:\n\n${content}`
          });
          result = toPythonResult.text.trim();
          break;
          
        case 'to-javascript':
          const toJsResult = await ai.models.generateContent({
            model: config.ai.model,
            contents: `Convert this Python code to JavaScript:\n\n${content}`
          });
          result = toJsResult.text.trim();
          break;
          
        case 'format-json':
          // This is now handled locally in actionSuggestionsHandler
          result = 'JSON formatting handled locally';
          break;
          
        case 'json-to-yaml':
          const yamlResult = await ai.models.generateContent({
            model: config.ai.model,
            contents: `Convert this JSON to YAML format:\n\n${content}`
          });
          result = yamlResult.text.trim();
          break;
          
        case 'translate':
          // This case shouldn't be reached anymore as translate shows language selector
          result = 'Please select a language from the dropdown.';
          break;
          
        case 'translate-to':
          // Handle translation with specific language
          const targetLang = data.language ? data.language.name : 'Spanish';
          const translateToResult = await ai.models.generateContent({
            model: config.ai.model,
            contents: `Translate this text to ${targetLang}:\n\n${content}`
          });
          result = translateToResult.text.trim();
          break;
          
        case 'improve':
          const improveResult = await ai.models.generateContent({
            model: config.ai.model,
            contents: `Provide specific suggestions to improve this writing. List each suggestion as a bullet point with the issue and how to fix it:\n\n${content}`
          });
          result = improveResult.text.trim();
          break;
          
        default:
          result = 'Unknown action';
      }
      
      // Close status window
      if (statusWindow && !statusWindow.isDestroyed()) {
        statusWindow.close();
        statusWindow = null;
      }
      
      // Show result
      createOverlay(result);
      
    } catch (error) {
      console.error('[Action chip action error]:', error);
      
      // Close status window if open
      if (statusWindow && !statusWindow.isDestroyed()) {
        statusWindow.close();
        statusWindow = null;
      }
      
      createOverlay(`Error: ${error.message}`);
    }
  });
  
  // Monitor active window for privacy (only if rewind is enabled)
  if (config.features.rewind.enabled) {
    privacyMonitorInterval = setInterval(() => {
      const focusedWindow = BrowserWindow.getFocusedWindow();
      if (focusedWindow && focusedWindow !== welcomeWindow && focusedWindow !== overlayWindow) {
        const title = focusedWindow.getTitle();
        if (rewindHandler.shouldPauseRecording(title)) {
          console.log('[Privacy] Pausing recording for sensitive app:', title);
          rewindHandler.clearBuffer();
        }
      }
    }, 1000); // Check every second
  }
});

app.on('window-all-closed', e => e.preventDefault());

app.on('before-quit', () => {
  console.log('[App] Before quit - unregistering shortcuts');
  globalShortcut.unregisterAll();
  
  // Close status window if open
  if (statusWindow && !statusWindow.isDestroyed()) {
    statusWindow.close();
    statusWindow = null;
  }
});

app.on('will-quit', () => {
  console.log('[App] Will quit - cleaning up');
  globalShortcut.unregisterAll();
  if (config.features.rewind.enabled) {
    rewindHandler.stopRecording();
  }
  
  // Clean up action suggestions
  actionSuggestionsHandler.cleanup();
  
  // Clear privacy monitor
  if (privacyMonitorInterval) {
    clearInterval(privacyMonitorInterval);
    privacyMonitorInterval = null;
  }
});

/**
 * Trigger rewind mode
 */
async function triggerRewind() {
  console.log('[Rewind triggered]');
  
  // Check if rewind feature is enabled
  if (!config.features.rewind.enabled) {
    console.log('[Rewind feature is disabled]');
    return;
  }
  
  // Check if we have frames in buffer
  const rewindData = rewindHandler.getRewindData();
  
  if (!rewindData || rewindData.frames.length === 0) {
    console.log('[No frames in buffer]');
    createStatus('No recent activity captured. Rewind starts capturing after app launch.', 'warning', 3000);
    return;
  }
  
  console.log(`[Rewind has ${rewindData.frameCount} frames]`);
  
  // Show loading status immediately
  createStatus('Analyzing the last 10 seconds...', 'info', 30000);
  
  try {
    // Process with default prompt
    const result = await rewindHandler.processRewind('What happened in the last 10 seconds? Summarize the key activities and any notable changes.');
    
    // Close status window
    if (statusWindow && !statusWindow.isDestroyed()) {
      statusWindow.close();
      statusWindow = null;
    }
    
    // Store for follow-ups
    originalSelectedText = `[Rewind: ${result.duration.toFixed(1)}s of activity]`;
    
    // Show the result
    createOverlay(result.response);
  } catch (error) {
    console.error('[Rewind error]:', error);
    
    // Close status window if open
    if (statusWindow && !statusWindow.isDestroyed()) {
      statusWindow.close();
      statusWindow = null;
    }
    
    createOverlay(`Error analyzing activity: ${error.message}`);
  }
}

/**
 * Create status popup for brief notifications
 */
function createStatus(message, type = 'info', duration = 3000) {
  console.log('[createStatus] called with:', message, type);
  
  // Close existing status window if any
  if (statusWindow && !statusWindow.isDestroyed()) {
    statusWindow.close();
    statusWindow = null;
  }
  
  // Calculate position (top center)
  const { width: sw } = screen.getPrimaryDisplay().workAreaSize;
  const w = 400;
  const h = 80;
  const x = Math.round((sw - w) / 2);
  const y = 50; // 50px from top
  
  statusWindow = new BrowserWindow({
    x, y, width: w, height: h,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    movable: false,
    resizable: false,
    focusable: false,
    webPreferences: {
      preload: join(__dirname, '../renderer/windows/status/status-preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  
  statusWindow.setIgnoreMouseEvents(true);
  
  statusWindow.loadFile(join(__dirname, '../renderer/windows/status/status.html'));
  
  statusWindow.webContents.once('did-finish-load', () => {
    if (statusWindow && !statusWindow.isDestroyed()) {
      statusWindow.webContents.send('status-update', { message, type });
      
      // Auto-close after duration
      setTimeout(() => {
        if (statusWindow && !statusWindow.isDestroyed()) {
          statusWindow.close();
          statusWindow = null;
        }
      }, duration);
    }
  });
  
  statusWindow.on('closed', () => {
    statusWindow = null;
  });
}

/**
 * Create a temporal bookmark
 */
async function createBookmark() {
  console.log('[Bookmark creation triggered]');
  
  try {
    // Show immediate feedback
    createStatus('Creating temporal bookmark...', 'info', 1000);
    
    // Create the bookmark
    const bookmark = await bookmarkHandler.createBookmark();
    
    // Show success with context summary (truncated for status)
    const contextPreview = bookmark.aiContext.length > 100 
      ? bookmark.aiContext.substring(0, 97) + '...' 
      : bookmark.aiContext;
    createStatus(`Bookmark saved: ${contextPreview}`, 'success', 4000);
    
    // Notify viewer window if open
    if (bookmarkWindow && !bookmarkWindow.isDestroyed()) {
      bookmarkWindow.webContents.send('bookmark-created', bookmark);
    }
    
  } catch (error) {
    console.error('[Bookmark creation error]:', error);
    createStatus(`Error creating bookmark: ${error.message}`, 'error', 4000);
  }
}

/**
 * Show bookmark viewer window
 */
async function showBookmarkViewer() {
  console.log('[Bookmark viewer triggered]');
  
  // Prevent multiple viewer windows
  if (bookmarkWindow && !bookmarkWindow.isDestroyed()) {
    bookmarkWindow.focus();
    return;
  }
  
  // Create bookmark viewer window
  bookmarkWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: join(__dirname, '../renderer/windows/bookmarks/bookmarks-preload.js')
    },
    center: true,
    resizable: true,
    minimizable: true,
    maximizable: true,
    frame: false,
    transparent: true,
    title: 'Atlas Bookmarks',
    show: false,
    backgroundColor: '#1a1a1a'
  });
  
  bookmarkWindow.loadFile(join(__dirname, '../renderer/windows/bookmarks/bookmarks.html'));
  
  bookmarkWindow.once('ready-to-show', () => {
    bookmarkWindow.show();
  });
  
  bookmarkWindow.on('closed', () => {
    bookmarkWindow = null;
  });
}