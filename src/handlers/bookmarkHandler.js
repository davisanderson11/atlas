// Temporal bookmark handler module for saving and retrieving moments in time

import { writeFile, readFile, mkdir, readdir, unlink } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { existsSync } from 'fs';
import { config } from '../config.js';
import { clipboard, desktopCapturer, screen } from 'electron';

export class BookmarkHandler {
  constructor(ai) {
    this.ai = ai;
    this.bookmarksPath = join(homedir(), config.features.bookmarks.storagePath);
    this.ensureStorageDirectory();
  }

  /**
   * Ensure bookmark storage directory exists
   */
  async ensureStorageDirectory() {
    try {
      if (!existsSync(this.bookmarksPath)) {
        await mkdir(this.bookmarksPath, { recursive: true });
        console.log('[BookmarkHandler] Created bookmarks directory:', this.bookmarksPath);
      }
    } catch (error) {
      console.error('[BookmarkHandler] Failed to create storage directory:', error);
    }
  }

  /**
   * Create a new temporal bookmark
   */
  async createBookmark() {
    console.log('[BookmarkHandler] Creating temporal bookmark');
    
    try {
      const timestamp = Date.now();
      const bookmarkId = `bookmark_${timestamp}`;
      
      // Capture all windows and primary screen
      const windows = await this.captureAllWindows();
      const primaryScreenshot = await this.captureFullScreen();
      const clipboardText = clipboard.readText();
      const clipboardImage = clipboard.readImage();
      
      // Get active window ID
      const activeWindowId = this.getActiveWindowId(windows);
      
      // Generate AI context for the moment
      const aiContext = await this.generateContextSummary({
        timestamp,
        clipboardText,
        hasClipboardImage: !clipboardImage.isEmpty(),
        windows,
        activeWindowId,
        primaryScreenshot
      });
      
      // Create bookmark object
      const bookmark = {
        id: bookmarkId,
        timestamp,
        createdAt: new Date(timestamp).toISOString(),
        displayName: '', // User-editable display name
        windows,
        activeWindowId,
        primaryScreenshot,
        clipboard: {
          text: clipboardText,
          hasImage: !clipboardImage.isEmpty(),
          imageData: clipboardImage.isEmpty() ? null : clipboardImage.toPNG().toString('base64')
        },
        aiContext,
        userNote: '', // Can be added later
        tags: []
      };
      
      // Save bookmark
      await this.saveBookmark(bookmark);
      
      // Limit total bookmarks
      await this.enforceBookmarkLimit();
      
      return bookmark;
    } catch (error) {
      console.error('[BookmarkHandler] Failed to create bookmark:', error);
      throw error;
    }
  }

  /**
   * Capture full screen screenshot
   */
  async captureFullScreen() {
    try {
      const primaryDisplay = screen.getPrimaryDisplay();
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: {
          width: primaryDisplay.bounds.width,
          height: primaryDisplay.bounds.height
        }
      });
      
      if (sources.length === 0) {
        throw new Error('No screen sources available');
      }
      
