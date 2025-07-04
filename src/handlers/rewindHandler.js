// Rewind handler - captures screen activity with smart quality selection

import { desktopCapturer, screen } from 'electron';
import { config } from '../config.js';

export class RewindHandler {
  constructor(ai) {
    this.ai = ai;
    this.frameBuffer = [];
    this.isRecording = false;
    this.maxFrames = 30; // Keep last 30 frames (mix of low and high quality)
    this.captureInProgress = false;
    
    // Change detection
    this.lastFrame = null;
    this.lastChangeTime = 0;
    this.changeThreshold = 0.08; // 8% change threshold
    
    // Timing
    this.lowQualityInterval = 500; // Capture low quality every 500ms
    this.minTimeBetweenHighQuality = 300; // Min 300ms between high quality captures
  }

  /**
   * Start continuous recording
   */
  async startRecording() {
    if (this.isRecording) return;
    
    console.log('[RewindHandler] Starting smart capture');
    this.isRecording = true;
    
    // Regular low-quality capture loop
    const captureLoop = async () => {
      if (!this.isRecording) return;
      
      if (!this.captureInProgress) {
        try {
          await this.captureAndCheck();
        } catch (error) {
          console.error('[RewindHandler] Capture error:', error);
        }
      }
      
      // Schedule next capture
      if (this.isRecording) {
        setTimeout(captureLoop, this.lowQualityInterval);
      }
    };
    
    // Start the capture loop
    captureLoop();
  }

  /**
   * Stop recording
   */
  stopRecording() {
    if (!this.isRecording) return;
    
    console.log('[RewindHandler] Stopping capture');
    this.isRecording = false;
  }

  /**
   * Capture frame and check for changes
   */
  async captureAndCheck() {
    if (this.captureInProgress) return;
    this.captureInProgress = true;
    
    try {
      const primaryDisplay = screen.getPrimaryDisplay();
      const { width, height } = primaryDisplay.bounds;
      
      // Always capture low quality for the buffer
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: {
          width: Math.min(640, Math.floor(width / 3)), // Low quality
          height: Math.min(360, Math.floor(height / 3))
        }
      });
      
      if (sources.length === 0) return;
      
      const currentFrame = sources[0].thumbnail;
      const now = Date.now();
      
      // Check for changes
      let isSignificantChange = false;
      if (this.lastFrame) {
        const changeAmount = this.calculateChange(this.lastFrame, currentFrame);
        isSignificantChange = changeAmount > this.changeThreshold && 
                             (now - this.lastChangeTime) > this.minTimeBetweenHighQuality;
        
        if (isSignificantChange) {
          console.log(`[RewindHandler] Significant change detected: ${(changeAmount * 100).toFixed(1)}%`);
        }
      }
      
      // Decide quality based on change detection
      if (isSignificantChange) {
        // Capture high quality for significant changes
        this.lastChangeTime = now;
        await this.captureHighQuality('change-detected');
      } else {
        // Store low quality frame
        const frame = {
          timestamp: now,
          image: currentFrame.toDataURL(),
          quality: 'low',
          reason: 'periodic'
        };
        this.addFrame(frame);
      }
      
