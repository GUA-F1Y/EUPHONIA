# EUPHONIA Google account setup (maintainer only)

## Goal

End users should only select **Music Hub → YouTube Music → Continue with Google**. They should never enter a Google Client ID or YouTube API key.

Google still requires OAuth authorization to access the playlists belonging to the signed-in user. An API key alone can request public data but cannot identify and read the user's private account library. Google Identity Services makes the authorization popup straightforward; it does not remove the consent requirement. Official docs:
- [Google Identity Services for web](https://developers.google.com/identity/oauth2/web/guides/overview)
- [YouTube Data API OAuth authorization](https://developers.google.com/youtube/v3/guides/authentication)
- [YouTube playlists.list](https://developers.google.com/youtube/v3/docs/playlists/list)

## One-time app configuration

1. Open [Google Cloud Credentials](https://console.cloud.google.com/apis/credentials) and choose the EUPHONIA Cloud project.
2. Enable [YouTube Data API v3](https://console.cloud.google.com/apis/library/youtube.googleapis.com).
3. Configure the Google OAuth consent screen / Google Auth Platform branding and audience. If the app remains in Testing, add each account that needs to test it as a test user.
4. Create an OAuth Client ID with application type **Web application**.
5. Add the exact dev origins (for example `http://localhost:8080` and `http://127.0.0.1:8080`) under **Authorized JavaScript origins**, plus the deployed production origin when ready.
6. Put the Client ID in `euphonia-config.js`:

   ```js
   window.EUPHONIA_CONFIG = Object.freeze({
     googleOAuthClientId: "YOUR_CLIENT_ID.apps.googleusercontent.com"
   });
   ```

7. Do not put a client secret, access token, refresh token, or any private key in that file. A web OAuth Client ID is a public identifier, but it must be restricted to the origins that EUPHONIA uses.
8. Push the config and deploy. Users now just click **Continue with Google**; Google displays the account chooser and asks permission the first time.

## Why this is still OAuth

Reading a user's YouTube playlists requires a user-authorized access token with the YouTube read-only scope. The current browser code requests only `https://www.googleapis.com/auth/youtube.readonly`, keeps the access token in memory, and uses it for the YouTube Data API. It does not store Google access tokens in localStorage.

No OAuth-free method can securely read a private user's playlist from Google. Do not ask users for their Google password, scrape their browser cookies, or copy session tokens out of YouTube. Those are not safe substitutes for official authorization.

## Production notes

- Review OAuth branding, audience, verification requirements, data handling, and privacy disclosure before opening the app to the public.
- Client ID restrictions must match the exact domain/origin users use. A local origin is different from a Vercel or custom domain origin.
- This configuration step is for the EUPHONIA maintainer, not each user.
