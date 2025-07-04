// Settings persistence module
import { app } from 'electron';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export class Settings {
  constructor() {
    // Use a consistent path that works before app is ready
    this.settingsPath = join(homedir(), '.atlas', 'settings.json');
    this.data = this.load();
  }
  
  get SETTINGS_FILE() {
    return this.settingsPath;
  }

  load() {
    try {
      if (existsSync(this.SETTINGS_FILE)) {
        const content = readFileSync(this.SETTINGS_FILE, 'utf8');
        return JSON.parse(content);
      }
    } catch (error) {
      console.error('[Settings] Error loading settings:', error);
    }
    
    // Return default settings
    return {
      features: {
        rewind: {
          enabled: false
        }
      }
    };
  }

  save() {
    try {
      // Ensure directory exists
      const dir = join(homedir(), '.atlas');
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      
      writeFileSync(this.SETTINGS_FILE, JSON.stringify(this.data, null, 2));
      console.log('[Settings] Saved to', this.SETTINGS_FILE);
    } catch (error) {
      console.error('[Settings] Error saving settings:', error);
    }
  }

  get(path) {
    const keys = path.split('.');
    let value = this.data;
    
    for (const key of keys) {
      if (value && typeof value === 'object' && key in value) {
        value = value[key];
      } else {
        return undefined;
      }
    }
    
    return value;
  }

  set(path, value) {
    const keys = path.split('.');
    let current = this.data;
    
    // Navigate to the parent object
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (!(key in current) || typeof current[key] !== 'object') {
        current[key] = {};
      }
      current = current[key];
    }
    
    // Set the value
    current[keys[keys.length - 1]] = value;
    
    // Save immediately
    this.save();
  }
}

export const settings = new Settings();