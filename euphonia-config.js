/* Public client-side application configuration.
 * This file is downloaded by every browser. API keys must be restricted by HTTP referrer
 * and API scope; they are identifiers/public client configuration, not secret storage.
 * NEVER place a client_secret, access token, refresh token, or Apple .p8 private key here.
 */
window.EUPHONIA_CONFIG = Object.freeze({
  // App maintainer: replace this once with your Google Cloud OAuth Web Client ID.
  // End users then simply click "Continue with Google" and grant YouTube read access.
  googleOAuthClientId: "YOUR_GOOGLE_OAUTH_WEB_CLIENT_ID.apps.googleusercontent.com",
  // App maintainer: enable YouTube Data API v3 and restrict this key to EUPHONIA's real web origins.
  // Public search uses this key; it does not grant access to private playlists.
  youtubeDataApiKey: "YOUR_YOUTUBE_DATA_API_KEY"
});
