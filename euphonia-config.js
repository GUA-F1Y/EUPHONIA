/* Public client-side application configuration.
 * This file is safe to publish only because OAuth Client IDs are identifiers, not secrets.
 * NEVER place a client_secret, access token, refresh token, or Apple .p8 private key here.
 */
window.EUPHONIA_CONFIG = Object.freeze({
  // App maintainer: replace this once with your Google Cloud OAuth Web Client ID.
  // End users then simply click "Continue with Google" and grant YouTube read access.
  googleOAuthClientId: "YOUR_GOOGLE_OAUTH_WEB_CLIENT_ID.apps.googleusercontent.com"
});
