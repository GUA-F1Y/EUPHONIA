(() => {
  "use strict";

  const FAVORITES_KEY = "euphonia.musicHub.favorites.v1";
  const HISTORY_KEY = "euphonia.musicHub.listeningHistory.v1";
  const LYRICS_KEY = "euphonia.musicHub.lyricsCache.v1";
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  let favorites = readJSON(FAVORITES_KEY, []);
  let history = readJSON(HISTORY_KEY, []);
  let lyricsCache = readJSON(LYRICS_KEY, {});
  let savedView = "favorites";
  let activeLyrics = [];
  let lyricsRequestId = 0;
  let lyricsTimer = null;
  let lastHistoryKey = "";
  let lastHistoryTime = 0;

  function readJSON(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "null");
      return value == null ? fallback : value;
    } catch (_) {
      return fallback;
    }
  }

  function persist(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (_) {
      setStatus("Penyimpanan browser penuh atau tidak tersedia. Hapus sebagian data browser lalu coba lagi.", "error");
      return false;
    }
  }

  function normalizeTrack(track, provider) {
    const item = track && typeof track === "object" ? track : {};
    const source = item.provider || provider || "youtube";
    const id = String(item.id || item.videoId || item.trackId || item.sourceKey || item.url || "");
    return {
      id,
      sourceKey: item.sourceKey || (source + "::" + id),
      provider: source,
      providerName: item.providerName || (source === "youtube" ? "YouTube Music" : source === "apple" ? "Apple Music" : source),
      title: String(item.title || item.trackName || "Untitled track"),
      artist: String(item.artist || item.artistName || ""),
      artwork: String(item.artwork || item.image || ""),
      url: String(item.url || ""),
      album: String(item.album || item.albumName || ""),
      playlistTitle: String(item.playlistTitle || ""),
      duration: Number.isFinite(Number(item.duration)) ? Number(item.duration) : null,
      savedAt: item.savedAt || new Date().toISOString()
    };
  }

  function keyFor(track, provider) {
    const item = normalizeTrack(track, provider);
    return item.provider + "::" + String(item.id || item.sourceKey || item.url);
  }

  function setStatus(message, tone) {
    const status = $("#accountHubStatus");
    if (!status) return;
    status.dataset.tone = tone || "info";
    const node = status.querySelector("[data-account-status-message]");
    if (node) node.textContent = message;
  }

  function isFavorite(track, provider) {
    const key = keyFor(track, provider);
    return favorites.some(item => keyFor(item) === key);
  }

  function refreshFavoriteButtons() {
    const current = window.EUPHONIA_ACCOUNT_MUSIC?.getCurrentTrack?.();
    const playerButton = $("#accountPlayerFavorite");
    if (playerButton) {
      playerButton.textContent = current && isFavorite(current) ? "♥ Saved" : "♡ Favorite";
      playerButton.disabled = !current;
      playerButton.setAttribute("aria-pressed", String(Boolean(current && isFavorite(current))));
    }
    $$("[data-musicfy-favorite-key]").forEach(button => {
      const key = button.dataset.musicfyFavoriteKey;
      button.textContent = favorites.some(item => keyFor(item) === key) ? "♥ Saved" : "♡ Favorite";
      button.setAttribute("aria-pressed", String(favorites.some(item => keyFor(item) === key)));
    });
    const count = $("#accountFavoriteCount");
    if (count) count.textContent = String(favorites.length);
  }

  function toggleFavorite(track, provider) {
    if (!track) return;
    const item = normalizeTrack(track, provider);
    if (!item.id && !item.url) {
      setStatus("Track ini belum memiliki identitas sumber yang bisa disimpan.", "error");
      return;
    }
    const key = keyFor(item);
    const index = favorites.findIndex(saved => keyFor(saved) === key);
    if (index >= 0) {
      favorites.splice(index, 1);
      setStatus("Track dihapus dari Favorites EUPHONIA.", "success");
    } else {
      favorites.unshift(item);
      favorites = favorites.slice(0, 500);
      setStatus("Track disimpan ke Favorites EUPHONIA.", "success");
    }
    if (!persist(FAVORITES_KEY, favorites)) return;
    refreshFavoriteButtons();
    renderSavedCollection();
  }

  function appendHistory(track) {
    if (!track) return;
    const item = normalizeTrack(track);
    if (!item.id && !item.url) return;
    const key = keyFor(item);
    const now = Date.now();
    if (key === lastHistoryKey && now - lastHistoryTime < 20000) return;
    lastHistoryKey = key;
    lastHistoryTime = now;
    item.playedAt = new Date(now).toISOString();
    history.unshift(item);
    history = history.slice(0, 150);
    persist(HISTORY_KEY, history);
    renderSavedCollection();
  }

  function makeButton(label, className, onClick, disabled) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className || "outline-button small-account-button";
    button.textContent = label;
    button.disabled = Boolean(disabled);
    if (onClick) button.addEventListener("click", onClick);
    return button;
  }

  function makeLink(label, href) {
    const link = document.createElement("a");
    link.className = "outline-button small-account-button";
    link.textContent = label;
    link.href = /^https:\/\//i.test(href || "") ? href : "#";
    if (link.href !== "#") {
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    } else {
      link.setAttribute("aria-disabled", "true");
    }
    return link;
  }

  function renderSavedCollection() {
    const host = $("#accountSavedTracks");
    const count = $("#accountFavoriteCount");
    const playAll = $("#accountSavedPlayAll");
    const clearHistory = $("#accountClearHistory");
    if (count) count.textContent = String(favorites.length);
    if (playAll) {
      const visible = savedView === "favorites" ? favorites : history;
      playAll.disabled = visible.length === 0;
      playAll.textContent = savedView === "favorites" ? "▶ Play favorites" : "▶ Play recent list";
    }
    if (clearHistory) clearHistory.hidden = savedView !== "history";
    $$("[data-saved-view]").forEach(button => {
      const active = button.dataset.savedView === savedView;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    if (!host) return;
    host.replaceChildren();
    const items = savedView === "favorites" ? favorites : history;
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "account-empty-state compact";
      const title = document.createElement("strong");
      title.textContent = savedView === "favorites" ? "Your favorites live here" : "Nothing played yet";
      const copy = document.createElement("p");
      copy.textContent = savedView === "favorites"
        ? "Gunakan tombol Favorite pada track dari playlist akun untuk menyimpannya di perangkat ini."
        : "Track dari pemutar akun akan muncul di sini setelah layanan mulai memutarnya.";
      empty.append(title, copy);
      host.append(empty);
      refreshFavoriteButtons();
      return;
    }

    items.forEach((track, index) => {
      const row = document.createElement("article");
      row.className = "account-track-row account-saved-track-row";
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
      const title = document.createElement("strong");
      title.textContent = track.title || "Untitled track";
      const artist = document.createElement("small");
      const date = savedView === "history" && track.playedAt
        ? " · " + new Date(track.playedAt).toLocaleString()
        : "";
      artist.textContent = (track.artist || track.providerName || "Unknown artist") + " · " + (track.providerName || track.provider || "") + date;
      textBox.append(title, artist);
      const actions = document.createElement("div");
      actions.className = "account-track-actions";
      actions.append(makeButton("▶ Play", "primary-button small-account-button", () => {
        const api = window.EUPHONIA_ACCOUNT_MUSIC;
        if (!api) return setStatus("Pemutar akun belum siap.", "error");
        api.playQueue(items.map(item => normalizeTrack(item)), index);
      }));
      actions.append(makeButton("＋ Queue", "outline-button small-account-button", () => {
        const api = window.EUPHONIA_ACCOUNT_MUSIC;
        if (!api) return setStatus("Antrean akun belum siap.", "error");
        api.enqueueTrack(normalizeTrack(track));
      }));
      if (savedView === "favorites") {
        actions.append(makeButton("Remove", "text-button small-account-button", () => toggleFavorite(track)));
      } else {
        actions.append(makeButton(isFavorite(track) ? "♥ Saved" : "♡ Favorite", "outline-button small-account-button", () => toggleFavorite(track)));
      }
      actions.append(makeLink("Open source ↗", track.url));
      row.append(number, art, textBox, actions);
      host.append(row);
    });
    refreshFavoriteButtons();
  }

  function renderQueue() {
    const host = $("#accountQueueItems");
    const api = window.EUPHONIA_ACCOUNT_MUSIC;
    const queue = api?.getQueue?.() || [];
    const countButton = $("#accountPlayerQueueToggle");
    if (countButton) countButton.textContent = "☷ Queue (" + queue.length + ")";
    if (!host) return;
    host.replaceChildren();
    if (!queue.length) {
      const empty = document.createElement("div");
      empty.className = "account-empty-state compact";
      empty.textContent = "Queue masih kosong. Tambahkan track dari playlist, Favorites, atau Recently played.";
      host.append(empty);
      return;
    }
    queue.forEach((track, index) => {
      const row = document.createElement("div");
      row.className = "account-queue-row" + (track.active ? " is-current" : "");
      const number = document.createElement("span");
      number.className = "account-track-number";
      number.textContent = track.active ? "▶" : String(index + 1).padStart(2, "0");
      const art = document.createElement("div");
      art.className = "account-queue-art";
      if (track.artwork) {
        const image = document.createElement("img");
        image.loading = "lazy";
        image.alt = "";
        image.src = track.artwork;
        art.append(image);
      } else art.textContent = "♫";
      const copy = document.createElement("div");
      copy.className = "account-track-text";
      const title = document.createElement("strong");
      title.textContent = track.title || "Untitled track";
      const artist = document.createElement("small");
      artist.textContent = (track.artist || track.providerName || "") + " · " + (track.providerName || track.provider || "");
      copy.append(title, artist);
      const actions = document.createElement("div");
      actions.className = "account-queue-actions";
      actions.append(makeButton("↑", "outline-button small-account-button", () => api.moveQueueItem(index, index - 1), index === 0));
      actions.append(makeButton("↓", "outline-button small-account-button", () => api.moveQueueItem(index, index + 1), index === queue.length - 1));
      actions.append(makeButton("Play", "primary-button small-account-button", () => api.playQueue(queue, index)));
      actions.append(makeButton("×", "text-button small-account-button", () => api.removeQueueItem(index)));
      row.append(number, art, copy, actions);
      host.append(row);
    });
  }

  function parseLrc(value) {
    const parsed = [];
    String(value || "").split(/\r?\n/).forEach(line => {
      const matches = [...line.matchAll(/\[(\d{2,}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
      if (!matches.length) return;
      const text = line.replace(/\[(\d{2,}):(\d{2})(?:[.:](\d{1,3}))?\]/g, "").trim();
      if (!text) return;
      matches.forEach(match => {
        const fraction = String(match[3] || "0").padEnd(3, "0").slice(0, 3);
        const time = Number(match[1]) * 60 + Number(match[2]) + Number(fraction) / 1000;
        parsed.push({ time, text });
      });
    });
    return parsed.sort((a, b) => a.time - b.time);
  }

  function lyricsCacheKey(track) {
    return keyFor(track);
  }

  function renderLyrics(track, record, message) {
    const host = $("#accountLyricsLines");
    const status = $("#accountLyricsStatus");
    if (!host || !status) return;
    host.replaceChildren();
    activeLyrics = [];
    if (!record || record.notFound) {
      status.textContent = message || "Lirik untuk track ini belum ditemukan di LRCLIB.";
      stopLyricsTimer();
      return;
    }
    if (record.instrumental) {
      status.textContent = "Track ini ditandai sebagai instrumental.";
      stopLyricsTimer();
      return;
    }
    const lrc = parseLrc(record.syncedLyrics);
    if (lrc.length) {
      status.textContent = "Synchronized lyrics · " + (record.artistName || track.artist || "artist tidak diketahui");
      activeLyrics = lrc;
      lrc.forEach((line, index) => {
        const p = document.createElement("p");
        p.className = "account-lyric-line";
        p.dataset.lyricIndex = String(index);
        p.textContent = line.text;
        host.append(p);
      });
      startLyricsTimer();
      return;
    }
    if (record.plainLyrics) {
      status.textContent = "Plain lyrics · sinkronisasi waktu tidak tersedia untuk versi ini.";
      const pre = document.createElement("pre");
      pre.className = "account-plain-lyrics";
      pre.textContent = record.plainLyrics;
      host.append(pre);
      stopLyricsTimer();
      return;
    }
    status.textContent = "Data LRCLIB tidak memiliki lirik yang dapat ditampilkan.";
    stopLyricsTimer();
  }

  async function loadLyrics(track, force) {
    if (!track) {
      setStatus("Pilih track dari playlist akun sebelum mencari lirik.", "info");
      return;
    }
    const item = normalizeTrack(track);
    const status = $("#accountLyricsStatus");
    const host = $("#accountLyricsLines");
    if (!status || !host) return;
    const requestId = ++lyricsRequestId;
    host.replaceChildren();
    activeLyrics = [];
    status.textContent = "Mencari lirik untuk “" + item.title + "”…";
    const cacheKey = lyricsCacheKey(item);
    const cached = lyricsCache[cacheKey];
    if (!force && cached && cached.cachedAt && Date.now() - cached.cachedAt < (cached.notFound ? 86400000 : 2592000000)) {
      renderLyrics(item, cached, cached.notFound ? "Lirik tidak ditemukan. Coba lagi nanti melalui tombol reload." : "");
      return;
    }

    try {
      const url = new URL("https://lrclib.net/api/search");
      url.searchParams.set("track_name", item.title);
      if (item.artist) url.searchParams.set("artist_name", item.artist);
      const response = await fetch(url.toString(), {
        headers: { "X-User-Agent": "EUPHONIA/0.2 (+https://github.com/GUA-F1Y/EUPHONIA)" }
      });
      if (requestId !== lyricsRequestId) return;
      if (response.status === 429) {
        const retry = response.headers.get("Retry-After");
        status.textContent = "LRCLIB membatasi request. Coba kembali" + (retry ? " setelah " + retry + " detik." : " beberapa saat lagi.");
        return;
      }
      if (!response.ok) throw new Error("LRCLIB menjawab HTTP " + response.status);
      const results = await response.json();
      if (!Array.isArray(results)) throw new Error("Format jawaban LRCLIB tidak dikenal.");
      const clean = value => String(value || "").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
      const targetTitle = clean(item.title);
      const targetArtist = clean(item.artist);
      const ranked = results.map(record => {
        const title = clean(record.trackName || record.name);
        const artist = clean(record.artistName);
        let score = 0;
        if (title === targetTitle) score += 8;
        else if (title && (title.includes(targetTitle) || targetTitle.includes(title))) score += 3;
        if (targetArtist && artist === targetArtist) score += 6;
        else if (targetArtist && artist && (artist.includes(targetArtist) || targetArtist.includes(artist))) score += 3;
        if (record.syncedLyrics) score += 2;
        if (record.plainLyrics) score += 1;
        if (item.duration && record.duration) score -= Math.min(5, Math.abs(item.duration - record.duration));
        return { record, score };
      }).sort((a, b) => b.score - a.score);
      const winner = ranked.find(entry => entry.score > 0 && (entry.record.syncedLyrics || entry.record.plainLyrics || entry.record.instrumental));
      if (!winner) {
        const notFound = { notFound: true, cachedAt: Date.now() };
        lyricsCache[cacheKey] = notFound;
        persist(LYRICS_KEY, lyricsCache);
        renderLyrics(item, notFound, "Lirik tidak ditemukan untuk judul/artis ini.");
        return;
      }
      const record = { ...winner.record, cachedAt: Date.now() };
      lyricsCache[cacheKey] = record;
      const keys = Object.keys(lyricsCache);
      if (keys.length > 150) keys.slice(0, keys.length - 150).forEach(key => delete lyricsCache[key]);
      persist(LYRICS_KEY, lyricsCache);
      if (requestId === lyricsRequestId) renderLyrics(item, record);
    } catch (error) {
      if (requestId !== lyricsRequestId) return;
      status.textContent = "Tidak dapat mengambil lirik saat ini: " + (error.message || "periksa koneksi internet.");
    }
  }

  function startLyricsTimer() {
    stopLyricsTimer();
    lyricsTimer = window.setInterval(syncLyricsProgress, 450);
    syncLyricsProgress();
  }

  function stopLyricsTimer() {
    if (lyricsTimer) window.clearInterval(lyricsTimer);
    lyricsTimer = null;
  }

  function syncLyricsProgress() {
    if (!activeLyrics.length) return;
    const api = window.EUPHONIA_ACCOUNT_MUSIC;
    const time = api?.getPlaybackTime?.();
    if (!Number.isFinite(time)) return;
    let active = -1;
    for (let index = 0; index < activeLyrics.length; index++) {
      if (activeLyrics[index].time <= time) active = index;
      else break;
    }
    const current = $("#accountLyricsLines [data-lyric-index].is-active");
    const activeNode = active >= 0 ? $("#accountLyricsLines [data-lyric-index='" + active + "']") : null;
    if (current === activeNode) return;
    current?.classList.remove("is-active");
    if (activeNode) {
      activeNode.classList.add("is-active");
      activeNode.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  function updatePlaybackModeLabels() {
    const modes = window.EUPHONIA_ACCOUNT_MUSIC?.getModes?.() || { shuffle: false, repeat: "off" };
    const shuffle = $("#accountPlayerShuffle");
    const repeat = $("#accountPlayerRepeat");
    if (shuffle) {
      shuffle.textContent = modes.shuffle ? "⤨ Shuffle on" : "⤨ Shuffle";
      shuffle.classList.toggle("is-active", Boolean(modes.shuffle));
      shuffle.setAttribute("aria-pressed", String(Boolean(modes.shuffle)));
    }
    if (repeat) {
      const label = modes.repeat === "one" ? "↻ Repeat one" : modes.repeat === "all" ? "↻ Repeat all" : "↻ Repeat off";
      repeat.textContent = label;
      repeat.classList.toggle("is-active", modes.repeat !== "off");
      repeat.setAttribute("aria-pressed", String(modes.repeat !== "off"));
    }
  }

  function init() {
    $("#accountPlayerFavorite")?.addEventListener("click", () => {
      const current = window.EUPHONIA_ACCOUNT_MUSIC?.getCurrentTrack?.();
      if (current) toggleFavorite(current);
    });
    $("#accountPlayerShuffle")?.addEventListener("click", () => {
      window.EUPHONIA_ACCOUNT_MUSIC?.toggleShuffle?.();
      updatePlaybackModeLabels();
    });
    $("#accountPlayerRepeat")?.addEventListener("click", () => {
      window.EUPHONIA_ACCOUNT_MUSIC?.cycleRepeat?.();
      updatePlaybackModeLabels();
    });
    $("#accountPlayerQueueToggle")?.addEventListener("click", () => {
      const panel = $("#accountQueuePanel");
      if (!panel) return;
      panel.hidden = !panel.hidden;
      $("#accountPlayerQueueToggle")?.setAttribute("aria-expanded", String(!panel.hidden));
    });
    $("#accountPlayerLyricsToggle")?.addEventListener("click", () => {
      const panel = $("#accountLyricsPanel");
      if (!panel) return;
      panel.hidden = !panel.hidden;
      $("#accountPlayerLyricsToggle")?.setAttribute("aria-expanded", String(!panel.hidden));
      if (!panel.hidden) {
        const current = window.EUPHONIA_ACCOUNT_MUSIC?.getCurrentTrack?.();
        if (current) void loadLyrics(current, false);
        else {
          const status = $("#accountLyricsStatus");
          if (status) status.textContent = "Putar track dari playlist akun untuk mencari lirik.";
        }
      } else stopLyricsTimer();
    });
    $("#accountLyricsRetry")?.addEventListener("click", () => {
      const current = window.EUPHONIA_ACCOUNT_MUSIC?.getCurrentTrack?.();
      if (current) void loadLyrics(current, true);
    });
    $("#accountQueueClear")?.addEventListener("click", () => window.EUPHONIA_ACCOUNT_MUSIC?.clearQueue?.());
    $("#accountSavedPlayAll")?.addEventListener("click", () => {
      const items = savedView === "favorites" ? favorites : history;
      if (items.length) window.EUPHONIA_ACCOUNT_MUSIC?.playQueue?.(items.map(item => normalizeTrack(item)), 0);
    });
    $("#accountClearHistory")?.addEventListener("click", () => {
      history = [];
      lastHistoryKey = "";
      persist(HISTORY_KEY, history);
      renderSavedCollection();
      setStatus("Listening history EUPHONIA dihapus dari browser ini.", "success");
    });
    $$("[data-saved-view]").forEach(button => button.addEventListener("click", () => {
      savedView = button.dataset.savedView === "history" ? "history" : "favorites";
      renderSavedCollection();
    }));

    window.addEventListener("euphonia:account-track-change", event => {
      refreshFavoriteButtons();
      renderQueue();
      const panel = $("#accountLyricsPanel");
      if (panel && !panel.hidden && event.detail?.track) void loadLyrics(event.detail.track, false);
    });
    window.addEventListener("euphonia:account-playback-started", event => {
      appendHistory(event.detail?.track || window.EUPHONIA_ACCOUNT_MUSIC?.getCurrentTrack?.());
      refreshFavoriteButtons();
    });
    window.addEventListener("euphonia:account-queue-change", () => {
      renderQueue();
      updatePlaybackModeLabels();
    });

    renderSavedCollection();
    renderQueue();
    refreshFavoriteButtons();
    updatePlaybackModeLabels();
  }

  window.EUPHONIA_MUSICFY = Object.freeze({
    isFavorite,
    toggleFavorite,
    renderSavedCollection,
    refreshFavoriteButtons
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();