      const screenshot = sources[0].thumbnail;
      return screenshot.toPNG().toString('base64');
    } catch (error) {
      console.error('[BookmarkHandler] Screenshot capture failed:', error);
      return null;
    }
  }

  /**
   * Capture all open windows
   */
  async captureAllWindows() {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['window'],
        thumbnailSize: {
          width: 1920,
          height: 1080
        },
        fetchWindowIcons: true
      });
      
      console.log(`[BookmarkHandler] Found ${sources.length} windows`);
      
      const windows = await Promise.all(sources.map(async (source, index) => {
        try {
          // Get window bounds if available (may require native module)
          const bounds = await this.getWindowBounds(source.id);
          
          return {
            id: source.id,
            title: source.name,
            app: source.appIcon ? this.extractAppName(source.name) : 'Unknown',
            screenshot: source.thumbnail.toPNG().toString('base64'),
            appIcon: source.appIcon ? source.appIcon.toPNG().toString('base64') : null,
            bounds: bounds || { x: 0, y: 0, width: 800, height: 600 },
            zOrder: index, // Approximation of z-order
            display_id: source.display_id
          };
        } catch (error) {
          console.error(`[BookmarkHandler] Failed to process window ${source.name}:`, error);
          return null;
        }
      }));
      
      // Filter out failed captures
      return windows.filter(w => w !== null);
    } catch (error) {
      console.error('[BookmarkHandler] Failed to capture windows:', error);
      return [];
    }
  }

  /**
   * Get window bounds (placeholder - would need native module for full implementation)
   */
  async getWindowBounds(windowId) {
    // In a full implementation, this would use a native module like node-window-manager
    // For now, return null to use default bounds
    return null;
  }

  /**
   * Extract app name from window title
   */
  extractAppName(windowTitle) {
    // Common patterns for extracting app names
    const patterns = [
      /^(.+?) - /,           // "App - Document"
      / - (.+?)$/,           // "Document - App"
      /^(.+?): /,            // "App: Document"
      / \| (.+?)$/,          // "Document | App"
      / — (.+?)$/,           // "Document — App"
    ];
    
    for (const pattern of patterns) {
      const match = windowTitle.match(pattern);
      if (match) {
        return match[1].trim();
      }
    }
    
    // If no pattern matches, return the first word or the whole title
    const firstWord = windowTitle.split(' ')[0];
    return firstWord.length > 2 ? firstWord : windowTitle;
  }

  /**
   * Get the ID of the currently active window
   */
  getActiveWindowId(windows) {
    // In a full implementation, this would use native module to get actual active window
    // For now, return the first window (usually most recently used)
    return windows.length > 0 ? windows[0].id : null;
  }

  /**
   * Generate AI context summary for the bookmark
   */
  async generateContextSummary({ timestamp, clipboardText, hasClipboardImage, windows, activeWindowId, primaryScreenshot }) {
    try {
      const activeWindow = windows.find(w => w.id === activeWindowId);
      const windowList = windows.map(w => `- ${w.title} (${w.app})`).join('\n');
      
      const prompt = `Analyze this moment in time and provide a comprehensive contextual summary:

Time: ${new Date(timestamp).toLocaleString()}
Open windows (${windows.length} total):
${windowList}

Active window: ${activeWindow ? activeWindow.title : 'Unknown'}
Clipboard content: ${clipboardText ? `"${clipboardText.substring(0, 100)}${clipboardText.length > 100 ? '...' : ''}"` : 'Empty'}
Clipboard has image: ${hasClipboardImage ? 'Yes' : 'No'}

Based on the primary screenshot and the context of all open windows, describe:
1. What the user appears to be working on overall
2. The workflow context across multiple applications
3. Key tasks or projects visible across windows

Keep the summary concise (3-4 sentences max) but comprehensive.`;

      const parts = [{ text: prompt }];
      
      if (primaryScreenshot) {
        parts.push({
          inlineData: {
            mimeType: 'image/png',
            data: primaryScreenshot
          }
        });
      }

      const result = await this.ai.models.generateContent({
        model: config.ai.model,
        contents: [{ parts }]
      });

      return result.text.trim();
    } catch (error) {
      console.error('[BookmarkHandler] AI context generation failed:', error);
      return 'Context generation failed';
    }
  }

  /**
   * Save bookmark to disk
   */
  async saveBookmark(bookmark) {
    const filePath = join(this.bookmarksPath, `${bookmark.id}.json`);
    await writeFile(filePath, JSON.stringify(bookmark, null, 2));
    console.log('[BookmarkHandler] Bookmark saved:', bookmark.id);
  }

  /**
   * Load all bookmarks
   */
  async loadBookmarks() {
    try {
      const files = await readdir(this.bookmarksPath);
      const bookmarkFiles = files.filter(f => f.endsWith('.json'));
      
      const bookmarks = await Promise.all(
        bookmarkFiles.map(async (file) => {
          try {
            const content = await readFile(join(this.bookmarksPath, file), 'utf-8');
            return JSON.parse(content);
          } catch (error) {
            console.error(`[BookmarkHandler] Failed to load bookmark ${file}:`, error);
            return null;
          }
        })
      );
      
      // Filter out failed loads and sort by timestamp (newest first)
      return bookmarks
        .filter(b => b !== null)
        .sort((a, b) => b.timestamp - a.timestamp);
    } catch (error) {
      console.error('[BookmarkHandler] Failed to load bookmarks:', error);
      return [];
    }
  }

  /**
   * Get a specific bookmark
   */
  async getBookmark(bookmarkId) {
    try {
      const filePath = join(this.bookmarksPath, `${bookmarkId}.json`);
      const content = await readFile(filePath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      console.error('[BookmarkHandler] Failed to load bookmark:', error);
      return null;
    }
  }

  /**
   * Delete a bookmark
   */
  async deleteBookmark(bookmarkId) {
    try {
      const filePath = join(this.bookmarksPath, `${bookmarkId}.json`);
      await unlink(filePath);
      console.log('[BookmarkHandler] Bookmark deleted:', bookmarkId);
      return true;
    } catch (error) {
      console.error('[BookmarkHandler] Failed to delete bookmark:', error);
      return false;
    }
  }

  /**
   * Update bookmark with user note or tags
   */
  async updateBookmark(bookmarkId, updates) {
    try {
      const bookmark = await this.getBookmark(bookmarkId);
      if (!bookmark) {
        throw new Error('Bookmark not found');
      }
      
      // Apply updates
      if (updates.displayName !== undefined) {
        bookmark.displayName = updates.displayName;
      }
      if (updates.userNote !== undefined) {
        bookmark.userNote = updates.userNote;
      }
      if (updates.tags !== undefined) {
        bookmark.tags = updates.tags;
      }
      
      // Save updated bookmark
      await this.saveBookmark(bookmark);
      return bookmark;
    } catch (error) {
      console.error('[BookmarkHandler] Failed to update bookmark:', error);
      throw error;
    }
  }

  /**
   * Search bookmarks by query
   */
  async searchBookmarks(query) {
    const bookmarks = await this.loadBookmarks();
    const searchTerm = query.toLowerCase();
    
    return bookmarks.filter(bookmark => {
      // Search in AI context
      if (bookmark.aiContext && bookmark.aiContext.toLowerCase().includes(searchTerm)) {
        return true;
      }
      // Search in user note
      if (bookmark.userNote && bookmark.userNote.toLowerCase().includes(searchTerm)) {
        return true;
      }
      // Search in clipboard text
      if (bookmark.clipboard.text && bookmark.clipboard.text.toLowerCase().includes(searchTerm)) {
        return true;
      }
      // Search in tags
      if (bookmark.tags && bookmark.tags.some(tag => tag.toLowerCase().includes(searchTerm))) {
        return true;
      }
      // Search in window titles
      if (bookmark.windows && bookmark.windows.some(window => 
        window.title && window.title.toLowerCase().includes(searchTerm)
      )) {
        return true;
      }
      // Search in app names
      if (bookmark.windows && bookmark.windows.some(window => 
        window.app && window.app.toLowerCase().includes(searchTerm)
      )) {
        return true;
      }
      
      return false;
    });
  }

  /**
   * Enforce maximum bookmark limit
   */
  async enforceBookmarkLimit() {
    try {
      const bookmarks = await this.loadBookmarks();
      
      if (bookmarks.length > config.features.bookmarks.maxBookmarks) {
        // Sort by timestamp and remove oldest
        const toDelete = bookmarks
          .sort((a, b) => a.timestamp - b.timestamp)
          .slice(0, bookmarks.length - config.features.bookmarks.maxBookmarks);
        
        for (const bookmark of toDelete) {
          await this.deleteBookmark(bookmark.id);
        }
        
        console.log(`[BookmarkHandler] Removed ${toDelete.length} old bookmarks`);
      }
    } catch (error) {
      console.error('[BookmarkHandler] Failed to enforce bookmark limit:', error);
    }
  }

  /**
   * Export bookmarks to a file
   */
  async exportBookmarks(exportPath) {
    try {
      const bookmarks = await this.loadBookmarks();
      const exportData = {
        version: '1.0',
        exportDate: new Date().toISOString(),
        bookmarks
      };
      
      await writeFile(exportPath, JSON.stringify(exportData, null, 2));
      return bookmarks.length;
    } catch (error) {
      console.error('[BookmarkHandler] Failed to export bookmarks:', error);
      throw error;
    }
  }

  /**
   * Import bookmarks from a file
   */
  async importBookmarks(importPath) {
    try {
      const content = await readFile(importPath, 'utf-8');
      const importData = JSON.parse(content);
      
      if (!importData.bookmarks || !Array.isArray(importData.bookmarks)) {
        throw new Error('Invalid import file format');
      }
      
      let imported = 0;
      for (const bookmark of importData.bookmarks) {
        // Generate new ID to avoid conflicts
        bookmark.id = `bookmark_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        await this.saveBookmark(bookmark);
        imported++;
      }
      
      return imported;
    } catch (error) {
      console.error('[BookmarkHandler] Failed to import bookmarks:', error);
      throw error;
    }
  }
}