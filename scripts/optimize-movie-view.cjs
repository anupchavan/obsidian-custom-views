// Patch only palette handling in local settings; preserve the rest of the view.
// Run with the plugin unloaded, then reload it so it reads the updated settings.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const file = path.join(root, 'data.json');
const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
const movie = settings.views.find(v => v.name === 'Movies');
if (!movie || !movie.js.includes('function loadPaletteFromImage()')) throw new Error('Movie palette template not found');
const loader = fs.readFileSync(path.join(root, 'templates/movie-palette-loader.js.txt'), 'utf8');
movie.js = movie.js.replace(/function loadPaletteFromImage\(\) \{[\s\S]*?(?=function tmdbReady\()/, loader.slice(loader.indexOf('function loadPaletteFromImage')) + '\n');
// 64px retains representative colors while processing 1/16 as many pixels.
movie.js = movie.js.replace('256 / Math.max(sourceW, sourceH)', '64 / Math.max(sourceW, sourceH)');
movie.css = movie.css.replaceAll('var(--color-bg, #7baaba)', 'var(--color-bg, var(--background-primary))');
fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
console.log('Updated movie palette sampling, persistent cache, and neutral fallback.');