      this.lastFrame = currentFrame;
      
    } finally {
      this.captureInProgress = false;
    }
  }

  /**
   * Capture high quality frame
   */
  async captureHighQuality(reason) {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.bounds;
    
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: Math.min(1280, Math.floor(width * 0.75)), // High quality
        height: Math.min(720, Math.floor(height * 0.75))
      }
    });
    
    if (sources.length > 0) {
      const frame = {
        timestamp: Date.now(),
        image: sources[0].thumbnail.toDataURL(),
        quality: 'high',
        reason: reason
      };
      this.addFrame(frame);
    }
  }

  /**
   * Calculate change between two frames
   */
  calculateChange(frame1, frame2) {
    const data1 = frame1.toBitmap();
    const data2 = frame2.toBitmap();
    
    if (data1.length !== data2.length) return 1;
    
    let diffPixels = 0;
    const totalPixels = data1.length / 4;
    
    // Sample every 10th pixel for performance
    for (let i = 0; i < data1.length; i += 40) { // 4 channels * 10 pixels
      const diff = Math.abs(data1[i] - data2[i]) + 
                  Math.abs(data1[i+1] - data2[i+1]) + 
                  Math.abs(data1[i+2] - data2[i+2]);
      
      if (diff > 50) {
        diffPixels += 10; // Account for sampling
      }
    }
    
    return diffPixels / totalPixels;
  }

  /**
   * Add frame to buffer
   */
  addFrame(frame) {
    this.frameBuffer.push(frame);
    
    // Remove old frames
    if (this.frameBuffer.length > this.maxFrames) {
      this.frameBuffer.shift();
    }
    
    console.log(`[RewindHandler] Frame added (${frame.quality}, ${frame.reason}), buffer: ${this.frameBuffer.length}`);
  }

  /**
   * Clear the frame buffer
   */
  clearBuffer() {
    console.log('[RewindHandler] Clearing frame buffer');
    this.frameBuffer = [];
    this.lastFrame = null;
  }

  /**
   * Get rewind data
   */
  getRewindData() {
    if (this.frameBuffer.length === 0) {
      return null;
    }
    
    const firstTime = this.frameBuffer[0].timestamp;
    const lastTime = this.frameBuffer[this.frameBuffer.length - 1].timestamp;
    const duration = (lastTime - firstTime) / 1000;
    
    return {
      frames: this.frameBuffer,
      duration: duration,
      frameCount: this.frameBuffer.length
    };
  }

  /**
   * Process rewind with user context
   */
  async processRewind(userQuestion) {
    const rewindData = this.getRewindData();
    
    if (!rewindData || rewindData.frames.length === 0) {
      throw new Error('No frames captured in buffer');
    }
    
    console.log(`[RewindHandler] Processing ${rewindData.frameCount} frames over ${rewindData.duration.toFixed(1)}s`);
    
    // Select frames to send to AI (prioritize high quality and recent)
    const framesToAnalyze = [];
    const highQualityFrames = rewindData.frames.filter(f => f.quality === 'high');
    const lowQualityFrames = rewindData.frames.filter(f => f.quality === 'low');
    
    // Add all high quality frames (up to 6)
    framesToAnalyze.push(...highQualityFrames.slice(-6));
    
    // If we need more frames, add some low quality ones
    if (framesToAnalyze.length < 8) {
      const needed = 8 - framesToAnalyze.length;
      // Get evenly distributed low quality frames
      const step = Math.max(1, Math.floor(lowQualityFrames.length / needed));
      for (let i = 0; i < lowQualityFrames.length && framesToAnalyze.length < 8; i += step) {
        framesToAnalyze.push(lowQualityFrames[i]);
      }
    }
    
    // Sort by timestamp
    framesToAnalyze.sort((a, b) => a.timestamp - b.timestamp);
    
    console.log(`[RewindHandler] Sending ${framesToAnalyze.length} frames (${framesToAnalyze.filter(f => f.quality === 'high').length} high quality)`);
    
    // Create prompt
    const parts = [
      {
        text: `User's question: "${userQuestion}"

I'm showing you ${framesToAnalyze.length} screenshots from the last ${rewindData.duration.toFixed(1)} seconds. High-quality images were captured when significant changes occurred.

Please provide a CONCISE SUMMARY that directly answers the user's question. Focus on what happened, not individual frames.`
      }
    ];
    
    // Add frames
    framesToAnalyze.forEach((frame) => {
      const base64Data = frame.image.replace(/^data:image\/png;base64,/, '');
      parts.push({
        inlineData: {
          mimeType: 'image/png',
          data: base64Data
        }
      });
    });
    
    try {
      const result = await this.ai.models.generateContent({
        model: config.ai.model,
        contents: [{ parts }]
      });
      
      return {
        response: result.text.trim(),
        frameCount: framesToAnalyze.length,
        totalFrames: rewindData.frameCount,
        duration: rewindData.duration
      };
    } catch (error) {
      console.error('[RewindHandler] AI processing error:', error);
      throw error;
    }
  }

  /**
   * Check if we should pause recording
   */
  shouldPauseRecording(activeWindowTitle) {
    const sensitivePatterns = [
      /password/i,
      /banking/i,
      /1password/i,
      /lastpass/i,
      /bitwarden/i,
      /keeper/i,
      /private browsing/i,
      /incognito/i
    ];
    
    return sensitivePatterns.some(pattern => pattern.test(activeWindowTitle));
  }
}