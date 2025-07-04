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
  ipcMain
} from 'electron';
import { GoogleGenAI } from '@google/genai';
import { homedir } from 'os';

// Import config and handlers
import { config } from './config.js';
import { TextHandler } from './handlers/textHandler.js';
import { ScreenshotHandler } from './handlers/screenshotHandler.js';
import { MathHandler } from './handlers/mathHandler.js';
import { DataHandler } from './handlers/dataHandler.js';

// Derive __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Set custom cache directory to avoid Windows permission issues
const userDataPath = join(homedir(), '.atlas');
app.setPath('userData', userDataPath);
app.setPath('cache', join(userDataPath, 'cache'));

console.log('[main.js] loading...');

// Initialize Gemini client
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Initialize handlers
const textHandler = new TextHandler(ai);
const screenshotHandler = new ScreenshotHandler(ai);
const mathHandler = new MathHandler(ai);
const dataHandler = new DataHandler(ai);

let overlayWindow;
let welcomeWindow;

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
      preload: join(__dirname, 'preload.js'),
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
    overlayWindow.loadFile(join(__dirname, 'index.html'));
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
      const result = await mathHandler.process(selectedText);
      
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
      const dataResult = await dataHandler.process(selectedText);
      if (dataResult) {
        console.log('[Structured data detected]:', dataResult.dataType);
        createOverlay(dataResult);
        return;
      }
    }
    
    // 4. Process as regular text (including code)
    console.log('[Processing as regular text]');
    const textResult = await textHandler.process(selectedText);
    createOverlay(textResult);
    
  } catch (error) {
    console.error('[Processing error]:', error);
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
    
    const { screenshot, bounds } = await screenshotHandler.startCapture();
    const result = await screenshotHandler.process(screenshot);
    
    // Store for follow-ups
    originalSelectedText = '[Screenshot]';
    lastScreenshotData = screenshot;
    
    createOverlay(result.text);
  } catch (error) {
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
      preload: join(__dirname, 'welcome-preload.js')
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

  welcomeWindow.loadFile(join(__dirname, 'welcome.html'));
  
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

// App lifecycle
app.whenReady().then(() => {
  console.log('[App ready]');
  
  // Create welcome window on launch
  createWelcomeWindow();
  
  // Register global shortcut
  const registered = globalShortcut.register(config.shortcuts.main, summarizeSelection);
  console.log('[Shortcut registered]:', registered);
});

app.on('window-all-closed', e => e.preventDefault());
app.on('will-quit', () => globalShortcut.unregisterAll());