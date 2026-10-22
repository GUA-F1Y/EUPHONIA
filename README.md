# EUPHONIA — Music Hub & Studio

EUPHONIA is a **local-first music workspace** with a Netflix-inspired music-discovery homepage, an account-based Music Hub that reads playlist metadata from supported providers, a local audio library, and browser-based DAW (multitrack arrangement, MIDI-style piano roll, drum sequencer, mixer/effects and project export). The core UI is static HTML/CSS/JavaScript; playlist metadata is cached in the current browser profile, while provider sign-in and playback remain governed by each official service.

> Release status: production-oriented beta. Static validation is included, but this package has not been certified through end-to-end testing on every target browser/phone. Complete the release checklist in `QA-CHECKLIST.md` before using it for important work or distributing it broadly.

## Run on Windows / VS Code

1. Extract the ZIP and open the `euphonia-studio` folder in VS Code.
2. Open **Terminal → New Terminal**.
3. Run `python -m http.server 8080 --bind 127.0.0.1` or `py -m http.server 8080 --bind 127.0.0.1`.
4. Open <http://127.0.0.1:8080> in Edge or Chrome. Keep the terminal open.
5. You can double-click `start-euphonia.bat` instead if Python is installed.

## Use it from a phone on the same Wi-Fi

1. On the PC, run `start-euphonia-mobile.bat` (or start Python with `python -m http.server 8080 --bind 0.0.0.0`).
2. Run `ipconfig` on Windows and find the active Wi-Fi adapter's IPv4 address, for example `192.168.1.24`.
3. On the phone connected to the same trusted Wi-Fi, open `http://192.168.1.24:8080` (replace the example with the PC's actual address).
4. Allow the Windows Firewall prompt only on a **Private** network you trust. Stop the server when done.

**LAN HTTP limitations:** this method is for checking the responsive UI and local workflows. Browser features such as microphone recording and installable PWA behavior require a secure context; `localhost` is treated specially, but a LAN IP served over plain HTTP generally is not. For full mobile use, publish the folder using HTTPS (see `DEPLOYMENT.md`). Do not expose this development server directly to the public internet.

## Install on mobile

- **Android:** open the HTTPS site in Chrome, then use the browser menu → **Install app** / **Add to Home screen**. The in-app Install button may trigger the native prompt where supported.
- **iPhone/iPad:** open the HTTPS site in Safari → **Share** → **Add to Home Screen**.
- Launch EUPHONIA from the installed app icon. Keep in mind that browser/iOS audio format and recording behavior vary by device.

## Included tools

### Music Hub
- Home uses a Netflix-inspired browsing layout: a featured hero, horizontal discovery shelves, mood shortcuts, local tracks, and browser-local My List.
- Music Hub can read YouTube account playlists using Google Identity Services and YouTube Data API v3. The app maintainer configures one Google OAuth Web Client ID in `euphonia-config.js`; end users only click **Continue with Google** and grant YouTube read access when prompted. YouTube API visibility rules apply; not every automatically generated YouTube Music library or playlist is necessarily returned.
- Music Hub can read Apple Music library playlists through MusicKit on the Web after the user authorizes access. The user must supply their own Apple Music developer token; the token is held in session storage for the current tab.
- Choose one or multiple remote playlists and import their metadata into EUPHONIA's local playlist collection. Track rows can be viewed, opened at the source, or played through the official YouTube Player API / Apple Music MusicKit where the account and content permit playback.
- Re-sync checks a previously imported playlist for new source tracks and appends only newly seen tracks. Tracks removed from the local EUPHONIA copy remain removed. This does not delete or edit tracks in the original provider account.
- Playlist metadata and imported track lists are cached in browser local storage; OAuth access tokens are not intentionally persisted. Disconnect clears the remote cache but leaves playlists the user already imported into EUPHONIA.
- Spotify stays a separate official-service link because its developer policy prohibits integrating Spotify content/streams with content from another service. See [docs/spotify-connection.md](docs/spotify-connection.md) and the [Spotify Developer Policy](https://developer.spotify.com/policy).
- SoundCloud account sync is not enabled in this static build: current OAuth token exchange requires a client secret, which must be handled by a secure backend and never exposed in browser code. Deezer needs separate app registration and OAuth validation. Bandcamp's official API is for label/merch partner account workflows, not a general listener-playlist API.
- Opening a playlist or track links back to the official service for playback. EUPHONIA does not rip, proxy, or route third-party streams through its custom player/DAW.
- The public iTunes Search API remains available for the Home discovery shelves and preview playback. These are provider-supplied previews, not unrestricted full-track streams.
- Local library playback includes seek, volume, next/previous and favorites. Imported local audio stays in the browser profile's IndexedDB workspace.

### Arrangement / multitrack DAW
- Import local audio clips into tracks, move clips and move them across tracks, trim the clip start/end, split at the playhead, duplicate/delete clips, draw placement, select tools and undo/redo.
- Tempo 40–240 BPM; grid selections for bars, quarter/eighth/sixteenth notes, triplets, or snap off; zoom, playhead, track rename, track gain, pan, mute and solo.
- Microphone recording via `MediaRecorder` where the browser grants access.
- Master controls/effects include volume, low-pass tone, delay, convolution reverb, compressor and basic linear master automation.
- Export the arrangement as stereo 44.1 kHz 16-bit WAV through `OfflineAudioContext`, subject to device RAM and browser limits.

### Piano Roll / MIDI-style sequencer
- Create notes on a grid, choose a sound, range, note length and velocity; the selected key signature highlights in-scale notes as a guide.
- Preview patterns, export a Standard MIDI `.mid`, or render a pattern into an audio clip for arrangement playback/mixing.

### Drum Sequencer
- 16-step kick, snare, closed/open hi-hat, clap and percussion pattern.
- Preview loops and render pattern lengths into audio clips.

### Local project storage and backups
- IndexedDB stores imported audio blobs, workspace metadata, arrangement, track settings, favorites and advanced MIDI/drum state on the **current browser profile and origin**. Autosave/recovery is local to that browser/device; it is not cloud sync.
- Use **Save project** to export a portable `.euphonia.json` containing source audio and arrangement. Keep backups for important work and transfer that file to move a project between devices.
- Changing host/origin (for example localhost → a deployed domain), clearing site data, private browsing, browser quota limits, or device cleanup can make local autosave unavailable. Always keep portable backups.

## Validation

Run the included static validator with Node.js:

```powershell
node validate-project.mjs
```

Then complete `QA-CHECKLIST.md` on the actual devices and browsers you plan to support. The validator checks syntax, referenced files, HTML IDs, manifest and baseline PWA wiring; it is **not** a substitute for real audio/device testing.

## Known limitations before a broad production release

- This is not an established desktop DAW replacement. It does not host VST/AU plugins, support external MIDI hardware, provide professional low-latency monitoring, compensation, multichannel input routing, advanced piano-roll editing, or an offline mastering suite.
- MIDI/drum patterns rendered to arrangement audio are snapshots. Re-render after changing the source pattern to update that audio clip.
- Advanced master controls are not a full per-track plugin chain. Export is currently WAV-only.
- Third-party streaming playback may be blocked by provider iframe/login policy.
- Browser codec, memory, microphone and offline behavior vary. Test large projects on target phones; export and project JSON can consume substantially more memory than the source audio size.


## Music Hub details

- The default in-app search uses the public Apple/iTunes Search API and shows provider-supplied preview clips where available.
- The Spotify card opens the official Spotify service in a separate tab; the operating system may route the link to the installed Spotify app if it supports that URL. Other provider cards select the provider in Music Hub and guide the user to catalog search or a supported share/embed link. EUPHONIA does not inspect installed apps, read passwords, or access account credentials.
- Catalog search returns Apple/iTunes preview results. YouTube search uses the optional YouTube Data API key when configured; without a key, paste a supported YouTube share link. Configure the key in Music Hub → YouTube API and restrict it to the expected HTTP referrers and API.
- Embedded playback remains optional and depends on each provider. Use a share/embed link to play supported content inside EUPHONIA. Spotify is intentionally handled as a separate official-service link rather than mixed into the in-app catalog.
- Platform app routing is controlled by the OS and each provider; EUPHONIA cannot guarantee that every browser/device opens the native app. Some tracks/videos can disable embedding, require sign-in, restrict playback by territory/account, or not provide previews. EUPHONIA does not bypass those restrictions.