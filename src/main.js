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
  desktopCapturer
} from 'electron';
import { GoogleGenAI } from '@google/genai';
import { homedir } from 'os';

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

let overlayWindow;
let captureWindow;
let welcomeWindow;

/**
 * Detect if text is structured data
 */
function detectStructuredData(text) {
  const lines = text.trim().split('\n').filter(line => line.trim());
  
  // JSON detection first (most specific)
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === 'object') {
      return { type: 'json', data: parsed };
    }
  } catch (e) {}
  
  // SQL result detection (simple table format)
  if (text.includes('|') && lines.length > 2) {
    const hasTableStructure = lines.some(line => /[|\-]{2,}/.test(line));
    if (hasTableStructure) {
      return { type: 'sql', data: parseSQLTable(text) };
    }
  }
  
  // CSV detection - more flexible
  if (lines.length > 1) {
    const firstLineCommas = (lines[0].match(/,/g) || []).length;
    if (firstLineCommas > 0) {
      // Allow some flexibility - at least 75% of lines should have similar comma count
      const validLines = lines.filter(line => {
        const commaCount = (line.match(/,/g) || []).length;
        return Math.abs(commaCount - firstLineCommas) <= 1;
      });
      
      if (validLines.length >= lines.length * 0.75) {
        return { type: 'csv', data: parseCSV(text) };
      }
    }
  }
  
  // Tab-separated values
  if (lines.length > 1 && text.includes('\t')) {
    const firstLineTabs = (lines[0].match(/\t/g) || []).length;
    if (firstLineTabs > 0) {
      return { type: 'tsv', data: parseTSV(text) };
    }
  }
  
  return null;
}

/**
 * Parse CSV text into data structure
 */
