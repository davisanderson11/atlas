// Rewind handler - captures last 10 seconds of screen activity

import { desktopCapturer, screen } from 'electron';
import { config } from '../config.js';

export class RewindHandler {
  constructor(ai) {
    this.ai = ai;
    this.frameBuffer = [];
    this.isRecording = false;
    this.captureInterval = null;
    this.maxFrames = 100; // 10 seconds at 10 FPS
    this.fps = 10; // Frames per second
  }

  /**
   * Start continuous frame capture
   */
  async startRecording() {
    if (this.isRecording) return;
    
    console.log('[RewindHandler] Starting frame capture');
    this.isRecording = true;
    
    // Capture frames at regular intervals
    this.captureInterval = setInterval(async () => {
      try {
        await this.captureFrame();
      } catch (error) {
        console.error('[RewindHandler] Frame capture error:', error);
      }
    }, 1000 / this.fps); // Capture every 100ms for 10 FPS
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
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.bounds;
    
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: Math.floor(width / 2), // Half resolution for memory efficiency
        height: Math.floor(height / 2)
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
      duration: this.frameBuffer.length / this.fps,
      fps: this.fps,
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
    
    // Take key frames for analysis (first, middle, last, and a few in between)
    const keyFrameIndices = this.selectKeyFrames(rewindData.frames.length);
    const keyFrames = keyFrameIndices.map(i => rewindData.frames[i]);
    
    // Create a composite prompt with multiple frames
    const parts = [
      {
        text: `I'm showing you ${keyFrames.length} key frames from the last ${rewindData.duration.toFixed(1)} seconds of screen activity.
        
User's question: "${userQuestion}"

Please analyze these frames in sequence and answer the user's question about what happened. Focus on changes between frames and any relevant details that help answer their specific question.`
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

  /**
   * Select key frames for analysis
   */
  selectKeyFrames(totalFrames) {
    if (totalFrames <= 5) {
      // If 5 or fewer frames, use all
      return Array.from({ length: totalFrames }, (_, i) => i);
    }
    
    // Otherwise, select up to 5 key frames evenly distributed
    const indices = [];
    const step = (totalFrames - 1) / 4; // 5 frames total (including first and last)
    
    for (let i = 0; i < 5; i++) {
      indices.push(Math.round(i * step));
    }
    
    return indices;
  }

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