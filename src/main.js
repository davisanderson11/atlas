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

// Derive __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('[main.js] loading...');

// Initialize Gemini client
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

let overlayWindow;

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

function createOverlay(text) {
  console.log('[createOverlay]:', text);
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.close();
    overlayWindow = null;
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
    webPreferences: { 
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  
  overlayWindow.on('closed', () => {
    overlayWindow = null;
  });
  
  overlayWindow.loadFile(join(__dirname, 'index.html'));
  overlayWindow.webContents.once('did-finish-load', () => {
    console.log('[Sending text to overlay]:', text);
    overlayWindow.webContents.send('overlay-text', text);
  });
}

/**
 * Main hotkey handler: reads clipboard only
 */
async function summarizeSelection() {
  console.log('[Hotkey pressed]');
  const selectedText = clipboard.readText().trim();
  console.log('[Clipboard contains]:', JSON.stringify(selectedText));

  if (!selectedText) {
    return createOverlay('Please copy text (Ctrl+C) before pressing the hotkey.');
  }

  // Store original text for follow-ups
  originalSelectedText = selectedText;

  const prompt = buildPrompt(selectedText);
  console.log('[Prompt]:', prompt);

  let aiResponse;
  try {
    const result = await ai.models.generateContent({
      model: 'gemini-1.5-pro',
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

// Close overlay request
ipcMain.on('overlay-close', () => {
  console.log('[Close request received]');
  if (overlayWindow) {
    overlayWindow.close();
    overlayWindow = null;
  }
});

// Follow-up handler via IPC
ipcMain.handle('overlay-followup', async (_, question) => {
  console.log('[Follow-up question]:', question);
  console.log('[Original context]:', originalSelectedText);
  try {
    const result = await ai.models.generateContent({
      model: 'gemini-1.5-pro',
      contents: `Original text that was selected: "${originalSelectedText}"

Follow-up question: ${question}`
    });
    return result.text.trim();
  } catch (error) {
    console.error('[Follow-up error]:', error);
    return `API Error: ${error.message}`;
  }
});

// App lifecycle
app.whenReady().then(() => {
  console.log('[App ready]');
  const registered = globalShortcut.register('CommandOrControl+Shift+Enter', summarizeSelection);
  console.log('[Shortcut registered]:', registered);
});

app.on('window-all-closed', e => e.preventDefault());
app.on('will-quit', () => globalShortcut.unregisterAll());
