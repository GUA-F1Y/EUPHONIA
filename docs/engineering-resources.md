# EUPHONIA engineering resource map

This document records official documentation and practical engineering references to use when extending EUPHONIA. Prefer documented APIs and independently implemented adapters. Do not copy source code from reference projects without checking their license and integration constraints.

## 1. Provider integration — authoritative sources

### YouTube playback and account data
- [YouTube IFrame Player API](https://developers.google.com/youtube/iframe_api_reference) — player states, playback controls, errors, **onAutoplayBlocked**, and supported embed options.
- [IFrame API revision history](https://developers.google.com/youtube/iframe_api_revision_history) — changes to embed behavior and new error handling. Keep an eye on error 153 and client identity/referrer requirements.
- [YouTube Data API: playlists.list](https://developers.google.com/youtube/v3/docs/playlists/list) — official playlist metadata endpoint and pagination parameters.
- [YouTube Data API: playlistItems.list](https://developers.google.com/youtube/v3/docs/playlistItems/list) — playlist track/video metadata, pagination, and partial resources.
- [YouTube Data API quota costs](https://developers.google.com/youtube/data/determine_quota_cost) — quota budgeting and API usage monitoring.
- [YouTube API authentication](https://developers.google.com/youtube/v3/guides/authentication) — user authorization requirements for private/account-owned playlists.

Implementation guardrails:
- Use official authorization for account-specific data; API keys alone cannot read private account libraries.
- Request only needed fields, paginate with documented maximums, honor errors/expired sessions, and avoid repeated unnecessary synchronization.
- Keep official playback inside the supported YouTube player. Never download/rip provider streams or embed the whole provider website in an iframe.
- Treat autoplay as best effort and explain errors to users.

### Apple Music
- [MusicKit on the Web v3 — Getting Started](https://js-cdn.music.apple.com/musickit/v3/docs/index.html?path=/story/get-started--page) — loading and configuring the official browser SDK with a developer token.
- [MusicKit on the Web v3 documentation](https://js-cdn.music.apple.com/musickit/v3/docs/index.html) — API, events, queues, authorization, and playback reference.
- [Apple Music API](https://developer.apple.com/documentation/applemusicapi) — catalog and library API reference.

Implementation guardrails:
- Configure MusicKit after its readiness event and validate token configuration before asking the user to authorize.
- Use SDK event/enum constants instead of guessed integer values wherever possible.
- Distinguish metadata/library access from actual playable content; playback still depends on authorization, subscription, storefront, and item availability.
- Never request or publish the Apple .p8 private signing key in this static frontend. A backend that creates developer tokens must store the signing key securely.

### Lyrics
- [LRCLIB API documentation](https://lrclib.net/docs) — search parameters, response fields, required client identification, rate limiting, and the Retry-After header.

Implementation guardrails:
- Cache successful lyric results locally, apply a short serial-request delay, set a timeout, cancel stale lookups when the track changes, and honor Retry-After on HTTP 429.
- Lyrics are best-effort metadata, not guaranteed for every track. Do not imply that LRCLIB provides audio or authoritative recording identification.

## 2. Browser audio, controls, and accessibility

- [MDN Web Audio API best practices](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices) — user-gesture/autoplay behavior, audio loading, and cross-browser considerations for the DAW.
- [MDN Media Session API](https://developer.mozilla.org/en-US/docs/Web/API/MediaSession) — metadata and hardware/lock-screen media controls; feature-detect it because support is not universal.
- [MDN setPositionState](https://developer.mozilla.org/en-US/docs/Web/API/MediaSession/setPositionState) — constraints for reporting duration, playback position, and speed.
- [MDN AbortController](https://developer.mozilla.org/en-US/docs/Web/API/AbortController) — cancel obsolete requests and avoid stale asynchronous results.
- [MDN prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion) — keep motion accessible.
- [WAI-ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/) — keyboard interaction and accessible states for controls, dialogs, and tabs.

Implementation guardrails:
- Treat OS-level media controls as a progressive enhancement; in-page controls must still work where Media Session is unavailable.
- Avoid creating/resuming Web Audio contexts automatically outside a user gesture.
- Keep control labels, pressed/expanded states, focus visibility, and error messages understandable to keyboard and mobile users.

## 3. Security, local data, and PWA reliability

- [OWASP HTML5 Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html) — risks of localStorage, sessionStorage, IndexedDB, and untrusted stored data.
- [MDN Content Security Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Content_Security_Policy) — how to deploy a CSP safely; report-only is useful before enforcing a policy.
- [web.dev: Service worker caching and HTTP caching](https://web.dev/articles/service-worker-caching-and-http-caching) — how browser HTTP cache and Service Worker cache interact.
- [Chrome for Developers: caching strategies](https://developer.chrome.com/docs/workbox/caching-strategies-overview) — network-first, cache-first, and stale-while-revalidate tradeoffs.
- [Google Chrome modern web guidance — performance](https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/performance/performance.md) — cache discipline, expiry, and avoiding unbounded storage.

Implementation guardrails:
- Keep access tokens and provider secrets out of persistent local storage and Git history. Current Google access tokens should remain in memory; Apple developer tokens used in the browser are session-only and must never be the private signing key.
- Treat local browser data as user-modifiable and potentially malformed. Validate parsed structures, cap queue/history/cache sizes, and handle storage quota or disabled storage gracefully.
- Keep static app-shell cache versions synchronized whenever core scripts/styles change. The current worker precaches its required shell atomically; if a required asset fails, it rejects that install and cleans up the incomplete cache so the previous worker can remain active. Test this recovery path and offline fallback behavior.
- Do not apply a CSP blindly to static hosting; first enumerate the required Google, Apple, YouTube, lyrics, font, and artwork origins. Test in report-only mode before enforcing headers.

## 4. Automated testing and release quality

- [Playwright Test introduction](https://playwright.dev/docs/intro) — browser-driven end-to-end tests, isolated browser contexts, Chromium/Firefox/WebKit, and CI.
- [Playwright best practices](https://playwright.dev/docs/best-practices) — user-visible assertions, isolation, and resilient selectors.
- [Playwright network mocking](https://playwright.dev/docs/network) — simulate success, empty lists, expired auth, 403/429/500 errors, and slow networks without consuming actual provider quota.
- [Chrome Lighthouse](https://developer.chrome.com/docs/lighthouse/overview) — repeatable accessibility, performance, best-practice, and SEO audits.
- [GitHub Actions documentation](https://docs.github.com/en/actions) — automated static checks and browser-test workflows.

Recommended testing layers:
1. **Static gate** on every push: JavaScript syntax, unique HTML IDs, required assets/scripts, Service Worker cache entries, and contract markers.
2. **Unit tests** for pure helpers: LRC timestamp parsing, favorite/queue normalization, repeat/shuffle transitions, retry-after parsing, and malformed storage.
3. **Browser tests** with mocked provider/lyrics responses for account UI, queue management, reload persistence, responsive layout, and error states.
4. **Manual real-provider smoke tests** for OAuth consent, YouTube/Apple playback restrictions, seeking, volume, mobile audio, and lyric alignment. Mocked tests are not a substitute for this layer.
5. **Release checks**: run Lighthouse on the deployed HTTPS URL, inspect DevTools console/network errors, check update/offline behavior, and complete QA-CHECKLIST.md.

## 5. Suggested priority order

### P0 — trust and basic stability
- Add the real Google OAuth Web Client ID and confirm authorized origins/consent settings.
- Complete live account login and official playback tests before making availability claims.
- Use consistent provider state transitions, actionable API errors, request timeouts, cancellation, and rate-limit behavior.
- Verify queue/favorites persistence on reload and confirm no credentials are written to local storage.

### P1 — repeatable testing and recovery
- Add Playwright tests with mocked provider, lyrics, offline, and API-error responses.
- Add unit coverage for pure queue/lyrics helpers and corrupt/blocked storage.
- Test upgrade/downgrade Service Worker behavior, keyboard focus, and mobile viewport variants.
- If real-time crash reporting is later considered, make it opt-in/configurable and avoid collecting track titles, account identifiers, or tokens by default.

### P2 — deeper player quality
- Device-level Media Session controls where supported; confirm metadata and seeking behavior per browser.
- Performance profiling on long playlists and large DAW projects.
- Only add more provider adapters after account authorization, playback boundaries, policy compliance, and automated failure tests are well understood.
