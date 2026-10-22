# EUPHONIA — Spotify account and playback boundary

EUPHONIA keeps Spotify outside the cross-provider playlist library.

Spotify's current [Developer Policy](https://developer.spotify.com/policy) prohibits a product or service that integrates Spotify streams or content with content from another service (Section III.5). The current Music Hub intentionally does not use Spotify Web API to add Spotify playlists to the aggregated playlist grid. Spotify remains a direct link to its official service instead.

## How to open Spotify

1. Go to Music Hub.
2. Select the Spotify card.
3. EUPHONIA opens the official Spotify website in a separate tab.

The original EUPHONIA tab stays open. Playback and playlist browsing remain in Spotify; EUPHONIA does not extract, proxy, download, or feed Spotify audio into its custom player or DAW.

## What the account-based Music Hub does

- YouTube: requests read-only OAuth permission, fetches account-owned playlists with YouTube Data API v3, and retrieves playlist items when a playlist is opened.
- Apple Music: uses MusicKit on the Web and a signed developer token supplied by the developer, then requests permission before reading the user's library playlists and tracks.
- SoundCloud is not activated in the static build because its current OAuth token exchange requires a client secret. A secure backend is needed; the secret must not be stored in browser code or committed to GitHub.
- Deezer needs a separate registered application and tested OAuth adapter before the account card can be enabled.
- Bandcamp's official API access is directed toward labels and merchandise fulfillment partners, not a general listener-playlist endpoint.

Playlist metadata from supported providers is cached locally in the current browser profile. OAuth access tokens are kept in memory for the active session; Apple Music's developer token is kept in session storage for the current tab. Disconnect clears the local playlist cache. This is a personal-use prototype, not a production-complete multi-account authentication system.

Review the [Spotify Developer Policy](https://developer.spotify.com/policy) and [Spotify Compliance Tips](https://developer.spotify.com/compliance-tips) before considering a different Spotify integration.
