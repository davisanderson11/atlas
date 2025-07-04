// Worker thread for image comparison
const { parentPort } = require('worker_threads');

// Handle messages from main thread
parentPort.on('message', (message) => {
  if (message.type === 'compare-frames') {
    const changeAmount = compareFrames(
      message.frame1, 
      message.frame2, 
      message.dimensions
    );
    
    parentPort.postMessage({
      type: 'change-detected',
      changeAmount: changeAmount
    });
  }
});

/**
 * Compare two frames for changes
 */
function compareFrames(frame1, frame2, dimensions) {
  if (!frame1 || !frame2 || frame1.length !== frame2.length) {
    return 1; // Major change
  }
  
  const { width, height } = dimensions;
  let diffPixels = 0;
  const totalPixels = width * height;
  
  // Sample every 20th pixel for performance
  const sampleRate = 20;
  
  for (let y = 0; y < height; y += 5) { // Sample every 5th row
    for (let x = 0; x < width; x += 4) { // Sample every 4th column
      const i = (y * width + x) * 4; // RGBA
      
      if (i + 3 < frame1.length) {
        // Calculate color difference
        const dr = Math.abs(frame1[i] - frame2[i]);
        const dg = Math.abs(frame1[i + 1] - frame2[i + 1]);
        const db = Math.abs(frame1[i + 2] - frame2[i + 2]);
        
        // Threshold for significant change
        if (dr + dg + db > 60) {
          diffPixels += sampleRate; // Account for sampling
        }
      }
    }
  }
  
  return Math.min(1, diffPixels / totalPixels);
}