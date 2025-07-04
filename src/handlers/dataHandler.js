// Data visualization handler module for CSV, JSON, TSV, SQL tables

import { config } from '../config.js';

export class DataHandler {
  constructor(ai) {
    this.ai = ai;
  }

  /**
   * Detect if text is structured data
   */
  detectStructuredData(text) {
    const lines = text.trim().split('\n').filter(line => line.trim());
    
    // JSON detection first (most specific)
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed === 'object') {
        return { type: 'json', data: parsed };
      }
    } catch (e) {}
    
    // SQL result detection (simple table format)
    if (text.includes('|') && lines.length > 2) {
      const hasTableStructure = lines.some(line => /[|\-]{2,}/.test(line));
      if (hasTableStructure) {
        return { type: 'sql', data: this.parseSQLTable(text) };
      }
    }
    
    // CSV detection - more flexible
    if (lines.length > 1) {
      const firstLineCommas = (lines[0].match(/,/g) || []).length;
      if (firstLineCommas > 0) {
        // Allow some flexibility - at least 75% of lines should have similar comma count
        const validLines = lines.filter(line => {
          const commaCount = (line.match(/,/g) || []).length;
          return Math.abs(commaCount - firstLineCommas) <= 1;
        });
        
        if (validLines.length >= lines.length * 0.75) {
          return { type: 'csv', data: this.parseCSV(text) };
        }
      }
    }
    
    // Tab-separated values
    if (lines.length > 1 && text.includes('\t')) {
      const firstLineTabs = (lines[0].match(/\t/g) || []).length;
      if (firstLineTabs > 0) {
        return { type: 'tsv', data: this.parseTSV(text) };
      }
    }
    
    return null;
  }

  /**
   * Parse CSV text into data structure
   */
  parseCSV(text) {
    const lines = text.trim().split('\n').filter(line => line.trim());
    if (lines.length === 0) return null;
    
    const headers = lines[0].split(',').map(h => h.trim().replace(/^["']|["']$/g, ''));
    const rows = lines.slice(1).map(line => {
      const values = line.split(',').map(v => v.trim().replace(/^["']|["']$/g, ''));
      return headers.reduce((obj, header, i) => {
        obj[header] = values[i] || '';
        return obj;
      }, {});
    });
    
    console.log('[DataHandler] CSV Parsed:', { headers, rows });
    return { headers, rows };
  }

  /**
   * Parse TSV text into data structure
   */
  parseTSV(text) {
    const lines = text.trim().split('\n');
    const headers = lines[0].split('\t').map(h => h.trim());
    const rows = lines.slice(1).map(line => {
      const values = line.split('\t').map(v => v.trim());
      return headers.reduce((obj, header, i) => {
        obj[header] = values[i] || '';
        return obj;
      }, {});
    });
    return { headers, rows };
  }

  /**
   * Parse SQL-style table into data structure
   */
  parseSQLTable(text) {
    const lines = text.trim().split('\n');
    const dataLines = lines.filter(line => !line.match(/^\s*\|?\s*-+\s*\|/));
    
    if (dataLines.length < 2) return null;
    
    const parseRow = (line) => line.split('|').map(cell => cell.trim()).filter(cell => cell);
    const headers = parseRow(dataLines[0]);
    const rows = dataLines.slice(1).map(line => {
      const values = parseRow(line);
      return headers.reduce((obj, header, i) => {
        obj[header] = values[i] || '';
        return obj;
      }, {});
    });
    
    return { headers, rows };
  }

  /**
   * Process structured data
   */
  async process(text) {
    const structuredData = this.detectStructuredData(text);
    
    if (!structuredData) {
      return null;
    }
    
    console.log('[DataHandler] Processing structured data:', structuredData.type);
    
    return {
      type: 'visualization',
      dataType: structuredData.type,
      data: structuredData.data,
      originalText: text
    };
  }
}