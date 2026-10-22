# EUPHONIA — Music Hub & Studio

EUPHONIA is a **local-first music workspace** with a Netflix-inspired music-discovery homepage, provider links/embeds, an audio-preview player, local audio library, and browser-based DAW (multitrack arrangement, MIDI-style piano roll, drum sequencer, mixer/effects and project export). The project is static HTML/CSS/JavaScript; there is no build step, backend, account system, or cloud synchronization.

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
- Home uses a Netflix-inspired browsing layout: a featured hero, horizontal catalog shelves, mood shortcuts, local tracks, and a browser-local My List.
- The default catalog uses the public Apple/iTunes Search API and plays provider-supplied audio previews when available. These are previews, not unrestricted full-track streams.
- Spotify opens its official service in a separate tab. EUPHONIA does not mix Spotify content into its other provider catalogs or route Spotify audio through its custom player/DAW. See [docs/spotify-connection.md](docs/spotify-connection.md) and the [Spotify Developer Policy](https://developer.spotify.com/policy).
- YouTube Data API search is optional; official embed/share links are supported for services and content that permit them.
- Local library playback includes seek, volume, next/previous and favorites. Imported local audio stays in the browser profile's IndexedDB workspace.
- EUPHONIA does not bypass DRM, licensing, paywalls, or provider iframe restrictions. Not every service will play within an embedded panel.

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
- Clicking a platform card opens that service's playlist/library or collection route. On a phone or computer where the platform registers that HTTPS link as an App/Universal Link, the operating system may open the native app; otherwise the link opens the service website in a new tab. The user must already be signed in to the desired account in that app/site. EUPHONIA does not read passwords or account tokens.
- Catalog search returns Apple/iTunes preview results. YouTube search uses the optional YouTube Data API key when configured; without a key, paste a supported YouTube share link. Configure the key in Music Hub → YouTube API and restrict it to the expected HTTP referrers and API.
- Embedded playback remains optional and depends on each provider. Use a share/embed link to play supported content inside EUPHONIA. Spotify is intentionally handled as a separate official-service link rather than mixed into the in-app catalog.
- Platform app routing is controlled by the OS and each provider; EUPHONIA cannot guarantee that every browser/device opens the native app. Some tracks/videos can disable embedding, require sign-in, restrict playback by territory/account, or not provide previews. EUPHONIA does not bypass those restrictions.