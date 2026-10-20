# Deploy EUPHONIA over HTTPS

EUPHONIA is static and can be hosted by any static-site provider that serves HTML, CSS, JavaScript, JSON and PNG files over HTTPS. No server-side runtime or environment secrets are needed.

## Before publishing

1. Run `node validate-project.mjs`.
2. Complete `QA-CHECKLIST.md` on desktop and mobile.
3. Test microphone recording, project Save/Open, reload recovery, and WAV export with short and medium-size projects.
4. Review the limitations in `README.md`. Do not advertise provider playback or DAW functionality that has not been tested.
5. Keep the source directory structure unchanged; `index.html`, scripts, stylesheet, icons, manifest and `sw.js` should stay together.

## Static hosting options

### Netlify / Cloudflare Pages / similar

Upload the contents of `euphonia-studio` as the site root or connect a repository whose publish directory is `euphonia-studio`. The included `netlify.toml` applies basic security/cache headers on Netlify. Confirm that the final site uses HTTPS.

### GitHub Pages

Publish the contents of the `euphonia-studio` directory from a repository or configured Pages source. Open the final HTTPS URL and validate the manifest, service worker and install flow. Relative asset URLs are used so a subpath deployment can work.

## HTTPS and permissions

Microphone recording and installation support depend on secure-context rules enforced by the browser. Use the provider's HTTPS URL for mobile. A LAN IP over plain HTTP is useful for layout checks, but may not permit microphone recording or PWA installation.

## Data handling and backups

There is no EUPHONIA backend and no cloud sync: imported audio and autosave remain within the browser's local site storage. Host deployments can still serve updates to the app shell, but cannot recover local data if the user clears browser storage or changes origin. Ask users to keep `.euphonia.json` backups before upgrading or switching browsers.

## Release / rollback

- Keep each published build as a versioned release or ZIP.
- Increment `CACHE_NAME` in `sw.js` for every app-shell release.
- Because updates replace cached scripts/styles, run the smoke test after deployment and test an upgrade from the previous version, not only a clean install.
- If an update is broken, redeploy the last known-good static bundle with its matching service-worker cache version. Validate recovery on a device that previously installed the PWA.