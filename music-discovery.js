(() => {
  "use strict";

  const $ = selector => document.querySelector(selector);
  const CACHE_TTL = 5 * 60 * 1000;
  const cache = new Map();
  let currentRequest = null;
  let requestSequence = 0;
  let currentResults = [];

  function setStatus(message, tone = "info") {
    const node = $("#musicDiscoveryStatus");
    if (!node) return;
    node.dataset.tone = tone;
    node.textContent = message;
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

  function playApplePreview(item, list) {
    const callback = window.EUPHONIA?.playApplePreview;
    if (typeof callback !== "function") {
      setStatus("Player EUPHONIA belum siap. Muat ulang halaman dan coba lagi.", "error");
      return;
    }
    setStatus("Memulai preview audio “" + item.title + "” di player EUPHONIA…", "info");
    Promise.resolve(callback(item, list)).then(played => {
      if (played === false) setStatus("Preview siap, tetapi browser memblokir autoplay. Tekan Play pada player bawah.", "info");
      else setStatus("Memutar audio preview “" + item.title + "” di player bawah EUPHONIA.", "success");
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
    actions.append(makeButton("▶ Play audio preview", "primary-button", () => playApplePreview(item, list), !item.previewUrl));
    const api = window.EUPHONIA_ACCOUNT_MUSIC;
    if (api?.isProviderReady?.("apple") && item.url) {
      actions.append(makeButton("Full track", "outline-button", () => {
        showSearchPlaybackSurface("Apple Music", item);
        api.playQueue([{ ...item, provider: "apple", id: String(item.id), url: item.url }], 0);
        setStatus("Meminta pemutaran audio Apple Music penuh lewat MusicKit. Ketersediaan tergantung langganan dan hak akses akun.", "info");
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
    const mapped = results.map(itemFromApple);
    currentResults = mapped;
    createResultsHeading(query, mapped.length, "Apple Music · Audio Only");
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

  async function searchApple(query, sequence) {
    const cacheKey = "apple::" + query.toLocaleLowerCase();
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.at < CACHE_TTL) {
      if (sequence === requestSequence) {
        renderResults(query, "apple", cached.items);
        setStatus("Hasil katalog audio dimuat dari cache sementara.", "success");
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
        ? "Ditemukan " + items.length + " lagu; " + previews + " punya audio preview untuk diputar di EUPHONIA. Tidak ada video yang diputar di fitur ini."
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
    setStatus("Mencari lagu audio-only “" + query + "”…");
    await searchApple(query, sequence);
  }

  function init() {
    // The discovery panel is audio-only now; remove an obsolete local YouTube search key if present.
    try { localStorage.removeItem("euphonia.youtubeDataApiKey"); } catch (_) {}

    const form = $("#musicDiscoveryForm");
    form?.addEventListener("submit", event => {
      event.preventDefault();
      void runSearch();
    });

    window.addEventListener("euphonia:find-audio-preview", event => {
      const input = $("#musicDiscoveryQuery");
      const query = String(event.detail?.query || "").trim();
      if (!input || !query) return;
      input.value = query;
      void runSearch();
      $("#musicDiscoverySection")?.scrollIntoView({ behavior: "smooth", block: "start" });
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