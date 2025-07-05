#!/usr/bin/env node

/**
 * Build optimization script for Atlas
 * Removes unnecessary files and optimizes the build size
 * Works cross-platform (Windows, Mac, Linux)
 */

import { execSync } from 'child_process';
import { existsSync, rmSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { platform } from 'os';

console.log('🚀 Starting Atlas build optimization...\n');

// Determine the platform
const currentPlatform = platform();
const isWindows = currentPlatform === 'win32';
const isMac = currentPlatform === 'darwin';
const isLinux = currentPlatform === 'linux';

console.log(`📍 Building for platform: ${currentPlatform}\n`);

// Step 1: Clean previous builds
console.log('📦 Cleaning previous builds...');
if (existsSync('dist')) {
  rmSync('dist', { recursive: true, force: true });
  console.log('✅ Removed dist folder');
}

// Step 2: Remove unnecessary native module prebuilds (keep only current platform)
console.log('\n🔧 Optimizing native modules...');
const nativeModules = [
  'node_modules/@todesktop/robotjs-prebuild/prebuilds',
  'node_modules/@nut-tree-fork/libnut/prebuilds'
];

// Determine which prebuilds to keep based on platform
let keepPlatform = '';
if (isWindows) keepPlatform = 'win32-x64';
else if (isMac) keepPlatform = 'darwin-x64'; // Also might need darwin-arm64 for M1/M2
else if (isLinux) keepPlatform = 'linux-x64';

nativeModules.forEach(modulePath => {
  if (existsSync(modulePath)) {
    const prebuildsDir = readdirSync(modulePath);
    prebuildsDir.forEach(platform => {
      // Keep only the current platform's prebuilds
      if (platform !== keepPlatform && !(isMac && platform === 'darwin-arm64')) {
        const platformPath = join(modulePath, platform);
        if (existsSync(platformPath) && statSync(platformPath).isDirectory()) {
          rmSync(platformPath, { recursive: true, force: true });
          console.log(`✅ Removed ${platform} prebuilds`);
        }
      }
    });
  }
});

// Step 3: Prune dev dependencies
console.log('\n📦 Pruning development dependencies...');
try {
  execSync('npm prune --production', { stdio: 'inherit' });
  console.log('✅ Removed development dependencies');
} catch (error) {
  console.warn('⚠️  Could not prune dependencies:', error.message);
}

// Step 4: Run the actual build
console.log('\n🏗️  Building Atlas...');
try {
  let buildCommand = 'npm run build';
  if (process.argv.includes('--win')) buildCommand = 'npm run build:win';
  else if (process.argv.includes('--mac')) buildCommand = 'npm run build:mac';
  else if (process.argv.includes('--linux')) buildCommand = 'npm run build:linux';
  
  execSync(buildCommand, { stdio: 'inherit' });
  console.log('\n✅ Build completed successfully!');
} catch (error) {
  console.error('\n❌ Build failed:', error.message);
  process.exit(1);
}

// Step 5: Report final size
console.log('\n📊 Build size report:');
if (existsSync('dist')) {
  const files = readdirSync('dist');
  files.forEach(file => {
    const filePath = join('dist', file);
    const stats = statSync(filePath);
    if (stats.isFile()) {
      // Check for different installer types
      const isInstaller = file.endsWith('.exe') || 
                         file.endsWith('.dmg') || 
                         file.endsWith('.AppImage') || 
                         file.endsWith('.deb');
      if (isInstaller) {
        const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
        console.log(`   ${file}: ${sizeMB} MB`);
      }
    }
  });
}

console.log('\n✨ Optimization complete!');