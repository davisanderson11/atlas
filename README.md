# Atlas - Gemini AI Desktop Assistant

Atlas is an AI-powered desktop assistant that provides instant text analysis, data visualization, math solving, screenshot understanding, and screen activity review capabilities through simple keyboard shortcuts.

## Quick Start

### Primary Hotkey: `Ctrl + Shift + Enter` (Windows/Linux) or `Cmd + Shift + Enter` (Mac)

This is your main gateway to Atlas's AI capabilities. What happens depends on your current context:

#### With Text Selected
Select any text and press the hotkey to:
- **Summarize** long articles or documents
- **Explain** complex concepts
- **Translate** text to other languages
- **Answer questions** about the selected content
- **Analyze data** if CSV or JSON format is detected

#### Without Text Selected
Press the hotkey with nothing selected to:
- **Capture a screenshot** - Click and drag to select an area
- **Analyze images** - AI will describe what it sees
- **Extract text** from images (OCR)
- **Understand diagrams**, charts, or UI elements
- **Answer questions** about visual content

#### Follow-up Questions
After any AI response, you can:
- Type follow-up questions directly in the response window
- Continue the conversation with context from the previous interaction
- Press `Esc` to close the window

## Feature-Specific Hotkeys

### Rewind (Beta) - `Ctrl + Shift + '` (Windows/Linux) or `Cmd + Shift + '` (Mac)
- Reviews the last 10 seconds of your screen activity
- Useful for catching things you missed or need to reference
- AI analyzes the captured frames to provide context

### Temporal Bookmarks (Beta)
- **Create Bookmark**: `Ctrl + Shift + /` (Windows/Linux) or `Cmd + Shift + /` (Mac)
  - Captures current screen, clipboard contents, and AI-generated context
  - Creates a searchable snapshot of your current work state
- **Browse Bookmarks**: `Ctrl + Shift + ;` (Windows/Linux) or `Cmd + Shift + ;` (Mac)
  - View all saved bookmarks with search functionality
  - Add notes and organize your captured moments

## Specialized Modes

### Math Mode
When Atlas detects mathematical expressions, it automatically:
- Renders equations using LaTeX
- Shows step-by-step solutions
- Graphs functions when applicable
- Supports complex calculations and symbolic math

### Data Visualization
When selecting CSV, JSON, or tabular data:
- Automatically generates appropriate charts
- Provides interactive visualizations
- Offers data insights and summaries

## Tips for Best Results

1. **Be Specific with Selections**
   - Select only the relevant text for more focused responses
   - For screenshots, capture just the area you need analyzed

2. **Use Natural Language**
   - Ask questions as you would to a human
   - Provide context when needed for better responses

3. **Leverage Follow-ups**
   - Don't close the window if you need clarification
   - Build on previous responses with additional questions

4. **Privacy Considerations**
   - All processing happens locally unless AI features are used
   - Screenshots and bookmarks are stored on your device
   - Be mindful when capturing sensitive information

## Troubleshooting

### Atlas doesn't respond to hotkeys
- Ensure Atlas is running (check system tray/menu bar)
- Some applications may block global hotkeys
- Try restarting Atlas

### Screenshot capture not working
- Check screen recording permissions (especially on macOS)
- Ensure no other apps are using the same hotkeys

### AI responses are slow
- First response may take longer as models load
- Check your internet connection for AI features
- Consider closing other resource-intensive applications

---

Atlas runs quietly in the background, ready whenever you need intelligent assistance. Simply press `Ctrl + Shift + Enter` to get started!
