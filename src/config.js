// Configuration file for Atlas

export const config = {
  // AI Model Configuration
  ai: {
    model: process.env.AI_MODEL || 'gemini-1.5-flash',
    // You can add more AI-related config here in the future
    // temperature: 0.7,
    // maxTokens: 1000,
  },
  
  // Window Configuration
  window: {
    overlay: {
      width: 860,
      height: 600,
      yOffset: 10
    },
    welcome: {
      width: 900,
      height: 700
    }
  },
  
  // Keyboard Shortcuts
  shortcuts: {
    main: 'CommandOrControl+Shift+Enter'
  }
};