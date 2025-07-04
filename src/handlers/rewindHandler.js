// Rewind handler - optimized with worker threads and adaptive capture

import { desktopCapturer, screen, app, powerMonitor } from 'electron';
import { Worker } from 'worker_threads';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { config } from '../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class RewindHandler {
  constructor(ai) {
    this.ai = ai;
    this.frameBuffer = [];
    this.isRecording = false;
    this.maxFrames = 30;
    
    // Performance monitoring
    this.captureInProgress = false;
    this.lastCaptureTime = 0;
    this.lastCaptureMs = 0; // Track how long captures take
    this.systemLoad = 'low'; // low, medium, high
    this.skipCount = 0;
    
    // Adaptive quality settings
    this.qualitySettings = {
      low: { width: 640, height: 360, interval: 500 },
      medium: { width: 480, height: 270, interval: 750 },
      high: { width: 320, height: 180, interval: 1000 }
    };
    
    // Event-driven capture
    this.lastEventTime = 0;
    this.eventQueue = [];
    this.worker = null;
    
    // Frame comparison
    this.lastFrameData = null;
  }

  /**
   * Initialize worker thread for image processing
   */
  async initWorker() {
    if (this.worker) return;
    
    try {
      this.worker = new Worker(join(__dirname, 'rewindWorker.js'));
      
      this.worker.on('message', (message) => {
        if (message.type === 'change-detected') {
          this.handleChangeDetected(message.changeAmount);
        }
      });
      
      this.worker.on('error', (error) => {
        console.error('[RewindHandler] Worker error:', error);
        this.worker = null;
      });
    } catch (error) {
      console.error('[RewindHandler] Failed to create worker:', error);
    }
  }

  /**
   * Start recording with optimizations
   */
  async startRecording() {
    if (this.isRecording) return;
    
    console.log('[RewindHandler] Starting optimized capture');
    this.isRecording = true;
    
    // Initialize worker
    await this.initWorker();
    
    // Setup event listeners for user activity
    this.setupEventListeners();
    
    // Monitor system load
    this.startLoadMonitoring();
    
    // Start adaptive capture loop
    this.startAdaptiveCapture();
  }

  /**
   * Setup event listeners for user activity
   */
  setupEventListeners() {
    // Monitor window focus changes
    app.on('browser-window-focus', () => {
      this.queueEvent('window-focus');
    });
    
    // Monitor power/system events
    powerMonitor.on('speed-limit-change', () => {
      // Force a system load check when power state changes
      if (this.lastCaptureMs > 150) {
        this.systemLoad = 'high';
      } else if (this.lastCaptureMs > 100) {
        this.systemLoad = 'medium';
      } else {
        this.systemLoad = 'low';
      }
    });
  }

  /**
   * Queue an event for high-priority capture
   */
  queueEvent(eventType) {
    const now = Date.now();
    if (now - this.lastEventTime < 100) return; // Debounce
    
    this.lastEventTime = now;
    this.eventQueue.push({ type: eventType, time: now });
    
    // Trigger immediate capture for important events
    if (!this.captureInProgress) {
      this.captureFrame('event-' + eventType, true);
    }
  }

  /**
   * Monitor system load and adjust quality
   */
  startLoadMonitoring() {
    setInterval(() => {
      // Simple heuristic based on capture performance
      if (this.lastCaptureMs > 150) {
        this.systemLoad = 'high';
      } else if (this.lastCaptureMs > 100) {
        this.systemLoad = 'medium';
      } else {
        this.systemLoad = 'low';
      }
      
      // Reset skip count periodically
      if (this.skipCount > 0) {
        console.log(`[RewindHandler] Skipped ${this.skipCount} frames due to high load`);
        this.skipCount = 0;
      }
    }, 5000);
  }

  /**
   * Adaptive capture loop
   */
  startAdaptiveCapture() {
    const captureLoop = async () => {
      if (!this.isRecording) return;
      
      const settings = this.qualitySettings[this.systemLoad];
      
      // Skip if previous capture is still running and system is loaded
      if (this.captureInProgress && this.systemLoad !== 'low') {
        this.skipCount++;
        // Mark this period as high activity
        this.addFrame({
          timestamp: Date.now(),
          skipped: true,
          reason: 'high-activity',
          load: this.systemLoad
        });
      } else {
        await this.captureFrame('periodic', false);
      }
      
      // Schedule next capture with adaptive interval
      if (this.isRecording) {
        setTimeout(captureLoop, settings.interval);
      }
    };
    
    captureLoop();
  }

  /**
   * Capture frame with adaptive quality
   */
  async captureFrame(reason, isHighPriority = false) {
    if (this.captureInProgress && !isHighPriority) return;
    
    const captureStart = Date.now();
    this.captureInProgress = true;
    
    try {
      const primaryDisplay = screen.getPrimaryDisplay();
      const { width, height } = primaryDisplay.bounds;
      const settings = this.qualitySettings[this.systemLoad];
      
      // Use higher quality for event-driven captures
      const quality = isHighPriority ? this.qualitySettings.low : settings;
      
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: {
          width: Math.min(quality.width, Math.floor(width / 2)),
          height: Math.min(quality.height, Math.floor(height / 2))
        }
      });
      
      if (sources.length === 0) return;
      
      const thumbnail = sources[0].thumbnail;
      const frameData = thumbnail.toBitmap();
      
      // Send to worker for comparison if we have a previous frame
      if (this.worker && this.lastFrameData && !isHighPriority) {
        this.worker.postMessage({
          type: 'compare-frames',
          frame1: this.lastFrameData,
          frame2: frameData,
          dimensions: { 
            width: thumbnail.getSize().width, 
            height: thumbnail.getSize().height 
          }
        });
      }
      
      // Store frame
      const frame = {
        timestamp: Date.now(),
        image: thumbnail.toDataURL(),
        quality: isHighPriority ? 'high' : quality.width > 400 ? 'medium' : 'low',
        reason: reason,
        load: this.systemLoad
      };
      
      this.addFrame(frame);
      this.lastFrameData = frameData;
      
    } catch (error) {
      console.error('[RewindHandler] Capture error:', error);
    } finally {
      this.captureInProgress = false;
      this.lastCaptureMs = Date.now() - captureStart;
      this.lastCaptureTime = Date.now();
    }
  }

  /**
   * Handle change detection from worker
   */
  handleChangeDetected(changeAmount) {
    if (changeAmount > 0.08) {
      console.log(`[RewindHandler] Change detected: ${(changeAmount * 100).toFixed(1)}%`);
      // Queue high-priority capture
      this.queueEvent('change-detected');
    }
  }

  /**
   * Add frame to buffer with smart management
   */
  addFrame(frame) {
    // Don't add too many skip markers
    if (frame.skipped && this.frameBuffer.length > 0) {
      const lastFrame = this.frameBuffer[this.frameBuffer.length - 1];
      if (lastFrame.skipped) return;
    }
    
    this.frameBuffer.push(frame);
    
    // Smart buffer management - keep important frames
    if (this.frameBuffer.length > this.maxFrames) {
      this.intelligentFrameRemoval();
    }
    
    if (!frame.skipped) {
      console.log(`[RewindHandler] Frame added (${frame.quality}, ${frame.reason}), buffer: ${this.frameBuffer.length}`);
    }
  }

  /**
   * Intelligently remove frames to stay under limit
   */
  intelligentFrameRemoval() {
    // Priority: event frames > high quality > recent > periodic
    const framesToRemove = this.frameBuffer.length - this.maxFrames;
    
    // Sort by priority (lower = remove first)
    const prioritized = this.frameBuffer.map((frame, index) => ({
      frame,
      index,
      priority: this.calculateFramePriority(frame)
    })).sort((a, b) => a.priority - b.priority);
    
    // Remove lowest priority frames
    const indicesToRemove = prioritized.slice(0, framesToRemove).map(p => p.index);
    this.frameBuffer = this.frameBuffer.filter((_, i) => !indicesToRemove.includes(i));
  }

  /**
   * Calculate frame priority for removal
   */
  calculateFramePriority(frame) {
    if (frame.skipped) return 0; // Remove skip markers first
    
    let priority = 0;
    const age = Date.now() - frame.timestamp;
    
    // Event frames are highest priority
    if (frame.reason.startsWith('event-')) priority += 1000;
    
    // Quality bonus
    if (frame.quality === 'high') priority += 500;
    else if (frame.quality === 'medium') priority += 250;
    
    // Recency bonus (last 3 seconds)
    if (age < 3000) priority += 300;
    
    // Change detection bonus
    if (frame.reason === 'change-detected') priority += 400;
    
    return priority;
  }

  /**
   * Stop recording
   */
  stopRecording() {
    if (!this.isRecording) return;
    
    console.log('[RewindHandler] Stopping capture');
    this.isRecording = false;
    
    // Clear frame buffer when stopping
    this.frameBuffer = [];
    this.lastFrameData = null;
    
    // Cleanup worker
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    
    // Remove event listeners
    app.removeAllListeners('browser-window-focus');
    powerMonitor.removeAllListeners('speed-limit-change');
  }

  /**
   * Clear buffer
   */
  clearBuffer() {
    console.log('[RewindHandler] Clearing frame buffer');
    this.frameBuffer = [];
    this.lastFrameData = null;
  }

  /**
   * Get rewind data for processing
   */
  getRewindData() {
    if (this.frameBuffer.length === 0) {
      return null;
    }
    
    // Filter out skip markers
    const actualFrames = this.frameBuffer.filter(f => !f.skipped);
    
    if (actualFrames.length === 0) {
      return null;
    }
    
    const firstTime = actualFrames[0].timestamp;
    const lastTime = actualFrames[actualFrames.length - 1].timestamp;
    const duration = (lastTime - firstTime) / 1000;
    
    return {
      frames: actualFrames,
      duration: duration,
      frameCount: actualFrames.length,
      totalCount: this.frameBuffer.length,
      skipCount: this.frameBuffer.filter(f => f.skipped).length
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
    if (rewindData.skipCount > 0) {
      console.log(`[RewindHandler] ${rewindData.skipCount} frames were skipped due to high activity`);
    }
    
    // Smart frame selection
    const framesToAnalyze = this.selectBestFrames(rewindData.frames);
    
    console.log(`[RewindHandler] Selected ${framesToAnalyze.length} best frames for analysis`);
    
    // Create prompt
    const parts = [
      {
        text: `User's question: "${userQuestion}"

I'm showing you ${framesToAnalyze.length} screenshots from the last ${rewindData.duration.toFixed(1)} seconds. ${rewindData.skipCount > 0 ? 'Note: Some frames were skipped during periods of high activity.' : ''}

Please provide a CONCISE SUMMARY that directly answers the user's question. Focus on what happened, not technical details about the frames.`
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
   * Select best frames for AI analysis
   */
  selectBestFrames(frames, maxFrames = 8) {
    if (frames.length <= maxFrames) return frames;
    
    // Group frames by priority
    const eventFrames = frames.filter(f => f.reason.startsWith('event-'));
    const changeFrames = frames.filter(f => f.reason === 'change-detected');
    const highQualityFrames = frames.filter(f => f.quality === 'high' && !f.reason.startsWith('event-'));
    const otherFrames = frames.filter(f => !eventFrames.includes(f) && !changeFrames.includes(f) && !highQualityFrames.includes(f));
    
    const selected = [];
    
    // Always include first and last frames
    selected.push(frames[0]);
    
    // Add all event frames (up to 4)
    selected.push(...eventFrames.slice(0, 4));
    
    // Add change detection frames
    const remainingSlots = maxFrames - selected.length - 1; // -1 for last frame
    if (remainingSlots > 0) {
      selected.push(...changeFrames.slice(0, remainingSlots));
    }
    
    // Fill remaining with high quality frames
    const stillRemaining = maxFrames - selected.length - 1;
    if (stillRemaining > 0) {
      selected.push(...highQualityFrames.slice(0, stillRemaining));
    }
    
    // Always include last frame
    const lastFrame = frames[frames.length - 1];
    if (!selected.includes(lastFrame)) {
      selected.push(lastFrame);
    }
    
    // Sort by timestamp and deduplicate
    return [...new Set(selected)].sort((a, b) => a.timestamp - b.timestamp);
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