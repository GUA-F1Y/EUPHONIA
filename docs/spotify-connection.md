# EUPHONIA — Spotify link and playback boundary

EUPHONIA keeps Spotify separate from the other music catalog and preview sources in the application.

Spotify's current [Developer Policy](https://developer.spotify.com/policy) prohibits a product or service that integrates Spotify streams/content with content from another service (Section III.5). For that reason, EUPHONIA does not use Spotify Web API to read playlists or embed Spotify content alongside other music sources in the same workspace.

## How to open Spotify

1. Go to Music Hub.
2. Select the Spotify card.
3. EUPHONIA opens the official Spotify website in a separate tab.

The original EUPHONIA tab stays open, so you can return to your workspace without losing the current page. Playback itself belongs to Spotify; EUPHONIA does not extract, proxy, download, or feed Spotify audio into its custom player or DAW.

## What remains inside EUPHONIA

- The homepage's music discovery shelves use the public iTunes Search API and play preview URLs only when the provider supplies them.
- Local audio files can be played in EUPHONIA's persistent player and used in the local Studio / DAW, subject to the user's rights to those files.
- Other providers appear inside the workspace only through their supported official embed/player mechanisms and the terms that apply to those providers.

Spotify may change its Developer Policy, API access, or player behavior. Review the [official Spotify Developer Policy](https://developer.spotify.com/policy) and [Spotify Compliance Tips](https://developer.spotify.com/compliance-tips) before considering a different integration.