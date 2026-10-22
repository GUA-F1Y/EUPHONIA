(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const CONFIG_KEY = "euphonia.musicHub.accountConfig.v1";
  const CACHE_KEY = "euphonia.musicHub.accountPlaylists.v1";
  const APPLE_TOKEN_KEY = "euphonia.musicHub.appleDeveloperToken.session";
  const YOUTUBE_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";

  let config = readJSON(localStorage, CONFIG_KEY, {});
  let cache = readJSON(localStorage, CACHE_KEY, {});
  let youtubeAccessToken = null;
  let youtubeTokenExpiresAt = 0;
  let appleMusic = null;
  let appleConfiguredToken = "";
  let appleAuthorized = false;
  let musicKitPromise = null;
  let pendingYoutubePlaylistId = null;
  let pendingApplePlaylistId = null;
  let activePlaylistDetailKey = null;

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
      localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
      sessionStorage.setItem(APPLE_TOKEN_KEY, $("#accountAppleDeveloperToken").value.trim());
      return true;
    } catch (_) {
      setStatus("Browser menolak menyimpan pengaturan. Periksa pengaturan privasi atau ruang penyimpanan.", "error");
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
        connectButton.textContent = "Reconnect account";
        stateNode.dataset.connected = "false";
      } else {
        stateNode.textContent = "Belum terhubung";
        connectButton.textContent = "Connect account";
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

  function renderPlaylistGrid() {
    const host = $("#accountPlaylistGrid");
    const countNode = $("#accountPlaylistCount");
    if (!host) return;
    const query = ($("#accountPlaylistSearch")?.value || "").trim().toLocaleLowerCase();
    const filter = $("#accountPlaylistFilter")?.value || "all";
    const all = allCachedPlaylists();
    const filtered = all.filter(item => {
      if (filter !== "all" && item.provider !== filter) return false;
      const searchText = [item.title, item.description, item.providerName, item.visibility].filter(Boolean).join(" ").toLocaleLowerCase();
      return !query || searchText.includes(query);
    });
    if (countNode) countNode.textContent = filtered.length + " / " + all.length + " PLAYLISTS";
    host.replaceChildren();
    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.className = "account-empty-state";
      const icon = document.createElement("span");
      icon.className = "account-empty-icon";
      icon.textContent = "♫";
      const title = document.createElement("strong");
      title.textContent = all.length ? "No matching playlists" : "Your playlists will appear here";
      const description = document.createElement("p");
      description.textContent = all.length
        ? "Coba kata kunci lain atau pilih All services."
        : "Hubungkan YouTube Music atau Apple Music untuk mengambil daftar playlist dari akunmu. Data yang tersimpan di sini hanya cache metadata playlist di browser ini.";
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
      tracks.textContent = countLabel(item);
      const visibility = document.createElement("span");
      visibility.textContent = item.visibility ? item.visibility : "Account library";
      meta.append(tracks, visibility);
      body.append(service, title, description, meta);
      const actions = document.createElement("div");
      actions.className = "account-playlist-actions";
      const view = createButton("View tracks", "primary-button small-account-button", () => void viewPlaylist(item));
      actions.append(view, createExternalLink("Open source ↗", item.url, "outline-button small-account-button"));
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
    const clientId = String(config.googleClientId || "").trim();
    if (!clientId) {
      setStatus("Masukkan Google OAuth Web Client ID terlebih dahulu. API key publik saja tidak cukup untuk membaca playlist privat akunmu.", "error");
      openSetup("#accountGoogleClientId");
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
      tokenClient.requestAccessToken({ prompt: "consent" });
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
      renderProviderStates();
      await loadApplePlaylists();
    } catch (error) {
      appleAuthorized = false;
      renderProviderStates();
      setStatus("Apple Music tidak dapat terhubung: " + (error.message || "periksa developer token, MusicKit setup, dan izin akun."), "error");
    }
  }

  async function loadYouTubeTracks(playlist) {
    if (!youtubeAccessToken || Date.now() >= youtubeTokenExpiresAt) {
      pendingYoutubePlaylistId = playlist.id;
      connectYouTube();
      return;
    }
    setStatus("Mengambil lagu dari playlist YouTube…");
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
          title: snippet.title || "Untitled video",
          artist: snippet.videoOwnerChannelTitle || "",
          artwork: snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url || "",
          url: "https://music.youtube.com/watch?v=" + encodeURIComponent(videoId),
          id: videoId
        });
      });
      pageToken = data.nextPageToken || "";
      page += 1;
    } while (pageToken && page < 10);
    renderPlaylistTracks(playlist, tracks);
    setStatus("Berhasil memuat " + tracks.length + " item playlist. Tekan Open source untuk mendengarkan lewat layanan resmi.", "success");
  }

  async function loadAppleTracks(playlist) {
    if (!appleMusic || !appleAuthorized) {
      pendingApplePlaylistId = playlist.id;
      void connectAppleMusic();
      return;
    }
    setStatus("Mengambil lagu dari playlist Apple Music…");
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
          title: attributes.name || "Untitled track",
          artist: attributes.artistName || "",
          artwork: appleArtwork(attributes),
          url: attributes.url || playlist.url,
          id: item.id
        });
      });
      if (!rows.length || rows.length < 100) break;
      offset += rows.length;
    }
    renderPlaylistTracks(playlist, tracks);
    setStatus("Berhasil memuat " + tracks.length + " item playlist Apple Music. Pemutaran tetap ditangani Apple Music.", "success");
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
        const link = createExternalLink("Open source ↗", track.url, "outline-button small-account-button");
        row.append(number, art, textBox, link);
        host.append(row);
      });
    }
    panel.hidden = false;
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function viewPlaylist(playlist) {
    if (!playlist) return;
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
    writePlaylistCache();
    if (activePlaylistDetailKey && activePlaylistDetailKey.startsWith(provider + "::")) {
      $("#accountPlaylistDetail").hidden = true;
      activePlaylistDetailKey = null;
    }
    renderProviderStates();
    renderPlaylistGrid();
    setStatus(providerTitle(provider) + " disconnected from this EUPHONIA session. Cached playlist metadata was cleared.", "success");
  }

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
    const googleInput = $("#accountGoogleClientId");
    const appleInput = $("#accountAppleDeveloperToken");
    if (googleInput) googleInput.value = config.googleClientId || "";
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
      config.googleClientId = (googleInput?.value || "").trim();
      if (!storeConfig()) return;
      setStatus("Pengaturan tersimpan. Google Client ID disimpan di browser ini; Apple developer token hanya disimpan selama sesi tab ini.", "success");
      $("#accountSetup").hidden = true;
      if (toggle) toggle.setAttribute("aria-expanded", "false");
    });
    const clear = $("#clearAccountConfig");
    if (clear) clear.addEventListener("click", () => {
      config = {};
      try {
        localStorage.removeItem(CONFIG_KEY);
        sessionStorage.removeItem(APPLE_TOKEN_KEY);
      } catch (_) {}
      if (googleInput) googleInput.value = "";
      if (appleInput) appleInput.value = "";
      setStatus("Pengaturan koneksi dihapus dari browser ini. Koneksi akun yang sedang aktif tidak otomatis dicabut.", "success");
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
    $("#accountPlaylistFilter")?.addEventListener("change", renderPlaylistGrid);
    $("#accountRefreshAll")?.addEventListener("click", () => {
      if (youtubeAccessToken && Date.now() < youtubeTokenExpiresAt) void loadYouTubePlaylists(youtubeAccessToken).catch(error => setStatus(error.message, "error"));
      else if (appleMusic && appleAuthorized) void loadApplePlaylists().catch(error => setStatus(error.message, "error"));
      else setStatus("Belum ada sesi akun aktif. Pilih Connect account pada YouTube Music atau Apple Music untuk sinkronisasi.", "info");
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
    window.addEventListener("euphonia:filter-playlists", event => {
      const query = event.detail && event.detail.query ? String(event.detail.query) : "";
      const input = $("#accountPlaylistSearch");
      if (input) input.value = query;
      if ($("#accountPlaylistFilter")) $("#accountPlaylistFilter").value = "all";
      renderPlaylistGrid();
      setStatus(query ? "Memfilter playlist akun dengan kata kunci: " + query : "Menampilkan semua playlist akun yang tersimpan di browser.", "info");
    });
  }

  function init() {
    initSettings();
    initListeners();
    renderProviderStates();
    renderPlaylistGrid();
    loadMusicKit().catch(() => {});
    window.dispatchEvent(new CustomEvent("euphonia:accounts-ready"));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();