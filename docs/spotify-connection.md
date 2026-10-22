# EUPHONIA — Spotify connection setup

This integration lets a user authorize EUPHONIA to read their Spotify profile and playlist list. Playback is handed off to Spotify's official embedded player; EUPHONIA does not extract, download, or re-host Spotify audio.

## 1. Create a Spotify app

1. Open the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
2. Create or select an app and open its settings.
3. In Redirect URIs, add the **exact Redirect URI shown by EUPHONIA** under Music Hub → Spotify → Setup.
4. Save the Spotify app settings.

The URI must match exactly, including protocol, hostname, path, and trailing slash. Use HTTPS for a hosted deployment. For local development, use the exact localhost URI displayed by the app.

## 2. Configure EUPHONIA

1. Open EUPHONIA and go to **Music Hub**.
2. Select **Spotify**, then open **Setup**.
3. Copy the app's **Client ID** from Spotify Developer Dashboard into EUPHONIA and save it.
4. Click **Connect account**, sign in at Spotify, and review the permission request.
5. After returning to EUPHONIA, use the loaded playlist cards. **Play inside** opens the playlist using Spotify's official embed player.

EUPHONIA uses the Authorization Code with PKCE flow in the browser. The app does not need or ask for the Spotify Client Secret. The Client ID is not a secret; authorization tokens are held in the current tab's `sessionStorage` rather than long-term local storage.

## 3. What this connection can and cannot do

- It requests permission to read the current user's playlist list and basic profile information.
- It does not retrieve playable raw audio URLs from Spotify or feed Spotify streams into EUPHONIA's custom audio player or DAW.
- Full-track playback is handled by Spotify's official embedded player. Playback can depend on the user's Spotify session, the selected playlist, country availability, browser settings, and Spotify's own rules.
- The link-share flow remains available when a user does not configure OAuth.
- My List for catalog previews is stored locally in the user's browser and is separate from the Spotify account's saved playlists.

## 4. Troubleshooting

**Redirect URI mismatch:** Copy the URI displayed by EUPHONIA and register it exactly in the Spotify app settings. Do not include query parameters or a fragment.

**Access denied / 403:** Confirm that the correct Client ID is saved, the user is allowed to use the Spotify app under its current Developer Mode rules, and playlist scopes are available for that app.

**Login returns to the wrong page:** Open the same deployed EUPHONIA URL whose path is registered as the redirect URI. OAuth state and the PKCE verifier are temporary and are cleared after callback handling.

**Playlist playback does not start:** The playlist card uses Spotify's official embedded player. Some private, unavailable, or restricted playlists may require Spotify login or may not play in an embed; EUPHONIA does not bypass those restrictions.

**Rate limited:** If Spotify returns HTTP 429, wait and retry instead of repeatedly refreshing.

## 5. Official references

- [Authorization Code with PKCE](https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow)
- [Get Current User's Playlists](https://developer.spotify.com/documentation/web-api/reference/get-a-list-of-current-users-playlists)
- [Spotify Developer Access and Platform Security update](https://developer.spotify.com/blog/2026-02-06-update-on-developer-access-and-platform-security)

Spotify's developer access, quotas, supported endpoints, and user-authorization limits can change. Check the current Spotify Developer Dashboard and official documentation before relying on the integration for a wider audience.
