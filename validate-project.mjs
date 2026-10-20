import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const errors = [];
const warnings = [];
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const exists = name => fs.existsSync(path.join(root, name));

for (const file of ['index.html', 'styles.css', 'app.js', 'euphonia-daw.js', 'euphonia-storage.js', 'manifest.json', 'sw.js', 'icon-192.png', 'icon-512.png']) {
  if (!exists(file)) errors.push(`Missing required file: ${file}`);
}

for (const file of ['app.js', 'euphonia-daw.js', 'euphonia-storage.js', 'sw.js']) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
  if (result.status !== 0) errors.push(`Syntax check failed for ${file}: ${(result.stderr || result.stdout || 'unknown error').trim()}`);
}

let html = '';
try { html = read('index.html'); } catch (_) {}
const ids = [...html.matchAll(/\bid\s*=\s*(['"])([^'"]+)\1/g)].map(match => match[2]);
const idSet = new Set();
for (const id of ids) {
  if (idSet.has(id)) errors.push(`Duplicate HTML id: ${id}`);
  idSet.add(id);
}
const app = exists('app.js') ? read('app.js') : '';
for (const match of app.matchAll(/\$\(\s*['"]#([A-Za-z][\w:-]*)['"]\s*[,)]/g)) {
  if (!idSet.has(match[1])) errors.push(`app.js references missing HTML id: #${match[1]}`);
}

for (const match of html.matchAll(/<(?:script|link|img)\b[^>]*?(?:src|href)\s*=\s*(['"])([^'"]+)\1/gi)) {
  const uri = match[2];
  if (/^(?:https?:|data:|mailto:|#|\/\/)/i.test(uri)) continue;
  const local = decodeURIComponent(uri.split(/[?#]/)[0]);
  if (local && !exists(local)) errors.push(`HTML references missing local asset: ${uri}`);
}

try {
  const manifest = JSON.parse(read('manifest.json'));
  if (!manifest.name || !manifest.start_url || !manifest.scope || manifest.display !== 'standalone') errors.push('manifest.json is missing required PWA properties.');
  for (const icon of manifest.icons || []) if (!exists(icon.src)) errors.push(`Manifest icon missing: ${icon.src}`);
} catch (error) { errors.push(`manifest.json is invalid: ${error.message}`); }

const sw = exists('sw.js') ? read('sw.js') : '';
if (!/euphonia-studio-v0330/.test(sw)) errors.push('Service worker cache version does not match the v0.3.3 release.')
if (!html.includes('euphonia-storage.js')) errors.push('IndexedDB storage module is not included in index.html.');
if (!html.includes('manifest.json')) errors.push('PWA manifest is not linked in index.html.');
for (const id of ['hubStatus', 'musicResults', 'embedLinkForm', 'platformFrame', 'hubPreviewAudio', 'youtubeApiKeyInput', 'savedPlaylistNote', 'clearSavedPlaylist']) if (!idSet.has(id)) errors.push(`Music Hub control missing: #${id}`);
if (/frame\.src\s*=\s*destination/.test(app)) errors.push('Unsafe legacy behavior still attempts to frame whole platform search URLs.');
if (!app.includes('https://www.googleapis.com/youtube/v3/search')) errors.push('YouTube Data API search integration is missing.');
if (!app.includes('https://itunes.apple.com/search')) errors.push('No-key catalog search integration is missing.');

const platformLinks = [...html.matchAll(/<a\b[^>]*data-platform=[\"']([^\"']+)[\"'][^>]*href=[\"']([^\"']+)[\"'][^>]*>/gi)];
if (platformLinks.length !== 6) errors.push(`Expected 6 in-app platform cards, found ${platformLinks.length}.`);
for (const [, platform, href] of platformLinks) {
  if (href !== '#platformViewer') errors.push(`Platform ${platform} must use an in-app anchor, found ${href}.`);
}
if (html.includes('target="_blank"') && /data-platform/.test(html)) errors.push('Platform cards must not declare new-tab navigation.');
if (/window\.open\(/.test(app)) errors.push('Music Hub must not use window.open; playback/search must remain in-app.');
if (!app.includes('function selectPlatformInHub(')) errors.push('Platform click handler for saved in-app playlist is missing.');
if (!app.includes('function savePlaylistLink(')) errors.push('Local saved playlist link behavior is missing.');
if (!/addEventListener\(['"]activate['"]/.test(sw)) errors.push('Service worker activation handler is missing.');
if (!exists('QA-CHECKLIST.md')) warnings.push('Manual QA checklist is missing.');
if (!exists('DEPLOYMENT.md')) warnings.push('Deployment guide is missing.');

console.log(`EUPHONIA v0.3.3 static validation`);
console.log(`HTML ids: ${idSet.size}; core scripts checked: 4; manifest and local references checked.`);
for (const warning of warnings) console.warn(`WARN: ${warning}`);
if (errors.length) {
  for (const error of errors) console.error(`FAIL: ${error}`);
  console.error(`\nValidation failed with ${errors.length} error(s).`);
  process.exitCode = 1;
} else {
  console.log('PASS: static checks succeeded.');
  console.log('NOTE: this does not replace real-browser, audio, PWA, or device QA.');
}