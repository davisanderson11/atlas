#!/usr/bin/env node

/**
 * Build optimization script for Atlas
 * Removes unnecessary files and optimizes the build size
 */

import { execSync } from 'child_process';
import { existsSync, rmSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

console.log('🚀 Starting Atlas build optimization...\n');

// Step 1: Clean previous builds
console.log('📦 Cleaning previous builds...');
if (existsSync('dist')) {
  rmSync('dist', { recursive: true, force: true });
  console.log('✅ Removed dist folder');
}

// Step 2: Remove unnecessary native module prebuilds
console.log('\n🔧 Optimizing native modules...');
const nativeModules = [
  'node_modules/@todesktop/robotjs-prebuild/prebuilds',
  'node_modules/@nut-tree-fork/libnut/prebuilds'
];

nativeModules.forEach(modulePath => {
  if (existsSync(modulePath)) {
    const prebuildsDir = readdirSync(modulePath);
    prebuildsDir.forEach(platform => {
      // Keep only win32-x64 prebuilds
      if (platform !== 'win32-x64') {
        const platformPath = join(modulePath, platform);
        if (statSync(platformPath).isDirectory()) {
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
  execSync('npm run build:win', { stdio: 'inherit' });
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
    if (stats.isFile() && file.endsWith('.exe')) {
      const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
      console.log(`   ${file}: ${sizeMB} MB`);
    }
  });
}

console.log('\n✨ Optimization complete!');