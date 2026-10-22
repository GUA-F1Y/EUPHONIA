## Account-based Music Hub — current behavior

Run these checks in a real browser after configuring provider credentials. Do not mark a test complete until it has actually been tried.

- [ ] Open Connection setup and save a Google OAuth Web Client ID; confirm it persists only as client configuration in this browser.
- [ ] Configure the Google Cloud OAuth consent screen, add the actual local origin as an authorized JavaScript origin, enable YouTube Data API v3, and add the testing account if the consent screen is in Testing mode.
- [ ] Connect YouTube. Confirm the OAuth consent request asks only for YouTube read access and the account-owned playlists populate in Connected playlist library.
- [ ] Refresh the YouTube list; check playlist title, artwork, item count and privacy metadata. Verify no OAuth access token appears in localStorage.
- [ ] Open View tracks on a YouTube playlist. Confirm video metadata appears from playlistItems.list and Open source uses an official YouTube Music URL.
- [ ] Disconnect YouTube. Confirm its local playlist cache clears and the current access token is revoked where the provider endpoint permits it.
- [ ] Configure a valid Apple Music developer token in the current session, connect through MusicKit, and authorize the Apple Music account.
- [ ] Verify Apple Music library playlists populate; open a playlist and check track metadata. Confirm the developer token is held in sessionStorage, not localStorage, and the private .p8 signing key is never requested.
- [ ] Reload the app. Cached playlist metadata remains visible, but provider sync requires a fresh account authorization if no live session is present.
- [ ] Search/filter the library by playlist title/description and source. Use Home mood shortcuts and global search to filter local playlist metadata instead of opening hidden legacy embed controls.
- [ ] Confirm SoundCloud clearly reports the secure-backend requirement; no client secret field exists in the browser UI or repository.
- [ ] Confirm Deezer reports that its adapter needs separate OAuth validation, Spotify stays on its official service link, and Bandcamp does not pretend to sync consumer playlists.
- [ ] Test desktop, tablet and mobile layouts, keyboard focus, API permission denial, expired/revoked token, offline state, zero-playlist accounts and large playlist collections.

**Limits:** provider account sync requires each user's own provider setup and permission. YouTube's API result is limited to playlists returned by the YouTube Data API and may not reflect all YouTube Music-generated/library collections. This static browser integration is a personal-use prototype; production OAuth should use a secure backend and be reviewed against current provider requirements. Real-browser tests are still required.

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

