// Contextual Action Suggestions handler
// Monitors clipboard and suggests relevant actions based on content

import { clipboard, BrowserWindow, screen, ipcMain } from 'electron';
import { config } from '../config.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

export class ActionSuggestionsHandler {
  constructor(ai) {
    this.ai = ai;
    this.actionChipWindow = null;
    this.hideTimeout = null;
    this.mouseListener = null;
    this.lastRightClickTime = 0;
  }

  /**
   * Initialize context menu handling
   */
  async initialize() {
    console.log('[ActionSuggestions] Initializing right-click handler');
    
    // Set up mouse monitoring
    await this.setupMouseMonitoring();
  }

  /**
   * Clean up resources
   */
  async cleanup() {
    console.log('[ActionSuggestions] Cleaning up resources');
    
    // Close action chip window if open
    if (this.actionChipWindow) {
      try {
        if (!this.actionChipWindow.isDestroyed()) {
          this.actionChipWindow.close();
        }
      } catch (e) {
        console.error('[ActionSuggestions] Error closing window during cleanup:', e);
      }
      this.actionChipWindow = null;
    }
    
    // Clear any timeouts
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }
    
    if (this.mouseListener) {
      this.mouseListener.stop();
      this.mouseListener = null;
    }
    
    // Note: globalShortcut will be unregistered by main.js
    console.log('[ActionSuggestions] Cleaned up resources');
  }

  /**
   * Setup mouse monitoring for right clicks
   */
  async setupMouseMonitoring() {
    try {
      // For now, let's use a simpler approach with global shortcuts
      // True mouse monitoring would require native modules compiled for the right architecture
      console.log('[ActionSuggestions] Using alternative approach: Select text and use Ctrl+Right Click');
      
      const { globalShortcut } = await import('electron');
      
      // Register Ctrl+Right Click detection via a keyboard shortcut
      // We'll monitor for a special key combination instead
      const shortcut = 'CommandOrControl+Shift+Space';
      
      const registered = globalShortcut.register(shortcut, async () => {
        console.log('[ActionSuggestions] Shortcut triggered');
        
        // Check if action chip is already open
        if (this.actionChipWindow && !this.actionChipWindow.isDestroyed()) {
          console.log('[ActionSuggestions] Action chip already open, closing it');
          this.actionChipWindow.close();
          this.actionChipWindow = null;
          return;
        }
        
        const selectedText = await this.getSelectedText();
        if (selectedText && selectedText.trim()) {
          console.log('[ActionSuggestions] Action triggered with text:', selectedText.substring(0, 50) + '...');
          
          const mousePos = screen.getCursorScreenPoint();
          console.log('[ActionSuggestions] Mouse position:', mousePos);
          
          const contentType = this.detectContentType(selectedText);
          console.log('[ActionSuggestions] Content type:', contentType);
          
          const actions = this.getActionsForType(contentType, selectedText);
          console.log('[ActionSuggestions] Actions:', actions.length);
          
          if (actions.length > 0) {
            this.showActionChipAtPosition(actions, selectedText, mousePos.x, mousePos.y);
          } else {
            console.log('[ActionSuggestions] No actions available for this content type');
          }
        } else {
          console.log('[ActionSuggestions] No text selected');
        }
      });
      
      if (registered) {
        console.log(`[ActionSuggestions] Registered shortcut: ${shortcut} for selected text actions`);
      }
      
    } catch (error) {
      console.error('[ActionSuggestions] Error setting up monitoring:', error);
    }
  }
  
  
  /**
   * Get currently selected text
   */
  async getSelectedText() {
    try {
      // Save current clipboard content
      const originalClipboard = clipboard.readText();
      
      // Try using nut-js keyboard
      try {
        const { keyboard, Key } = await import('@nut-tree-fork/nut-js');
        
        // Clear clipboard
        clipboard.clear();
        
        // Send copy command
        if (process.platform === 'darwin') {
          await keyboard.pressKey(Key.LeftCmd, Key.C);
          await keyboard.releaseKey(Key.LeftCmd, Key.C);
        } else {
          await keyboard.pressKey(Key.LeftControl, Key.C);
          await keyboard.releaseKey(Key.LeftControl, Key.C);
        }
        
        // Wait for copy
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (nutError) {
        console.log('[ActionSuggestions] Nut-js keyboard failed, using clipboard directly');
        // If nut-js fails, we'll just use whatever is in the clipboard
      }
      
      // Get the selected text
      const selectedText = clipboard.readText();
      
      // Restore original clipboard content if we changed it
      if (selectedText !== originalClipboard && originalClipboard) {
        setTimeout(() => {
          clipboard.writeText(originalClipboard);
        }, 200);
      }
      
      return selectedText;
    } catch (error) {
      console.error('[ActionSuggestions] Error getting selected text:', error);
      // Last resort: return current clipboard content
      return clipboard.readText();
    }
  }


  /**
   * Detect the type of content in clipboard
   */
  detectContentType(content) {
    // URL detection - more comprehensive pattern
    const urlPattern = /^(https?:\/\/)?(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&\/\/=]*)$/i;
    if (urlPattern.test(content.trim())) {
      return 'url';
    }
    
    // Code detection (basic heuristics)
    const codePatterns = [
      /function\s+\w+\s*\(/,
      /class\s+\w+/,
      /const\s+\w+\s*=/,
      /let\s+\w+\s*=/,
      /var\s+\w+\s*=/,
      /import\s+.*\s+from/,
      /def\s+\w+\s*\(/,
      /if\s*\(.+\)\s*{/,
      /for\s*\(.+\)\s*{/,
      /\w+\s*=\s*function/,
      /export\s+(default\s+)?/
    ];
    
    if (codePatterns.some(pattern => pattern.test(content))) {
      return 'code';
    }
    
    // Email detection
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (emailPattern.test(content.trim())) {
      return 'email';
    }
    
    // JSON detection
    try {
      JSON.parse(content);
      return 'json';
    } catch {}
    
    // Default to text
    return 'text';
  }

  /**
   * Get relevant actions for content type
   */
  getActionsForType(type, content) {
    const actions = [];
    
    switch (type) {
      case 'url':
        actions.push(
          { id: 'preview', label: 'Preview page' },
          { id: 'summarize', label: 'Summarize article' }
        );
        break;
        
      case 'code':
        actions.push(
          { id: 'explain', label: 'Explain code' },
          { id: 'optimize', label: 'Optimize' },
          { id: 'add-comments', label: 'Add comments' }
        );
        
        // Detect language for translation suggestions
        if (this.detectLanguage(content) === 'javascript') {
          actions.push({ id: 'to-python', label: 'Convert to Python' });
        } else if (this.detectLanguage(content) === 'python') {
          actions.push({ id: 'to-javascript', label: 'Convert to JavaScript' });
        }
        break;
        
      case 'email':
        actions.push(
          { id: 'compose', label: 'Compose email' },
          { id: 'validate', label: 'Validate address' }
        );
        break;
        
      case 'json':
        actions.push(
          { id: 'format', label: 'Format JSON' },
          { id: 'validate-json', label: 'Validate' },
          { id: 'to-yaml', label: 'Convert to YAML' }
        );
        break;
        
      case 'text':
      default:
        // Show suggestions for any text
        actions.push(
          { id: 'summarize-text', label: 'Summarize' },
          { id: 'translate', label: 'Translate' },
          { id: 'improve', label: 'Improve writing' }
        );
        break;
    }
    
    return actions;
  }

  /**
   * Basic language detection for code
   */
  detectLanguage(code) {
    if (/import\s+.*\s+from|const\s+\w+\s*=|let\s+\w+\s*=|function\s+\w+/.test(code)) {
      return 'javascript';
    }
    if (/def\s+\w+.*:|import\s+\w+|from\s+\w+\s+import/.test(code)) {
      return 'python';
    }
    return 'unknown';
  }

  /**
   * Show action chip at specific position
   */
  showActionChipAtPosition(actions, content, x, y) {
    console.log('[ActionSuggestions] showActionChipAtPosition called');
    
    // Clear any existing hide timeout
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }
    
    // Close any existing action chip window
    if (this.actionChipWindow) {
      console.log('[ActionSuggestions] Closing existing action chip window');
      try {
        if (!this.actionChipWindow.isDestroyed()) {
          this.actionChipWindow.close();
        }
      } catch (e) {
        console.error('[ActionSuggestions] Error closing window:', e);
      }
      this.actionChipWindow = null;
    }
    
    // Get display info
    const currentDisplay = screen.getDisplayNearestPoint({ x, y });
    
    // Calculate position (offset from cursor)
    const chipWidth = 300;
    const chipHeight = 50 + (actions.length * 40) + 10;
    const offset = 10;
    
    let chipX = x + offset;
    let chipY = y + offset;
    
    // Adjust if would go off screen
    if (chipX + chipWidth > currentDisplay.bounds.x + currentDisplay.bounds.width) {
      chipX = x - chipWidth - offset;
    }
    if (chipY + chipHeight > currentDisplay.bounds.y + currentDisplay.bounds.height) {
      chipY = y - chipHeight - offset;
    }
    
    // Create the window
    this.createActionChipWindow(chipX, chipY, actions, content);
    
    // Auto-hide after 10 seconds
    this.hideTimeout = setTimeout(() => {
      if (this.actionChipWindow && !this.actionChipWindow.isDestroyed()) {
        this.actionChipWindow.close();
      }
    }, 10000);
  }

  /**
   * Show action chip near cursor (legacy method)
   */
  showActionChip(actions, content) {
    // Clear any existing hide timeout
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }
    
    // Close any existing action chip window
    if (this.actionChipWindow && !this.actionChipWindow.isDestroyed()) {
      this.actionChipWindow.close();
      this.actionChipWindow = null;
    }
    
    // Get cursor position
    const cursorPos = screen.getCursorScreenPoint();
    const currentDisplay = screen.getDisplayNearestPoint(cursorPos);
    
    // Calculate position (offset from cursor)
    const chipWidth = 300;
    const chipHeight = 50 + (actions.length * 40) + 10; // Header + action items + padding
    const offset = 20;
    
    let x = cursorPos.x + offset;
    let y = cursorPos.y + offset;
    
    // Adjust if would go off screen
    if (x + chipWidth > currentDisplay.bounds.x + currentDisplay.bounds.width) {
      x = cursorPos.x - chipWidth - offset;
    }
    if (y + chipHeight > currentDisplay.bounds.y + currentDisplay.bounds.height) {
      y = cursorPos.y - chipHeight - offset;
    }
    
    // Create or update action chip window
    if (!this.actionChipWindow || this.actionChipWindow.isDestroyed()) {
      this.createActionChipWindow(x, y, actions, content);
    } else {
      // Update position and content
      this.actionChipWindow.setBounds({ x, y });
      this.actionChipWindow.webContents.send('update-actions', { actions, content });
    }
    
    // Auto-hide after 10 seconds
    this.hideTimeout = setTimeout(() => {
      if (this.actionChipWindow && !this.actionChipWindow.isDestroyed()) {
        this.actionChipWindow.close();
      }
    }, 10000);
  }

  /**
   * Create the action chip window
   */
  createActionChipWindow(x, y, actions, content) {
    // Get the directory path
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    
    this.actionChipWindow = new BrowserWindow({
      x,
      y,
      width: 300,
      height: 50 + (actions.length * 40) + 10,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      resizable: false,
      movable: false,
      focusable: true, // Need this for clicks to work
      skipTaskbar: true,
      hasShadow: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: join(__dirname, '../action-chip-preload.js')
      }
    });
    
    // Load the action chip HTML
    this.actionChipWindow.loadFile(join(__dirname, '../action-chip.html'));
    
    // Send actions once loaded
    this.actionChipWindow.webContents.once('did-finish-load', () => {
      this.actionChipWindow.webContents.send('set-actions', { actions, content });
    });
    
    // Handle action selection
    const handleActionSelection = (event, actionId) => {
      console.log('[ActionSuggestions] Action selected:', actionId);
      this.handleAction(actionId, content);
      
      // Ensure window is closed and reference is cleared
      if (this.actionChipWindow) {
        try {
          if (!this.actionChipWindow.isDestroyed()) {
            this.actionChipWindow.close();
          }
        } catch (e) {
          console.error('[ActionSuggestions] Error closing window after action:', e);
        }
        this.actionChipWindow = null;
      }
      
      // Clear any hide timeout
      if (this.hideTimeout) {
        clearTimeout(this.hideTimeout);
        this.hideTimeout = null;
      }
      
      // Remove the listener after handling
      ipcMain.removeListener('action-selected', handleActionSelection);
    };
    
    // Remove any existing listeners first
    ipcMain.removeAllListeners('action-selected');
    
    // Add the new listener
    ipcMain.on('action-selected', handleActionSelection);
    
    // Make window clickable
    this.actionChipWindow.setIgnoreMouseEvents(false);
    
    // Clean up on close
    this.actionChipWindow.on('closed', () => {
      console.log('[ActionSuggestions] Action chip window closed');
      // Clear the reference when window is closed
      this.actionChipWindow = null;
      
      // Clear any hide timeout
      if (this.hideTimeout) {
        clearTimeout(this.hideTimeout);
        this.hideTimeout = null;
      }
      
      // Remove any action selection listeners
      ipcMain.removeAllListeners('action-selected');
    });
    
    // Show the window with a slight delay to avoid focus issues
    setTimeout(() => {
      if (this.actionChipWindow && !this.actionChipWindow.isDestroyed()) {
        this.actionChipWindow.show();
        // Don't focus the window - let user continue working
        this.actionChipWindow.blur();
      }
    }, 100);
  }

  /**
   * Handle selected action
   */
  async handleAction(actionId, content) {
    console.log(`[ActionSuggestions] Handling action: ${actionId}`);
    
    // Import shell for opening URLs
    const { shell } = await import('electron');
    
    // Implement specific handlers for each action type
    switch (actionId) {
      case 'preview':
        // Create preview window in Atlas
        if (content.trim().match(/^(https?:\/\/|www\.)/i)) {
          let url = content.trim();
          if (!url.startsWith('http')) {
            url = 'https://' + url;
          }
          console.log('[ActionSuggestions] Creating preview window for URL:', url);
          this.createPreviewWindow(url);
        }
        break;
        
      case 'summarize':
      case 'summarize-text':
        // Trigger Atlas with summarize action
        this.triggerAtlasAction('summarize', content);
        break;
        
      case 'explain':
        // Trigger Atlas with code explanation request
        this.triggerAtlasAction('explain', content);
        break;
        
      case 'optimize':
        // Trigger Atlas with optimization request
        this.triggerAtlasAction('optimize', content);
        break;
        
      case 'add-comments':
        // Trigger Atlas with comment request
        this.triggerAtlasAction('add-comments', content);
        break;
        
      case 'to-python':
        // Trigger Atlas with translation request
        this.triggerAtlasAction('to-python', content);
        break;
        
      case 'to-javascript':
        // Trigger Atlas with translation request
        this.triggerAtlasAction('to-javascript', content);
        break;
        
      case 'format':
        // Trigger Atlas with format request
        this.triggerAtlasAction('format-json', content);
        break;
        
      case 'translate':
        // Show language selector
        this.showLanguageSelector(content);
        break;
        
      case 'improve':
        // Trigger Atlas with writing improvement request
        this.triggerAtlasAction('improve', content);
        break;
        
      default:
        console.log('[ActionSuggestions] Unknown action:', actionId);
    }
  }
  
  /**
   * Create preview window for URL
   */
  createPreviewWindow(url) {
    console.log('[ActionSuggestions] Creating preview window for:', url);
    
    // Get screen dimensions
    const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
    
    // Calculate window size (80% of screen or max 1200x800)
    const windowWidth = Math.min(Math.floor(screenWidth * 0.8), 1200);
    const windowHeight = Math.min(Math.floor(screenHeight * 0.8), 800);
    
    // Center the window
    const x = Math.floor((screenWidth - windowWidth) / 2);
    const y = Math.floor((screenHeight - windowHeight) / 2);
    
    // Create preview window
    const previewWindow = new BrowserWindow({
      x, y,
      width: windowWidth,
      height: windowHeight,
      title: `Preview: ${url}`,
      webPreferences: {
        webviewTag: true,
        nodeIntegration: false,
        contextIsolation: true
      },
      frame: true,
      show: false
    });
    
    // Create HTML content with webview
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body {
            margin: 0;
            padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            flex-direction: column;
            height: 100vh;
            background: #1a1a1a;
          }
          
          .toolbar {
            height: 40px;
            background: #2a2a2a;
            border-bottom: 1px solid #444;
            display: flex;
            align-items: center;
            padding: 0 16px;
            flex-shrink: 0;
          }
          
          .url-display {
            flex: 1;
            color: #e0e0e0;
            font-size: 13px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            padding: 6px 12px;
            background: rgba(255, 255, 255, 0.05);
            border-radius: 6px;
            margin-right: 12px;
          }
          
          .close-button {
            background: rgba(255, 255, 255, 0.1);
            border: none;
            color: #e0e0e0;
            padding: 6px 16px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 13px;
            transition: all 0.2s ease;
          }
          
          .close-button:hover {
            background: rgba(255, 255, 255, 0.2);
          }
          
          webview {
            flex: 1;
            width: 100%;
            border: none;
          }
          
          .loading {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            color: #888;
            font-size: 16px;
          }
        </style>
      </head>
      <body>
        <div class="toolbar">
          <div class="url-display">${url}</div>
          <button class="close-button" onclick="window.close()">Close</button>
        </div>
        <div class="loading">Loading...</div>
        <webview src="${url}" style="display:none;"></webview>
        
        <script>
          const webview = document.querySelector('webview');
          const loading = document.querySelector('.loading');
          
          webview.addEventListener('dom-ready', () => {
            loading.style.display = 'none';
            webview.style.display = 'block';
          });
          
          webview.addEventListener('did-fail-load', (e) => {
            loading.textContent = 'Failed to load page: ' + e.errorDescription;
          });
        </script>
      </body>
      </html>
    `;
    
    // Load the HTML content
    previewWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    
    // Show window when ready
    previewWindow.once('ready-to-show', () => {
      previewWindow.show();
    });
  }

  /**
   * Show language selector for translation
   */
  showLanguageSelector(content) {
    console.log('[ActionSuggestions] Showing language selector');
    
    // Get the directory path
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    
    // Get cursor position
    const cursorPos = screen.getCursorScreenPoint();
    
    // Create language selector window
    const languageSelectorWindow = new BrowserWindow({
      x: cursorPos.x + 10,
      y: cursorPos.y + 10,
      width: 250,
      height: 350,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      resizable: false,
      movable: false,
      focusable: true,
      skipTaskbar: true,
      hasShadow: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: join(__dirname, '../language-selector-preload.js')
      }
    });
    
    // Load the language selector HTML
    languageSelectorWindow.loadFile(join(__dirname, '../language-selector.html'));
    
    // Handle language selection
    const handleLanguageSelection = (event, language) => {
      console.log('[ActionSuggestions] Language selected:', language.name);
      languageSelectorWindow.close();
      
      // Trigger translation with selected language
      process.emit('action-chip-action', { 
        type: 'translate-to', 
        content: content,
        language: language
      });
      
      // Remove the listener
      ipcMain.removeListener('language-selected', handleLanguageSelection);
    };
    
    // Remove any existing listeners first
    ipcMain.removeAllListeners('language-selected');
    
    // Add the new listener
    ipcMain.on('language-selected', handleLanguageSelection);
    
    // Clean up on close
    languageSelectorWindow.on('closed', () => {
      ipcMain.removeAllListeners('language-selected');
    });
    
    // Show the window
    languageSelectorWindow.show();
  }

  /**
   * Trigger Atlas summarize function
   */
  async triggerAtlasSummarize(content) {
    try {
      console.log('[ActionSuggestions] Triggering Atlas summarize with content:', content.substring(0, 50) + '...');
      
      // Emit a custom event that main.js can listen for
      process.emit('action-chip-trigger', content);
      
    } catch (error) {
      console.error('[ActionSuggestions] Error triggering summarize:', error);
    }
  }
  
  /**
   * Trigger Atlas with a specific action/prompt
   */
  async triggerAtlasAction(actionType, content) {
    try {
      console.log('[ActionSuggestions] Triggering Atlas action:', actionType);
      
      // Emit a custom event with action type and content
      process.emit('action-chip-action', { type: actionType, content: content });
      
    } catch (error) {
      console.error('[ActionSuggestions] Error triggering action:', error);
    }
  }

  /**
   * Create a preview window for a URL
   */
  createPreviewWindow(url) {
    try {
      console.log('[ActionSuggestions] Creating preview window for URL:', url);
      
      // Get the directory path
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);
      
      // Get current display
      const currentDisplay = screen.getPrimaryDisplay();
      const { width, height } = currentDisplay.workAreaSize;
      
      // Create preview window
      const previewWindow = new BrowserWindow({
        width: Math.min(1200, width * 0.8),
        height: Math.min(800, height * 0.8),
        center: true,
        frame: true,
        titleBarStyle: 'default',
        title: `Atlas Preview - ${url}`,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          webviewTag: true
        }
      });
      
      // Load preview HTML with the URL
      const previewHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>Atlas Preview</title>
          <style>
            body {
              margin: 0;
              padding: 0;
              height: 100vh;
              display: flex;
              flex-direction: column;
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            }
            .toolbar {
              background: #f5f5f5;
              border-bottom: 1px solid #ccc;
              padding: 8px 12px;
              display: flex;
              align-items: center;
              gap: 10px;
            }
            .url-bar {
              flex: 1;
              padding: 6px 12px;
              border: 1px solid #ccc;
              border-radius: 4px;
              font-size: 14px;
              background: white;
            }
            .close-button {
              padding: 6px 12px;
              background: #dc3545;
              color: white;
              border: none;
              border-radius: 4px;
              cursor: pointer;
              font-size: 14px;
            }
            .close-button:hover {
              background: #c82333;
            }
            webview {
              flex: 1;
              width: 100%;
            }
          </style>
        </head>
        <body>
          <div class="toolbar">
            <input type="text" class="url-bar" value="${url}" readonly>
            <button class="close-button" onclick="window.close()">Close</button>
          </div>
          <webview src="${url}" allowpopups></webview>
        </body>
        </html>
      `;
      
      // Load the HTML content
      previewWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(previewHtml)}`);
      
      // Show the window
      previewWindow.show();
      
    } catch (error) {
      console.error('[ActionSuggestions] Error creating preview window:', error);
    }
  }
}