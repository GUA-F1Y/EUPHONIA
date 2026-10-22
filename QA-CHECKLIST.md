## Music discovery homepage & Music Hub — current behavior

Run these checks on the current Netflix-inspired music-discovery UI. Mark each item only after trying it in a real browser.

- [ ] Load Home with the network available. Featured artwork and the Fresh Finds, Alternative R&B, Melodic Rap, and Indie shelves populate when the public iTunes Search API returns previewable tracks.
- [ ] Temporarily block the catalog endpoint or use offline mode. Home remains usable, and empty/error shelves do not crash the rest of the app.
- [ ] Play a track from a catalog shelf. The persistent player shows its title, artist, and artwork and controls the same preview audio.
- [ ] Test play/pause, progress/seek, volume, previous/next, track-ended queue advance, and navigation between Home, Music Hub, Library, and Studio while audio is playing.
- [ ] Add a previewable track to My List, remove it, refresh the page, and verify saved entries remain in the same browser profile.
- [ ] Click every mood/genre shortcut. It opens Music Hub, fills the search field, and returns usable results or a clear provider error.
- [ ] With an empty Library, click Import audio from the Home shelf. Import local MP3/WAV, verify the file appears in Continue listening and Library, and play it using the same persistent player.
- [ ] Verify switching between a local file and catalog preview updates artwork/title/favorite state without leaving two audio previews playing at once.
- [ ] Verify Send to DAW works for local files. A catalog preview must not be imported into the DAW as if it were a local source file.
- [ ] Confirm five provider cards stay inside the Music Hub UI: YouTube Music, Apple Music, SoundCloud, Deezer, and Bandcamp. They should focus the appropriate catalog/API/share-link workflow.
- [ ] Paste valid public share/embed links for providers that support the official embedded player. Check saved links survive refresh, reload works, close clears the frame, and invalid/unsupported hosts are rejected.
- [ ] Test YouTube search with no API key and with a referrer-restricted YouTube Data API key. Without a key, the interface should request a supported share link; with a valid key, search results should load into the official embed player.
- [ ] Click Spotify. The official Spotify website opens in a separate tab and EUPHONIA stays open. Spotify is intentionally not embedded or mixed into the other in-app catalogs.
- [ ] Check desktop, tablet and mobile portrait/landscape. Confirm rails scroll horizontally, no page-wide horizontal overflow appears, and the persistent player and buttons remain usable.

**Limits:** iTunes/Apple results are provider-supplied previews, not unrestricted full-track streams. Third-party embeds can require sign-in or refuse content by account, region, or provider policy. Real-browser playback checks are required before claiming release readiness.

# EUPHONIA v0.3.0 — release checklist

This is a manual checklist. Check each item on the actual supported browser/device; static code validation cannot prove audio behavior.

## Static checks

- [ ] `node validate-project.mjs` passes with no missing asset/ID/syntax issue.
- [ ] Open browser DevTools; no uncaught JavaScript errors on startup.
- [ ] Service worker installs, activates the current cache version, and updates after a versioned deployment.
- [ ] PWA manifest loads and all icons return HTTP 200.

## Library and recovery

- [ ] Import MP3 and WAV (plus any additional formats you plan to support).
- [ ] Play, pause, seek, change volume, use next/previous, favorite and navigate between pages.
- [ ] Reload the page; audio library and arrangement are restored from IndexedDB.
- [ ] Force an invalid/corrupt project open; verify the active session remains intact and an error is shown.
- [ ] Save a small project, reload the app, and open the exported `.euphonia.json` on the same and another device.
- [ ] Simulate storage denial/quota (where possible); verify the app shows a warning without locking into an endless retry loop.

## DAW arrangement

- [ ] Import an audio file into the arrangement; playback starts at the expected position.
- [ ] Move a clip, move it to another track, trim both edges, duplicate, split at playhead, delete, undo and redo.
- [ ] Verify clip offset/trim stays correct during playback and in exported WAV.
- [ ] Exercise snap on/off and quarter/eighth/sixteenth/triplet grid settings.
- [ ] Verify mute, solo, track gain, pan, BPM changes, zoom and playhead controls.
- [ ] Record a microphone take on an HTTPS/localhost origin; stop it, play it, save, reload and export.
- [ ] Render MIDI and drum patterns; confirm timing, preview, arrangement placement and mix export.
- [ ] Export a short stereo WAV and listen to it in a separate player. Check for clipping, silence, incorrect offsets, and missing effects.
- [ ] Test a longer arrangement on each target device; cancel/abort/low memory behavior must remain recoverable.

## Mobile layout and install

- [ ] Test a narrow phone portrait layout (320–390 CSS px), a larger phone, and a tablet.
- [ ] Test landscape orientation while the bottom player is visible.
- [ ] Verify navigation drawer opens/closes, no page-wide horizontal overflow, and all important buttons have comfortable touch targets.
- [ ] Test horizontal timeline scrolling and clip dragging/resizing on touch. Verify scrolling remains possible elsewhere.
- [ ] Test Piano Roll and Drum Sequencer with finger input and horizontally scrolling grids.
- [ ] Install from an HTTPS URL on Android Chrome; launch from icon and verify the app shell/update.
- [ ] Install from Safari Add to Home Screen on iOS; test playback, file import, backgrounding/return, recording permission and export behavior.
- [ ] Validate storage persistence and backup export on the actual phone/browser.

## Music Hub / accessibility

- [ ] Test each third-party service. If iframe embedding is blocked, the UI should explain that the provider restricts it.
- [ ] Keyboard navigation and visible focus work; dialogs can be cancelled and important state is not mouse-only.
- [ ] Reduced-motion mode remains usable.

## Go / no-go

Do not call the release fully production-certified until the checks that apply to the advertised target browsers/devices have passed. For important work, maintain portable project backups even after autosave has been tested.

