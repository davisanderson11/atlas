# Atlas Source Code Structure

## Directory Organization

```
src/
├── main/                          # Main process files
│   ├── main.js                    # Application entry point
│   ├── config.js                  # Application configuration
│   └── settings.js                # User settings management
│
├── handlers/                      # Business logic handlers
│   ├── actionSuggestionsHandler.js # Contextual action suggestions
│   ├── bookmarkHandler.js         # Temporal bookmarks management
│   ├── dataHandler.js             # Data visualization
│   ├── mathHandler.js             # Math equation processing
│   ├── rewindHandler.js           # Screen activity recording
│   ├── rewindWorker.js            # Worker thread for rewind
│   ├── screenshotHandler.js       # Screenshot capture and analysis
│   └── textHandler.js             # Text processing and analysis
│
├── renderer/                      # Renderer process files
│   └── windows/                   # Window-specific components
│       ├── action-chip/           # Action suggestion popup
│       │   ├── action-chip.html
│       │   └── action-chip-preload.js
│       ├── bookmarks/             # Bookmark viewer window
│       │   ├── bookmarks.html
│       │   └── bookmarks-preload.js
│       ├── capture/               # Screenshot capture overlay
│       │   ├── capture.html
│       │   └── capture-preload.js
│       ├── language-selector/     # Language selection dropdown
│       │   ├── language-selector.html
│       │   └── language-selector-preload.js
│       ├── overlay/               # Main result overlay window
│       │   ├── index.html
│       │   └── preload.js
│       ├── status/                # Status notification popup
│       │   ├── status.html
│       │   └── status-preload.js
│       └── welcome/               # Welcome/settings window
│           ├── welcome.html
│           └── welcome-preload.js
│
└── shared/                        # Shared utilities (future use)
```

## Quick Navigation Guide

### Main Process
- **Entry Point**: `main/main.js`
- **Configuration**: `main/config.js`
- **User Settings**: `main/settings.js`

### Features
- **Text Analysis**: `handlers/textHandler.js`
- **Screenshots**: `handlers/screenshotHandler.js`
- **Math Solving**: `handlers/mathHandler.js`
- **Data Visualization**: `handlers/dataHandler.js`
- **Rewind**: `handlers/rewindHandler.js`
- **Bookmarks**: `handlers/bookmarkHandler.js`
- **Action Chips**: `handlers/actionSuggestionsHandler.js`

### UI Components
Each window component has its own folder containing:
- `.html` file - The window's UI
- `-preload.js` file - Secure bridge between main and renderer

### Adding New Features

1. **New Handler**: Add to `handlers/` directory
2. **New Window**: Create folder in `renderer/windows/` with HTML and preload script
3. **Shared Code**: Place in `shared/` directory

This structure follows Electron best practices with clear separation between main and renderer processes.