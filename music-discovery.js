(() => {
  "use strict";

  const $ = selector => document.querySelector(selector);
  const CACHE_TTL = 5 * 60 * 1000;
  const cache = new Map();
  let currentRequest = null;
  let requestSequence = 0;
  let currentResults = [];
  let currentSource = "youtube";

  function setStatus(message, tone = "info") {
    const node = $("#musicDiscoveryStatus");
    if (!node) return;
    node.dataset.tone = tone;
    node.textContent = message;
  }

  function configuredYouTubeKey() {
    const configured = String(window.EUPHONIA_CONFIG?.youtubeDataApiKey || "").trim();
    if (configured && !configured.startsWith("YOUR_YOUTUBE_")) return configured;
    try {
      const local = String(localStorage.getItem("euphonia.youtubeDataApiKey") || "").trim();
      return local && !local.startsWith("YOUR_YOUTUBE_") ? local : "";
    } catch (_) {
      return "";
    }
  }

  function create(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function makeButton(text, className, callback, disabled = false) {
    const button = create("button", className, text);
    button.type = "button";
    button.disabled = disabled;
    button.addEventListener("click", callback);
    return button;
  }

  function createResultsHeading(query, count, source) {
    const title = $("#musicDiscoveryResultsTitle");
    const countNode = $("#musicDiscoveryResultsCount");
    if (title) title.textContent = source + " results for “" + query + "”";
    if (countNode) countNode.textContent = count + " TRACKS";
  }

  function clearResults() {
    $("#musicDiscoveryResults")?.replaceChildren();
    $("#musicDiscoveryResultsPanel")?.setAttribute("hidden", "");
    currentResults = [];
  }

  function itemFromYouTube(entry) {
    const snippet = entry.snippet || {};
    const videoId = entry.id?.videoId;
    return {
      id: String(videoId || ""),
      sourceKey: "youtube::" + String(videoId || ""),
      provider: "youtube",
      providerName: "YouTube Music",
      title: String(snippet.title || "Untitled video"),
      artist: String(snippet.channelTitle || "YouTube"),
      artwork: String(snippet.thumbnails?.high?.url || snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url || ""),
      url: "https://music.youtube.com/watch?v=" + encodeURIComponent(String(videoId || ""))
    };
  }

  function itemFromApple(entry) {
    return {
      id: String(entry.trackId || ""),
      sourceKey: "apple-preview::" + String(entry.trackId || entry.collectionId || ""),
      provider: "apple",
      providerName: "Apple Music",
      title: String(entry.trackName || entry.collectionName || "Untitled track"),
      artist: String(entry.artistName || "Unknown artist"),
      artwork: String(entry.artworkUrl100 || ""),
      url: String(entry.trackViewUrl || ""),
      previewUrl: String(entry.previewUrl || ""),
      trackId: entry.trackId,
      collectionId: entry.collectionId,
      collectionName: entry.collectionName || "",
      artworkUrl100: entry.artworkUrl100 || "",
      artistName: entry.artistName || "",
      trackName: entry.trackName || ""
    };
  }

  function showSearchPlaybackSurface(source, item) {
    const detail = $("#accountPlaylistDetail");
    const title = $("#accountPlaylistDetailTitle");
    const subtitle = $("#accountPlaylistDetailSubtitle");
    const tracks = $("#accountPlaylistTracks");
    if (detail) detail.hidden = false;
    if (title) title.textContent = "Search playback";
    if (subtitle) subtitle.textContent = source + " · " + (item?.title || "Selected track");
    if (tracks) {
      tracks.replaceChildren();
      tracks.hidden = true;
    }
    $("#accountNowPlaying")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function playYouTubeAt(index) {
    const api = window.EUPHONIA_ACCOUNT_MUSIC;
    const queue = currentResults.filter(track => track.provider === "youtube");
    if (!api || !queue.length) {
      setStatus("Pemutar YouTube belum siap. Muat ulang halaman atau gunakan preview Apple Music.", "error");
      return;
    }
    const item = queue[index];
    if (!item || !item.id) return;
    showSearchPlaybackSurface("YouTube Music", item);
    api.playQueue(queue, index);
    setStatus("Membuka “" + item.title + "” di pemutar YouTube resmi dalam EUPHONIA. Video tertentu mungkin melarang pemutaran tertanam.", "success");
    window.setTimeout(() => $("#accountNowPlaying")?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 80);
  }

  function addToQueue(item) {
    const api = window.EUPHONIA_ACCOUNT_MUSIC;
    if (!api) return setStatus("Queue akun belum siap. Coba muat ulang EUPHONIA.", "error");
    if (item.provider === "youtube") {
      api.enqueueTrack(item);
      setStatus("Ditambahkan ke queue: " + item.title, "success");
      return;
    }
    if (item.provider === "apple" && api.isProviderReady?.("apple") && item.url) {
      api.enqueueTrack({ ...item, provider: "apple", id: String(item.id), url: item.url });
      setStatus("Ditambahkan ke queue Apple Music. Pemutaran penuh bergantung pada MusicKit, akun dan ketersediaan track.", "success");
      return;
    }
    setStatus("Queue akun saat ini mendukung track YouTube dan Apple Music yang sudah punya URL katalog yang bisa diputar.", "info");
  }

  function playApplePreview(item, list) {
    const callback = window.EUPHONIA?.playApplePreview;
    if (typeof callback !== "function") {
      setStatus("Player EUPHONIA belum siap. Muat ulang halaman dan coba lagi.", "error");
      return;
    }
    setStatus("Memulai preview “" + item.title + "” di player EUPHONIA…", "info");
    Promise.resolve(callback(item, list)).then(played => {
      if (played === false) setStatus("Preview siap, tetapi browser memblokir autoplay. Tekan Play pada player bawah.", "info");
      else setStatus("Memutar preview “" + item.title + "” di player bawah EUPHONIA.", "success");
    }).catch(error => setStatus("Tidak dapat memutar preview: " + (error.message || "coba lagi."), "error"));
  }

  function renderCard(item, index, list) {
    const card = create("article", "music-discovery-card");
    const art = create("div", "music-discovery-art");
    if (item.artwork) {
      const img = create("img");
      img.loading = "lazy";
      img.alt = "";
      img.src = item.artwork;
      img.addEventListener("error", () => img.remove(), { once: true });
      art.append(img);
    } else {
      art.textContent = "♫";
    }

    const body = create("div", "music-discovery-card-body");
    body.append(create("strong", "music-discovery-track-title", item.title));
    body.append(create("small", "music-discovery-track-artist", item.artist || item.providerName));
    if (item.collectionName) body.append(create("small", "music-discovery-album", item.collectionName));

    const actions = create("div", "music-discovery-actions");
    if (item.provider === "youtube") {
      actions.append(makeButton("▶ Play here", "primary-button", () => playYouTubeAt(index)));
      actions.append(makeButton("＋ Queue", "outline-button", () => addToQueue(item)));
      if (item.url) {
        const link = create("a", "music-discovery-source", "Open source ↗");
        link.href = item.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        actions.append(link);
      }
    } else {
      actions.append(makeButton("▶ Preview", "primary-button", () => playApplePreview(item, list), !item.previewUrl));
      const api = window.EUPHONIA_ACCOUNT_MUSIC;
      if (api?.isProviderReady?.("apple") && item.url) {
        actions.append(makeButton("Full track", "outline-button", () => {
          showSearchPlaybackSurface("Apple Music", item);
          api.playQueue([{ ...item, provider: "apple", id: String(item.id), url: item.url }], 0);
          setStatus("Meminta pemutaran Apple Music penuh lewat MusicKit. Pastikan langganan dan track tersedia.", "info");
          window.setTimeout(() => $("#accountNowPlaying")?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 80);
        }));
      }
      if (item.url) {
        const link = create("a", "music-discovery-source", "Apple Music ↗");
        link.href = item.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        actions.append(link);
      }
    }
    body.append(actions);
    card.append(art, body);
    return card;
  }

  function renderResults(query, source, results) {
    const panel = $("#musicDiscoveryResultsPanel");
    const grid = $("#musicDiscoveryResults");
    if (!panel || !grid) return;
    currentSource = source;
    currentResults = results;
    grid.replaceChildren();
    const mapped = source === "youtube" ? results.map(itemFromYouTube) : results.map(itemFromApple);
    currentResults = mapped;
    createResultsHeading(query, mapped.length, source === "youtube" ? "YouTube Music" : "Apple Music");
    if (!mapped.length) {
      const empty = create("div", "account-empty-state compact");
      const title = create("strong", "", "No tracks found");
      const copy = create("p", "", "Coba nama artis yang berbeda, judul lagu, atau kata kunci yang lebih singkat.");
      empty.append(title, copy);
      grid.append(empty);
    } else {
      mapped.forEach((item, index) => grid.append(renderCard(item, index, mapped)));
    }
    panel.hidden = false;
  }

  async function searchYouTube(query, sequence) {
    const key = configuredYouTubeKey();
    if (!key) {
      clearResults();
      setStatus("Pencarian YouTube belum diaktifkan oleh pemilik aplikasi. Tambahkan YouTube Data API key yang dibatasi untuk domain EUPHONIA di euphonia-config.js. Sementara itu, kamu bisa memilih Apple Music Previews.", "info");
      return;
    }

    const cacheKey = "youtube::" + query.toLocaleLowerCase();
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.at < CACHE_TTL) {
      if (sequence === requestSequence) {
        renderResults(query, "youtube", cached.items);
        setStatus("Hasil YouTube diambil dari cache lokal sementara.", "success");
      }
      return;
    }

    const controller = new AbortController();
    currentRequest = controller;
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    try {
      const url = new URL("https://www.googleapis.com/youtube/v3/search");
      url.search = new URLSearchParams({
        part: "snippet",
        type: "video",
        videoCategoryId: "10",
        videoEmbeddable: "true",
        safeSearch: "moderate",
        regionCode: "ID",
        maxResults: "12",
        q: query,
        key
      }).toString();
      const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
      let data = {};
      try { data = await response.json(); } catch (_) {}
      if (sequence !== requestSequence) return;
      if (!response.ok || data.error) {
        const reason = data.error?.errors?.[0]?.reason || "";
        if (response.status === 403 && /quotaExceeded|dailyLimitExceeded|rateLimitExceeded/i.test(reason)) {
          throw new Error("Kuota pencarian YouTube sedang habis. Coba lagi setelah kuota reset atau gunakan Apple Music Previews.");
        }
        if (response.status === 403) throw new Error("YouTube API menolak permintaan. Periksa pembatasan HTTP referrer, izin YouTube Data API v3, dan API key pemilik aplikasi.");
        throw new Error(data.error?.message || "YouTube API HTTP " + response.status);
      }
      const items = (Array.isArray(data.items) ? data.items : []).filter(item => item?.id?.videoId && item.snippet);
      cache.set(cacheKey, { items, at: Date.now() });
      renderResults(query, "youtube", items);
      setStatus(items.length
        ? "Ditemukan " + items.length + " hasil. Pilih Play here untuk memakai pemutar YouTube resmi di halaman ini."
        : "Tidak ada hasil video musik yang bisa ditampilkan untuk query ini.", items.length ? "success" : "info");
    } catch (error) {
      if (sequence !== requestSequence) return;
      clearResults();
      setStatus(error.name === "AbortError"
        ? "Pencarian YouTube timeout setelah 12 detik. Coba lagi."
        : "Pencarian YouTube gagal: " + (error.message || "periksa koneksi internet."), "error");
    } finally {
      window.clearTimeout(timeout);
      if (currentRequest === controller) currentRequest = null;
    }
  }

  async function searchApple(query, sequence) {
    const cacheKey = "apple::" + query.toLocaleLowerCase();
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.at < CACHE_TTL) {
      if (sequence === requestSequence) {
        renderResults(query, "apple", cached.items);
        setStatus("Hasil Apple Music dimuat dari cache sementara.", "success");
      }
      return;
    }
    const controller = new AbortController();
    currentRequest = controller;
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    try {
      const url = new URL("https://itunes.apple.com/search");
      url.search = new URLSearchParams({ term: query, entity: "song", limit: "24", country: "ID", media: "music" }).toString();
      const response = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" }, cache: "no-store" });
      if (!response.ok) throw new Error("Katalog Apple menjawab HTTP " + response.status);
      const data = await response.json();
      if (sequence !== requestSequence) return;
      const items = Array.isArray(data.results) ? data.results.filter(item => item.trackId && item.trackName) : [];
      cache.set(cacheKey, { items, at: Date.now() });
      renderResults(query, "apple", items);
      const previews = items.filter(item => item.previewUrl).length;
      setStatus(items.length
        ? "Ditemukan " + items.length + " lagu; " + previews + " punya preview yang dapat dicoba langsung di EUPHONIA. Preview memiliki durasi yang ditentukan penyedia."
        : "Tidak ada lagu yang cocok. Coba nama artis atau judul lagu lain.", items.length ? "success" : "info");
    } catch (error) {
      if (sequence !== requestSequence) return;
      clearResults();
      setStatus(error.name === "AbortError"
        ? "Pencarian katalog timeout setelah 12 detik. Coba lagi."
        : "Pencarian Apple Music gagal: " + (error.message || "periksa koneksi internet."), "error");
    } finally {
      window.clearTimeout(timeout);
      if (currentRequest === controller) currentRequest = null;
    }
  }

  async function runSearch() {
    const input = $("#musicDiscoveryQuery");
    const query = String(input?.value || "").trim();
    if (!query) {
      setStatus("Masukkan nama artis, judul lagu, atau kata kunci musik.", "error");
      input?.focus();
      return;
    }
    requestSequence += 1;
    const sequence = requestSequence;
    if (currentRequest) currentRequest.abort();
    const source = $("#musicDiscoverySource")?.value || "youtube";
    setStatus("Mencari “" + query + "”…");
    if (source === "apple") await searchApple(query, sequence);
    else await searchYouTube(query, sequence);
  }

  function init() {
    const form = $("#musicDiscoveryForm");
    form?.addEventListener("submit", event => {
      event.preventDefault();
      void runSearch();
    });
    $("#musicDiscoverySource")?.addEventListener("change", () => {
      const source = $("#musicDiscoverySource")?.value;
      const button = $("#musicDiscoverySearchButton");
      if (button) button.textContent = source === "apple" ? "Search previews" : "Search YouTube";
      const hint = $("#musicDiscoveryHint");
      if (hint) hint.textContent = source === "apple"
        ? "Cari katalog tanpa login; Play mengalirkan preview resmi jika tersedia."
        : "Cari video musik dan putar lewat pemutar YouTube resmi. API key dikonfigurasi pemilik aplikasi.";
      clearResults();
    });
    $("#musicDiscoveryClear")?.addEventListener("click", () => {
      if (currentRequest) currentRequest.abort();
      requestSequence += 1;
      if ($("#musicDiscoveryQuery")) $("#musicDiscoveryQuery").value = "";
      clearResults();
      setStatus("Masukkan nama artis atau lagu untuk mulai mencari.", "info");
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();