function parseCSV(text) {
  const lines = text.trim().split('\n').filter(line => line.trim());
  if (lines.length === 0) return null;
  
  const headers = lines[0].split(',').map(h => h.trim().replace(/^["']|["']$/g, ''));
  const rows = lines.slice(1).map(line => {
    const values = line.split(',').map(v => v.trim().replace(/^["']|["']$/g, ''));
    return headers.reduce((obj, header, i) => {
      obj[header] = values[i] || '';
      return obj;
    }, {});
  });
  
  console.log('[CSV Parsed]:', { headers, rows });
  return { headers, rows };
}

/**
 * Parse TSV text into data structure
 */
function parseTSV(text) {
  const lines = text.trim().split('\n');
  const headers = lines[0].split('\t').map(h => h.trim());
  const rows = lines.slice(1).map(line => {
    const values = line.split('\t').map(v => v.trim());
    return headers.reduce((obj, header, i) => {
      obj[header] = values[i] || '';
      return obj;
    }, {});
  });
  return { headers, rows };
}

/**
 * Parse SQL-style table into data structure
 */
function parseSQLTable(text) {
  const lines = text.trim().split('\n');
  const dataLines = lines.filter(line => !line.match(/^\s*\|?\s*-+\s*\|/));
  
  if (dataLines.length < 2) return null;
  
  const parseRow = (line) => line.split('|').map(cell => cell.trim()).filter(cell => cell);
  const headers = parseRow(dataLines[0]);
  const rows = dataLines.slice(1).map(line => {
    const values = parseRow(line);
    return headers.reduce((obj, header, i) => {
      obj[header] = values[i] || '';
      return obj;
    }, {});
  });
  
  return { headers, rows };
}

/**
 * Build AI prompt based on selected text
 */
function buildPrompt(text) {
  // Single word - dictionary style definition
  if (/^[\w-]+$/.test(text) && text.length < 30) {
    return `Define "${text}" in dictionary format: word class • brief definition (etymology). Keep it under 15 words.`;
  }
  
  // Code snippet
  else if (text.includes('\n') && /[{};=()=>]/.test(text)) {
    return `Code summary in 1 sentence: what does this do?\n\`\`\`\n${text}\n\`\`\``;
  }
  
  // URL or link
  else if (/^https?:\/\/|^www\.|\.com|\.org|\.net/i.test(text)) {
    return `What is this website? Give 1-line description: ${text}`;
  }
  
  // Email
  else if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
    return `Whose email is this likely to be (based on domain): ${text}`;
  }
  
  // Math expression
  else if (/^[\d\s+\-*/()^=]+$/.test(text)) {
    return `Calculate: ${text}`;
  }
  
  // Phone number
  else if (/^[\d\s\-()]+$/.test(text) && text.length >= 10 && text.length <= 15) {
    return `What country/region is this phone number from: ${text}`;
  }
  
  // Date/time
  else if (/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d{1,2}\/\d{1,2}|\d{4})\b/i.test(text)) {
    return `What day of the week is this date? Any significance? ${text}`;
  }
  
  // Long quote or paragraph
  else if (text.length > 200) {
    return `Summarize in 1-2 sentences maximum:\n"${text}"`;
  }
  
  // Error message
  else if (/error|exception|failed|cannot|undefined|null/i.test(text)) {
    return `What does this error mean in simple terms: ${text}`;
  }
  
  // File path
  else if (/^[\/\\]|\\\\|[a-zA-Z]:[\/\\]/.test(text)) {
    return `What type of file/directory is this: ${text}`;
  }
  
  // General short text
  else {
    return `Explain in 1 sentence: "${text}"`;
  }
}

/**
 * Create or update overlay at top-center
 */
// Store original context for follow-ups
let originalSelectedText = '';
let lastScreenshotData = null; // Store screenshot base64 data for follow-ups

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
  const w = 860, h = 600;
  const x = Math.round((sw - w) / 2), y = 10;
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
      console.log('[Sending content to overlay]:', typeof content === 'string' ? 'text' : 'visualization');
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        if (typeof content === 'string') {
          overlayWindow.webContents.send('overlay-text', content);
        } else {
          overlayWindow.webContents.send('overlay-data', content);
        }
        console.log('[Content sent to overlay]');
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

    // Check if it's structured data
    console.log('[Checking for structured data in]:', selectedText);
    const structuredData = detectStructuredData(selectedText);
    console.log('[Detection result]:', structuredData);
    
    if (structuredData) {
      console.log('[Structured data detected]:', structuredData.type);
      // For structured data, pass both the data and a visualization flag
      createOverlay({
        type: 'visualization',
        dataType: structuredData.type,
        data: structuredData.data,
        originalText: selectedText
      });
      console.log('[Overlay created for visualization]');
      return; // Make sure we exit here
    } else {
      // Regular text processing
      const prompt = buildPrompt(selectedText);
      console.log('[Prompt]:', prompt);

      let aiResponse;
      try {
        const result = await ai.models.generateContent({
          model: 'gemini-1.5-flash',
          contents: prompt
        });
        aiResponse = result.text.trim();
        console.log('[AI responded]');
      } catch (error) {
        console.error('[AI error]:', error);
        aiResponse = `API Error: ${error.message}`;
      }

      createOverlay(aiResponse);
    }
    
  } catch (error) {
    console.error('[Copy error]:', error);
    // Fallback to clipboard content if copy fails
    const clipboardText = clipboard.readText().trim();
    if (clipboardText) {
      originalSelectedText = clipboardText;
      const prompt = buildPrompt(clipboardText);
      let aiResponse;
      try {
        const result = await ai.models.generateContent({
          model: 'gemini-1.5-flash',
          contents: prompt
        });
        aiResponse = result.text.trim();
      } catch (err) {
        aiResponse = `API Error: ${err.message}`;
      }
      createOverlay(aiResponse);
    } else {
      createOverlay('Please copy text (Ctrl+C) before pressing the hotkey.');
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
    let contents;
    
    if (lastScreenshotData && originalSelectedText === '[Screenshot]') {
      // If we have screenshot data, include it in the follow-up
      contents = [{
        parts: [
          { text: `This is a follow-up question about the screenshot you just analyzed.\n\nFollow-up question: ${question}` },
          {
            inlineData: {
              mimeType: 'image/png',
              data: lastScreenshotData
            }
          }
        ]
      }];
    } else {
      // Text-based follow-up
      contents = `Original text that was selected: "${originalSelectedText}"

Follow-up question: ${question}`;
    }
    
    const result = await ai.models.generateContent({
      model: 'gemini-1.5-flash',
      contents: contents
    });
    return result.text.trim();
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
    width: 900,
    height: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    },
    center: true,
    resizable: true,
    minimizable: true,
    maximizable: true,
    title: 'Atlas',
    show: false,
    backgroundColor: '#1a1a1a',
    titleBarStyle: 'default'
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

// App lifecycle
app.whenReady().then(() => {
  console.log('[App ready]');
  
  // Create welcome window on launch
  createWelcomeWindow();
  
  // Register global shortcut
  const registered = globalShortcut.register('CommandOrControl+Shift+Enter', summarizeSelection);
  console.log('[Shortcut registered]:', registered);
});

app.on('window-all-closed', e => e.preventDefault());
app.on('will-quit', () => globalShortcut.unregisterAll());

/**
 * Start screen capture mode
 */
async function startScreenCapture() {
  // Close overlay if it's open
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.close();
    overlayWindow = null;
  }
  
  // Get all displays
  const displays = screen.getAllDisplays();
  const primaryDisplay = screen.getPrimaryDisplay();
  
  // Create a fullscreen transparent window for selection
  captureWindow = new BrowserWindow({
    x: primaryDisplay.bounds.x,
    y: primaryDisplay.bounds.y,
    width: primaryDisplay.bounds.width,
    height: primaryDisplay.bounds.height,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: join(__dirname, 'capture-preload.js')
    }
  });
  
  captureWindow.setIgnoreMouseEvents(false);
  captureWindow.loadFile(join(__dirname, 'capture.html'));
  
  // Handle area selection
  ipcMain.once('capture-area', async (event, bounds) => {
    captureWindow.close();
    captureWindow = null;
    
    // Take screenshot of selected area
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: primaryDisplay.bounds.width,
        height: primaryDisplay.bounds.height
      }
    });
    
    if (sources.length > 0) {
      // Get the full screenshot
      const screenshot = sources[0].thumbnail;
      
      // Crop to selected area
      const croppedImage = screenshot.crop({
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height
      });
      
      // Convert the cropped image to base64
      const imageBuffer = croppedImage.toPNG();
      const base64Image = imageBuffer.toString('base64');
      
      // Process with Gemini Vision
      await processScreenshot(base64Image, bounds);
    }
  });
  
  // Handle escape key
  ipcMain.once('capture-cancelled', () => {
    if (captureWindow) {
      captureWindow.close();
      captureWindow = null;
    }
  });
}

/**
 * Process screenshot with Gemini Vision API
 */
async function processScreenshot(base64Image, bounds) {
  console.log('[Processing screenshot]');
  
  try {
    const result = await ai.models.generateContent({
      model: 'gemini-1.5-flash',
      contents: [{
        parts: [
          { text: 'Analyze this screenshot and explain what you see. Be concise.' },
          {
            inlineData: {
              mimeType: 'image/png',
              data: base64Image
            }
          }
        ]
      }]
    });
    
    const text = result.text.trim();
    console.log('[AI responded to screenshot]');
    
    // Store for follow-ups
    originalSelectedText = '[Screenshot]';
    lastScreenshotData = base64Image; // Store the actual screenshot data
    
    createOverlay(text);
  } catch (error) {
    console.error('[Screenshot AI error]:', error);
    createOverlay(`Error analyzing screenshot: ${error.message}`);
  }
}
