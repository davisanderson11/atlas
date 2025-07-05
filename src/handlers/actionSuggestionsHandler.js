// Contextual Action Suggestions handler
// Monitors clipboard and suggests relevant actions based on content

import { clipboard, BrowserWindow, screen, ipcMain } from 'electron';
import { config } from '../config.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

export class ActionSuggestionsHandler {
  constructor(ai) {
    this.ai = ai;
    this.lastClipboardContent = '';
    this.actionChipWindow = null;
    this.monitoringInterval = null;
    this.hideTimeout = null;
  }

  /**
   * Start monitoring clipboard for changes
   */
  startMonitoring() {
    // Check clipboard every 500ms
    this.monitoringInterval = setInterval(() => {
      this.checkClipboard();
    }, 500);
    
    console.log('[ActionSuggestions] Started clipboard monitoring');
  }

  /**
   * Stop monitoring clipboard
   */
  stopMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    
    if (this.actionChipWindow) {
      this.actionChipWindow.close();
      this.actionChipWindow = null;
    }
    
    console.log('[ActionSuggestions] Stopped clipboard monitoring');
  }

  /**
   * Check clipboard for changes
   */
  async checkClipboard() {
    try {
      const currentContent = clipboard.readText();
      
      // Check if content has changed and is not empty
      if (currentContent && currentContent !== this.lastClipboardContent) {
        this.lastClipboardContent = currentContent;
        
        // Analyze content and show suggestions
        const contentType = this.detectContentType(currentContent);
        const actions = this.getActionsForType(contentType, currentContent);
        
        if (actions.length > 0) {
          this.showActionChip(actions, currentContent);
        }
      }
    } catch (error) {
      console.error('[ActionSuggestions] Error checking clipboard:', error);
    }
  }

  /**
   * Detect the type of content in clipboard
   */
  detectContentType(content) {
    // URL detection
    const urlPattern = /^(https?:\/\/|www\.)[^\s]+$/i;
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
          { id: 'preview', label: 'Preview page', icon: '🌐' },
          { id: 'summarize', label: 'Summarize article', icon: '📄' },
          { id: 'extract-images', label: 'Extract images', icon: '🖼️' }
        );
        break;
        
      case 'code':
        actions.push(
          { id: 'explain', label: 'Explain code', icon: '💡' },
          { id: 'optimize', label: 'Optimize', icon: '⚡' },
          { id: 'add-comments', label: 'Add comments', icon: '💬' }
        );
        
        // Detect language for translation suggestions
        if (this.detectLanguage(content) === 'javascript') {
          actions.push({ id: 'to-python', label: 'Convert to Python', icon: '🐍' });
        } else if (this.detectLanguage(content) === 'python') {
          actions.push({ id: 'to-javascript', label: 'Convert to JavaScript', icon: '📜' });
        }
        break;
        
      case 'email':
        actions.push(
          { id: 'compose', label: 'Compose email', icon: '✉️' },
          { id: 'validate', label: 'Validate address', icon: '✓' }
        );
        break;
        
      case 'json':
        actions.push(
          { id: 'format', label: 'Format JSON', icon: '🎨' },
          { id: 'validate-json', label: 'Validate', icon: '✓' },
          { id: 'to-yaml', label: 'Convert to YAML', icon: '📋' }
        );
        break;
        
      case 'text':
      default:
        // Only show suggestions for substantial text
        if (content.length > 50) {
          actions.push(
            { id: 'summarize-text', label: 'Summarize', icon: '📝' },
            { id: 'translate', label: 'Translate', icon: '🌍' },
            { id: 'improve', label: 'Improve writing', icon: '✨' }
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
   * Show action chip near cursor
   */
  showActionChip(actions, content) {
    // Clear any existing hide timeout
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
    }
    
    // Get cursor position
    const cursorPos = screen.getCursorScreenPoint();
    const currentDisplay = screen.getDisplayNearestPoint(cursorPos);
    
    // Calculate position (offset from cursor)
    const chipWidth = 300;
    const chipHeight = 40 + (actions.length * 36); // Header + action items
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
      height: 40 + (actions.length * 36),
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      resizable: false,
      movable: false,
      focusable: true,
      skipTaskbar: true,
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
    ipcMain.once('action-selected', (event, actionId) => {
      this.handleAction(actionId, content);
      if (this.actionChipWindow && !this.actionChipWindow.isDestroyed()) {
        this.actionChipWindow.close();
      }
    });
    
    // Close on blur
    this.actionChipWindow.on('blur', () => {
      setTimeout(() => {
        if (this.actionChipWindow && !this.actionChipWindow.isDestroyed()) {
          this.actionChipWindow.close();
        }
      }, 100);
    });
  }

  /**
   * Handle selected action
   */
  async handleAction(actionId, content) {
    console.log(`[ActionSuggestions] Handling action: ${actionId}`);
    
    // For now, we'll emit an event that the main window can handle
    // In a full implementation, each action would have its specific handler
    const mainWindow = BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.title === 'Atlas');
    
    if (mainWindow) {
      mainWindow.webContents.send('action-suggestion-selected', {
        actionId,
        content,
        timestamp: Date.now()
      });
    }
    
    // TODO: Implement specific handlers for each action type
    switch (actionId) {
      case 'summarize':
      case 'summarize-text':
        // Would open the main Atlas window with summarization request
        break;
      case 'preview':
        // Would open a preview window for URLs
        break;
      case 'explain':
        // Would explain the code
        break;
      // ... etc
    }
  }
}