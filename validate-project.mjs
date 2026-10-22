import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const errors = [];
const warnings = [];
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const exists = name => fs.existsSync(path.join(root, name));

for (const file of ['index.html', 'styles.css', 'app.js', 'euphonia-config.js', 'music-accounts.js', 'musicfy-features.js', 'euphonia-daw.js', 'euphonia-storage.js', 'manifest.json', 'sw.js', 'icon-192.png', 'icon-512.png']) {
  if (!exists(file)) errors.push(`Missing required file: ${file}`);
}

for (const file of ['app.js', 'euphonia-config.js', 'music-accounts.js', 'musicfy-features.js', 'euphonia-daw.js', 'euphonia-storage.js', 'sw.js']) {
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
// Some controls are intentionally injected into a shelf only when it is empty.
const dynamicIds = new Set(['emptyImport']);
for (const match of app.matchAll(/\$\(\s*['"]#([A-Za-z][\w:-]*)['"]\s*[,)]/g)) {
  if (!idSet.has(match[1]) && !dynamicIds.has(match[1])) errors.push(`app.js references missing HTML id: #${match[1]}`);
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
if (!/euphonia-studio-v0346/.test(sw)) errors.push('Service worker cache version does not match the current music-discovery shell.')
if (!html.includes('euphonia-storage.js')) errors.push('IndexedDB storage module is not included in index.html.');
if (!html.includes('music-accounts.js')) errors.push('Account playlist integration module is not included in index.html.');
if (!html.includes('euphonia-config.js')) errors.push('Public app configuration is not included in index.html.');
if (!sw.includes("'./euphonia-config.js'")) errors.push('Service worker does not cache the public app configuration.');
const appConfig = exists('euphonia-config.js') ? read('euphonia-config.js') : '';
if (!appConfig.includes('googleOAuthClientId')) errors.push('Google OAuth Web Client ID config entry is missing.');
if (appConfig.includes('YOUR_GOOGLE_OAUTH_WEB_CLIENT_ID')) warnings.push('Google login stays disabled until the app maintainer adds its Web Client ID to euphonia-config.js. End users will not need to enter this value.');
if (!sw.includes("'./music-accounts.js'")) errors.push('Service worker does not cache the account playlist integration module.');
if (!sw.includes("'./musicfy-features.js'")) errors.push('Service worker does not cache the Musicfy-style player enhancement module.');
if (!html.includes('musicfy-features.js')) errors.push('Musicfy-style player enhancement module is not included in index.html.');
const musicfy = exists('musicfy-features.js') ? read('musicfy-features.js') : '';
for (const marker of ['euphonia:account-track-change', 'euphonia:account-playback-started', 'LRCLIB', 'listeningHistory.v1', 'favorites.v1', 'accountQueueItems']) if (!musicfy.includes(marker)) errors.push('Musicfy-style player feature marker is missing: ' + marker);
for (const id of ['accountPlayerFavorite', 'accountPlayerShuffle', 'accountPlayerRepeat', 'accountPlayerQueueToggle', 'accountPlayerLyricsToggle', 'accountPlayerSeek', 'accountPlayerVolume', 'accountPlayerCurrentTime', 'accountPlayerDuration', 'accountQueuePanel', 'accountQueueItems', 'accountLyricsPanel', 'accountLyricsLines', 'accountSavedSection', 'accountSavedTracks', 'accountSavedPlayAll']) if (!idSet.has(id)) errors.push('Musicfy-style player UI missing from HTML: #' + id);
const accounts = exists('music-accounts.js') ? read('music-accounts.js') : '';
if (!accounts.includes('https://www.googleapis.com/youtube/v3/playlists')) errors.push('YouTube account playlist endpoint is missing.');
if (!accounts.includes('https://www.googleapis.com/youtube/v3/playlistItems')) errors.push('YouTube playlist item endpoint is missing.');
if (!accounts.includes('/v1/me/library/playlists')) errors.push('Apple Music library playlist endpoint is missing.');
if (!accounts.includes('async function importPlaylist(') || !accounts.includes('async function importSelectedPlaylists(')) errors.push('Playlist import workflow is missing.');
if (!accounts.includes('lastRemoteTrackKeys')) errors.push('Playlist resync no longer tracks prior remote keys to preserve local removals.');
if (!accounts.includes('ensureYouTubeIframeAPI') || !accounts.includes('appleMusic.setQueue')) errors.push('Official account playback adapters are missing.');
if (!accounts.includes('ACCOUNT_QUEUE_KEY') || !accounts.includes('ACCOUNT_MODES_KEY')) errors.push('Account queue and playback mode persistence is missing.');
if (!accounts.includes('appleMusic.player.seekToTime(value)')) errors.push('Apple Music seek adapter does not use the player seek method.');
for (const id of ['accountImportSelected', 'accountSelectVisible', 'accountNowPlaying', 'accountYouTubePlayer', 'accountPlayerPrevious', 'accountPlayerNext', 'accountPlayerToggle']) if (!idSet.has(id)) errors.push(`Account playback/import control missing from HTML: #${id}`);
if (accounts.includes('localStorage.setItem(APPLE_TOKEN_KEY')) errors.push('Apple developer token should not be saved to localStorage.');
if (!html.includes('manifest.json')) errors.push('PWA manifest is not linked in index.html.');
for (const id of ['hubStatus', 'musicResults', 'embedLinkForm', 'platformFrame', 'hubPreviewAudio', 'youtubeApiKeyInput', 'savedPlaylistNote', 'clearSavedPlaylist', 'accountHubStatus', 'accountSetup', 'accountAppleDeveloperToken', 'accountPlaylistGrid', 'accountPlaylistSearch', 'accountPlaylistFilter', 'accountImportSelected', 'accountSelectVisible', 'accountNowPlaying', 'accountYouTubePlayer', 'accountApplePlayerStatus', 'accountPlayerPrevious', 'accountPlayerNext', 'accountPlayerToggle', 'accountPlayerClose']) if (!idSet.has(id)) errors.push(`Music Hub control missing: #${id}`);
if (/frame\.src\s*=\s*destination/.test(app)) errors.push('Unsafe legacy behavior still attempts to frame whole platform search URLs.');
if (!app.includes('https://www.googleapis.com/youtube/v3/search')) errors.push('YouTube Data API search integration is missing.');
if (!app.includes('https://itunes.apple.com/search')) errors.push('No-key catalog search integration is missing.');

const platformLinks = [...html.matchAll(/<a\b[^>]*data-platform=[\"']([^\"']+)[\"'][^>]*href=[\"']([^\"']+)[\"'][^>]*>/gi)];
if (platformLinks.length !== 5) errors.push(`Expected 5 in-app embed provider cards, found ${platformLinks.length}.`);
for (const [, platform, href] of platformLinks) {
  if (href !== '#platformViewer') errors.push(`Platform ${platform} must use an in-app anchor, found ${href}.`);
}
const embedCardTags = [...html.matchAll(/<a\b[^>]*data-platform=[\"'][^\"']+[\"'][^>]*>/gi)].map(match => match[0]);
if (embedCardTags.some(tag => /target=[\"']_blank[\"']/i.test(tag))) errors.push('In-app embed provider cards must not declare new-tab navigation.');
const spotifyExternalCard = html.match(/<a\b[^>]*class=[\"'][^\"']*platform-card spotify[^\"']*[\"'][^>]*>/i)?.[0] || '';
if (!/href=[\"']https:\/\/open\.spotify\.com\//i.test(spotifyExternalCard) || !/target=[\"']_blank[\"']/i.test(spotifyExternalCard) || !/rel=[\"']noopener noreferrer[\"']/i.test(spotifyExternalCard)) errors.push('Spotify must remain an explicit, safe link to its official service.');
if (/window\.open\(/.test(app)) errors.push('Music Hub must not use window.open; playback/search must remain in-app.');
if (!app.includes('function selectPlatformInHub(')) errors.push('Platform click handler for saved in-app playlist is missing.');
if (!app.includes('function savePlaylistLink(')) errors.push('Local saved playlist link behavior is missing.');
if (!/addEventListener\(['"]activate['"]/.test(sw)) errors.push('Service worker activation handler is missing.');
if (!exists('QA-CHECKLIST.md')) warnings.push('Manual QA checklist is missing.');
if (!exists('DEPLOYMENT.md')) warnings.push('Deployment guide is missing.');

console.log(`EUPHONIA account playlists + one-click Google setup static validation`);
console.log(`HTML ids: ${idSet.size}; core scripts checked: 7; manifest and local references checked.`);
for (const warning of warnings) console.warn(`WARN: ${warning}`);
if (errors.length) {
  for (const error of errors) console.error(`FAIL: ${error}`);
  console.error(`\nValidation failed with ${errors.length} error(s).`);
  process.exitCode = 1;
} else {
  console.log('PASS: static checks succeeded.');
  console.log('NOTE: this does not replace real-browser, audio, PWA, or device QA.');
}