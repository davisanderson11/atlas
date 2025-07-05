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
    // Initialize with current clipboard content to avoid triggering on startup
    this.lastClipboardContent = clipboard.readText();
    console.log('[ActionSuggestions] Initialized with current clipboard content');
    
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
        console.log('[ActionSuggestions] New clipboard content detected:', currentContent.substring(0, 50) + '...');
        
        // Small delay to ensure the user has finished copying
        setTimeout(() => {
          // Analyze content and show suggestions
          const contentType = this.detectContentType(currentContent);
          console.log('[ActionSuggestions] Content type:', contentType);
          
          const actions = this.getActionsForType(contentType, currentContent);
          
          if (actions.length > 0) {
            this.showActionChip(actions, currentContent);
          }
        }, 200);
      }
    } catch (error) {
      console.error('[ActionSuggestions] Error checking clipboard:', error);
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
   * Show action chip near cursor
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