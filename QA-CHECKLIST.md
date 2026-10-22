## Account Music Hub, import, and playback — current behavior

Run these checks with real provider credentials in a browser. Do not mark a test complete until it has actually been tried.

- [ ] Confirm normal users do not see a Google Client ID field or API key field. The provider card says Continue with Google.
- [ ] Confirm Music Hub shows Search artists & songs before the account playlist grid, without needing account sign-in just to open the search panel.
- [ ] Search an artist/song in Music Hub without signing in; verify results are Apple/iTunes catalog tracks and the UI is labelled AUDIO ONLY.
- [ ] Play an available track preview and confirm it uses EUPHONIA's bottom audio player; verify tracks without preview URLs show a disabled preview control.
- [ ] Open a YouTube playlist track and select Find audio preview; confirm EUPHONIA searches the Apple catalog and does not start or show a YouTube video player.
- [ ] Test zero results, rapid consecutive searches, offline/timeouts, missing preview URLs, and browser autoplay blocking; verify clear recovery guidance.
- [ ] With MusicKit authorized, verify the optional Full track action uses the official Apple Music player; test no subscription, invalid track URL and unavailable catalog item.
- [ ] As the app maintainer only, set the Web Client ID in euphonia-config.js, configure the consent screen, add local/production origins to Authorized JavaScript origins, and allow testing accounts when using Testing mode.
- [ ] With a configured Client ID, click Continue with Google. Verify the Google account chooser/consent appears and the requested scope is YouTube read-only.
- [ ] Connect YouTube. Confirm OAuth asks only for YouTube read access and the account-owned playlists populate in Connected playlist library.
- [ ] Open View tracks on a YouTube playlist and verify title, channel, artwork and Open source URL.
- [ ] Select Find audio preview on a YouTube track. Confirm no YouTube iframe is created and the track query is passed to the audio-only catalog search.
- [ ] Confirm YouTube playlist sync/import still reads metadata after Google OAuth; playback remains audio-only and must not start the video iframe.
- [ ] Select several YouTube playlists using the checkboxes / Select visible, then Import selected. Confirm all successful imports appear under Imported to EUPHONIA.
- [ ] Remove one track from an imported playlist locally, add a new track to the source playlist, re-sync, and verify only the newly discovered source track is appended while the locally removed track stays removed.
- [ ] Disconnect YouTube. Confirm the remote cache clears while already imported EUPHONIA playlists remain local; re-sync should ask you to reconnect.
- [ ] Trigger two sync clicks rapidly for a connected provider; confirm duplicate playlist requests are coalesced and only one successful refresh is reported.
- [ ] Simulate a YouTube API 401, quota-exceeded 403, 429, 5xx, and slow network; confirm sessions/errors are actionable and retries are bounded.
- [ ] Configure a valid Apple Music developer token in the current session, connect through MusicKit, and authorize the account.
- [ ] Verify Apple Music library playlists populate and View tracks gets metadata. Confirm the developer token is held in sessionStorage, not localStorage, and the private .p8 signing key is never requested.
- [ ] Press Play audio on an Apple Music track. Confirm MusicKit uses official audio playback and reports useful errors when authorization, subscription, URL, or content access is unavailable.
- [ ] Test previous/next and play/pause for Apple Music; verify track changes stay within the same provider queue.
- [ ] Reload EUPHONIA. Playlist metadata remains cached; connecting/syncing again requires an active/renewed provider session as appropriate.
- [ ] Search/filter by title and description and by provider or Imported to EUPHONIA. Home mood shortcuts should filter the local playlist metadata instead of exposing hidden legacy embed controls.
- [ ] Confirm SoundCloud clearly reports the secure-backend requirement; no client secret field exists in frontend code or Git history.
- [ ] Confirm Deezer reports pending OAuth integration, Spotify remains a separate official-service link, and Bandcamp does not claim to sync listener playlists.
- [ ] Test desktop/tablet/mobile layout, keyboard focus, low storage quota, empty playlists, large collections, repeated imports, API 403/429/5xx failures, and private/deleted provider tracks.

- [ ] Favorite an Apple track (and keep a YouTube playlist track as metadata), reload the page, and confirm Favorites persists in the same browser profile; audio playback should never start a YouTube video.
- [ ] Start account playback and confirm the track appears in Recently played. Pause/resume the same track and verify the history does not fill with rapid duplicates.
- [ ] Add several tracks to Queue, play a queued row, move rows up/down, remove current/non-current rows, and clear the queue.
- [ ] Build a queue, enable Shuffle/Repeat, reload EUPHONIA, and confirm queue order and playback mode are restored without trying to auto-play before account authorization.
- [ ] Enable Shuffle and verify Next chooses a different queue item; cycle Repeat off/all/one and test natural end-of-track behavior.
- [ ] Open Lyrics and verify synchronized LRCLIB lines highlight against supported player position; test plain lyrics, not-found, offline and HTTP 429 behavior.
- [ ] Use the EUPHONIA account seek bar on an authorized Apple Music track; verify time labels and seek behavior. Change account volume and confirm it does not alter the local-file player's separate volume.
- [ ] Verify a YouTube playlist track redirects to Apple catalog audio search without constructing a YouTube iframe; local audio/DAW playback remains coordinated.
- [ ] Verify lyrics searches cancel stale track requests, time out on a stalled connection, throttle sequential requests, and honor Retry-After after HTTP 429.
- [ ] Where supported, test lock-screen/system media metadata, play/pause/previous/next and seek controls. In unsupported browsers, confirm the in-page account-player controls still work.
- [ ] Add tracks from Favorites/Recently played into Queue, and confirm YouTube metadata items route to audio-preview search while eligible Apple Music items use official MusicKit playback without overlapping local audio/DAW playback.

**Limits:** account sync requires each user's provider setup and consent. YouTube Data API results may not contain all YouTube Music-generated/library collections. Imported playlists store metadata and source identifiers, not copied audio files. The Music Hub discovery player is audio-only: Apple catalog previews are short provider-supplied clips, and full-length audio needs eligible Apple Music/MusicKit access. This static browser implementation is a prototype; production OAuth should use a secure backend for secrets and receive a privacy/security review.

# EUPHONIA v0.3.0 — release checklist

This is a manual checklist. Check each item on the actual supported browser/device; static code validation cannot prove audio behavior.

## Static checks

- [ ] `node validate-project.mjs` passes with no missing asset/ID/syntax issue.
- [ ] Open browser DevTools; no uncaught JavaScript errors on startup.
- [ ] Service worker installs, activates the current cache version, and updates after a versioned deployment.
- [ ] Simulate a failed fetch for one required core asset during a new Service Worker install; verify the partial new cache is removed and the previously active worker/version remains available.
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

