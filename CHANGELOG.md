## v0.3.3 — embedded playlist workflow (no tab switching)
- Removed Music Hub behaviors that opened provider searches/account libraries in a new tab.
- Platform cards now select a provider and play its saved share link inside EUPHONIA, or prompt the user to paste a share URL.
- Supported playlist/track URLs are converted to official YouTube, Spotify, Apple Music, SoundCloud, Deezer, or Bandcamp embed players where available.
- Successful pasted links are stored locally per provider and can be replayed by clicking that provider card; added a control to forget a saved link.
- Search for providers without an in-app catalog API now shows an in-app guidance message rather than navigating away.
- Fixed parsing of YouTube `/embed/videoseries?list=...` playlist links and bumped the service-worker cache to v0330.

# Changelog

## v0.3.2 — platform account and playlist deep links
- Platform cards now open the user's saved playlist/library/collection routes using official HTTPS service URLs.
- Links are opened in a separate tab/window so EUPHONIA remains available. On supported devices, Universal Links/App Links may route into an installed service app and use that app's own signed-in account; otherwise, the browser opens the platform website.
- Service-specific search now routes to that platform when selected, while Apple catalog previews and optional YouTube API search remain available inside EUPHONIA.
- Bandcamp routes to the user's collection because there is no single universal personal-playlist URL for every account.
- Updated the service-worker cache to v0320 so the new Music Hub behavior replaces stale cached JavaScript.


## v0.3.1 — in-app Music Hub and official embeds
- Removed the previous behavior that embedded full platform search pages, which several services refuse to frame.
- Added no-key Apple catalog search and provider-supplied track previews inside EUPHONIA.
- Added optional YouTube Data API v3 search and YouTube's official privacy-enhanced embed player.
- Added safe URL parsing for YouTube, Spotify, Apple Music, SoundCloud Widget, Deezer Widget, and official Bandcamp EmbeddedPlayer links.
- Added local YouTube API-key setup, validation of supported embed hosts, clearer status/error messages, and mobile-friendly search results.
- Kept all provider navigation inside EUPHONIA; no platform card opens a new tab automatically.
- Bumped service-worker cache to v0310 to prevent stale Music Hub files from remaining cached.

## v0.3.0 — local-first/mobile foundation

- Added IndexedDB storage for source audio and workspace snapshots, autosave and local session recovery.
- Added best-effort persistent storage request and explicit save-error status; avoids endless autosave retries after quota errors.
- Cleans up orphaned IndexedDB assets after a successful workspace save.
- Added mobile responsive/touch layout adjustments, safe-area handling, install guidance and LAN preview launcher.
- Added split-at-playhead clip editing; wired Select/Draw, undo/redo, duplicate/delete and trim handles from the preceding iteration.
- Arrangement edits refresh active playback; playback start can be cancelled while source audio is decoding.
- Piano Roll now highlights the selected major/minor scale while leaving all chromatic notes editable.
- Microphone recording uses the filename extension matching the browser-produced audio MIME type (including Safari MP4/M4A variants).
- Expanded arrangement grid options, constrained large project import/export paths and improved project load rollback behavior.
- Bumped the service worker cache so installed clients fetch the new app shell.
- Added deployment guide, release checklist and static validator.

## v0.2.0

- Music Hub with embedded service viewer and local audio library.
- Basic multitrack arrangement, browser recording, Piano Roll, Drum Sequencer, mixer/master effects and WAV/MIDI export.