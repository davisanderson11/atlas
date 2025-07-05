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
    if (this.actionChipWindow) {
      this.actionChipWindow.close();
      this.actionChipWindow = null;
    }
    
    if (this.mouseListener) {
      this.mouseListener.stop();
      this.mouseListener = null;
    }
    
    console.log('[ActionSuggestions] Cleaned up resources');
  }

  /**
   * Setup mouse monitoring for right clicks
   */
  async setupMouseMonitoring() {
    try {
      const { mouse, Button } = await import('@nut-tree-fork/nut-js');
      
      console.log('[ActionSuggestions] Setting up mouse monitoring');
      
      // Monitor mouse clicks
      mouse.on('click', async (button) => {
        if (button === Button.RIGHT) {
          console.log('[ActionSuggestions] Right click detected');
          
          // Debounce rapid clicks
          const now = Date.now();
          if (now - this.lastRightClickTime < 500) {
            return;
          }
          this.lastRightClickTime = now;
          
          // Small delay to let the context menu appear (if any)
          setTimeout(async () => {
            // Check if there's selected text
            const selectedText = await this.getSelectedText();
            if (selectedText && selectedText.trim()) {
              console.log('[ActionSuggestions] Found selected text:', selectedText.substring(0, 50) + '...');
              
              // Get mouse position
              const position = await mouse.getPosition();
              this.showActionChipAtPosition(
                this.getActionsForType(this.detectContentType(selectedText), selectedText),
                selectedText,
                position.x,
                position.y
              );
            }
          }, 100);
        }
      });
      
      console.log('[ActionSuggestions] Mouse monitoring started');
    } catch (error) {
      console.error('[ActionSuggestions] Error setting up mouse monitoring:', error);
      
      // Fallback to robotjs if nut-js fails
      this.setupRobotjsMonitoring();
    }
  }
  
  /**
   * Fallback mouse monitoring using robotjs
   */
  async setupRobotjsMonitoring() {
    try {
      const { createRequire } = await import('module');
      const require = createRequire(import.meta.url);
      const robot = require('@todesktop/robotjs-prebuild');
      
      // Since robotjs doesn't support right-click detection well,
      // we'll use a modifier key approach
      console.log('[ActionSuggestions] Robotjs fallback: Hold Shift and right-click to show actions');
      
      // Monitor for Shift key + mouse position
      let shiftPressed = false;
      
      setInterval(async () => {
        // Check if shift is pressed
        // Unfortunately robotjs doesn't have good key state detection either
        // So we'll need to rely on the nut-js approach primarily
      }, 100);
      
    } catch (error) {
      console.error('[ActionSuggestions] Robotjs fallback also failed:', error);
    }
  }
  
  /**
   * Get currently selected text
   */
  async getSelectedText() {
    try {
      // Save current clipboard content
      const originalClipboard = clipboard.readText();
      
      // Clear clipboard first
      clipboard.clear();
      
      // Use dynamic import for ESM compatibility
      const { createRequire } = await import('module');
      const require = createRequire(import.meta.url);
      const robot = require('@todesktop/robotjs-prebuild');
      
      // Send Ctrl+C / Cmd+C
      if (process.platform === 'darwin') {
        robot.keyTap('c', 'command');
      } else {
        robot.keyTap('c', 'control');
      }
      
      // Wait a bit for the copy to complete
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Get the selected text
      const selectedText = clipboard.readText();
      
      // Restore original clipboard content
      if (originalClipboard) {
        clipboard.writeText(originalClipboard);
      }
      
      return selectedText;
    } catch (error) {
      console.error('[ActionSuggestions] Error getting selected text:', error);
      return '';
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
          { id: 'summarize', label: 'Summarize article' },
          { id: 'extract-images', label: 'Extract images' }
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
        // Only show suggestions for substantial text
        if (content.length > 50) {
          actions.push(
            { id: 'summarize-text', label: 'Summarize' },
            { id: 'translate', label: 'Translate' },
            { id: 'improve', label: 'Improve writing' }
          );
        }
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
      this.handleAction(actionId, content);
      if (this.actionChipWindow && !this.actionChipWindow.isDestroyed()) {
        this.actionChipWindow.close();
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
      // Clear the reference when window is closed
      this.actionChipWindow = null;
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
        // Open URL in default browser
        if (content.trim().match(/^(https?:\/\/|www\.)/i)) {
          let url = content.trim();
          if (!url.startsWith('http')) {
            url = 'https://' + url;
          }
          console.log('[ActionSuggestions] Opening URL:', url);
          shell.openExternal(url);
        }
        break;
        
      case 'summarize':
      case 'summarize-text':
        // Trigger the main Atlas summarize function
        this.triggerAtlasSummarize(content);
        break;
        
      case 'explain':
        // Trigger Atlas with code explanation request
        this.triggerAtlasAction('Explain this code:\n\n' + content);
        break;
        
      case 'optimize':
        // Trigger Atlas with optimization request
        this.triggerAtlasAction('Optimize this code for performance:\n\n' + content);
        break;
        
      case 'add-comments':
        // Trigger Atlas with comment request
        this.triggerAtlasAction('Add helpful comments to this code:\n\n' + content);
        break;
        
      case 'to-python':
        // Trigger Atlas with translation request
        this.triggerAtlasAction('Convert this JavaScript code to Python:\n\n' + content);
        break;
        
      case 'to-javascript':
        // Trigger Atlas with translation request
        this.triggerAtlasAction('Convert this Python code to JavaScript:\n\n' + content);
        break;
        
      case 'format':
        // Trigger Atlas with format request
        this.triggerAtlasAction('Format this JSON properly:\n\n' + content);
        break;
        
      case 'translate':
        // Trigger Atlas with translation request
        this.triggerAtlasAction('Translate this text to English (or to Spanish if already in English):\n\n' + content);
        break;
        
      case 'improve':
        // Trigger Atlas with writing improvement request
        this.triggerAtlasAction('Improve this writing (grammar, clarity, conciseness):\n\n' + content);
        break;
        
      default:
        console.log('[ActionSuggestions] Unknown action:', actionId);
    }
  }
  
  /**
   * Trigger Atlas summarize function
   */
  async triggerAtlasSummarize(content) {
    try {
      console.log('[ActionSuggestions] Triggering Atlas summarize');
      
      // Set clipboard with content
      clipboard.writeText(content);
      
      // Emit a custom event that main.js can listen for
      process.emit('action-chip-trigger', content);
      
    } catch (error) {
      console.error('[ActionSuggestions] Error triggering summarize:', error);
    }
  }
  
  /**
   * Trigger Atlas with a specific action/prompt
   */
  async triggerAtlasAction(prompt) {
    try {
      // Same as summarize but with the prompt
      await this.triggerAtlasSummarize(prompt);
    } catch (error) {
      console.error('[ActionSuggestions] Error triggering action:', error);
    }
  }
}