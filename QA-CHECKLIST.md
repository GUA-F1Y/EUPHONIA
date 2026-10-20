## Music Hub v0.3.3 regression checks — no tab switching
- [ ] Clicking each of the six platform cards does not change the current tab or navigate away. Clicking provider chrome/links inside the embedded player should not open a popup or navigate the EUPHONIA top-level page.
- [ ] With no saved URL, a platform card selects that provider and focuses the in-app Share URL field.
- [ ] Paste a public YouTube/YouTube Music playlist Share URL; the player loads in the EUPHONIA panel and the source link is stored locally.
- [ ] Refresh the page and click YouTube Music again; the saved playlist loads in the same panel.
- [ ] Repeat with shareable Spotify, Apple Music, SoundCloud, and Deezer URLs that support official embeds.
- [ ] Confirm unsupported/private links show an in-app message and never open a new tab.
- [ ] Clear the saved link for a provider and confirm its card prompts for a new share URL.
- [ ] Use search with Spotify/SoundCloud/Deezer/Bandcamp selected; app remains in EUPHONIA and shows link guidance instead of opening a tab.
- [ ] Confirm Apple catalog preview and optional YouTube Data API results still render in the app.
- [ ] Check on desktop and mobile; iframe player controls remain visible and usable.

**Limitation:** these checks require real provider URLs/accounts and browser testing. Private libraries cannot be read by this static frontend without each provider's approved authentication/API setup; an embed may still reject content or require login.

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


## Music Hub v0.3.2 regression checks
- [ ] Search a common song/artist in Unified music search; verify result cards and preview buttons appear where available.
- [ ] Start a preview, stop it, then start a different preview; verify only one preview is active.
- [ ] Paste a public YouTube watch URL and verify the privacy-enhanced embedded player loads without opening a new tab.
- [ ] Paste public Spotify track/album/playlist, Apple Music album, SoundCloud track, and Deezer track links; verify each uses the provider's official embed host.
- [ ] Paste an unsupported or malformed URL; verify a clear in-app error appears and no arbitrary host is framed.
- [ ] Configure a referrer-restricted YouTube Data API key; verify search results can be selected and loaded in the embed player.
- [ ] Test mobile portrait and landscape: search controls and results remain usable without horizontal page overflow.
- [ ] Click each platform card and verify it opens the corresponding playlist/library/collection route in a separate tab or routes to the native app when supported; EUPHONIA remains open.
- [ ] Test from a phone with each platform installed and signed in. Verify App Links/Universal Links route into the expected account and playlist/library section where the service supports it.
- [ ] Test with an app absent or signed out; verify the HTTPS website fallback is usable and EUPHONIA remains available.
- [ ] Enter a query, select Spotify/SoundCloud/Deezer/Bandcamp, and verify Search opens the selected provider search in a new tab. For YouTube, test both with and without the API key.