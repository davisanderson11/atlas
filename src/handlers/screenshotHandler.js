// Screenshot capture and analysis handler module

import { BrowserWindow, screen, desktopCapturer, ipcMain } from 'electron';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { config } from '../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class ScreenshotHandler {
  constructor(ai) {
    this.ai = ai;
    this.captureWindow = null;
  }

  /**
   * Start screen capture mode
   */
  async startCapture() {
    // Prevent multiple captures at once
    if (this.captureWindow && !this.captureWindow.isDestroyed()) {
      console.log('[ScreenshotHandler] Capture already in progress');
      return;
    }
    
    console.log('[ScreenshotHandler] Starting screen capture');
    
    // Get primary display
    const primaryDisplay = screen.getPrimaryDisplay();
    
    // Create a fullscreen transparent window for selection
    this.captureWindow = new BrowserWindow({
      x: primaryDisplay.bounds.x,
      y: primaryDisplay.bounds.y,
      width: primaryDisplay.bounds.width,
      height: primaryDisplay.bounds.height,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: true,   // Need focus for keyboard events
      show: false,       // Don't show immediately
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: join(dirname(__dirname), 'capture-preload.js')
      }
    });
    
    this.captureWindow.loadFile(join(dirname(__dirname), 'capture.html'));
    
    // Show window after it's ready
    this.captureWindow.once('ready-to-show', () => {
      this.captureWindow.show(); // Show and focus to receive keyboard events
      this.captureWindow.setIgnoreMouseEvents(false);
      this.captureWindow.setAlwaysOnTop(true, 'screen-saver'); // Highest level
    });
    
    return new Promise((resolve, reject) => {
      // Handle area selection
      ipcMain.once('capture-area', async (event, bounds) => {
        if (this.captureWindow && !this.captureWindow.isDestroyed()) {
          this.captureWindow.close();
          this.captureWindow = null;
        }
        
        try {
          const screenshot = await this.captureScreenshot(bounds, primaryDisplay);
          resolve({ screenshot, bounds });
        } catch (error) {
          reject(error);
        }
      });
      
      // Handle escape key
      ipcMain.once('capture-cancelled', () => {
        if (this.captureWindow && !this.captureWindow.isDestroyed()) {
          this.captureWindow.close();
          this.captureWindow = null;
        }
        reject(new Error('Capture cancelled'));
      });
    });
  }

  /**
   * Capture screenshot of selected area
   */
  async captureScreenshot(bounds, primaryDisplay) {
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
    
    // Get the full screenshot
    const screenshot = sources[0].thumbnail;
    
    // Crop to selected area
    const croppedImage = screenshot.crop({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height
    });
    
    // Convert to base64
    const imageBuffer = croppedImage.toPNG();
    return imageBuffer.toString('base64');
  }

  /**
   * Process screenshot with AI
   */
  async process(base64Image) {
    console.log('[ScreenshotHandler] Processing screenshot with AI');
    
    try {
      const result = await this.ai.models.generateContent({
        model: config.ai.model,
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
      
      return {
        text: result.text.trim(),
        screenshotData: base64Image
      };
    } catch (error) {
      console.error('[ScreenshotHandler] AI error:', error);
      throw error;
    }
  }

  /**
   * Process follow-up question with screenshot context
   */
  async processFollowUp(question, screenshotData) {
    console.log('[ScreenshotHandler] Processing follow-up with screenshot');
    
    try {
      const result = await this.ai.models.generateContent({
        model: config.ai.model,
        contents: [{
          parts: [
            { text: `This is a follow-up question about the screenshot you just analyzed.\n\nFollow-up question: ${question}` },
            {
              inlineData: {
                mimeType: 'image/png',
                data: screenshotData
              }
            }
          ]
        }]
      });
      
      return result.text.trim();
    } catch (error) {
      console.error('[ScreenshotHandler] Follow-up error:', error);
      throw error;
    }
  }
}