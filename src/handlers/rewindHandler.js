// Rewind handler - captures last 10 seconds of screen activity

import { desktopCapturer, screen } from 'electron';
import { config } from '../config.js';

export class RewindHandler {
  constructor(ai) {
    this.ai = ai;
    this.frameBuffer = [];
    this.isRecording = false;
    this.captureInterval = null;
    this.maxFrames = 6; // Keep 6 frames
    this.captureIntervalMs = 1700; // Capture every 1.7 seconds (10 seconds / 6 frames)
    this.captureInProgress = false; // Prevent overlapping captures
  }

  /**
   * Start continuous frame capture
   */
  async startRecording() {
    if (this.isRecording) return;
    
    console.log('[RewindHandler] Starting frame capture');
    this.isRecording = true;
    
    // Use setTimeout instead of setInterval for better control
    const captureLoop = async () => {
      if (!this.isRecording) return;
      
      if (!this.captureInProgress) {
        try {
          await this.captureFrame();
        } catch (error) {
          console.error('[RewindHandler] Frame capture error:', error);
        }
      }
      
      // Schedule next capture
      if (this.isRecording) {
        setTimeout(captureLoop, this.captureIntervalMs);
      }
    };
    
    // Start the capture loop
    captureLoop();
  }

  /**
   * Stop frame capture
   */
  stopRecording() {
    if (!this.isRecording) return;
    
    console.log('[RewindHandler] Stopping frame capture');
    this.isRecording = false;
    
    if (this.captureInterval) {
      clearInterval(this.captureInterval);
      this.captureInterval = null;
    }
  }

  /**
   * Capture a single frame
   */
  async captureFrame() {
    if (this.captureInProgress) return;
    
    this.captureInProgress = true;
    
    try {
      const primaryDisplay = screen.getPrimaryDisplay();
      const { width, height } = primaryDisplay.bounds;
    
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: Math.min(1280, Math.floor(width / 2)), // Higher resolution
        height: Math.min(720, Math.floor(height / 2))   // 720p max
      }
    });
    
    if (sources.length > 0) {
      const frame = {
        timestamp: Date.now(),
        image: sources[0].thumbnail.toDataURL() // Convert to base64 data URL
      };
      
      // Add to circular buffer
      this.frameBuffer.push(frame);
      
      // Remove oldest frames if buffer is full
      if (this.frameBuffer.length > this.maxFrames) {
        this.frameBuffer.shift();
      }
    }
    } finally {
      this.captureInProgress = false;
    }
  }

  /**
   * Clear the frame buffer (for privacy)
   */
  clearBuffer() {
    console.log('[RewindHandler] Clearing frame buffer');
    this.frameBuffer = [];
  }

  /**
   * Get the current buffer as a video-like sequence
   */
  getRewindData() {
    if (this.frameBuffer.length === 0) {
      return null;
    }
    
    // Return the frames and metadata
    return {
      frames: this.frameBuffer,
      duration: 10, // Always approximately 10 seconds
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
    
    console.log(`[RewindHandler] Processing ${rewindData.frameCount} frames with question: ${userQuestion}`);
    
    // Use all frames since we're only keeping 6
    const keyFrames = rewindData.frames;
    
    // Create a composite prompt with multiple frames
    const parts = [
      {
        text: `User's question: "${userQuestion}"

I'm showing you ${keyFrames.length} screenshots from the last 10 seconds. Please provide a CONCISE SUMMARY that directly answers the user's question.

DO NOT:
- Describe each frame individually
- Mention frame numbers
- Speculate about details you can't clearly see
- Add information that isn't visible

DO:
- Give a brief overview of what happened
- Focus only on elements relevant to the user's question
- Mention specific text, errors, or UI elements only if clearly visible
- Keep your response short and direct`
      }
    ];
    
    // Add each key frame to the prompt
    keyFrames.forEach((frame, index) => {
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
        frameCount: rewindData.frameCount,
        duration: rewindData.duration
      };
    } catch (error) {
      console.error('[RewindHandler] AI processing error:', error);
      throw error;
    }
  }

  // Removed selectKeyFrames - no longer needed since we keep exactly what we need

  /**
   * Check if we should pause recording (privacy)
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