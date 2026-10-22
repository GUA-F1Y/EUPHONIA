(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const CACHE_KEY = "euphonia.musicHub.accountPlaylists.v1";
  const IMPORTED_KEY = "euphonia.musicHub.importedPlaylists.v1";
  const ACCOUNT_QUEUE_KEY = "euphonia.musicHub.accountQueue.v1";
  const ACCOUNT_MODES_KEY = "euphonia.musicHub.accountPlaybackModes.v1";
  const APPLE_TOKEN_KEY = "euphonia.musicHub.appleDeveloperToken.session";
  const YOUTUBE_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";

  let cache = readJSON(localStorage, CACHE_KEY, {});
  // Migrate the old per-user Google Client ID setting away: app maintainers configure this once
  // in euphonia-config.js; normal users should never need to enter it.
  try { localStorage.removeItem("euphonia.musicHub.accountConfig.v1"); } catch (_) {}
  let importedPlaylists = readJSON(localStorage, IMPORTED_KEY, {});
  if (!importedPlaylists || typeof importedPlaylists !== "object" || Array.isArray(importedPlaylists)) importedPlaylists = {};
  const selectedPlaylistKeys = new Set();
  let importingSelected = false;
  let youtubeAccessToken = null;
  let youtubeTokenExpiresAt = 0;
  let appleMusic = null;
  let appleConfiguredToken = "";
  let appleAuthorized = false;
  let musicKitPromise = null;
  let pendingYoutubePlaylistId = null;
  let pendingApplePlaylistId = null;
  let activePlaylistDetailKey = null;
  let accountPlaybackQueue = readJSON(localStorage, ACCOUNT_QUEUE_KEY, []);
  let accountPlaybackIndex = -1;
  let accountPlaybackProvider = null;
  const restoredPlaybackModes = readJSON(localStorage, ACCOUNT_MODES_KEY, {});
  let accountShuffleEnabled = Boolean(restoredPlaybackModes && restoredPlaybackModes.shuffle);
  let accountRepeatMode = restoredPlaybackModes && ["off", "all", "one"].includes(restoredPlaybackModes.repeat) ? restoredPlaybackModes.repeat : "off";
  let youtubePlayer = null;
  let youtubeApiPromise = null;
  let applePlaybackBusy = false;
  let applePlaybackEventInstance = null;
  let lastAppleEndedAt = 0;

  function readJSON(storage, key, fallback) {
    try {
      const value = storage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function setStatus(message, tone = "info") {
    const status = $("#accountHubStatus");
    if (!status) return;
    status.dataset.tone = tone;
    const messageNode = status.querySelector("[data-account-status-message]");
    if (messageNode) messageNode.textContent = message;
  }

  function openSetup(focusSelector) {
    const panel = $("#accountSetup");
    if (panel) panel.hidden = false;
    const button = $("#accountSetupToggle");
    if (button) button.setAttribute("aria-expanded", "true");
    if (focusSelector) {
      const input = $(focusSelector);
      if (input) input.focus();
    }
  }

  function savedAppleDeveloperToken() {
    try { return sessionStorage.getItem(APPLE_TOKEN_KEY) || ""; }
    catch (_) { return ""; }
  }

  function storeConfig() {
    try {
      sessionStorage.setItem(APPLE_TOKEN_KEY, $("#accountAppleDeveloperToken").value.trim());
      return true;
    } catch (_) {
      setStatus("Browser menolak menyimpan Apple Music developer token untuk tab ini.", "error");
      return false;
    }
  }

  function readPlaylistCache() {
    cache = readJSON(localStorage, CACHE_KEY, {});
    if (!cache || typeof cache !== "object" || Array.isArray(cache)) cache = {};
    return cache;
  }

  function writePlaylistCache() {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
      return true;
    } catch (_) {
      setStatus("Playlist berhasil dibaca, tetapi cache browser tidak dapat disimpan. Daftar masih tersedia selama sesi ini.", "error");
      return false;
    }
  }

  function getCached(provider) {
    const rows = cache[provider];
    return rows && Array.isArray(rows.items) ? rows.items : [];
  }

  function countLabel(item) {
    if (Number.isFinite(item.itemCount)) return item.itemCount + " track" + (item.itemCount === 1 ? "" : "s");
    return "Playlist";
  }

  function providerTitle(provider) {
    return provider === "youtube" ? "YouTube Music" : "Apple Music";
  }

  function renderProviderStates() {
    readPlaylistCache();
    ["youtube", "apple"].forEach(provider => {
      const stateNode = $("[data-account-status=\"" + provider + "\"]");
      const connectButton = $("[data-account-connect=\"" + provider + "\"]");
      const disconnectButton = $("[data-account-disconnect=\"" + provider + "\"]");
      if (!stateNode || !connectButton) return;
      const count = getCached(provider).length;
      const active = provider === "youtube"
        ? Boolean(youtubeAccessToken && Date.now() < youtubeTokenExpiresAt)
        : Boolean(appleMusic && appleAuthorized);
      if (active) {
        stateNode.textContent = "Connected · session aktif · " + count + " playlist";
        connectButton.textContent = "↻ Sync playlists";
        stateNode.dataset.connected = "true";
      } else if (count) {
        stateNode.textContent = "Cache lokal · " + count + " playlist · perlu reconnect untuk sinkronisasi";
        connectButton.textContent = provider === "youtube" ? "Reconnect with Google" : "Reconnect Apple Music";
        stateNode.dataset.connected = "false";
      } else {
        stateNode.textContent = "Belum terhubung";
        connectButton.textContent = provider === "youtube" ? "Continue with Google" : "Connect Apple Music";
        stateNode.dataset.connected = "false";
      }
      if (disconnectButton) disconnectButton.hidden = !active && count === 0;
    });
    const otherProviders = [
      ["soundcloud", "Backend aman diperlukan untuk pertukaran token"],
      ["deezer", "Integrasi perlu App ID dan uji OAuth"],
      ["bandcamp", "API playlist akun konsumen tidak tersedia"],
      ["spotify", "Tetap di layanan resmi, tidak digabung"]
    ];
    otherProviders.forEach(entry => {
      const node = $("[data-account-status=\"" + entry[0] + "\"]");
      if (node) node.textContent = entry[1];
    });
  }

  function allCachedPlaylists() {
    readPlaylistCache();
    return ["youtube", "apple"].flatMap(provider => getCached(provider).map(item => item));
  }

  function createButton(label, className, callback, disabled = false) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className || "outline-button";
    button.textContent = label;
    button.disabled = Boolean(disabled);
    if (callback) button.addEventListener("click", callback);
    return button;
  }

  function createExternalLink(label, href, className) {
    const link = document.createElement("a");
    link.className = className || "outline-button";
    link.textContent = label;
    link.href = href || "#";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    if (!href) {
      link.removeAttribute("target");
      link.removeAttribute("rel");
      link.setAttribute("aria-disabled", "true");
    }
    return link;
  }

  function allImportedPlaylists() {
    try {
      const stored = JSON.parse(localStorage.getItem(IMPORTED_KEY) || "{}");
      importedPlaylists = stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
    } catch (_) {
      importedPlaylists = {};
    }
    return Object.values(importedPlaylists).map(item => ({ ...item, importedLocal: true, key: item.sourceKey || item.key }));
  }

  function persistImportedPlaylists() {
    try {
      localStorage.setItem(IMPORTED_KEY, JSON.stringify(importedPlaylists));
      return true;
    } catch (_) {
      setStatus("Playlist belum tersimpan karena ruang penyimpanan browser tidak cukup. Hapus beberapa playlist lokal atau simpan salinan metadata.", "error");
      return false;
    }
  }

  function renderSelectionControls(visibleRemoteItems) {
    const importButton = $("#accountImportSelected");
    const selectVisibleButton = $("#accountSelectVisible");
    if (importButton) {
      const count = selectedPlaylistKeys.size;
      importButton.textContent = importingSelected ? "Importing…" : "Import selected (" + count + ")";
      importButton.disabled = importingSelected || count === 0;
    }
    if (selectVisibleButton) {
      const visibleKeys = visibleRemoteItems.map(item => item.key);
      const allSelected = visibleKeys.length > 0 && visibleKeys.every(key => selectedPlaylistKeys.has(key));
      selectVisibleButton.textContent = allSelected ? "Deselect visible" : "Select visible";
      selectVisibleButton.disabled = importingSelected || visibleKeys.length === 0;
    }
  }

  function renderPlaylistGrid() {
    const host = $("#accountPlaylistGrid");
    const countNode = $("#accountPlaylistCount");
    if (!host) return;
    const query = ($("#accountPlaylistSearch")?.value || "").trim().toLocaleLowerCase();
    const filter = $("#accountPlaylistFilter")?.value || "all";
    const remote = allCachedPlaylists();
    const imported = allImportedPlaylists();
    const isImportedView = filter === "imported";
    const sourceItems = isImportedView ? imported : remote;
    const filtered = sourceItems.filter(item => {
      if (!isImportedView && filter !== "all" && item.provider !== filter) return false;
      const searchText = [item.title, item.description, item.providerName, item.visibility].filter(Boolean).join(" ").toLocaleLowerCase();
      return !query || searchText.includes(query);
    });
    if (countNode) countNode.textContent = filtered.length + " / " + sourceItems.length + " " + (isImportedView ? "SAVED PLAYLISTS" : "PLAYLISTS");
    renderSelectionControls(filtered.filter(item => !item.importedLocal));
    host.replaceChildren();
    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.className = "account-empty-state";
      const icon = document.createElement("span");
      icon.className = "account-empty-icon";
      icon.textContent = "♫";
      const title = document.createElement("strong");
      title.textContent = isImportedView ? "Your EUPHONIA playlists will appear here" : (sourceItems.length ? "No matching playlists" : "Your playlists will appear here");
      const description = document.createElement("p");
      description.textContent = isImportedView
        ? "Impor satu atau beberapa playlist dari akun yang terhubung. EUPHONIA menyimpan daftar track dan metadata secara lokal; audio tetap diputar dari layanan asal."
        : (sourceItems.length
          ? "Coba kata kunci lain atau pilih All services."
          : "Hubungkan YouTube Music atau Apple Music untuk membaca playlist akunmu. Pilih playlist, lalu impor ke EUPHONIA.");
      empty.append(icon, title, description);
      host.append(empty);
      return;
    }
    filtered.forEach(item => {
      const card = document.createElement("article");
      card.className = "account-playlist-card";
      const artWrap = document.createElement("div");
      artWrap.className = "account-playlist-art";
      if (item.artwork) {
        const image = document.createElement("img");
        image.loading = "lazy";
        image.alt = "";
        image.src = item.artwork;
        image.addEventListener("error", () => {
          image.remove();
          artWrap.classList.add("no-art");
          artWrap.textContent = "♫";
        }, { once: true });
        artWrap.append(image);
      } else {
        artWrap.classList.add("no-art");
        artWrap.textContent = item.provider === "youtube" ? "▶" : "♫";
      }
      const body = document.createElement("div");
      body.className = "account-playlist-body";
      if (!item.importedLocal) {
        const selectLabel = document.createElement("label");
        selectLabel.className = "account-playlist-select";
        const select = document.createElement("input");
        select.type = "checkbox";
        select.checked = selectedPlaylistKeys.has(item.key);
        select.dataset.accountSelect = item.key;
        select.setAttribute("aria-label", "Select " + (item.title || "playlist"));
        select.disabled = importingSelected;
        const selectText = document.createElement("span");
        selectText.textContent = "Select for import";
        selectLabel.append(select, selectText);
        body.append(selectLabel);
      }
      const service = document.createElement("span");
      service.className = "account-playlist-provider";
      service.textContent = item.providerName || providerTitle(item.provider);
      const title = document.createElement("h3");
      title.textContent = item.title || "Untitled playlist";
      const description = document.createElement("p");
      description.textContent = item.description || "No description provided by the service.";
      description.className = "account-playlist-description";
      const meta = document.createElement("div");
      meta.className = "account-playlist-meta";
      const tracks = document.createElement("span");
      tracks.textContent = item.importedLocal ? ((item.tracks || []).length + " saved tracks") : countLabel(item);
      const visibility = document.createElement("span");
      const importedVersion = importedPlaylists[item.key];
      visibility.textContent = item.importedLocal ? "Saved in EUPHONIA" : (importedVersion ? ("Imported · " + (importedVersion.tracks || []).length + " tracks") : (item.visibility || "Account library"));
      meta.append(tracks, visibility);
      body.append(service, title, description, meta);
      const actions = document.createElement("div");
      actions.className = "account-playlist-actions";
      if (item.importedLocal) {
        actions.append(
          createButton("View tracks", "primary-button small-account-button", () => void viewPlaylist(item)),
          createButton("Sync updates", "outline-button small-account-button", () => void importPlaylist(item, { resync: true })),
          createExternalLink("Open source ↗", item.url, "outline-button small-account-button")
        );
      } else {
        actions.append(
          createButton("View tracks", "primary-button small-account-button", () => void viewPlaylist(item)),
          createButton(importedVersion ? "Sync updates" : "Import to EUPHONIA", "outline-button small-account-button", () => void importPlaylist(item, { resync: Boolean(importedVersion) })),
          createExternalLink("Open source ↗", item.url, "outline-button small-account-button")
        );
      }
      card.append(artWrap, body, actions);
      host.append(card);
    });
  }

  function providerStatusCard(provider, active, playlistCount) {
    const node = $("[data-account-status=\"" + provider + "\"]");
    if (!node) return;
    node.textContent = active
      ? "Connected · " + playlistCount + " playlist"
      : playlistCount
        ? "Cache lokal · " + playlistCount + " playlist · reconnect untuk update"
        : "Belum terhubung";
  }

  async function fetchYouTubeJSON(endpoint, token) {
    const response = await fetch(endpoint, {
      headers: { Authorization: "Bearer " + token, Accept: "application/json" },
      cache: "no-store"
    });
    let data = {};
    try { data = await response.json(); } catch (_) {}
    if (!response.ok || data.error) {
      const message = data.error && data.error.message ? data.error.message : "YouTube API HTTP " + response.status;
      if (response.status === 401) {
        youtubeAccessToken = null;
        youtubeTokenExpiresAt = 0;
      }
      throw new Error(message);
    }
    return data;
  }

  async function loadYouTubePlaylists(token) {
    setStatus("Mengambil playlist milik akun YouTube…");
    const collected = [];
    let pageToken = "";
    let page = 0;
    do {
      const url = new URL("https://www.googleapis.com/youtube/v3/playlists");
      url.searchParams.set("part", "snippet,contentDetails,status");
      url.searchParams.set("mine", "true");
      url.searchParams.set("maxResults", "50");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const data = await fetchYouTubeJSON(url.toString(), token);
      (Array.isArray(data.items) ? data.items : []).forEach(item => {
        if (!item || !item.id || !item.snippet) return;
        collected.push({
          key: "youtube::" + item.id,
          provider: "youtube",
          providerName: "YouTube Music",
          id: item.id,
          title: item.snippet.title || "Untitled playlist",
          description: item.snippet.description || "",
          artwork: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.default?.url || "",
          itemCount: Number.isFinite(item.contentDetails?.itemCount) ? item.contentDetails.itemCount : null,
          visibility: item.status?.privacyStatus || "",
          url: "https://music.youtube.com/playlist?list=" + encodeURIComponent(item.id),
          refreshedAt: new Date().toISOString()
        });
      });
      pageToken = data.nextPageToken || "";
      page += 1;
    } while (pageToken && page < 10);
    cache.youtube = { items: collected, refreshedAt: new Date().toISOString() };
    writePlaylistCache();
    renderProviderStates();
    renderPlaylistGrid();
    setStatus("Sinkronisasi YouTube selesai: " + collected.length + " playlist terbaca. EUPHONIA menampilkan metadata; pemutaran tetap melalui layanan YouTube resmi.", "success");
    if (pendingYoutubePlaylistId) {
      const id = pendingYoutubePlaylistId;
      pendingYoutubePlaylistId = null;
      const item = collected.find(row => row.id === id);
      if (item) await loadYouTubeTracks(item);
    }
  }

  function connectYouTube() {
    const clientId = String(window.EUPHONIA_CONFIG?.googleOAuthClientId || "").trim();
    if (!clientId || clientId.startsWith("YOUR_GOOGLE_") || !clientId.endsWith(".apps.googleusercontent.com")) {
      setStatus("Google login belum dikonfigurasi oleh pemilik aplikasi. Setelah Client ID disetel satu kali di euphonia-config.js, pengguna cukup klik Continue with Google.", "error");
      return;
    }
    if (youtubeAccessToken && Date.now() < youtubeTokenExpiresAt - 30000) {
      void loadYouTubePlaylists(youtubeAccessToken).catch(error => setStatus("Sinkronisasi YouTube gagal: " + error.message, "error"));
      return;
    }
    if (!window.google?.accounts?.oauth2) {
      setStatus("Google Identity Services belum siap. Tunggu halaman selesai dimuat, lalu tekan Connect account sekali lagi.", "error");
      return;
    }
    try {
      const tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: YOUTUBE_SCOPE,
        callback: response => {
          if (!response || response.error || !response.access_token) {
            setStatus("Login YouTube dibatalkan atau gagal: " + ((response && (response.error_description || response.error)) || "OAuth tidak mengembalikan token."), "error");
            return;
          }
          youtubeAccessToken = response.access_token;
          youtubeTokenExpiresAt = Date.now() + (Number(response.expires_in) || 3600) * 1000;
          renderProviderStates();
          void loadYouTubePlaylists(youtubeAccessToken).catch(error => setStatus("Tidak dapat membaca playlist YouTube: " + error.message, "error"));
        },
        error_callback: error => setStatus("Login Google tidak selesai: " + ((error && error.message) || (error && error.type) || "popup ditutup atau diblokir."), "error")
      });
      tokenClient.requestAccessToken();
    } catch (error) {
      setStatus("Google OAuth gagal dimulai: " + (error.message || "periksa Client ID dan authorized origins."), "error");
    }
  }

  function loadMusicKit() {
    if (window.MusicKit) return Promise.resolve(window.MusicKit);
    if (musicKitPromise) return musicKitPromise;
    musicKitPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector("script[data-euphonia-musickit]");
      const script = existing || document.createElement("script");
      let settled = false;
      const finish = () => {
        if (settled || !window.MusicKit) return;
        settled = true;
        resolve(window.MusicKit);
      };
      document.addEventListener("musickitloaded", finish, { once: true });
      script.src = "https://js-cdn.music.apple.com/musickit/v3/musickit.js";
      script.async = true;
      script.dataset.euphoniaMusickit = "true";
      script.onload = finish;
      script.onerror = () => {
        if (!settled) {
          settled = true;
          reject(new Error("MusicKit JS gagal dimuat. Periksa koneksi internet."));
        }
      };
      if (!existing) document.head.append(script);
      window.setTimeout(() => {
        if (!settled && window.MusicKit) finish();
        else if (!settled) {
          settled = true;
          reject(new Error("MusicKit belum siap. Muat ulang halaman lalu coba lagi."));
        }
      }, 15000);
    }).finally(() => { musicKitPromise = null; });
    return musicKitPromise;
  }

  function unwrapAppleData(result) {
    let value = result;
    if (value && value.data !== undefined) value = value.data;
    if (value && value.data !== undefined) value = value.data;
    return Array.isArray(value) ? value : [];
  }

  function appleArtwork(attributes) {
    const url = attributes && attributes.artwork && attributes.artwork.url;
    return url ? url.replace("{w}", "600").replace("{h}", "600").replace("{f}", "jpg") : "";
  }

  async function loadApplePlaylists() {
    if (!appleMusic || !appleAuthorized) throw new Error("Hubungkan Apple Music untuk membaca library playlist.");
    setStatus("Mengambil playlist dari Apple Music…");
    const collected = [];
    let offset = 0;
    let total = Infinity;
    while (collected.length < total && collected.length < 500) {
      const response = await appleMusic.api.music("/v1/me/library/playlists", { limit: 100, offset: offset });
      const body = response && response.data && response.data.data ? response.data : response;
      const rows = body && Array.isArray(body.data) ? body.data : [];
      rows.forEach(item => {
        const attributes = item.attributes || {};
        collected.push({
          key: "apple::" + item.id,
          provider: "apple",
          providerName: "Apple Music",
          id: item.id,
          title: attributes.name || "Untitled playlist",
          description: typeof attributes.description === "string" ? attributes.description : (attributes.description?.standard || ""),
          artwork: appleArtwork(attributes),
          itemCount: Number.isFinite(attributes.trackCount) ? attributes.trackCount : null,
          visibility: attributes.isPublic ? "Public" : "Account library",
          url: attributes.url || "https://music.apple.com/library",
          refreshedAt: new Date().toISOString()
        });
      });
      total = Number(body?.meta?.total);
      if (!Number.isFinite(total)) total = rows.length < 100 ? collected.length : Infinity;
      if (!rows.length || rows.length < 100) break;
      offset += rows.length;
    }
    cache.apple = { items: collected, refreshedAt: new Date().toISOString() };
    writePlaylistCache();
    renderProviderStates();
    renderPlaylistGrid();
    setStatus("Sinkronisasi Apple Music selesai: " + collected.length + " playlist terbaca. EUPHONIA menampilkan metadata; pemutaran mengikuti akun dan layanan Apple Music.", "success");
    if (pendingApplePlaylistId) {
      const id = pendingApplePlaylistId;
      pendingApplePlaylistId = null;
      const item = collected.find(row => row.id === id);
      if (item) await loadAppleTracks(item);
    }
  }

  function attachApplePlaybackEvents(MusicKit) {
    if (!appleMusic || typeof appleMusic.addEventListener !== "function" || applePlaybackEventInstance === appleMusic) return;
    const eventName = MusicKit?.Events?.playbackStateDidChange || "playbackStateDidChange";
    appleMusic.addEventListener(eventName, () => {
      if (accountPlaybackProvider !== "apple") return;
      const state = appleMusic?.player?.playbackState ?? appleMusic?.playbackState;
      const states = MusicKit?.PlaybackStates || {};
      const isPlaying = state === states.playing || state === 5 || state === "playing";
      const isEnded = state === states.ended || state === states.completed || state === 1 || state === 0 || state === "ended" || state === "completed";
      if (isPlaying) {
        window.dispatchEvent(new CustomEvent("euphonia:account-playback-started", { detail: { track: currentAccountTrack() } }));
        const button = $("#accountPlayerToggle");
        if (button) button.textContent = "Ⅱ Pause";
      }
      if (isEnded && Date.now() - lastAppleEndedAt > 1500) {
        lastAppleEndedAt = Date.now();
        advanceAccountQueue(1, true);
      } else if (state === states.paused || state === 4 || state === "paused") {
        const button = $("#accountPlayerToggle");
        if (button) button.textContent = "▶ Play";
      }
    });
    applePlaybackEventInstance = appleMusic;
  }

  async function connectAppleMusic() {
    const developerToken = savedAppleDeveloperToken() || ($("#accountAppleDeveloperToken")?.value || "").trim();
    if (!developerToken) {
      setStatus("Apple Music memerlukan MusicKit developer token. Masukkan token sementara di Connection setup; jangan masukkan private key .p8.", "error");
      openSetup("#accountAppleDeveloperToken");
      return;
    }
    try {
      setStatus("Menyiapkan MusicKit dan meminta izin Apple Music…");
      const MusicKit = await loadMusicKit();
      if (!appleMusic || appleConfiguredToken !== developerToken) {
        await MusicKit.configure({
          developerToken: developerToken,
          app: { name: "EUPHONIA", build: "0.4.0" }
        });
        appleMusic = MusicKit.getInstance();
        appleConfiguredToken = developerToken;
        appleAuthorized = false;
      } else {
        appleMusic = MusicKit.getInstance();
      }
      await appleMusic.authorize();
      appleAuthorized = true;
      attachApplePlaybackEvents(MusicKit);
      renderProviderStates();
      await loadApplePlaylists();
    } catch (error) {
      appleAuthorized = false;
      renderProviderStates();
      setStatus("Apple Music tidak dapat terhubung: " + (error.message || "periksa developer token, MusicKit setup, dan izin akun."), "error");
    }
  }

  async function fetchYouTubeTracks(playlist) {
    if (!youtubeAccessToken || Date.now() >= youtubeTokenExpiresAt) throw new Error("YouTube session expired. Reconnect your account and try again.");
    const tracks = [];
    let pageToken = "";
    let page = 0;
    do {
      const url = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
      url.searchParams.set("part", "snippet,contentDetails,status");
      url.searchParams.set("playlistId", playlist.id);
      url.searchParams.set("maxResults", "50");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const data = await fetchYouTubeJSON(url.toString(), youtubeAccessToken);
      (Array.isArray(data.items) ? data.items : []).forEach(item => {
        const snippet = item.snippet || {};
        const videoId = item.contentDetails?.videoId || snippet.resourceId?.videoId;
        if (!videoId || snippet.title === "Deleted video" || snippet.title === "Private video") return;
        tracks.push({
          id: String(videoId),
          sourceKey: "youtube::" + String(videoId),
          title: snippet.title || "Untitled video",
          artist: snippet.videoOwnerChannelTitle || "",
          artwork: snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url || "",
          url: "https://music.youtube.com/watch?v=" + encodeURIComponent(videoId)
        });
      });
      pageToken = data.nextPageToken || "";
      page += 1;
    } while (pageToken && page < 10);
    return tracks;
  }

  async function loadYouTubeTracks(playlist) {
    if (!youtubeAccessToken || Date.now() >= youtubeTokenExpiresAt) {
      pendingYoutubePlaylistId = playlist.id;
      setStatus("Reconnect akun YouTube untuk membaca lagu dalam playlist ini.", "info");
      connectYouTube();
      return;
    }
    try {
      setStatus("Mengambil lagu dari playlist YouTube…");
      const tracks = await fetchYouTubeTracks(playlist);
      renderPlaylistTracks(playlist, tracks);
      setStatus("Berhasil memuat " + tracks.length + " item playlist. Pemutaran tetap menggunakan layanan YouTube resmi.", "success");
    } catch (error) {
      setStatus("Tidak bisa membaca playlist YouTube: " + (error.message || "request gagal."), "error");
    }
  }

  async function fetchAppleTracks(playlist) {
    if (!appleMusic || !appleAuthorized) throw new Error("Apple Music session expired. Reconnect your account and try again.");
    const tracks = [];
    let offset = 0;
    while (tracks.length < 500) {
      const path = "/v1/me/library/playlists/" + encodeURIComponent(playlist.id) + "/tracks";
      const response = await appleMusic.api.music(path, { limit: 100, offset: offset });
      const body = response && response.data && response.data.data ? response.data : response;
      const rows = body && Array.isArray(body.data) ? body.data : [];
      rows.forEach(item => {
        const attributes = item.attributes || {};
        tracks.push({
          id: String(item.id),
          sourceKey: "apple::" + String(item.id),
          title: attributes.name || "Untitled track",
          artist: attributes.artistName || "",
          artwork: appleArtwork(attributes),
          url: attributes.url || playlist.url
        });
      });
      if (!rows.length || rows.length < 100) break;
      offset += rows.length;
    }
    return tracks;
  }

  async function loadAppleTracks(playlist) {
    if (!appleMusic || !appleAuthorized) {
      pendingApplePlaylistId = playlist.id;
      setStatus("Reconnect Apple Music untuk membaca lagu dalam playlist ini.", "info");
      void connectAppleMusic();
      return;
    }
    try {
      setStatus("Mengambil lagu dari playlist Apple Music…");
      const tracks = await fetchAppleTracks(playlist);
      renderPlaylistTracks(playlist, tracks);
      setStatus("Berhasil memuat " + tracks.length + " item playlist Apple Music. Pemutaran tetap ditangani Apple Music.", "success");
    } catch (error) {
      setStatus("Tidak bisa membaca playlist Apple Music: " + (error.message || "request gagal."), "error");
    }
  }

  function normalizedPlaylistKey(playlist) {
    return playlist.sourceKey || playlist.key || (playlist.provider + "::" + playlist.id);
  }

  async function importPlaylist(playlist, options = {}) {
    if (!playlist) return false;
    const key = normalizedPlaylistKey(playlist);
    const provider = playlist.provider;
    if (provider === "youtube" && (!youtubeAccessToken || Date.now() >= youtubeTokenExpiresAt)) {
      setStatus("Hubungkan ulang akun YouTube, lalu tekan Import to EUPHONIA sekali lagi.", "info");
      connectYouTube();
      return false;
    }
    if (provider === "apple" && (!appleMusic || !appleAuthorized)) {
      setStatus("Hubungkan ulang akun Apple Music, lalu tekan Import to EUPHONIA sekali lagi.", "info");
      void connectAppleMusic();
      return false;
    }
    try {
      setStatus((options.resync ? "Sinkronisasi ulang " : "Mengimpor ") + "playlist “" + (playlist.title || "Untitled playlist") + "”…");
      const tracks = provider === "youtube"
        ? await fetchYouTubeTracks(playlist)
        : await fetchAppleTracks(playlist);
      const existing = importedPlaylists[key];
      const currentRemoteKeys = tracks.map(track => track.sourceKey || (provider + "::" + track.id));
      let localTracks;
      let addedCount;
      if (existing && options.resync) {
        const previouslySeen = new Set(existing.lastRemoteTrackKeys || []);
        const locallyPresent = new Set((existing.tracks || []).map(track => track.sourceKey || (provider + "::" + track.id)));
        const newlyAvailable = tracks.filter(track => {
          const trackKey = track.sourceKey || (provider + "::" + track.id);
          return !previouslySeen.has(trackKey) && !locallyPresent.has(trackKey);
        });
        localTracks = [...(existing.tracks || []), ...newlyAvailable];
        addedCount = newlyAvailable.length;
      } else {
        localTracks = tracks;
        addedCount = tracks.length;
      }
      const imported = {
        key: key,
        sourceKey: key,
        provider: provider,
        providerName: playlist.providerName || providerTitle(provider),
        id: playlist.id,
        title: playlist.title || existing?.title || "Untitled playlist",
        description: playlist.description || existing?.description || "",
        artwork: playlist.artwork || existing?.artwork || "",
        url: playlist.url || existing?.url || "",
        visibility: playlist.visibility || existing?.visibility || "",
        tracks: localTracks,
        lastRemoteTrackKeys: currentRemoteKeys,
        importedAt: existing?.importedAt || new Date().toISOString(),
        lastSyncedAt: new Date().toISOString()
      };
      importedPlaylists[key] = imported;
      if (!persistImportedPlaylists()) return false;
      selectedPlaylistKeys.delete(key);
      const checkbox = $("[data-account-select=\"" + CSS.escape(key) + "\"]");
      if (checkbox) checkbox.checked = false;
      renderPlaylistGrid();
      const suffix = existing && options.resync
        ? " · " + addedCount + " track baru ditambahkan; track yang kamu hapus lokal tetap dihapus."
        : " · " + localTracks.length + " track disimpan ke koleksi lokal.";
      setStatus("Playlist “" + imported.title + "” berhasil " + (existing && options.resync ? "disinkronkan ulang" : "diimpor") + suffix, "success");
      return true;
    } catch (error) {
      setStatus("Impor playlist gagal: " + (error.message || "request gagal."), "error");
      return false;
    }
  }

  async function importSelectedPlaylists() {
    if (importingSelected || !selectedPlaylistKeys.size) return;
    const selected = allCachedPlaylists().filter(item => selectedPlaylistKeys.has(item.key));
    if (!selected.length) {
      selectedPlaylistKeys.clear();
      renderPlaylistGrid();
      setStatus("Pilih setidaknya satu playlist dari layanan yang terhubung.", "info");
      return;
    }
    importingSelected = true;
    renderPlaylistGrid();
    let completed = 0;
    const errors = [];
    for (const item of selected) {
      try {
        const providerReady = item.provider === "youtube"
          ? Boolean(youtubeAccessToken && Date.now() < youtubeTokenExpiresAt)
          : Boolean(appleMusic && appleAuthorized);
        if (!providerReady) {
          errors.push(item.title + ": connect akun " + providerTitle(item.provider) + " terlebih dahulu");
          continue;
        }
        const ok = await importPlaylist(item, { resync: Boolean(importedPlaylists[item.key]) });
        if (ok) completed++;
        else errors.push(item.title + ": import tidak selesai; periksa pesan status di atas");
      } catch (error) {
        errors.push(item.title + ": " + (error.message || "gagal"));
      }
    }
    importingSelected = false;
    renderPlaylistGrid();
    if (errors.length) setStatus("Proses selesai: " + completed + "/" + selected.length + " playlist diproses. " + errors.slice(0, 3).join(" · "), "error");
    else setStatus("Selesai mengimpor/menyinkronkan " + completed + " playlist ke koleksi lokal EUPHONIA.", "success");
  }

  function removeImportedTrack(playlist, track) {
    const key = normalizedPlaylistKey(playlist);
    const current = importedPlaylists[key];
    if (!current) return;
    const trackKey = track.sourceKey || (playlist.provider + "::" + track.id);
    current.tracks = (current.tracks || []).filter(item => (item.sourceKey || (playlist.provider + "::" + item.id)) !== trackKey);
    if (!persistImportedPlaylists()) return;
    renderPlaylistTracks({ ...current, importedLocal: true, key: key }, current.tracks);
    renderPlaylistGrid();
    setStatus("Track dihapus dari playlist lokal EUPHONIA. Track asal di layanan musik tidak diubah.", "success");
  }

  function ensureYouTubeIframeAPI() {
    if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
    if (youtubeApiPromise) return youtubeApiPromise;
    youtubeApiPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector("script[data-euphonia-youtube-player]");
      const script = existing || document.createElement("script");
      const timeout = window.setTimeout(() => reject(new Error("YouTube Player API timed out. Check your connection.")), 20000);
      const previousCallback = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        try { if (typeof previousCallback === "function") previousCallback(); } catch (_) {}
        window.clearTimeout(timeout);
        if (window.YT && window.YT.Player) resolve(window.YT);
        else reject(new Error("YouTube Player API loaded without a player constructor."));
      };
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      script.dataset.euphoniaYoutubePlayer = "true";
      script.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error("YouTube Player API could not load."));
      };
      if (!existing) document.head.append(script);
    }).catch(error => {
      youtubeApiPromise = null;
      throw error;
    });
    return youtubeApiPromise;
  }

  function currentAccountTrack() {
    return accountPlaybackQueue[accountPlaybackIndex] || null;
  }

  function updateAccountPlayerHeader(track) {
    const title = $("#accountNowPlayingTitle");
    const subtitle = $("#accountNowPlayingSubtitle");
    const button = $("#accountPlayerToggle");
    if (title) title.textContent = track?.title || "No track selected";
    if (subtitle) subtitle.textContent = (track?.artist || providerTitle(accountPlaybackProvider || "")) + " · Official service playback";
    if (button) button.textContent = "Ⅱ Pause";
  }

  function emitAccountQueueChange() {
    try {
      const safeQueue = accountPlaybackQueue.slice(0, 500).map(track => {
        const { queueIndex, active, ...metadata } = track || {};
        return metadata;
      });
      localStorage.setItem(ACCOUNT_QUEUE_KEY, JSON.stringify(safeQueue));
      localStorage.setItem(ACCOUNT_MODES_KEY, JSON.stringify({ shuffle: accountShuffleEnabled, repeat: accountRepeatMode }));
    } catch (_) {
      setStatus("Queue hanya tersimpan selama sesi ini karena browser menolak penyimpanan lokal.", "error");
    }
    const queue = accountPlaybackQueue.map((track, index) => ({ ...track, queueIndex: index, active: index === accountPlaybackIndex }));
    window.dispatchEvent(new CustomEvent("euphonia:account-queue-change", {
      detail: { queue, index: accountPlaybackIndex, shuffle: accountShuffleEnabled, repeat: accountRepeatMode }
    }));
    const shuffle = $("#accountPlayerShuffle");
    if (shuffle) {
      shuffle.textContent = accountShuffleEnabled ? "⤨ Shuffle on" : "⤨ Shuffle";
      shuffle.classList.toggle("is-active", accountShuffleEnabled);
      shuffle.setAttribute("aria-pressed", String(accountShuffleEnabled));
    }
    const repeat = $("#accountPlayerRepeat");
    if (repeat) {
      repeat.textContent = accountRepeatMode === "one" ? "↻ Repeat one" : accountRepeatMode === "all" ? "↻ Repeat all" : "↻ Repeat off";
      repeat.classList.toggle("is-active", accountRepeatMode !== "off");
      repeat.setAttribute("aria-pressed", String(accountRepeatMode !== "off"));
    }
  }

  function advanceAccountQueue(direction, naturalEnd = false) {
    if (!accountPlaybackQueue.length) return;
    if (naturalEnd && accountRepeatMode === "one" && accountPlaybackIndex >= 0) {
      void playAccountQueueIndex(accountPlaybackIndex);
      return;
    }
    if (direction > 0 && accountShuffleEnabled && accountPlaybackQueue.length > 1) {
      let next = accountPlaybackIndex;
      while (next === accountPlaybackIndex) next = Math.floor(Math.random() * accountPlaybackQueue.length);
      void playAccountQueueIndex(next);
      return;
    }
    let next = accountPlaybackIndex + direction;
    if (next < 0 || next >= accountPlaybackQueue.length) {
      if (naturalEnd && accountRepeatMode !== "all") {
        const toggle = $("#accountPlayerToggle");
        if (toggle) toggle.textContent = "▶ Play";
        setStatus("Queue selesai. Tekan Next untuk memulai lagi, atau aktifkan Repeat all.", "info");
        return;
      }
      if (naturalEnd && accountRepeatMode === "all") next = (next + accountPlaybackQueue.length) % accountPlaybackQueue.length;
      else next = (next + accountPlaybackQueue.length) % accountPlaybackQueue.length;
    }
    void playAccountQueueIndex(next);
  }

  async function playAccountQueueIndex(index) {
    const track = accountPlaybackQueue[index];
    if (!track) return;
    const nextProvider = track.provider || accountPlaybackProvider;
    if (accountPlaybackProvider === "youtube" && nextProvider !== "youtube" && youtubePlayer && typeof youtubePlayer.stopVideo === "function") {
      try { youtubePlayer.stopVideo(); } catch (_) {}
    }
    if (accountPlaybackProvider === "apple" && nextProvider !== "apple" && appleMusic && appleAuthorized) {
      try { await appleMusic.pause(); } catch (_) {}
    }
    accountPlaybackIndex = index;
    accountPlaybackProvider = nextProvider;
    emitAccountQueueChange();
    window.dispatchEvent(new Event("euphonia:account-playback-start"));
    const panel = $("#accountNowPlaying");
    const youtubeWrap = $("#accountYouTubePlayerWrap");
    const appleStatus = $("#accountApplePlayerStatus");
    if (panel) panel.hidden = false;
    if (youtubeWrap) youtubeWrap.hidden = accountPlaybackProvider !== "youtube";
    if (appleStatus) appleStatus.hidden = accountPlaybackProvider !== "apple";
    updateAccountPlayerHeader(track);
    window.dispatchEvent(new CustomEvent("euphonia:account-track-change", {
      detail: { track: { ...track, provider: accountPlaybackProvider, providerName: track.providerName || providerTitle(accountPlaybackProvider) }, index: accountPlaybackIndex }
    }));

    if (accountPlaybackProvider === "youtube") {
      try {
        const YT = await ensureYouTubeIframeAPI();
        if (!track.id) throw new Error("This YouTube playlist item has no video ID.");
        if (youtubePlayer && typeof youtubePlayer.loadVideoById === "function") {
          youtubePlayer.loadVideoById({ videoId: track.id });
          return;
        }
        youtubePlayer = new YT.Player("accountYouTubePlayer", {
          height: "250",
          width: "100%",
          videoId: track.id,
          playerVars: {
            playsinline: 1,
            origin: window.location.origin,
            rel: 0
          },
          events: {
            onReady: event => {
              event.target.playVideo();
            },
            onStateChange: event => {
              if (event.data === YT.PlayerState.ENDED && accountPlaybackProvider === "youtube") {
                advanceAccountQueue(1, true);
              }
              if (event.data === YT.PlayerState.PLAYING) {
                window.dispatchEvent(new CustomEvent("euphonia:account-playback-started", { detail: { track: currentAccountTrack() } }));
              }
              const button = $("#accountPlayerToggle");
              if (button) button.textContent = event.data === YT.PlayerState.PLAYING ? "Ⅱ Pause" : "▶ Play";
            },
            onError: () => setStatus("YouTube tidak dapat memainkan video ini di player tertanam. Gunakan Open source untuk membukanya di layanan resmi.", "error")
          }
        });
      } catch (error) {
        setStatus("Pemutar YouTube gagal disiapkan: " + (error.message || "unknown error"), "error");
      }
      return;
    }

    if (accountPlaybackProvider === "apple") {
      if (!appleMusic || !appleAuthorized) {
        setStatus("Hubungkan dan beri izin Apple Music sebelum memulai playback.", "error");
        return;
      }
      try {
        applePlaybackBusy = true;
        try {
          if (track.url) await appleMusic.setQueue({ url: track.url });
          else await appleMusic.setQueue({ song: track.id });
        } catch (queueError) {
          if (!track.id || !track.url) throw queueError;
          await appleMusic.setQueue({ song: track.id });
        }
        await appleMusic.play();
        applePlaybackBusy = false;
        window.dispatchEvent(new CustomEvent("euphonia:account-playback-started", { detail: { track: currentAccountTrack() } }));
        setStatus("Memutar lewat MusicKit resmi Apple Music. Ketersediaan bergantung pada langganan dan izin akun.", "success");
        const button = $("#accountPlayerToggle");
        if (button) button.textContent = "Ⅱ Pause";
      } catch (error) {
        applePlaybackBusy = false;
        setStatus("Apple Music tidak dapat memutar track ini: " + (error.message || "cek langganan, izin, dan URL track."), "error");
      }
    }
  }

  function playTrackFromPlaylist(playlist, tracks, index) {
    const provider = playlist.provider;
    if (!["youtube", "apple"].includes(provider)) {
      setStatus("Pemutaran di dalam EUPHONIA tersedia untuk YouTube dan Apple Music yang terhubung. Gunakan Open source untuk provider lain.", "info");
      return;
    }
    accountPlaybackQueue = tracks.map(track => ({ ...track, provider, providerName: track.providerName || providerTitle(provider) }));
    emitAccountQueueChange();
    void playAccountQueueIndex(index);
  }

  function closeAccountPlayback() {
    if (youtubePlayer && typeof youtubePlayer.stopVideo === "function") {
      try { youtubePlayer.stopVideo(); } catch (_) {}
    }
    if (appleMusic && appleAuthorized) {
      try { void appleMusic.pause().catch(() => {}); } catch (_) {}
    }
    const panel = $("#accountNowPlaying");
    if (panel) panel.hidden = true;
  }

  function renderPlaylistTracks(playlist, tracks) {
    activePlaylistDetailKey = playlist.key;
    const panel = $("#accountPlaylistDetail");
    const title = $("#accountPlaylistDetailTitle");
    const subtitle = $("#accountPlaylistDetailSubtitle");
    const host = $("#accountPlaylistTracks");
    if (!panel || !host) return;
    if (title) title.textContent = playlist.title || "Playlist details";
    if (subtitle) subtitle.textContent = (playlist.providerName || providerTitle(playlist.provider)) + " · " + tracks.length + " item";
    host.replaceChildren();
    if (!tracks.length) {
      const empty = document.createElement("div");
      empty.className = "account-empty-state compact";
      empty.textContent = "Playlist terbaca, tetapi itemnya kosong atau tidak tersedia lewat API ini.";
      host.append(empty);
    } else {
      tracks.forEach((track, index) => {
        const row = document.createElement("article");
        row.className = "account-track-row";
        const number = document.createElement("span");
        number.className = "account-track-number";
        number.textContent = String(index + 1).padStart(2, "0");
        const art = document.createElement("div");
        art.className = "account-track-art";
        if (track.artwork) {
          const image = document.createElement("img");
          image.loading = "lazy";
          image.alt = "";
          image.src = track.artwork;
          image.addEventListener("error", () => image.remove(), { once: true });
          art.append(image);
        } else art.textContent = "♫";
        const textBox = document.createElement("div");
        textBox.className = "account-track-text";
        const trackTitle = document.createElement("strong");
        trackTitle.textContent = track.title || "Untitled track";
        const artist = document.createElement("small");
        artist.textContent = track.artist || playlist.providerName || providerTitle(playlist.provider);
        textBox.append(trackTitle, artist);
        const actions = document.createElement("div");
        actions.className = "account-track-actions";
        const accountTrack = { ...track, provider: playlist.provider, providerName: playlist.providerName || providerTitle(playlist.provider), playlistTitle: playlist.title || "" };
        if (["youtube", "apple"].includes(playlist.provider)) {
          actions.append(createButton("Play here", "primary-button small-account-button", () => playTrackFromPlaylist(playlist, tracks, index)));
          actions.append(createButton("＋ Queue", "outline-button small-account-button", () => window.EUPHONIA_ACCOUNT_MUSIC?.enqueueTrack(accountTrack)));
        }
        const favoriteButton = createButton(window.EUPHONIA_MUSICFY?.isFavorite(accountTrack) ? "♥ Saved" : "♡ Favorite", "outline-button small-account-button", () => window.EUPHONIA_MUSICFY?.toggleFavorite(accountTrack));
        favoriteButton.dataset.musicfyFavoriteKey = (accountTrack.provider || "") + "::" + String(accountTrack.id || accountTrack.sourceKey || accountTrack.url || "");
        favoriteButton.setAttribute("aria-pressed", String(Boolean(window.EUPHONIA_MUSICFY?.isFavorite(accountTrack))));
        actions.append(favoriteButton);
        actions.append(createExternalLink("Open source ↗", track.url, "outline-button small-account-button"));
        if (playlist.importedLocal) actions.append(createButton("Remove local", "text-button small-account-button", () => removeImportedTrack(playlist, track)));
        row.append(number, art, textBox, actions);
        host.append(row);
      });
    }
    panel.hidden = false;
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function viewPlaylist(playlist) {
    if (!playlist) return;
    if (playlist.importedLocal) {
      renderPlaylistTracks(playlist, playlist.tracks || []);
      setStatus("Membuka koleksi playlist yang disimpan lokal di EUPHONIA. Klik Open source untuk pemutaran resmi.", "success");
      return;
    }
    if (playlist.provider === "youtube") {
      if (!youtubeAccessToken || Date.now() >= youtubeTokenExpiresAt) {
        pendingYoutubePlaylistId = playlist.id;
        setStatus("Untuk mengambil item playlist, hubungkan ulang akun YouTube terlebih dahulu.", "info");
        connectYouTube();
        return;
      }
      try { await loadYouTubeTracks(playlist); }
      catch (error) { setStatus("Tidak bisa mengambil item playlist YouTube: " + error.message, "error"); }
      return;
    }
    if (playlist.provider === "apple") {
      if (!appleMusic || !appleAuthorized) {
        pendingApplePlaylistId = playlist.id;
        setStatus("Untuk mengambil item playlist, hubungkan ulang Apple Music terlebih dahulu.", "info");
        void connectAppleMusic();
        return;
      }
      try { await loadAppleTracks(playlist); }
      catch (error) { setStatus("Tidak bisa mengambil item playlist Apple Music: " + error.message, "error"); }
    }
  }

  function disconnectProvider(provider) {
    if (provider === "youtube") {
      const token = youtubeAccessToken;
      youtubeAccessToken = null;
      youtubeTokenExpiresAt = 0;
      if (token) {
        fetch("https://oauth2.googleapis.com/revoke", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "token=" + encodeURIComponent(token)
        }).catch(() => {});
      }
    } else if (provider === "apple") {
      if (appleMusic && appleAuthorized && typeof appleMusic.unauthorize === "function") {
        try { void appleMusic.unauthorize(); } catch (_) {}
      }
      appleMusic = null;
      appleConfiguredToken = "";
      appleAuthorized = false;
    }
    delete cache[provider];
    for (const key of selectedPlaylistKeys) if (key.startsWith(provider + "::")) selectedPlaylistKeys.delete(key);
    writePlaylistCache();
    if (activePlaylistDetailKey && activePlaylistDetailKey.startsWith(provider + "::")) {
      $("#accountPlaylistDetail").hidden = true;
      activePlaylistDetailKey = null;
    }
    renderProviderStates();
    renderPlaylistGrid();
    setStatus(providerTitle(provider) + " disconnected from this EUPHONIA session. Cached playlist metadata was cleared.", "success");
  }

  window.EUPHONIA_ACCOUNT_MUSIC = Object.freeze({
    getQueue: () => accountPlaybackQueue.map((track, index) => ({ ...track, queueIndex: index, active: index === accountPlaybackIndex })),
    getCurrentTrack: () => {
      const track = currentAccountTrack();
      return track ? { ...track, provider: track.provider || accountPlaybackProvider, providerName: track.providerName || providerTitle(track.provider || accountPlaybackProvider || "") } : null;
    },
    getPlaybackTime: () => {
      try {
        if (accountPlaybackProvider === "youtube" && youtubePlayer && typeof youtubePlayer.getCurrentTime === "function") {
          const value = Number(youtubePlayer.getCurrentTime());
          return Number.isFinite(value) ? value : null;
        }
        if (accountPlaybackProvider === "apple" && appleMusic?.player) {
          const value = Number(appleMusic.player.currentPlaybackTime);
          return Number.isFinite(value) ? value : null;
        }
      } catch (_) {}
      return null;
    },
    getPlaybackDuration: () => {
      try {
        if (accountPlaybackProvider === "youtube" && youtubePlayer && typeof youtubePlayer.getDuration === "function") {
          const value = Number(youtubePlayer.getDuration());
          return Number.isFinite(value) && value > 0 ? value : null;
        }
        if (accountPlaybackProvider === "apple" && appleMusic?.player) {
          const value = Number(appleMusic.player.currentPlaybackDuration);
          return Number.isFinite(value) && value > 0 ? value : null;
        }
      } catch (_) {}
      return null;
    },
    seekTo: seconds => {
      const value = Math.max(0, Number(seconds) || 0);
      try {
        if (accountPlaybackProvider === "youtube" && youtubePlayer && typeof youtubePlayer.seekTo === "function") {
          youtubePlayer.seekTo(value, true);
          return Promise.resolve();
        }
        if (accountPlaybackProvider === "apple" && appleMusic?.player && typeof appleMusic.player.seekToTime === "function") {
          return appleMusic.player.seekToTime(value);
        }
      } catch (error) {
        return Promise.reject(error);
      }
      return Promise.reject(new Error("Seek belum tersedia sampai pemutar account siap."));
    },
    getPlaybackVolume: () => {
      try {
        if (accountPlaybackProvider === "youtube" && youtubePlayer && typeof youtubePlayer.getVolume === "function") {
          const value = Number(youtubePlayer.getVolume());
          return Number.isFinite(value) ? value / 100 : null;
        }
        if (accountPlaybackProvider === "apple" && appleMusic?.player) {
          const value = Number(appleMusic.player.volume);
          return Number.isFinite(value) ? value : null;
        }
      } catch (_) {}
      return null;
    },
    setPlaybackVolume: level => {
      const value = Math.max(0, Math.min(1, Number(level) || 0));
      try {
        if (accountPlaybackProvider === "youtube" && youtubePlayer && typeof youtubePlayer.setVolume === "function") {
          youtubePlayer.setVolume(Math.round(value * 100));
          return true;
        }
        if (accountPlaybackProvider === "apple" && appleMusic?.player) {
          appleMusic.player.volume = value;
          return true;
        }
      } catch (_) {}
      return false;
    },
    getModes: () => ({ shuffle: accountShuffleEnabled, repeat: accountRepeatMode }),
    isProviderReady: provider => provider === "youtube"
      ? Boolean(youtubeAccessToken && Date.now() < youtubeTokenExpiresAt)
      : provider === "apple" ? Boolean(appleMusic && appleAuthorized) : false,
    playQueue: (tracks, index = 0) => {
      const nextQueue = (Array.isArray(tracks) ? tracks : []).map(track => ({ ...track, provider: track.provider || "youtube", providerName: track.providerName || providerTitle(track.provider || "youtube") }))
        .filter(track => ["youtube", "apple"].includes(track.provider) && (track.id || track.url));
      if (!nextQueue.length) {
        setStatus("Tidak ada track yang bisa diputar di queue.", "info");
        return;
      }
      accountPlaybackQueue = nextQueue;
      accountPlaybackIndex = -1;
      emitAccountQueueChange();
      const safeIndex = Math.max(0, Math.min(nextQueue.length - 1, Number(index) || 0));
      void playAccountQueueIndex(safeIndex);
    },
    enqueueTrack: track => {
      if (!track || !["youtube", "apple"].includes(track.provider)) {
        setStatus("Queue hanya menerima track dari YouTube Music atau Apple Music.", "info");
        return;
      }
      const normalized = { ...track, providerName: track.providerName || providerTitle(track.provider) };
      accountPlaybackQueue.push(normalized);
      const index = accountPlaybackQueue.length - 1;
      emitAccountQueueChange();
      setStatus("Ditambahkan ke queue: " + (normalized.title || "Untitled track") + ".", "success");
      if (accountPlaybackIndex < 0) void playAccountQueueIndex(index);
    },
    advanceQueue: direction => advanceAccountQueue(direction < 0 ? -1 : 1, false),
    toggleShuffle: () => {
      accountShuffleEnabled = !accountShuffleEnabled;
      emitAccountQueueChange();
      return accountShuffleEnabled;
    },
    cycleRepeat: () => {
      accountRepeatMode = accountRepeatMode === "off" ? "all" : accountRepeatMode === "all" ? "one" : "off";
      emitAccountQueueChange();
      return accountRepeatMode;
    },
    removeQueueItem: index => {
      if (!Number.isInteger(index) || index < 0 || index >= accountPlaybackQueue.length) return;
      const removedCurrent = index === accountPlaybackIndex;
      accountPlaybackQueue.splice(index, 1);
      if (!accountPlaybackQueue.length) {
        accountPlaybackIndex = -1;
        closeAccountPlayback();
        emitAccountQueueChange();
        return;
      }
      if (index < accountPlaybackIndex) accountPlaybackIndex -= 1;
      else if (removedCurrent) {
        const next = Math.min(index, accountPlaybackQueue.length - 1);
        accountPlaybackIndex = -1;
        void playAccountQueueIndex(next);
      } else emitAccountQueueChange();
    },
    moveQueueItem: (from, to) => {
      if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= accountPlaybackQueue.length || to >= accountPlaybackQueue.length || from === to) return;
      const [item] = accountPlaybackQueue.splice(from, 1);
      accountPlaybackQueue.splice(to, 0, item);
      if (accountPlaybackIndex === from) accountPlaybackIndex = to;
      else if (from < accountPlaybackIndex && to >= accountPlaybackIndex) accountPlaybackIndex -= 1;
      else if (from > accountPlaybackIndex && to <= accountPlaybackIndex) accountPlaybackIndex += 1;
      emitAccountQueueChange();
    },
    clearQueue: () => {
      closeAccountPlayback();
      accountPlaybackQueue = [];
      accountPlaybackIndex = -1;
      accountPlaybackProvider = null;
      emitAccountQueueChange();
      setStatus("Queue dikosongkan.", "success");
    }
  });

  function helpOtherProvider(provider) {
    const messages = {
      soundcloud: "SoundCloud mendukung playlist akun melalui OAuth 2.1, tetapi token endpoint resminya memerlukan client secret. Jangan masukkan secret ke browser atau commit ke GitHub. Integrasi ini butuh backend OAuth kecil yang menyimpan secret sebagai environment variable.",
      deezer: "Deezer menyediakan API playlist dan OAuth untuk aplikasi yang disetujui/terdaftar. Integrasi akun belum diaktifkan di build ini; jangan anggap kartu ini sudah tersambung.",
      bandcamp: "API resmi Bandcamp ditujukan untuk akun label dan partner pemenuhan merchandise, bukan endpoint umum untuk mengambil playlist/collection akun pendengar.",
      spotify: "Spotify tetap dibuka pada layanan resminya. Kebijakan developer Spotify melarang integrasi konten/stream Spotify dengan konten layanan lain, sehingga playlist Spotify tidak digabung dalam tampilan lintas layanan ini."
    };
    setStatus(messages[provider] || "Integrasi ini belum tersedia.", "info");
  }

  function initSettings() {
    const appleInput = $("#accountAppleDeveloperToken");
    if (appleInput) appleInput.value = savedAppleDeveloperToken();

    const toggle = $("#accountSetupToggle");
    if (toggle) toggle.addEventListener("click", () => {
      const panel = $("#accountSetup");
      if (!panel) return;
      panel.hidden = !panel.hidden;
      toggle.setAttribute("aria-expanded", String(!panel.hidden));
    });

    const save = $("#saveAccountConfig");
    if (save) save.addEventListener("click", () => {
      if (!storeConfig()) return;
      const tokenSet = Boolean((appleInput?.value || "").trim());
      setStatus(tokenSet
        ? "Apple Music developer token disimpan hanya untuk tab ini. Google sign-in dikonfigurasi oleh pemilik aplikasi dan tidak perlu diatur oleh pengguna."
        : "Pengaturan tersimpan. Pengguna bisa memakai Continue with Google; Apple Music memerlukan developer token bila ingin dihubungkan.", "success");
      $("#accountSetup").hidden = true;
      if (toggle) toggle.setAttribute("aria-expanded", "false");
    });

    const clear = $("#clearAccountConfig");
    if (clear) clear.addEventListener("click", () => {
      try { sessionStorage.removeItem(APPLE_TOKEN_KEY); } catch (_) {}
      if (appleInput) appleInput.value = "";
      setStatus("Apple Music developer token dihapus dari tab ini. Pengaturan Google aplikasi tidak diubah.", "success");
    });
  }

  function initListeners() {
    $$("[data-account-connect]").forEach(button => {
      button.addEventListener("click", () => {
        const provider = button.dataset.accountConnect;
        if (provider === "youtube") connectYouTube();
        else if (provider === "apple") void connectAppleMusic();
      });
    });
    $$("[data-account-disconnect]").forEach(button => {
      button.addEventListener("click", () => disconnectProvider(button.dataset.accountDisconnect));
    });
    $$("[data-account-help]").forEach(button => {
      button.addEventListener("click", () => helpOtherProvider(button.dataset.accountHelp));
    });
    $("#accountPlaylistSearch")?.addEventListener("input", renderPlaylistGrid);
    $("#accountPlaylistFilter")?.addEventListener("change", () => {
      if ($("#accountPlaylistFilter")?.value === "imported") selectedPlaylistKeys.clear();
      renderPlaylistGrid();
    });
    $("#accountPlaylistGrid")?.addEventListener("change", event => {
      const checkbox = event.target.closest("[data-account-select]");
      if (!checkbox) return;
      if (checkbox.checked) selectedPlaylistKeys.add(checkbox.dataset.accountSelect);
      else selectedPlaylistKeys.delete(checkbox.dataset.accountSelect);
      renderSelectionControls(allCachedPlaylists().filter(item => {
        const query = ($("#accountPlaylistSearch")?.value || "").trim().toLocaleLowerCase();
        const filter = $("#accountPlaylistFilter")?.value || "all";
        return filter !== "imported" && (filter === "all" || item.provider === filter) &&
          [item.title, item.description, item.providerName, item.visibility].filter(Boolean).join(" ").toLocaleLowerCase().includes(query);
      }));
      const importButton = $("#accountImportSelected");
      if (importButton) importButton.textContent = "Import selected (" + selectedPlaylistKeys.size + ")";
    });
    $("#accountSelectVisible")?.addEventListener("click", () => {
      const query = ($("#accountPlaylistSearch")?.value || "").trim().toLocaleLowerCase();
      const filter = $("#accountPlaylistFilter")?.value || "all";
      const visible = allCachedPlaylists().filter(item => filter !== "imported" && (filter === "all" || item.provider === filter) &&
        [item.title, item.description, item.providerName, item.visibility].filter(Boolean).join(" ").toLocaleLowerCase().includes(query));
      const allSelected = visible.length > 0 && visible.every(item => selectedPlaylistKeys.has(item.key));
      visible.forEach(item => allSelected ? selectedPlaylistKeys.delete(item.key) : selectedPlaylistKeys.add(item.key));
      renderPlaylistGrid();
    });
    $("#accountImportSelected")?.addEventListener("click", () => void importSelectedPlaylists());
    $("#accountRefreshAll")?.addEventListener("click", async () => {
      const jobs = [];
      if (youtubeAccessToken && Date.now() < youtubeTokenExpiresAt) jobs.push(() => loadYouTubePlaylists(youtubeAccessToken));
      if (appleMusic && appleAuthorized) jobs.push(() => loadApplePlaylists());
      if (!jobs.length) {
        setStatus("Belum ada sesi akun aktif. Hubungkan YouTube Music atau Apple Music untuk sinkronisasi.", "info");
        return;
      }
      let completed = 0;
      for (const job of jobs) {
        try { await job(); completed += 1; }
        catch (error) { setStatus("Sinkronisasi salah satu layanan gagal: " + (error.message || "request gagal."), "error"); }
      }
      if (completed) setStatus("Sinkronisasi selesai untuk " + completed + " layanan yang terhubung.", "success");
    });
    $("#accountPlaylistGrid")?.addEventListener("click", event => {
      const button = event.target.closest("[data-view-playlist]");
      if (!button) return;
      const key = button.dataset.viewPlaylist;
      const playlist = allCachedPlaylists().find(item => item.key === key);
      if (playlist) void viewPlaylist(playlist);
    });
    $("#accountPlaylistDetailBack")?.addEventListener("click", () => {
      $("#accountPlaylistDetail").hidden = true;
      activePlaylistDetailKey = null;
      $("#accountPlaylistGrid")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    $("#accountPlayerPrevious")?.addEventListener("click", () => advanceAccountQueue(-1, false));
    $("#accountPlayerNext")?.addEventListener("click", () => advanceAccountQueue(1, false));
    $("#accountPlayerToggle")?.addEventListener("click", () => {
      if (accountPlaybackProvider === "youtube" && youtubePlayer) {
        try {
          if (youtubePlayer.getPlayerState() === 1) youtubePlayer.pauseVideo();
          else youtubePlayer.playVideo();
        } catch (_) {}
      } else if (accountPlaybackProvider === "apple" && appleMusic && appleAuthorized && !applePlaybackBusy) {
        const player = appleMusic.player;
        const isPlaying = player && (player.isPlaying || player.playbackState === window.MusicKit?.PlaybackStates?.PLAYING);
        if (isPlaying) void appleMusic.pause().then(() => { $("#accountPlayerToggle").textContent = "▶ Play"; }).catch(error => setStatus(error.message || "Tidak dapat menjeda Apple Music.", "error"));
        else void appleMusic.play().then(() => { $("#accountPlayerToggle").textContent = "Ⅱ Pause"; }).catch(error => setStatus(error.message || "Tidak dapat memutar Apple Music.", "error"));
      }
    });
    $("#accountPlayerClose")?.addEventListener("click", closeAccountPlayback);
    window.addEventListener("euphonia:filter-playlists", event => {
      const query = event.detail && event.detail.query ? String(event.detail.query) : "";
      const input = $("#accountPlaylistSearch");
      if (input) input.value = query;
      if ($("#accountPlaylistFilter")) $("#accountPlaylistFilter").value = "all";
      renderPlaylistGrid();
      setStatus(query ? "Memfilter playlist akun dengan kata kunci: " + query : "Menampilkan semua playlist akun yang tersimpan di browser.", "info");
    });
  }

  window.addEventListener("euphonia:local-audio-start", closeAccountPlayback);
  window.addEventListener("euphonia:account-playback-start", () => {
    const localAudio = document.getElementById("audioPlayer");
    if (localAudio) localAudio.pause();
    const legacyPreview = document.getElementById("hubPreviewAudio");
    if (legacyPreview) legacyPreview.pause();
    const daw = window.EUPHONIA_DAW;
    if (daw && typeof daw.pause === "function") {
      try { daw.pause(); } catch (_) {}
    }
  });

  function init() {
    if (!Array.isArray(accountPlaybackQueue)) accountPlaybackQueue = [];
    accountPlaybackQueue = accountPlaybackQueue
      .filter(track => track && ["youtube", "apple"].includes(track.provider) && (track.id || track.url))
      .slice(0, 500);
    accountPlaybackIndex = -1;
    accountPlaybackProvider = null;
    initSettings();
    initListeners();
    renderProviderStates();
    renderPlaylistGrid();
    emitAccountQueueChange();
    loadMusicKit().catch(() => {});
    window.dispatchEvent(new CustomEvent("euphonia:accounts-ready"));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();