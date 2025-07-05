// Text selection handler module

import { config } from '../main/config.js';

export class TextHandler {
  constructor(ai) {
    this.ai = ai;
  }

  /**
   * Build AI prompt based on selected text
   */
  buildPrompt(text) {
    // Single word - dictionary style definition
    if (/^[\w-]+$/.test(text) && text.length < 30) {
      return `Define "${text}" in dictionary format: word class • brief definition (etymology). Keep it under 15 words.`;
    }
    
    // Code snippet
    else if (text.includes('\n') && /[{};=()=>]/.test(text)) {
      return `Code summary in 1 sentence: what does this do?\n\`\`\`\n${text}\n\`\`\``;
    }
    
    // URL or link
    else if (/^https?:\/\/|^www\.|\.com|\.org|\.net/i.test(text)) {
      return `What is this website? Give 1-line description: ${text}`;
    }
    
    // Email
    else if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
      return `Whose email is this likely to be (based on domain): ${text}`;
    }
    
    // Math expression (simple calculation)
    else if (/^[\d\s+\-*/()^=]+$/.test(text)) {
      return `Calculate: ${text}`;
    }
    
    // Phone number
    else if (/^[\d\s\-()]+$/.test(text) && text.length >= 10 && text.length <= 15) {
      return `What country/region is this phone number from: ${text}`;
    }
    
    // Date/time
    else if (/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d{1,2}\/\d{1,2}|\d{4})\b/i.test(text)) {
      return `What day of the week is this date? Any significance? ${text}`;
    }
    
    // Long quote or paragraph
    else if (text.length > 200) {
      return `Summarize in 1-2 sentences maximum:\n"${text}"`;
    }
    
    // Error message
    else if (/error|exception|failed|cannot|undefined|null/i.test(text)) {
      return `What does this error mean in simple terms: ${text}`;
    }
    
    // File path
    else if (/^[\/\\]|\\\\|[a-zA-Z]:[\/\\]/.test(text)) {
      return `What type of file/directory is this: ${text}`;
    }
    
    // General short text
    else {
      return `Explain in 1 sentence: "${text}"`;
    }
  }

  /**
   * Process regular text selection
   */
  async process(text) {
    const prompt = this.buildPrompt(text);
    console.log('[TextHandler] Processing with prompt:', prompt);

    try {
      const result = await this.ai.models.generateContent({
        model: config.ai.model,
        contents: prompt
      });
      return result.text.trim();
    } catch (error) {
      console.error('[TextHandler] AI error:', error);
      throw error;
    }
  }
}