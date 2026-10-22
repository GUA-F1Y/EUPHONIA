(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const audioPlayer = $('#audioPlayer');
  const audioFilesInput = $('#audioFilesInput');
  const singleAudioInput = $('#singleAudioInput');
  const toastRegion = $('#toastRegion');
  const trackColors = ['#c9f36a', '#a798ff', '#8ce8db', '#ffa66e', '#ff8298', '#82b8ff'];

  const state = {
    files: [],
    currentFileId: null,
    externalTrack: null,
    externalQueue: [],
    favorites: new Set(),
    libraryFilter: 'all',
    inputPurpose: 'library',
    audioContext: null,
    dawTracks: [],
    nextTrackId: 1,
    nextClipId: 1,
    selectedTrackId: null,
    pixelsPerSecond: 44,
    playheadSeconds: 0,
    dawPlaying: false,
    isStartingPlayback: false,
    playbackStartToken: 0,
    dawStartWallTime: 0,
    dawStartPosition: 0,
    scheduledSources: [],
    animationFrame: null,
    recording: null,
    pendingModalAction: null,
    selectedClipId: null,
    activeTool: 'select',
    undoStack: [],
    redoStack: [],
    isRestoring: false,
    masterSettings: { volume: 0.82, cutoff: 20000, delayWet: 0, delayTime: 0.28, reverbWet: 0, compressor: 0.25, automation: false, automationStart: 0.82, automationEnd: 0.82 }
  };

  const masterChains = new WeakMap();
  const localStorageAPI = window.EUPHONIA_STORAGE || null;
  let workspaceReady = false;
  let autosaveTimer = null;
  let localSavePromise = null;
  let workspaceRevision = 0;
  let lastSavedRevision = 0;
  let storageWriteFailure = null;
  const pendingAssetWrites = new Set();
  const failedAssetIds = new Set();

  function setPersistenceStatus(text, mode = 'saved') {
    const host = $('#autosaveStatus');
    const label = $('#autosaveStatusText');
    if (host) host.dataset.state = mode;
    if (label) label.textContent = text;
  }

  function queueWorkspaceSave() {
    if (!workspaceReady || state.isRestoring || !localStorageAPI) return;
    workspaceRevision += 1;
    setPersistenceStatus('UNSAVED CHANGES', 'dirty');
    window.clearTimeout(autosaveTimer);
    autosaveTimer = window.setTimeout(() => saveLocalWorkspace({ quiet: true }), 900);
  }

  function workspaceSnapshot() {
    return {
      schemaVersion: 1,
      savedAt: new Date().toISOString(),
      files: state.files.map(item => ({ id: item.id, name: item.name, type: item.file.type || '', size: item.size, lastModified: item.lastModified, addedAt: item.addedAt instanceof Date ? item.addedAt.toISOString() : item.addedAt, duration: item.duration || 0 })),
      currentFileId: state.currentFileId,
      favorites: [...state.favorites],
      settings: {
        tempo: Math.max(40, Math.min(240, Number($('#bpmInput').value) || 118)),
        key: $('#keySelect').value,
        grid: $('#gridSelect').value,
        playheadSeconds: state.playheadSeconds,
        pixelsPerSecond: state.pixelsPerSecond,
        master: { ...state.masterSettings }
      },
      tracks: state.dawTracks.map(track => ({
        id: track.id, name: track.name, color: track.color, volume: track.volume, pan: track.pan || 0, muted: Boolean(track.muted), solo: Boolean(track.solo),
        clips: track.clips.map(clip => ({ id: clip.id, assetId: clip.item.id, name: clip.name, start: clip.start, offset: clip.offset || 0, duration: clip.duration }))
      })),
      advanced: window.EUPHONIA_DAW && typeof window.EUPHONIA_DAW.serialize === 'function' ? window.EUPHONIA_DAW.serialize() : {}
    };
  }

  async function saveLocalWorkspace({ quiet = false } = {}) {
    if (!localStorageAPI || !workspaceReady || state.isRestoring) return;
    if (localSavePromise) {
      // A concurrent caller shares the current save. Failures are handled inside the save task.
      await localSavePromise;
      if (workspaceRevision > lastSavedRevision) return saveLocalWorkspace({ quiet: true });
      return;
    }
    window.clearTimeout(autosaveTimer);
    setPersistenceStatus('SAVING…', 'saving');
    const revisionAtStart = workspaceRevision;
    localSavePromise = (async () => {
      try {
        await Promise.all([...pendingAssetWrites]);
        const activeAssetIds = new Set(state.files.map(item => item.id));
        for (const failedId of [...failedAssetIds]) if (!activeAssetIds.has(failedId)) failedAssetIds.delete(failedId);
        if (failedAssetIds.size === 0) storageWriteFailure = null;
        if (storageWriteFailure) throw storageWriteFailure;
        const snapshot = workspaceSnapshot();
        await localStorageAPI.saveWorkspace(snapshot);
        lastSavedRevision = revisionAtStart;
        // Remove old binary assets left behind by replaced/deleted projects to limit local storage growth.
        if (typeof localStorageAPI.keepAssets === 'function') {
          await localStorageAPI.keepAssets(snapshot.files.map(item => item.id)).catch(error => console.warn('EUPHONIA asset cleanup skipped:', error));
        }
        const savedAt = new Date();
        setPersistenceStatus(`SAVED ${savedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`, 'saved');
        if (!quiet) toast('Workspace tersimpan di perangkat ini.');
      } catch (error) {
        console.error('EUPHONIA local autosave failed:', error);
        // Mark this revision as attempted. Do not create an endless retry loop when quota is full.
        lastSavedRevision = revisionAtStart;
        setPersistenceStatus('SAVE FAILED', 'error');
        if (!quiet) toast(`Autosave gagal: ${error.message}. Export project sebagai backup.`, 'error');
      } finally {
        localSavePromise = null;
        if (workspaceReady && workspaceRevision > lastSavedRevision && !state.isRestoring) {
          window.clearTimeout(autosaveTimer);
          autosaveTimer = window.setTimeout(() => saveLocalWorkspace({ quiet: true }), 500);
        }
      }
    })();
    await localSavePromise;
  }

  function persistAsset(item) {
    if (!localStorageAPI || state.isRestoring) return;
    const write = localStorageAPI.saveAsset({
      id: item.id, name: item.name, type: item.file.type || 'application/octet-stream', size: item.size,
      lastModified: item.lastModified, addedAt: item.addedAt instanceof Date ? item.addedAt.toISOString() : item.addedAt,
      duration: item.duration || 0, blob: item.file
    }).then(() => {
      const recovered = failedAssetIds.delete(item.id);
      if (failedAssetIds.size === 0) storageWriteFailure = null;
      if (recovered) queueWorkspaceSave();
    }).catch(error => {
      console.error('EUPHONIA asset persistence failed:', error);
      failedAssetIds.add(item.id);
      setPersistenceStatus('STORAGE LIMITED', 'error');
      storageWriteFailure = error;
      return null;
    }).finally(() => pendingAssetWrites.delete(write));
    pendingAssetWrites.add(write);
  }

  async function restoreLocalWorkspace() {
    if (!localStorageAPI) {
      setPersistenceStatus('BROWSER STORAGE UNAVAILABLE', 'error');
      workspaceReady = true;
      return;
    }
    setPersistenceStatus('CHECKING LOCAL SESSION…', 'saving');
    state.isRestoring = true;
    try {
      const snapshot = await localStorageAPI.loadWorkspace();
      if (!snapshot || snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.files) || !Array.isArray(snapshot.tracks)) {
        setPersistenceStatus('LOCAL AUTOSAVE READY', 'saved');
        return;
      }
      // Build a temporary asset map before changing the live session. Missing assets are skipped safely.
      const assetMap = new Map();
      for (const meta of snapshot.files) {
        const stored = await localStorageAPI.getAsset(meta.id);
        if (!stored || !stored.blob) continue;
        const file = new File([stored.blob], meta.name || stored.name || 'Audio', { type: meta.type || stored.type || stored.blob.type || 'application/octet-stream', lastModified: Number(meta.lastModified || stored.lastModified) || Date.now() });
        const item = {
          id: meta.id, file, name: meta.name || stored.name || file.name, size: Number(meta.size) || file.size,
          type: fileType(file), lastModified: Number(meta.lastModified || stored.lastModified) || file.lastModified,
          addedAt: new Date(meta.addedAt || stored.addedAt || Date.now()), url: URL.createObjectURL(file), duration: Number(meta.duration || stored.duration) || 0,
          buffer: null, bufferPromise: null
        };
        assetMap.set(item.id, item);
      }
      state.files.forEach(item => { try { URL.revokeObjectURL(item.url); } catch (_) {} });
      state.files = snapshot.files.map(meta => assetMap.get(meta.id)).filter(Boolean);
      state.favorites = new Set((snapshot.favorites || []).filter(id => assetMap.has(id)));
      state.currentFileId = assetMap.has(snapshot.currentFileId) ? snapshot.currentFileId : null;
      state.dawTracks = [];
      state.selectedClipId = null;
      state.selectedTrackId = null;
      state.nextTrackId = 1;
      state.nextClipId = 1;
      for (const savedTrack of snapshot.tracks) {
        const id = Number(savedTrack.id) || state.nextTrackId;
        const track = { id, name: String(savedTrack.name || `Audio ${id}`).slice(0, 120), color: savedTrack.color || trackColors[(id - 1) % trackColors.length], volume: Math.max(0, Math.min(1, Number(savedTrack.volume ?? 0.82))), pan: Math.max(-1, Math.min(1, Number(savedTrack.pan) || 0)), muted: Boolean(savedTrack.muted), solo: Boolean(savedTrack.solo), clips: [] };
        for (const savedClip of (Array.isArray(savedTrack.clips) ? savedTrack.clips : [])) {
          const item = assetMap.get(savedClip.assetId);
          if (!item) continue;
          const start = Math.max(0, Number(savedClip.start) || 0);
          const offset = Math.max(0, Number(savedClip.offset) || 0);
          const duration = Math.max(0.01, Number(savedClip.duration) || item.duration || 0.01);
          track.clips.push({ id: Number(savedClip.id) || state.nextClipId++, item, name: String(savedClip.name || item.name).slice(0, 180), start, offset, duration, buffer: null });
        }
        state.nextTrackId = Math.max(state.nextTrackId, id + 1);
        for (const clip of track.clips) state.nextClipId = Math.max(state.nextClipId, clip.id + 1);
        state.dawTracks.push(track);
      }
      const settings = snapshot.settings || {};
      $('#bpmInput').value = Math.max(40, Math.min(240, Number(settings.tempo) || 118));
      if ([...$('#keySelect').options].some(option => option.value === settings.key || option.text === settings.key)) $('#keySelect').value = settings.key;
      if ([...$('#gridSelect').options].some(option => option.value === String(settings.grid))) $('#gridSelect').value = String(settings.grid);
      state.playheadSeconds = Math.max(0, Number(settings.playheadSeconds) || 0);
      state.pixelsPerSecond = Math.max(17, Math.min(112, Number(settings.pixelsPerSecond) || 44));
      if (settings.master) setMasterSettings(settings.master);
      if (window.EUPHONIA_DAW && typeof window.EUPHONIA_DAW.deserialize === 'function') window.EUPHONIA_DAW.deserialize(snapshot.advanced || {});
      state.selectedTrackId = state.dawTracks.length ? state.dawTracks[0].id : null;
      renderLibrary(); renderHomeRecent(); updateLibraryCount(); renderDaw();
      if (state.currentFileId) {
        const current = assetMap.get(state.currentFileId);
        if (current) { audioPlayer.src = current.url; audioPlayer.load(); $('#playerTitle').textContent = current.name; $('#playerArtist').textContent = 'Local Library · Restored'; }
      }
      $('#playerFav').classList.toggle('is-fav', Boolean(state.currentFileId && state.favorites.has(state.currentFileId)));
      $('#playerFav').textContent = state.currentFileId && state.favorites.has(state.currentFileId) ? '♥' : '♡';
      setPersistenceStatus('SESSION RESTORED', 'saved');
      if (!quietRestoreNotice) toast(`Sesi lokal dipulihkan: ${state.dawTracks.length} track, ${state.files.length} file audio.`);
      // Do not immediately rewrite the existing recovery snapshot while restoration is in progress.
    } catch (error) {
      console.error('EUPHONIA recovery failed:', error);
      setPersistenceStatus('RECOVERY WARNING', 'error');
      toast(`Sesi lokal tidak dapat dipulihkan: ${error.message}. Coba buka backup project.`, 'error');
    } finally {
      state.isRestoring = false;
      workspaceReady = true;
      if (window.EUPHONIA_STORAGE && window.EUPHONIA_STORAGE.requestPersistence) window.EUPHONIA_STORAGE.requestPersistence().catch(() => {});
    }
  }
  let quietRestoreNotice = false;

  function captureArrangementSnapshot() {
    return {
      tracks: state.dawTracks.map(track => ({ ...track, clips: track.clips.map(clip => ({ ...clip })) })),
      selectedTrackId: state.selectedTrackId, selectedClipId: state.selectedClipId, playheadSeconds: state.playheadSeconds,
      nextTrackId: state.nextTrackId, nextClipId: state.nextClipId
    };
  }

  function updateUndoRedoButtons() {
    const undo = $('#dawUndo'); const redo = $('#dawRedo');
    if (undo) undo.disabled = state.undoStack.length === 0;
    if (redo) redo.disabled = state.redoStack.length === 0;
  }

  function pushUndoSnapshot() {
    state.undoStack.push(captureArrangementSnapshot());
    if (state.undoStack.length > 40) state.undoStack.shift();
    state.redoStack = [];
    updateUndoRedoButtons();
  }

  function applyArrangementSnapshot(snapshot) {
    state.dawTracks = snapshot.tracks.map(track => ({ ...track, clips: track.clips.map(clip => ({ ...clip })) }));
    state.selectedTrackId = snapshot.selectedTrackId;
    state.selectedClipId = snapshot.selectedClipId;
    state.playheadSeconds = snapshot.playheadSeconds;
    state.nextTrackId = snapshot.nextTrackId;
    state.nextClipId = snapshot.nextClipId;
    renderDaw(); updateUndoRedoButtons();
    if (state.dawPlaying) { pauseDaw(); startDaw(); }
    queueWorkspaceSave();
  }

  function undoArrangement() {
    if (!state.undoStack.length) return;
    state.redoStack.push(captureArrangementSnapshot());
    applyArrangementSnapshot(state.undoStack.pop());
    setStatus('Arrangement edit undone');
  }

  function redoArrangement() {
    if (!state.redoStack.length) return;
    state.undoStack.push(captureArrangementSnapshot());
    applyArrangementSnapshot(state.redoStack.pop());
    setStatus('Arrangement edit redone');
  }

  function findSelectedClip() {
    for (const track of state.dawTracks) {
      const clip = track.clips.find(item => item.id === state.selectedClipId);
      if (clip) return { track, clip };
    }
    return null;
  }

  function deleteSelectedClip() {
    const found = findSelectedClip();
    if (!found) { toast('Pilih clip yang ingin dihapus terlebih dahulu.'); return; }
    pushUndoSnapshot();
    found.track.clips = found.track.clips.filter(clip => clip.id !== found.clip.id);
    state.selectedClipId = null;
    renderDaw(); setStatus('Clip deleted'); queueWorkspaceSave(); restartArrangementIfPlaying();
  }

  function splitSelectedClipAtPlayhead() {
    const found = findSelectedClip();
    if (!found) { toast('Pilih clip yang ingin dipotong terlebih dahulu.'); return; }
    const { track, clip } = found;
    const splitOffset = state.playheadSeconds - clip.start;
    if (splitOffset < 0.05 || splitOffset > clip.duration - 0.05) {
      toast('Pindahkan playhead ke bagian dalam clip untuk melakukan split.', 'error');
      return;
    }
    pushUndoSnapshot();
    const rightClip = {
      ...clip,
      id: state.nextClipId++,
      name: `${clip.name} (split)`,
      start: state.playheadSeconds,
      offset: Math.max(0, Number(clip.offset) || 0) + splitOffset,
      duration: clip.duration - splitOffset,
      buffer: clip.buffer || clip.item.buffer || null
    };
    clip.duration = splitOffset;
    track.clips.push(rightClip);
    state.selectedClipId = rightClip.id;
    renderDaw(); setStatus(`Clip split at ${fmtTime(state.playheadSeconds)}`); queueWorkspaceSave(); restartArrangementIfPlaying();
  }

  function duplicateSelectedClip() {
    const found = findSelectedClip();
    if (!found) { toast('Pilih clip yang ingin diduplikasi terlebih dahulu.'); return; }
    pushUndoSnapshot();
    const copy = { ...found.clip, id: state.nextClipId++, name: `${found.clip.name} copy`, start: found.clip.start + found.clip.duration, buffer: found.clip.buffer || found.clip.item.buffer || null };
    found.track.clips.push(copy);
    state.selectedClipId = copy.id;
    renderDaw(); setStatus('Clip duplicated'); queueWorkspaceSave(); restartArrangementIfPlaying();
  }

  const fmtTime = seconds => {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const s = Math.floor(seconds);
    const minutes = Math.floor(s / 60);
    const sec = String(s % 60).padStart(2, '0');
    return `${minutes}:${sec}`;
  };
  const fmtTimeCode = seconds => {
    const s = Math.max(0, Math.floor(seconds || 0));
    const h = String(Math.floor(s / 3600)).padStart(2, '0');
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const sec = String(s % 60).padStart(2, '0');
    return `${h}:${m}:${sec}`;
  };
  const fmtSize = bytes => {
    if (!Number.isFinite(bytes)) return '—';
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };
  const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  function toast(message, type = 'success') {
    const node = document.createElement('div');
    node.className = `toast${type === 'error' ? ' error' : ''}`;
    node.textContent = message;
    toastRegion.appendChild(node);
    window.setTimeout(() => node.remove(), 3800);
  }

  function setStatus(message) {
    $('#dawStatusText').textContent = message;
  }

  function showPage(name) {
    const valid = ['home', 'discover', 'library', 'studio'].includes(name) ? name : 'home';
    $$('.page').forEach(page => page.classList.toggle('active', page.id === `page-${valid}`));
    $$('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.page === valid));
    $('#pageBreadcrumb').textContent = ({ home: 'Home', discover: 'Music Hub', library: 'Library', studio: 'Studio / DAW' })[valid];
    $('#sidebar').classList.remove('open');
    $('#mobileScrim').hidden = true;
    $('#mobileMenu').setAttribute('aria-expanded', 'false');
    if (valid === 'studio') renderDaw();
  }

  function fileType(file) {
    const name = file.name || 'audio';
    const ext = name.includes('.') ? name.split('.').pop().toUpperCase() : '';
    if (ext && ext.length <= 5) return ext;
    const type = (file.type || '').split('/').pop();
    return type ? type.toUpperCase().replace('MPEG', 'MP3') : 'AUDIO';
  }

  function getAudioContext() {
    if (!state.audioContext) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) throw new Error('Browser ini belum mendukung Web Audio API. Coba Chrome atau Edge versi terbaru.');
      state.audioContext = new AudioCtx();
    }
    if (state.audioContext.state === 'suspended') state.audioContext.resume().catch(() => {});
    return state.audioContext;
  }

  function createLibraryItem(file) {
    const existing = state.files.find(item => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified);
    if (existing) return existing;
    const item = {
      id: uid(), file, name: file.name || 'Untitled audio', size: file.size || 0,
      type: fileType(file), lastModified: file.lastModified || Date.now(),
      addedAt: new Date(), url: URL.createObjectURL(file), duration: 0,
      buffer: null, bufferPromise: null
    };
    state.files.unshift(item);
    readDuration(item);
    persistAsset(item);
    queueWorkspaceSave();
    return item;
  }

  function readDuration(item) {
    const probe = document.createElement('audio');
    probe.preload = 'metadata';
    probe.src = item.url;
    probe.addEventListener('loadedmetadata', () => {
      if (Number.isFinite(probe.duration)) item.duration = probe.duration;
      probe.src = '';
      renderLibrary();
      renderHomeRecent();
      updateProjectDuration();
      if (!state.isRestoring) { persistAsset(item); queueWorkspaceSave(); }
    }, { once: true });
    probe.addEventListener('error', () => { probe.src = ''; }, { once: true });
  }

  async function decodeItem(item) {
    if (item.buffer) return item.buffer;
    if (item.bufferPromise) return item.bufferPromise;
    item.bufferPromise = (async () => {
      const ctx = getAudioContext();
      const arrayBuffer = await item.file.arrayBuffer();
      const buffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
      item.buffer = buffer;
      item.duration = buffer.duration;
      renderLibrary();
      renderHomeRecent();
      updateProjectDuration();
      if (!state.isRestoring) { persistAsset(item); queueWorkspaceSave(); }
      return buffer;
    })().catch(error => {
      item.bufferPromise = null;
      throw error;
    });
    return item.bufferPromise;
  }

  async function importFiles(fileList, purpose = 'library') {
    const files = Array.from(fileList || []).filter(file => file && (file.type.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac|flac|aiff|opus|webm)$/i.test(file.name)));
    if (!files.length) {
      if (fileList && fileList.length) toast('Pilih file audio yang didukung browser.', 'error');
      return;
    }
    const imported = files.map(createLibraryItem);
    queueWorkspaceSave();
    renderLibrary();
    renderHomeRecent();
    updateLibraryCount();
    toast(`${imported.length} file audio ditambahkan ke Library.`);
    if (purpose === 'daw') {
      for (const item of imported) {
        try { await addItemToDaw(item); }
        catch (error) { toast(`Gagal membaca ${item.name}: ${error.message}`, 'error'); }
      }
      showPage('studio');
    } else if (purpose === 'play') {
      playItem(imported[0]);
    }
  }

  function askImport(purpose = 'library', multiple = true) {
    state.inputPurpose = purpose;
    const input = multiple ? audioFilesInput : singleAudioInput;
    input.value = '';
    input.click();
  }

  function updateLibraryCount() {
    $('#libraryCount').textContent = String(state.files.length);
    $('#trackCountLabel').textContent = `${state.files.length} track${state.files.length === 1 ? '' : 's'}`;
  }

  const homeShelfConfig = [
    { id: 'homeFreshRail', query: 'top hits pop', title: 'Fresh finds' },
    { id: 'homeRnbRail', query: 'alternative r&b', title: 'Alternative R&B essentials' },
    { id: 'homeRapRail', query: 'melodic rap', title: 'Melodic rap & emo' },
    { id: 'homeIndieRail', query: 'indie pop', title: 'Indie, for the ride' }
  ];
  let homeFeaturedItem = null;
  const homeCatalogItems = new Map();
  const homeCatalogQueues = new Map();

  function homeTrackKey(item) {
    return String(item && (item.trackId || item.collectionId) || '');
  }

  function homeArtwork(item, size = 600) {
    const raw = String(item && (item.artworkUrl100 || item.artworkUrl60) || '');
    if (!raw) return '';
    return raw.replace(/\d+x\d+bb/, `${size}x${size}bb`);
  }

  function getHomeSavedTracks() {
    try {
      const value = JSON.parse(localStorage.getItem('euphonia.homeSavedTracks.v1') || '[]');
      return Array.isArray(value) ? value.filter(item => item && item.trackId && item.previewUrl) : [];
    } catch (_) { return []; }
  }

  function updateHomeSavedButtons() {
    const savedIds = new Set(getHomeSavedTracks().map(item => String(item.trackId)));
    $('.stream-save-track[data-stream-save]').forEach(button => {
      const saved = savedIds.has(button.dataset.streamSave);
      button.classList.toggle('is-saved', saved);
      button.textContent = saved ? '✓' : '＋';
      button.setAttribute('aria-label', saved ? 'Remove from My List' : 'Add to My List');
      button.title = saved ? 'Remove from My List' : 'Add to My List';
    });
    const featureButton = $('#homeFeaturedSave');
    if (featureButton && homeFeaturedItem) {
      const saved = savedIds.has(homeTrackKey(homeFeaturedItem));
      featureButton.classList.toggle('is-saved', saved);
      featureButton.innerHTML = saved ? '<span>✓</span> In My List' : '<span>＋</span> My List';
    }
  }

  function renderHomeTrackCards(hostId, items, queue = items) {
    const host = document.getElementById(hostId);
    if (!host) return;
    const playable = (items || []).filter(item => item && item.previewUrl && homeTrackKey(item));
    if (!playable.length) {
      host.innerHTML = '<div class="stream-shelf-empty"><strong>Nothing to play here yet.</strong><span>Search the catalog to find a track with a preview.</span><button type="button" class="stream-text-link" data-home-search="alternative r&b">Find music →</button></div>';
      return;
    }
    const queueItems = (queue || playable).filter(item => item && item.previewUrl);
    playable.forEach(item => {
      const key = homeTrackKey(item);
      homeCatalogItems.set(key, item);
      homeCatalogQueues.set(key, queueItems.length ? queueItems : [item]);
    });
    const savedIds = new Set(getHomeSavedTracks().map(entry => String(entry.trackId)));
    host.innerHTML = playable.slice(0, 14).map((item, index) => {
      const key = homeTrackKey(item);
      const art = homeArtwork(item, 600);
      const title = item.trackName || item.collectionName || 'Untitled track';
      const artist = item.artistName || 'Unknown artist';
      const saved = savedIds.has(key);
      const color = trackColors[index % trackColors.length];
      return `<article class="stream-track-card">
        <div class="stream-track-art-wrap" style="--track-accent:${color}">
          <button type="button" class="stream-art-button" data-stream-play="${escapeHTML(key)}" aria-label="Play preview: ${escapeHTML(title)}">
            <img src="${escapeHTML(art)}" alt="" loading="lazy" decoding="async" />
            <span class="stream-art-play" aria-hidden="true">▶</span>
          </button>
          <button type="button" class="stream-save-track ${saved ? 'is-saved' : ''}" data-stream-save="${escapeHTML(key)}" title="${saved ? 'Remove from My List' : 'Add to My List'}" aria-label="${saved ? 'Remove from My List' : 'Add to My List'}">${saved ? '✓' : '＋'}</button>
        </div>
        <div class="stream-track-meta"><strong title="${escapeHTML(title)}">${escapeHTML(title)}</strong><small title="${escapeHTML(artist)}">${escapeHTML(artist)}</small></div>
      </article>`;
    }).join('');
    updateHomeSavedButtons();
  }

  function renderHomeSavedRail() {
    const saved = getHomeSavedTracks();
    if (!saved.length) {
      const host = $('#homeSavedRail');
      if (host) host.innerHTML = '<div class="stream-shelf-empty"><strong>Your list starts here.</strong><span>Tap + on any track to keep it close.</span></div>';
      updateHomeSavedButtons();
      return;
    }
    renderHomeTrackCards('homeSavedRail', saved, saved);
    updateHomeSavedButtons();
  }

  function toggleHomeSaved(item) {
    if (!item || !item.trackId || !item.previewUrl) {
      toast('Track ini belum menyediakan preview yang bisa disimpan.', 'error');
      return;
    }
    const id = String(item.trackId);
    const saved = getHomeSavedTracks();
    const exists = saved.some(entry => String(entry.trackId) === id);
    const next = exists ? saved.filter(entry => String(entry.trackId) !== id) : [{
      trackId: item.trackId,
      trackName: item.trackName || item.collectionName || 'Untitled track',
      artistName: item.artistName || 'Unknown artist',
      collectionName: item.collectionName || '',
      artworkUrl100: item.artworkUrl100 || '',
      previewUrl: item.previewUrl,
      trackViewUrl: item.trackViewUrl || ''
    }, ...saved].slice(0, 100);
    try { localStorage.setItem('euphonia.homeSavedTracks.v1', JSON.stringify(next)); }
    catch (_) { toast('Browser tidak bisa menyimpan My List. Periksa ruang penyimpanan atau pengaturan privasi.', 'error'); return; }
    const favoriteId = `apple:${id}`;
    if (exists) state.favorites.delete(favoriteId); else state.favorites.add(favoriteId);
    queueWorkspaceSave();
    renderHomeSavedRail();
    updateHomeSavedButtons();
    if (state.externalTrack && String(state.externalTrack.trackId) === id) {
      $('#playerFav').classList.toggle('is-fav', !exists);
      $('#playerFav').textContent = exists ? '♡' : '♥';
    }
    toast(exists ? 'Track dihapus dari My List.' : 'Track disimpan ke My List.');
  }

  function renderHomeRecent() {
    const host = $('#homeRecent');
    if (!host) return;
    const recent = state.files.slice(0, 8);
    const count = $('#homeLocalCount');
    if (count) count.textContent = state.files.length ? `${state.files.length} LOCAL TRACK${state.files.length === 1 ? '' : 'S'}` : 'YOUR LIBRARY';
    if (!recent.length) {
      host.innerHTML = '<div class="stream-shelf-empty"><strong>No local tracks yet.</strong><span>Import your own audio to build a personal collection.</span><button class="outline-button" id="emptyImport" type="button">＋ Import audio</button></div>';
      $('#emptyImport')?.addEventListener('click', () => askImport('library'));
      return;
    }
    host.innerHTML = recent.map((item, index) => {
      const color = trackColors[index % trackColors.length];
      const isPlaying = state.currentFileId === item.id && !audioPlayer.paused;
      return `<article class="stream-track-card">
        <div class="stream-track-art-wrap" style="background:linear-gradient(140deg,${color}66,#18151f)">
          <button type="button" class="stream-art-button stream-local-art" data-play-file="${escapeHTML(item.id)}" aria-label="Play local track: ${escapeHTML(item.name)}">
            <span class="stream-local-cover" style="--track-accent:${color}"><i></i><i></i><i></i><b>♫</b></span>
            <span class="stream-art-play" aria-hidden="true">${isPlaying ? 'Ⅱ' : '▶'}</span>
          </button>
        </div>
        <div class="stream-track-meta"><strong title="${escapeHTML(item.name)}">${escapeHTML(item.name)}</strong><small>Local audio · ${escapeHTML(item.type)} · ${item.duration ? fmtTime(item.duration) : '—'}</small></div>
      </article>`;
    }).join('');
  }

  function setHomeFeatured(item, queue = [item]) {
    if (!item) return;
    homeFeaturedItem = item;
    const key = homeTrackKey(item);
    homeCatalogItems.set(key, item);
    homeCatalogQueues.set(key, queue);
    $('#homeFeaturedTitle').textContent = item.trackName || item.collectionName || 'Fresh finds';
    $('#homeFeaturedMeta').textContent = [item.artistName, item.collectionName].filter(Boolean).join(' · ') || 'Featured music preview';
    $('#homeFeaturedDesc').textContent = `A first listen to ${item.trackName || item.collectionName || 'something new'} — preview playback is available here when the provider supplies it.`;
    const art = homeArtwork(item, 1200);
    if (art) $('#streamHeroArt').style.backgroundImage = `linear-gradient(90deg,rgba(9,9,13,.96) 0%,rgba(9,9,13,.82) 28%,rgba(9,9,13,.42) 58%,rgba(9,9,13,.22) 100%),linear-gradient(0deg,rgba(9,9,13,.98) 0%,transparent 52%),url("${art}")`;
    updateHomeSavedButtons();
  }

  async function requestHomeCatalog(query) {
    const url = new URL('https://itunes.apple.com/search');
    url.search = new URLSearchParams({ term: query, entity: 'song', limit: '18', country: 'ID', media: 'music' }).toString();
    const response = await fetch(url.href, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Catalog HTTP ${response.status}`);
    const data = await response.json();
    return (Array.isArray(data.results) ? data.results : []).filter(item => item.trackId && item.trackName && item.previewUrl && item.artworkUrl100);
  }

  async function loadHomeCatalog() {
    const results = await Promise.all(homeShelfConfig.map(async shelf => {
      try { return { shelf, items: await requestHomeCatalog(shelf.query) }; }
      catch (error) { console.warn(`EUPHONIA home shelf unavailable: ${shelf.query}`, error); return { shelf, items: [] }; }
    }));
    let featureSet = null;
    results.forEach(({ shelf, items }) => {
      renderHomeTrackCards(shelf.id, items);
      if (shelf.id === 'homeFreshRail' && items.length) featureSet = { items, queue: items };
    });
    if (featureSet) setHomeFeatured(featureSet.items[0], featureSet.queue);
    else {
      const art = $('#streamHeroArt');
      if (art) art.style.backgroundImage = 'radial-gradient(ellipse at 76% 22%,#6a467e 0%,#2a203b 32%,#100f17 75%)';
      $('#homeFeaturedPlay').textContent = 'Search music';
      $('#homeFeaturedPlay').insertAdjacentHTML('afterbegin', '<span>⌕</span>');
      $('#homeFeaturedDesc').textContent = 'Catalog preview is temporarily unavailable. You can still search for tracks in Music Hub or play your local collection.';
    }
    renderHomeSavedRail();
  }

  function renderLibrary() {
    updateLibraryCount();
    const host = $('#libraryRows');
    let items = [...state.files];
    if (state.libraryFilter === 'recent') items = items.slice(0, 10);
    if (!items.length) {
      host.innerHTML = `<tr><td colspan="6" class="track-row-empty"><div class="empty-state"><span class="empty-note">♫</span><strong>No audio imported yet</strong><p>Tambah file audio dari perangkat untuk mulai mendengarkan.</p><button class="primary-button" id="libraryEmptyImport">Import audio</button></div></td></tr>`;
      $('#libraryEmptyImport').addEventListener('click', () => askImport('library'));
      return;
    }
    host.innerHTML = items.map((item, index) => `
      <tr class="audio-row ${state.currentFileId === item.id ? 'is-playing' : ''}" data-row-file="${item.id}" tabindex="0">
        <td class="track-num"><span class="track-number">${String(index + 1).padStart(2, '0')}</span></td>
        <td><div class="track-title-cell"><span class="track-art" style="background:linear-gradient(140deg,${trackColors[index % trackColors.length]}3a,#202329);color:${trackColors[index % trackColors.length]}">${state.currentFileId === item.id && !audioPlayer.paused ? '♫' : '♪'}</span><span class="track-title-text"><strong title="${escapeHTML(item.name)}">${escapeHTML(item.name)}</strong><small>Local file · ${item.duration ? fmtTime(item.duration) : 'Reading metadata…'}</small></span></div></td>
        <td><span class="format-pill">${escapeHTML(item.type)}</span></td><td>${fmtSize(item.size)}</td><td>${item.addedAt.toLocaleDateString('id-ID',{day:'2-digit',month:'short'})}</td>
        <td><button class="row-menu" data-row-action="menu" data-file-id="${item.id}" title="Track options">···</button></td>
      </tr>`).join('');
  }

  function playItem(item) {
    if (!item) return;
    state.externalTrack = null;
    state.externalQueue = [];
    $('#playerArtwork').style.backgroundImage = 'none';
    $('#playerArtwork').innerHTML = '<span>♫</span>';
    state.currentFileId = item.id;
    queueWorkspaceSave();
    audioPlayer.src = item.url;
    audioPlayer.load();
    const playPromise = audioPlayer.play();
    if (playPromise && playPromise.catch) playPromise.catch(() => toast('Playback tidak dapat dimulai. Coba tekan Play lagi.', 'error'));
    $('#playerTitle').textContent = item.name;
    $('#playerArtist').textContent = `${item.type} · Local audio`;
    $('#playerArtwork').style.background = `linear-gradient(140deg, ${trackColors[state.files.indexOf(item) % trackColors.length] || '#c9f36a'}66, #202329)`;
    $('#playerFav').classList.toggle('is-fav', state.favorites.has(item.id));
    $('#playerFav').textContent = state.favorites.has(item.id) ? '♥' : '♡';
    $('#playerToggle').textContent = 'Ⅱ';
    renderLibrary();
  }

  function currentItem() { return state.files.find(item => item.id === state.currentFileId) || null; }

  function togglePlayer() {
    if (!audioPlayer.src) {
      const item = state.files[0];
      if (!item) { toast('Import audio dulu untuk memulai playback.'); askImport('library'); return; }
      playItem(item);
      return;
    }
    if (audioPlayer.paused) {
      audioPlayer.play().then(() => { $('#playerToggle').textContent = 'Ⅱ'; }).catch(() => toast('Playback belum bisa dimulai.', 'error'));
    } else {
      audioPlayer.pause();
    }
  }

  function nextPlayerTrack(direction) {
    if (state.externalTrack) {
      const queue = (state.externalQueue || []).filter(item => item && item.previewUrl);
      if (!queue.length) return;
      const currentIndex = queue.findIndex(item => String(item.trackId) === String(state.externalTrack.trackId));
      const nextIndex = currentIndex < 0 ? 0 : (currentIndex + direction + queue.length) % queue.length;
      playApplePreview(queue[nextIndex], queue);
      return;
    }
    if (!state.files.length) return;
    const currentIndex = state.files.findIndex(item => item.id === state.currentFileId);
    const nextIndex = currentIndex < 0 ? 0 : (currentIndex + direction + state.files.length) % state.files.length;
    playItem(state.files[nextIndex]);
  }

  function updatePlayerProgress() {
    const duration = Number.isFinite(audioPlayer.duration) ? audioPlayer.duration : 0;
    const current = Number.isFinite(audioPlayer.currentTime) ? audioPlayer.currentTime : 0;
    $('#playerCurrentTime').textContent = fmtTime(current);
    $('#playerTotalTime').textContent = fmtTime(duration);
    $('#playerSeek').value = duration ? Math.round(current / duration * 1000) : 0;
    $('#playerToggle').textContent = audioPlayer.paused ? '▶' : 'Ⅱ';
  }

  const platformNames = {
    youtube: 'YouTube Music', spotify: 'Spotify', apple: 'Apple Music',
    soundcloud: 'SoundCloud', deezer: 'Deezer', bandcamp: 'Bandcamp'
  };
  const platformMarks = { youtube: '▶', spotify: '≋', apple: '♫', soundcloud: '☁', deezer: '▥', bandcamp: 'b' };
  // EUPHONIA never opens a platform search/library in a new tab. Users paste a playlist
  // share URL and supported official embed players render it inside the Music Hub.
  const platformLibraryLabels = {
    youtube: 'playlist YouTube Music', spotify: 'playlist Spotify', apple: 'perpustakaan Apple Music',
    soundcloud: 'playlist dan set SoundCloud', deezer: 'playlist Deezer', bandcamp: 'koleksi Bandcamp'
  };
  let activeHubProvider = 'catalog';
  let appleSearchSequence = 0;
  let youtubeSearchSequence = 0;

  const spotifyKeys = {
    clientId: 'euphonia.spotify.clientId',
    session: 'euphonia.spotify.session',
    verifier: 'euphonia.spotify.pkce.verifier',
    oauthState: 'euphonia.spotify.pkce.state',
    redirectUri: 'euphonia.spotify.pkce.redirectUri'
  };
  let spotifyPlaylistItems = [];
  let spotifyNextPlaylistsUrl = null;
  let spotifyProfile = null;

  function getSpotifyClientId() {
    try { return (localStorage.getItem(spotifyKeys.clientId) || '').trim(); } catch (_) { return ''; }
  }
  function getSpotifySession() {
    try {
      const session = JSON.parse(sessionStorage.getItem(spotifyKeys.session) || 'null');
      return session && typeof session === 'object' ? session : null;
    } catch (_) { return null; }
  }
  function setSpotifySession(session) {
    try {
      if (session) sessionStorage.setItem(spotifyKeys.session, JSON.stringify(session));
      else sessionStorage.removeItem(spotifyKeys.session);
    } catch (_) { throw new Error('Browser tidak mengizinkan penyimpanan sesi sementara.'); }
  }
  function spotifyRedirectUri() { return `${location.origin}${location.pathname}`; }
  function setSpotifyNotice(message, tone = 'info') {
    const host = $('#spotifyAccountNotice');
    if (!host) return;
    host.dataset.tone = tone;
    const paragraph = host.querySelector('p');
    if (paragraph) paragraph.textContent = message;
  }
  function updateSpotifyConnectionUI() {
    const session = getSpotifySession();
    const connected = Boolean(session && (session.access_token || session.refresh_token));
    $('#spotifyAccountTitle').textContent = connected
      ? (spotifyProfile?.display_name ? `Spotify · ${spotifyProfile.display_name}` : 'Spotify connected')
      : 'Connect Spotify';
    $('#spotifyAccountStatus').textContent = connected
      ? 'Account authorization is active in this browser tab.'
      : 'Browse your own Spotify playlists inside EUPHONIA.';
    $('#spotifyConnectButton').textContent = connected ? 'Load my playlists' : 'Connect account';
    $('#spotifyDisconnectButton').hidden = !connected;
    $('#spotifyConnectSettings').textContent = getSpotifyClientId() ? 'Edit setup' : 'Setup';
    $('#spotifyClientIdInput').value = getSpotifyClientId();
    $('#spotifyRedirectUri').textContent = spotifyRedirectUri();
  }
  function showSpotifyConnectPanel({ openSettings = false } = {}) {
    const panel = $('#spotifyConnectPanel');
    if (!panel) return;
    panel.hidden = false;
    if (openSettings) $('#spotifyClientConfigPanel').hidden = false;
    updateSpotifyConnectionUI();
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function randomBase64Url(byteLength = 48) {
    const bytes = new Uint8Array(byteLength);
    crypto.getRandomValues(bytes);
    let binary = '';
    bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }
  async function createSpotifyCodeChallenge(verifier) {
    if (!crypto.subtle) throw new Error('Spotify login membutuhkan HTTPS atau localhost agar PKCE dapat dibuat dengan aman.');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    let binary = '';
    new Uint8Array(digest).forEach(byte => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }
  function clearSpotifyOAuthState() {
    [spotifyKeys.verifier, spotifyKeys.oauthState, spotifyKeys.redirectUri].forEach(key => {
      try { sessionStorage.removeItem(key); } catch (_) {}
    });
  }
  async function startSpotifyAuthorization() {
    const clientId = getSpotifyClientId();
    if (!clientId) {
      showSpotifyConnectPanel({ openSettings: true });
      setSpotifyNotice('Tambahkan Client ID terlebih dahulu. Client Secret tidak diperlukan untuk OAuth PKCE di browser.', 'error');
      $('#spotifyClientIdInput').focus();
      return;
    }
    const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
    if (location.protocol !== 'https:' && !isLocal) {
      setSpotifyNotice('Spotify OAuth perlu HTTPS (atau localhost saat development). Buka EUPHONIA dari URL HTTPS yang didaftarkan.', 'error');
      return;
    }
    try {
      const verifier = randomBase64Url(64);
      const challenge = await createSpotifyCodeChallenge(verifier);
      const stateToken = randomBase64Url(24);
      const redirectUri = spotifyRedirectUri();
      sessionStorage.setItem(spotifyKeys.verifier, verifier);
      sessionStorage.setItem(spotifyKeys.oauthState, stateToken);
      sessionStorage.setItem(spotifyKeys.redirectUri, redirectUri);
      const authorize = new URL('https://accounts.spotify.com/authorize');
      authorize.search = new URLSearchParams({
        client_id: clientId,
        response_type: 'code',
        redirect_uri: redirectUri,
        scope: 'playlist-read-private playlist-read-collaborative user-read-private',
        code_challenge_method: 'S256',
        code_challenge: challenge,
        state: stateToken
      }).toString();
      setSpotifyNotice('Mengalihkan ke login resmi Spotify. EUPHONIA tidak pernah meminta password Spotify.', 'info');
      location.assign(authorize.href);
    } catch (error) {
      setSpotifyNotice(`Tidak bisa memulai login Spotify: ${error.message || 'PKCE gagal dibuat'}`, 'error');
    }
  }
  async function requestSpotifyToken(body) {
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error_description || data.error || `Spotify token endpoint HTTP ${response.status}`);
    return data;
  }
  async function getSpotifyAccessToken(forceRefresh = false) {
    const session = getSpotifySession();
    if (!session) throw new Error('Hubungkan akun Spotify terlebih dahulu.');
    if (!forceRefresh && session.access_token && Number(session.expires_at) > Date.now() + 60000) return session.access_token;
    if (!session.refresh_token) {
      setSpotifySession(null);
      throw new Error('Sesi Spotify kedaluwarsa. Hubungkan akun lagi.');
    }
    const refreshed = await requestSpotifyToken({
      grant_type: 'refresh_token',
      refresh_token: session.refresh_token,
      client_id: getSpotifyClientId()
    });
    const next = {
      ...session,
      access_token: refreshed.access_token,
      expires_at: Date.now() + Math.max(60, Number(refreshed.expires_in) || 3600) * 1000,
      refresh_token: refreshed.refresh_token || session.refresh_token
    };
    setSpotifySession(next);
    return next.access_token;
  }
  async function spotifyApi(url, retryAfter401 = true) {
    const accessToken = await getSpotifyAccessToken();
    const target = new URL(url, 'https://api.spotify.com');
    if (target.origin !== 'https://api.spotify.com') throw new Error('Permintaan Spotify ditolak karena host tidak valid.');
    const response = await fetch(target.href, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }
    });
    if (response.status === 401 && retryAfter401) {
      await getSpotifyAccessToken(true);
      return spotifyApi(target.href, false);
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 403) throw new Error('Spotify menolak akses. Periksa syarat akun developer, daftar pengguna yang diizinkan, serta scope playlist.');
      if (response.status === 429) throw new Error('Spotify membatasi permintaan sementara. Tunggu sebentar lalu coba lagi.');
      throw new Error(data.error?.message || `Spotify API HTTP ${response.status}`);
    }
    return data;
  }
  function renderSpotifyPlaylists(items, append = false) {
    const grid = $('#spotifyPlaylistGrid');
    if (!append) grid.replaceChildren();
    if (!append && !items.length) {
      const empty = document.createElement('div');
      empty.className = 'spotify-playlist-empty';
      const title = document.createElement('strong'); title.textContent = 'No playlists returned';
      const note = document.createElement('span'); note.textContent = 'Refresh, or check your Spotify account permissions.';
      empty.append(title, note); grid.append(empty);
    }
    items.forEach(playlist => {
      const card = document.createElement('article'); card.className = 'spotify-playlist-card';
      const cover = document.createElement('div'); cover.className = 'spotify-playlist-cover';
      const rawImage = playlist.images?.[0]?.url;
      if (rawImage) {
        try {
          const source = new URL(rawImage);
          if (source.protocol === 'https:' && source.hostname === 'i.scdn.co') {
            const image = document.createElement('img'); image.loading = 'lazy'; image.alt = ''; image.src = source.href;
            image.addEventListener('error', () => image.remove(), { once: true }); cover.append(image);
          }
        } catch (_) {}
      }
      if (!cover.childElementCount) cover.textContent = '♫';
      const body = document.createElement('div'); body.className = 'spotify-playlist-card-body';
      const title = document.createElement('strong'); title.textContent = playlist.name || 'Untitled playlist'; title.title = title.textContent;
      const owner = playlist.owner?.display_name || playlist.owner?.id || 'Spotify playlist';
      const count = playlist.items?.total ?? playlist.tracks?.total;
      const meta = document.createElement('small');
      meta.textContent = `${owner} · ${Number.isFinite(Number(count)) ? `${count} tracks` : 'Playlist'} · ${playlist.public === false ? 'Private' : 'Available playlist'}`;
      body.append(title, meta);
      const actions = document.createElement('div'); actions.className = 'spotify-playlist-card-actions';
      const play = document.createElement('button'); play.type = 'button'; play.className = 'primary-button'; play.textContent = '▶ Play inside';
      play.addEventListener('click', () => playSpotifyPlaylist(playlist));
      const save = document.createElement('button'); save.type = 'button'; save.className = 'outline-button'; save.textContent = 'Save link';
      save.addEventListener('click', () => {
        const url = playlist.external_urls?.spotify || `https://open.spotify.com/playlist/${encodeURIComponent(playlist.id)}`;
        savePlaylistLink('spotify', url);
        $('#embedLinkInput').value = url;
        setHubStatus(`Link playlist “${playlist.name || 'Spotify'}” tersimpan di browser ini.`, 'success');
      });
      actions.append(play, save); card.append(cover, body, actions); grid.append(card);
    });
    $('#spotifyLoadMore').hidden = !spotifyNextPlaylistsUrl;
    $('#spotifyLoadMore').disabled = !spotifyNextPlaylistsUrl;
  }
  function playSpotifyPlaylist(playlist) {
    if (!playlist || !playlist.id) return;
    const shareUrl = playlist.external_urls?.spotify || `https://open.spotify.com/playlist/${encodeURIComponent(playlist.id)}`;
    const embedUrl = `https://open.spotify.com/embed/playlist/${encodeURIComponent(playlist.id)}?utm_source=generator`;
    setHubProvider('spotify');
    savePlaylistLink('spotify', shareUrl);
    $('#embedLinkInput').value = shareUrl;
    loadOfficialEmbed('spotify', embedUrl, playlist.name || 'Spotify playlist');
    setHubStatus(`“${playlist.name || 'Spotify playlist'}” dibuka melalui Spotify Embed resmi. Pemutaran playlist privat mengikuti aturan Spotify dan pengaturan browser.`, 'success');
  }
  async function loadSpotifyPlaylists({ append = false, searchQuery = '' } = {}) {
    $('#spotifyPlaylistPanel').hidden = false;
    const grid = $('#spotifyPlaylistGrid');
    const nextUrl = append ? spotifyNextPlaylistsUrl : null;
    if (!append) {
      grid.innerHTML = '<div class="spotify-playlist-empty"><span class="stream-loading-dot"></span><strong>Loading your playlists…</strong></div>';
      spotifyPlaylistItems = [];
      spotifyNextPlaylistsUrl = null;
    }
    $('#spotifyRefreshPlaylists').disabled = true;
    $('#spotifyLoadMore').disabled = true;
    try {
      const url = nextUrl || 'https://api.spotify.com/v1/me/playlists?limit=50';
      if (append && !nextUrl) return;
      const data = await spotifyApi(url);
      const incoming = Array.isArray(data.items) ? data.items : [];
      spotifyPlaylistItems = append ? spotifyPlaylistItems.concat(incoming) : incoming;
      spotifyNextPlaylistsUrl = data.next || null;
      if (searchQuery) {
        const needle = searchQuery.toLocaleLowerCase();
        const matches = spotifyPlaylistItems.filter(item => `${item.name || ''} ${item.description || ''} ${item.owner?.display_name || ''}`.toLocaleLowerCase().includes(needle));
        renderSpotifyPlaylists(matches);
        setSpotifyNotice(matches.length ? `Found ${matches.length} matching playlist(s).` : 'No playlist matched that search. Try another name.', 'success');
      } else {
        renderSpotifyPlaylists(append ? incoming : spotifyPlaylistItems, append);
        setSpotifyNotice(`Loaded ${spotifyPlaylistItems.length} playlist(s). Choose Play inside to open Spotify’s official embed player.`, 'success');
      }
      updateSpotifyConnectionUI();
    } catch (error) {
      renderSpotifyPlaylists([]);
      setSpotifyNotice(`Could not load Spotify playlists: ${error.message || 'request failed'}`, 'error');
    } finally {
      $('#spotifyRefreshPlaylists').disabled = false;
      $('#spotifyLoadMore').disabled = !spotifyNextPlaylistsUrl;
    }
  }
  async function handleSpotifyOAuthCallback() {
    const params = new URLSearchParams(location.search);
    const code = params.get('code');
    const returnedError = params.get('error');
    if (!code && !returnedError) return;
    const returnedState = params.get('state') || '';
    const expectedState = sessionStorage.getItem(spotifyKeys.oauthState) || '';
    const verifier = sessionStorage.getItem(spotifyKeys.verifier) || '';
    const redirectUri = sessionStorage.getItem(spotifyKeys.redirectUri) || spotifyRedirectUri();
    history.replaceState({}, document.title, `${location.pathname}${location.hash}`);
    showPage('discover');
    setHubProvider('spotify');
    showSpotifyConnectPanel();
    if (returnedError) {
      clearSpotifyOAuthState();
      setSpotifyNotice(returnedError === 'access_denied' ? 'Login dibatalkan. EUPHONIA belum diberi izin membaca playlist.' : `Spotify login error: ${returnedError}`, 'error');
      return;
    }
    if (!code || !expectedState || returnedState !== expectedState || !verifier) {
      clearSpotifyOAuthState();
      setSpotifyNotice('Spotify callback tidak lolos pemeriksaan state. Mulai koneksi lagi untuk keamanan.', 'error');
      return;
    }
    try {
      if (redirectUri !== spotifyRedirectUri()) throw new Error('Redirect URI berubah selama login. Pastikan URL terdaftar sama persis.');
      const token = await requestSpotifyToken({
        grant_type: 'authorization_code', code, redirect_uri: redirectUri,
        client_id: getSpotifyClientId(), code_verifier: verifier
      });
      setSpotifySession({
        access_token: token.access_token, refresh_token: token.refresh_token || '',
        expires_at: Date.now() + Math.max(60, Number(token.expires_in) || 3600) * 1000,
        token_type: token.token_type || 'Bearer'
      });
      clearSpotifyOAuthState();
      spotifyProfile = await spotifyApi('https://api.spotify.com/v1/me');
      updateSpotifyConnectionUI();
      $('#spotifyProfileSummary').textContent = `Signed in as ${spotifyProfile.display_name || spotifyProfile.id}. EUPHONIA reads playlists with the permissions you approved.`;
      await loadSpotifyPlaylists();
    } catch (error) {
      clearSpotifyOAuthState();
      setSpotifyNotice(`Spotify connection failed: ${error.message || 'request failed'}`, 'error');
      updateSpotifyConnectionUI();
    }
  }
  function initializeSpotifyConnectUI() {
    updateSpotifyConnectionUI();
    $('#spotifyConnectSettings').addEventListener('click', () => {
      const panel = $('#spotifyClientConfigPanel');
      panel.hidden = !panel.hidden;
      if (!panel.hidden) $('#spotifyClientIdInput').focus();
    });
    $('#spotifySaveClientId').addEventListener('click', () => {
      const value = $('#spotifyClientIdInput').value.trim();
      try {
        if (value) localStorage.setItem(spotifyKeys.clientId, value);
        else localStorage.removeItem(spotifyKeys.clientId);
      } catch (_) { setSpotifyNotice('Browser tidak bisa menyimpan Client ID.', 'error'); return; }
      setSpotifySession(null);
      clearSpotifyOAuthState();
      spotifyProfile = null;
      spotifyPlaylistItems = [];
      spotifyNextPlaylistsUrl = null;
      $('#spotifyPlaylistPanel').hidden = true;
      $('#spotifyPlaylistGrid').replaceChildren();
      $('#spotifyClientConfigPanel').hidden = true;
      updateSpotifyConnectionUI();
      setSpotifyNotice(value ? 'Client ID disimpan di browser ini. Sekarang hubungkan akun Spotify.' : 'Client ID dihapus dari browser ini.', 'success');
    });
    $('#spotifyConnectButton').addEventListener('click', () => {
      if (getSpotifySession()) void loadSpotifyPlaylists();
      else void startSpotifyAuthorization();
    });
    $('#spotifyDisconnectButton').addEventListener('click', () => {
      setSpotifySession(null);
      clearSpotifyOAuthState();
      spotifyProfile = null;
      spotifyPlaylistItems = [];
      spotifyNextPlaylistsUrl = null;
      $('#spotifyPlaylistPanel').hidden = true;
      $('#spotifyPlaylistGrid').replaceChildren();
      updateSpotifyConnectionUI();
      setSpotifyNotice('Sesi Spotify EUPHONIA di tab ini dihapus. Untuk mencabut izin aplikasi sepenuhnya, kelola akses aplikasi di pengaturan akun Spotify.', 'info');
    });
    $('#spotifyRefreshPlaylists').addEventListener('click', () => { void loadSpotifyPlaylists(); });
    $('#spotifyLoadMore').addEventListener('click', () => { void loadSpotifyPlaylists({ append: true }); });
    $('#spotifyCopyRedirect').addEventListener('click', async () => {
      const value = spotifyRedirectUri();
      try {
        await navigator.clipboard.writeText(value);
        setSpotifyNotice('Redirect URI copied. Paste it into Spotify app settings.', 'success');
      } catch (_) { setSpotifyNotice(`Copy failed. Use this Redirect URI manually: ${value}`, 'error'); }
    });
  }

  function setHubStatus(message, tone = 'info') {
    const status = $('#hubStatus');
    if (!status) return;
    status.dataset.tone = tone;
    const text = status.querySelector('span:last-child');
    if (text) text.textContent = message;
  }

  function getSavedPlaylist(platform) {
    try { return localStorage.getItem(`euphonia.musicHubPlaylist.${platform}`) || ''; }
    catch (_) { return ''; }
  }

  function savePlaylistLink(platform, rawUrl) {
    try {
      localStorage.setItem(`euphonia.musicHubPlaylist.${platform}`, rawUrl);
      updateSavedPlaylistNote();
      return true;
    } catch (_) {
      setHubStatus('Pemutar dimuat, tetapi browser menolak penyimpanan link. Lu tetap bisa memutar link ini selama sesi terbuka.', 'error');
      return false;
    }
  }

  function updateSavedPlaylistNote() {
    const note = $('#savedPlaylistNote');
    const clearButton = $('#clearSavedPlaylist');
    if (!note || !clearButton) return;
    const saved = activeHubProvider !== 'catalog' ? getSavedPlaylist(activeHubProvider) : '';
    if (saved) {
      let host = 'link tersimpan';
      try { host = new URL(saved).hostname.replace(/^www\./, ''); } catch (_) {}
      note.textContent = `${platformNames[activeHubProvider]} · playlist/link tersimpan (${host}) di browser ini.`;
      clearButton.disabled = false;
    } else {
      note.textContent = activeHubProvider === 'catalog'
        ? 'Pilih platform lalu tempel link playlist.'
        : `Belum ada link tersimpan untuk ${platformNames[activeHubProvider]}. Tempel link Share playlist di atas.`;
      clearButton.disabled = true;
    }
  }

  function setHubProvider(provider) {
    activeHubProvider = platformNames[provider] ? provider : 'catalog';
    $$('[data-platform]').forEach(card => card.classList.toggle('is-selected', card.dataset.platform === activeHubProvider));
    const labels = {
      catalog: ['Music catalog search', 'Cari katalog Apple Music dan dengarkan preview yang tersedia langsung di EUPHONIA.'],
      youtube: ['YouTube Music', 'Pilih link playlist YouTube Music yang bisa dibagikan untuk memutarnya di panel EUPHONIA.'],
      spotify: ['Spotify', 'Pilih link playlist Spotify yang bisa dibagikan. Pemutar resmi akan tampil di panel EUPHONIA.'],
      apple: ['Apple Music', 'Cari katalog untuk preview atau tempel link album/playlist Apple Music yang mendukung embed.'],
      soundcloud: ['SoundCloud', 'Tempel link track/playlist SoundCloud publik. Pemutar resminya akan tampil di EUPHONIA.'],
      deezer: ['Deezer', 'Tempel link track/album/playlist Deezer yang mendukung widget resmi.'],
      bandcamp: ['Bandcamp', 'Untuk pemutaran tertanam, gunakan URL EmbeddedPlayer resmi Bandcamp.']
    };
    const label = labels[activeHubProvider];
    $('#hubProviderTitle').textContent = label[0];
    $('#hubProviderSubtitle').textContent = label[1];
    const searchButton = $('#searchAll');
    if (searchButton) {
      const embeddedSearch = activeHubProvider === 'catalog' || activeHubProvider === 'apple' || (activeHubProvider === 'youtube' && !!getYoutubeApiKey());
      searchButton.innerHTML = embeddedSearch ? 'Search in EUPHONIA <span>⌕</span>' : 'Use playlist link <span>↓</span>';
    }
    updateSavedPlaylistNote();
    const spotifyPanel = $('#spotifyConnectPanel');
    if (spotifyPanel) spotifyPanel.hidden = activeHubProvider !== 'spotify';
  }

  function syncPlatformLinks() {
    // Anchor targets remain local only; click handling below prevents navigation.
    $$('[data-platform]').forEach(link => {
      link.href = '#platformViewer';
      link.removeAttribute('target');
      link.removeAttribute('rel');
    });
  }

  function selectPlatformInHub(platform) {
    setHubProvider(platform);
    const saved = getSavedPlaylist(platform);
    if (saved) {
      const result = platformEmbedFromUrl(saved);
      if (result.error) {
        setHubStatus(`Link tersimpan tidak bisa dipakai: ${result.error} Tempel ulang link Share yang benar.`, 'error');
        $('#embedLinkInput').value = saved;
        $('#embedLinkInput').focus();
        return;
      }
      $('#embedLinkInput').value = saved;
      loadOfficialEmbed(result.platform, result.url, result.label);
      setHubStatus(`Memutar link tersimpan dari ${platformNames[platform]} di dalam EUPHONIA. Jika playlist privat atau penyedia meminta login top-level, embed mungkin tidak dapat memainkannya.`, 'success');
      return;
    }
    if (platform === 'spotify') {
      showSpotifyConnectPanel({ openSettings: !getSpotifyClientId() });
      if (getSpotifySession()) {
        setSpotifyNotice('Akun Spotify sudah terhubung dalam tab ini. Memuat daftar playlist…', 'success');
        void loadSpotifyPlaylists();
      } else {
        setSpotifyNotice(getSpotifyClientId()
          ? 'Hubungkan akun Spotify untuk memuat daftar playlist milikmu. Kamu juga bisa menempel link Share di bawah.'
          : 'Tambahkan Client ID aplikasi Spotify milikmu untuk menelusuri playlist akun. Link Share tetap bisa digunakan sebagai alternatif.',
          'info');
      }
      $('#embedLinkInput').placeholder = `Tempel link Share ${platformNames[platform]}…`;
      return;
    }
    setHubStatus(`Untuk memutar ${platformLibraryLabels[platform]} tanpa meninggalkan EUPHONIA, salin link Share playlist dari aplikasi/platform asal, lalu tempel link itu di kolom atas. EUPHONIA tidak membuka tab baru otomatis.`, 'info');
    $('#embedLinkInput').placeholder = `Tempel link Share ${platformNames[platform]}…`;
    $('#embedLinkForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function requestInAppSearch(platform, query) {
    setHubProvider(platform);
    setHubStatus(`Pencarian katalog ${platformNames[platform]} langsung belum diaktifkan untuk layanan ini. Supaya tidak pindah tab, tempel link Share playlist/track ${platformNames[platform]} di kolom atas; EUPHONIA akan memutarnya di panel bila embed resmi tersedia.`, 'info');
    $('#embedLinkInput').placeholder = `Tempel link Share ${platformNames[platform]}…`;
    $('#embedLinkInput').focus({ preventScroll: true });
    $('#embedLinkForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function getYoutubeApiKey() {
    try { return localStorage.getItem('euphonia.youtubeDataApiKey') || ''; }
    catch (_) { return ''; }
  }

  function showResults(title, results) {
    const section = $('#hubResultsSection');
    const grid = $('#musicResults');
    grid.replaceChildren();
    $('#hubResultsTitle').textContent = title;
    $('#hubResultsCount').textContent = `${results.length} RESULTS`;
    section.hidden = false;
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return grid;
  }

  function makeHubButton(label, callback, primary = false, disabled = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = primary ? 'primary-button' : 'outline-button';
    button.textContent = label;
    button.disabled = disabled;
    button.addEventListener('click', callback);
    return button;
  }

  function renderAppleResults(results, query) {
    const grid = showResults(`Results for “${query}”`, results);
    if (!results.length) {
      setHubStatus('Tidak ada hasil pada katalog preview. Coba kata kunci atau nama artis lain.', 'error');
      return;
    }
    results.forEach(item => {
      const card = document.createElement('article');
      card.className = 'hub-result-card';
      const art = document.createElement('img');
      art.className = 'hub-result-art';
      art.alt = '';
      art.loading = 'lazy';
      art.src = item.artworkUrl100 || '';
      art.onerror = () => { art.removeAttribute('src'); art.alt = '♫'; art.classList.add('hub-art-fallback'); };
      const info = document.createElement('div'); info.className = 'hub-result-info';
      const name = document.createElement('strong'); name.textContent = item.trackName || item.collectionName || 'Untitled audio';
      const artist = document.createElement('small'); artist.textContent = `${item.artistName || 'Unknown artist'}${item.collectionName ? ` · ${item.collectionName}` : ''}`;
      const actions = document.createElement('div'); actions.className = 'hub-result-actions';
      actions.append(makeHubButton(item.previewUrl ? '▶ Preview' : 'No preview', () => playApplePreview(item, results), true, !item.previewUrl));
      actions.append(makeHubButton('Apple player', () => {
        const embed = appleEmbedUrl(item.trackViewUrl);
        if (embed) loadOfficialEmbed('apple', embed, item.trackName || item.collectionName || 'Apple Music');
        else setHubStatus('Link embed Apple Music tidak tersedia untuk item ini. Gunakan tombol Preview jika tersedia.', 'error');
      }));
      info.append(name, artist, actions); card.append(art, info); grid.append(card);
    });
    setHubStatus('Hasil katalog dimuat. Preview diputar melalui audio preview resmi yang tersedia; panjang preview ditentukan oleh penyedia.', 'success');
  }

  async function searchAppleCatalog(query) {
    const requestId = ++appleSearchSequence;
    setHubProvider(activeHubProvider === 'apple' ? 'apple' : 'catalog');
    setHubStatus('Sedang mencari katalog musik…');
    $('#hubResultsSection').hidden = true;
    try {
      const url = new URL('https://itunes.apple.com/search');
      url.search = new URLSearchParams({ term: query, entity: 'song', limit: '24', country: 'ID', media: 'music' }).toString();
      const response = await fetch(url.href, { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`Katalog mengembalikan HTTP ${response.status}.`);
      const data = await response.json();
      if (requestId !== appleSearchSequence) return;
      const results = Array.isArray(data.results) ? data.results : [];
      renderAppleResults(results, query);
    } catch (error) {
      if (requestId !== appleSearchSequence) return;
      $('#hubResultsSection').hidden = false;
      $('#musicResults').replaceChildren();
      $('#hubResultsTitle').textContent = 'Catalog search unavailable';
      $('#hubResultsCount').textContent = '';
      setHubStatus(`Pencarian katalog gagal: ${error.message || 'koneksi ditolak'}. Periksa koneksi internet atau gunakan YouTube API/link embed di bawah.`, 'error');
    }
  }

  function playApplePreview(item, queue = null) {
    if (!item || !item.previewUrl) {
      setHubStatus('Preview tidak tersedia untuk track ini.', 'error');
      return;
    }
    const embeddedPreview = $('#hubPreviewAudio');
    if (embeddedPreview) { embeddedPreview.pause(); embeddedPreview.removeAttribute('src'); embeddedPreview.load(); }
    const playableQueue = Array.isArray(queue) ? queue.filter(track => track && track.previewUrl) : [item];
    state.externalQueue = playableQueue.some(track => String(track.trackId) === String(item.trackId)) ? playableQueue : [item, ...playableQueue];
    state.externalTrack = {
      id: `apple:${item.trackId || item.collectionId || 'preview'}`,
      trackId: item.trackId || item.collectionId,
      trackName: item.trackName || item.collectionName || 'Track preview',
      artistName: item.artistName || 'Unknown artist',
      collectionName: item.collectionName || '',
      artworkUrl100: item.artworkUrl100 || '',
      previewUrl: item.previewUrl,
      trackViewUrl: item.trackViewUrl || ''
    };
    state.currentFileId = null;
    audioPlayer.pause();
    audioPlayer.src = item.previewUrl;
    audioPlayer.load();
    $('#playerTitle').textContent = state.externalTrack.trackName;
    $('#playerArtist').textContent = `${state.externalTrack.artistName} · Apple Music preview`;
    const art = homeArtwork(item, 300);
    $('#playerArtwork').style.backgroundImage = art ? `url("${art}")` : 'none';
    $('#playerArtwork').style.backgroundSize = 'cover';
    $('#playerArtwork').style.backgroundPosition = 'center';
    $('#playerArtwork').innerHTML = art ? '' : '<span>♫</span>';
    const saved = getHomeSavedTracks().some(entry => String(entry.trackId) === String(state.externalTrack.trackId));
    $('#playerFav').classList.toggle('is-fav', saved || state.favorites.has(state.externalTrack.id));
    $('#playerFav').textContent = saved || state.favorites.has(state.externalTrack.id) ? '♥' : '♡';
    $('#playerToggle').textContent = 'Ⅱ';
    renderLibrary();
    audioPlayer.play().then(() => {
      setHubStatus(`Memutar preview ${state.externalTrack.trackName} di player EUPHONIA.`, 'success');
    }).catch(() => {
      $('#playerToggle').textContent = '▶';
      setHubStatus('Preview siap. Tekan Play pada player bawah jika browser belum memulainya.', 'info');
    });
  }

  async function searchYoutube(query) {
    const requestId = ++youtubeSearchSequence;
    const key = getYoutubeApiKey();
    if (!key) {
      $('#youtubeApiPanel').hidden = false;
      $('#youtubeApiKeyInput').focus();
      setHubStatus('Pencarian YouTube memerlukan YouTube Data API key. Simpan key yang dibatasi untuk localhost/domain lu, atau tempel URL YouTube di kolom link.', 'error');
      return;
    }
    setHubStatus('Sedang mencari video YouTube…');
    $('#hubResultsSection').hidden = true;
    try {
      const url = new URL('https://www.googleapis.com/youtube/v3/search');
      url.search = new URLSearchParams({ part: 'snippet', type: 'video', videoCategoryId: '10', maxResults: '12', q: query, key }).toString();
      const response = await fetch(url.href);
      const data = await response.json();
      if (requestId !== youtubeSearchSequence) return;
      if (!response.ok || data.error) throw new Error(data.error?.message || `YouTube API mengembalikan HTTP ${response.status}.`);
      const results = (data.items || []).filter(item => item.id && item.id.videoId && item.snippet);
      const grid = showResults(`YouTube results for “${query}”`, results);
      if (!results.length) { setHubStatus('YouTube tidak mengembalikan hasil video musik untuk query ini.', 'error'); return; }
      results.forEach(item => {
        const card = document.createElement('article'); card.className = 'hub-result-card';
        const art = document.createElement('img'); art.className = 'hub-result-art'; art.loading = 'lazy'; art.alt = ''; art.src = item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || '';
        const info = document.createElement('div'); info.className = 'hub-result-info';
        const title = document.createElement('strong'); title.textContent = item.snippet.title || 'YouTube video';
        const channel = document.createElement('small'); channel.textContent = item.snippet.channelTitle || 'YouTube';
        const actions = document.createElement('div'); actions.className = 'hub-result-actions';
        actions.append(makeHubButton('▶ Play inside', () => loadOfficialEmbed('youtube', `https://www.youtube-nocookie.com/embed/${encodeURIComponent(item.id.videoId)}?autoplay=1&playsinline=1&rel=0`, item.snippet.title || 'YouTube video'), true));
        info.append(title, channel, actions); card.append(art, info); grid.append(card);
      });
      setHubStatus('Hasil YouTube dimuat. Video yang pemiliknya melarang embed tetap tidak dapat diputar di dalam aplikasi.', 'success');
    } catch (error) {
      if (requestId !== youtubeSearchSequence) return;
      $('#hubResultsSection').hidden = false;
      $('#musicResults').replaceChildren();
      $('#hubResultsTitle').textContent = 'YouTube search unavailable';
      $('#hubResultsCount').textContent = '';
      setHubStatus(`Pencarian YouTube gagal: ${error.message || 'koneksi ditolak'}. Periksa API key, quota, dan batasan referrer pada Google Cloud.`, 'error');
    }
  }

  function appleEmbedUrl(raw) {
    try {
      const url = new URL(raw);
      if (url.hostname !== 'music.apple.com' && url.hostname !== 'embed.music.apple.com') return null;
      if (!url.pathname.match(/^\/[a-z]{2}\/(album|playlist|artist|music-video|station)\//i)) return null;
      url.hostname = 'embed.music.apple.com';
      return url.href;
    } catch (_) { return null; }
  }

  function platformEmbedFromUrl(raw) {
    let url;
    try { url = new URL(String(raw).trim()); } catch (_) { return { error: 'Masukkan URL lengkap yang diawali https://.' }; }
    if (url.protocol !== 'https:') return { error: 'Hanya link HTTPS yang didukung.' };
    const host = url.hostname.toLowerCase().replace(/^www\./, '');

    if (host === 'youtube.com' || host === 'music.youtube.com' || host === 'm.youtube.com' || host === 'youtu.be' || host === 'youtube-nocookie.com') {
      let id = '';
      const playlistId = url.searchParams.get('list');
      if ((url.pathname === '/playlist' || url.pathname === '/embed/videoseries') && playlistId) return { platform: 'youtube', url: `https://www.youtube-nocookie.com/embed/videoseries?list=${encodeURIComponent(playlistId)}`, label: 'YouTube playlist' };
      if (host === 'youtu.be') id = url.pathname.split('/').filter(Boolean)[0] || '';
      else if (url.pathname === '/watch') id = url.searchParams.get('v') || '';
      else if (/^\/(embed|shorts|live)\//.test(url.pathname)) id = url.pathname.split('/')[2] || '';
      if (!/^[\w-]{11}$/.test(id)) return { error: 'Link YouTube dikenali, tetapi video ID tidak ditemukan. Tempel link video atau playlist publik.' };
      const list = url.searchParams.get('list');
      return { platform: 'youtube', url: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?${new URLSearchParams({ playsinline: '1', rel: '0', ...(list ? { list } : {}) })}`, label: 'YouTube video' };
    }

    if (host === 'open.spotify.com') {
      const parts = url.pathname.split('/').filter(Boolean).filter(part => !/^intl-[a-z]{2}$/i.test(part));
      const index = parts.findIndex(part => ['track', 'album', 'playlist', 'artist', 'show', 'episode'].includes(part));
      if (index < 0 || !parts[index + 1] || parts[index + 1] === 'embed') return { error: 'Link Spotify harus mengarah ke track, album, playlist, artist, show, atau episode.' };
      return { platform: 'spotify', url: `https://open.spotify.com/embed/${parts[index]}/${encodeURIComponent(parts[index + 1])}?utm_source=generator`, label: `Spotify ${parts[index]}` };
    }

    if (host === 'music.apple.com' || host === 'embed.music.apple.com') {
      const embed = appleEmbedUrl(url.href);
      return embed ? { platform: 'apple', url: embed, label: 'Apple Music' } : { error: 'Link Apple Music dikenali, tetapi jenis konten ini belum didukung untuk embed.' };
    }

    if (host === 'soundcloud.com' || host === 'on.soundcloud.com') {
      if (host !== 'soundcloud.com' || !url.pathname.split('/').filter(Boolean).length || /\/search\/?/.test(url.pathname)) return { error: 'Tempel link track atau playlist publik SoundCloud, bukan halaman pencarian/short link.' };
      const widget = new URL('https://w.soundcloud.com/player/');
      widget.search = new URLSearchParams({ url: url.href, color: '#c9f36a', auto_play: 'false', hide_related: 'true', show_comments: 'false', show_user: 'true', show_reposts: 'false', visual: 'true' }).toString();
      return { platform: 'soundcloud', url: widget.href, label: 'SoundCloud' };
    }

    if (host === 'deezer.com' || host === 'dzr.page.link') {
      const match = url.pathname.match(/\/(track|album|playlist|episode|podcast)\/(\d+)/i);
      if (!match) return { error: 'Link Deezer harus mengarah ke track, album, playlist, episode, atau podcast dengan ID numerik.' };
      return { platform: 'deezer', url: `https://widget.deezer.com/widget/dark/${match[1].toLowerCase()}/${match[2]}`, label: `Deezer ${match[1]}` };
    }

    if (host === 'bandcamp.com' && url.pathname.includes('/EmbeddedPlayer/')) {
      return { platform: 'bandcamp', url: url.href, label: 'Bandcamp embedded player' };
    }
    if (/\.bandcamp\.com$/.test(url.hostname) || host === 'bandcamp.com') {
      return { error: 'Halaman Bandcamp biasa tidak selalu bisa di-embed. Untuk tetap di EUPHONIA, tempel URL EmbeddedPlayer resmi yang diberikan Bandcamp.' };
    }
    return { error: 'Platform/link ini belum didukung untuk pemutaran tertanam. Coba link YouTube, Spotify, Apple Music, SoundCloud, Deezer, atau Bandcamp EmbeddedPlayer.' };
  }

  function loadOfficialEmbed(platform, src, label = '') {
    const viewer = $('#platformViewer');
    const frame = $('#platformFrame');
    const wrap = $('#viewerFrameWrap');
    const url = new URL(src);
    const allowedHosts = {
      youtube: ['www.youtube-nocookie.com', 'www.youtube.com'],
      spotify: ['open.spotify.com'],
      apple: ['embed.music.apple.com'],
      soundcloud: ['w.soundcloud.com'],
      deezer: ['widget.deezer.com'],
      bandcamp: ['bandcamp.com']
    };
    if (!allowedHosts[platform] || !allowedHosts[platform].includes(url.hostname)) {
      setHubStatus('URL embed tidak lolos pemeriksaan host resmi. Link tidak dimuat.', 'error');
      return;
    }
    $('#platformViewerTitle').textContent = label || platformNames[platform] || 'Media player';
    $('#platformViewerSubtitle').textContent = `Pemutar resmi · ${platformNames[platform] || platform}`;
    $('#viewerServiceMark').textContent = platformMarks[platform] || '▶';
    wrap.className = 'viewer-frame-wrap';
    if (platform === 'youtube') wrap.classList.add('native-tall');
    else if (platform === 'soundcloud') wrap.classList.add('native-soundcloud');
    else wrap.classList.add('native-compact');
    viewer.hidden = false;
    if (frame.src !== url.href) frame.src = url.href;
    viewer.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setHubStatus(`Pemutar ${platformNames[platform] || platform} dimuat di dalam EUPHONIA. Jika pemilik konten melarang embed atau meminta login, konten tersebut mungkin tetap tidak dapat dimainkan.`, 'success');
  }

  function playPastedEmbedLink() {
    const raw = $('#embedLinkInput').value.trim();
    if (!raw) { $('#embedLinkInput').focus(); setHubStatus('Tempel link Share lagu, album, playlist, atau video yang ingin diputar di dalam EUPHONIA.', 'error'); return; }
    const result = platformEmbedFromUrl(raw);
    if (result.error) { setHubStatus(result.error, 'error'); return; }
    setHubProvider(result.platform);
    savePlaylistLink(result.platform, raw);
    loadOfficialEmbed(result.platform, result.url, result.label);
    setHubStatus(`${result.label} diputar di dalam EUPHONIA. Link ini disimpan lokal pada browser supaya bisa dibuka lagi dari kartu ${platformNames[result.platform]}.`, 'success');
  }


  async function doHubSearch() {
    const query = $('#hubSearch').value.trim();
    if (!query) { $('#hubSearch').focus(); setHubStatus('Masukkan nama track, artis, atau genre terlebih dahulu.', 'error'); return; }
    syncPlatformLinks();
    $('#hubSearch').dataset.lastQuery = query;
    if (activeHubProvider === 'youtube') {
      if (getYoutubeApiKey()) return searchYoutube(query);
      setHubStatus('Pencarian YouTube memerlukan YouTube Data API key. Tanpa key, tempel link Share playlist/video YouTube Music di kolom bawah untuk memutarnya di EUPHONIA.', 'info');
      $('#embedLinkInput').focus({ preventScroll: true });
      return;
    }
    if (activeHubProvider === 'spotify' && getSpotifySession()) return loadSpotifyPlaylists({ searchQuery: query });
    if (['spotify', 'soundcloud', 'deezer', 'bandcamp'].includes(activeHubProvider)) {
      return requestInAppSearch(activeHubProvider, query);
    }
    // The public iTunes Search API gives EUPHONIA a no-key catalog and preview fallback.
    return searchAppleCatalog(query);
  }

  function closePlatformViewer() {
    const viewer = $('#platformViewer');
    const frame = $('#platformFrame');
    viewer.hidden = true;
    frame.src = 'about:blank';
    $('#viewerFrameWrap').className = 'viewer-frame-wrap';
  }

  function navigateSearch(query) {
    showPage('discover');
    $('#hubSearch').value = query;
    syncPlatformLinks();
    window.setTimeout(() => $('#hubSearch').focus(), 30);
  }

  async function ensureTrackExists(trackName) {
    let track = state.dawTracks.find(t => t.name === trackName);
    if (!track) track = createDawTrack(trackName);
    return track;
  }

  function createDawTrack(name = '') {
    const id = state.nextTrackId++;
    const track = { id, name: name || `Audio ${id}`, color: trackColors[(id - 1) % trackColors.length], volume: 0.82, pan: 0, muted: false, solo: false, clips: [] };
    state.dawTracks.push(track);
    state.selectedTrackId = id;
    renderDaw();
    return track;
  }

  async function addItemToDaw(item, targetTrackId = null) {
    setStatus(`Reading audio: ${item.name}`);
    try {
      const buffer = await decodeItem(item);
      pushUndoSnapshot();
      let track = targetTrackId ? state.dawTracks.find(t => t.id === targetTrackId) : null;
      if (!track && state.selectedTrackId) {
        const selectedTrack = state.dawTracks.find(t => t.id === state.selectedTrackId);
        if (selectedTrack && selectedTrack.clips.length === 0) track = selectedTrack;
      }
      if (!track) track = createDawTrack(item.name.replace(/\.[^.]+$/, ''));
      state.selectedTrackId = track.id;
      const clip = { id: state.nextClipId++, item, name: item.name, start: Math.max(0, state.playheadSeconds), offset: 0, duration: buffer.duration, buffer };
      track.clips.push(clip);
      state.selectedClipId = clip.id;
      state.playheadSeconds = clip.start;
      renderDaw();
      setStatus(`Added ${item.name}`);
      updateProjectDuration();
      restartArrangementIfPlaying();
      toast(`“${item.name}” ditambahkan ke arrangement.`);
      return clip;
    } catch (error) {
      setStatus('Audio decode failed');
      throw new Error(error.message || 'Format audio tidak didukung browser.');
    }
  }

  function secondsPerBar() {
    const bpm = Math.min(240, Math.max(40, Number($('#bpmInput').value) || 118));
    return 240 / bpm;
  }

  function snapTime(seconds) {
    const division = Number($('#gridSelect').value);
    if (!Number.isFinite(division) || division <= 0) return Math.max(0, seconds);
    const snap = Math.max(0.005, secondsPerBar() * division);
    return Math.max(0, Math.round(seconds / snap) * snap);
  }

  async function placeClipFromCurrentLibrary(seconds) {
    const item = currentItem();
    if (!item) {
      state.playheadSeconds = Math.max(0, seconds);
      toast('Pilih audio di Library/player dulu, lalu gunakan Draw untuk menaruh clip.');
      askImport('daw');
      return;
    }
    try {
      const buffer = await decodeItem(item);
      pushUndoSnapshot();
      let track = state.dawTracks.find(candidate => candidate.id === state.selectedTrackId);
      if (!track) track = createDawTrack(item.name.replace(/\.[^.]+$/, ''));
      const clip = { id: state.nextClipId++, item, name: item.name, start: snapTime(seconds), offset: 0, duration: buffer.duration, buffer };
      track.clips.push(clip);
      state.selectedTrackId = track.id;
      state.selectedClipId = clip.id;
      renderDaw(); setStatus(`Placed ${item.name} at ${fmtTime(clip.start)}`); queueWorkspaceSave(); restartArrangementIfPlaying();
    } catch (error) { toast(`Tidak bisa menempatkan clip: ${error.message}`, 'error'); }
  }

  function actualProjectEnd() {
    let end = 0;
    state.dawTracks.forEach(track => track.clips.forEach(clip => { end = Math.max(end, clip.start + clip.duration); }));
    return end;
  }

  function projectEnd() {
    return Math.max(8, actualProjectEnd() + 2);
  }

  function activeSoloExists() { return state.dawTracks.some(track => track.solo); }

  function buildWaveform(clip, host) {
    host.innerHTML = '';
    let channel = clip.buffer && clip.buffer.numberOfChannels ? clip.buffer.getChannelData(0) : null;
    const bars = 70;
    for (let i = 0; i < bars; i++) {
      const bar = document.createElement('i');
      let amplitude = 0.2 + Math.abs(Math.sin(i * 1.72)) * 0.65;
      if (channel && channel.length) {
        const sampleRate = clip.buffer.sampleRate || 44100;
        const clipStart = Math.max(0, Math.floor((clip.offset || 0) * sampleRate));
        const clipEnd = Math.min(channel.length, Math.ceil(((clip.offset || 0) + clip.duration) * sampleRate));
        const clipLength = Math.max(1, clipEnd - clipStart);
        const from = Math.min(channel.length - 1, clipStart + Math.floor(i / bars * clipLength));
        const to = Math.min(channel.length, Math.max(from + 1, clipStart + Math.floor((i + 1) / bars * clipLength)));
        let peak = 0;
        const stride = Math.max(1, Math.floor((to - from) / 80));
        for (let j = from; j < to; j += stride) peak = Math.max(peak, Math.abs(channel[j] || 0));
        amplitude = Math.max(.08, Math.min(1, peak * 2.9));
      }
      bar.style.height = `${Math.max(8, amplitude * 100)}%`;
      host.appendChild(bar);
    }
  }

  function renderDaw() {
    const headers = $('#trackHeaders');
    const canvas = $('#timelineCanvas');
    const ruler = $('#timelineRuler');
    const grid = $('#timelineGrid');
    const empty = $('#timelineEmpty');
    const pps = state.pixelsPerSecond;
    const end = projectEnd();
    const bpm = Math.min(240, Math.max(40, Number($('#bpmInput').value) || 118));
    const secPerBeat = 60 / bpm;
    const secPerBar = secPerBeat * 4;
    const barWidth = secPerBar * pps;
    const beatWidth = secPerBeat * pps;
    const width = Math.max(1200, Math.ceil((end + 2) * pps));
    const rowsHeight = Math.max(295, state.dawTracks.length * 84);
    document.documentElement.style.setProperty('--sec-width', `${pps}px`);
    canvas.style.width = `${width}px`;
    canvas.style.minHeight = `${rowsHeight}px`;
    ruler.style.width = `${width}px`;
    ruler.style.minWidth = `${width}px`;
    ruler.style.backgroundImage = `repeating-linear-gradient(to right, #333840 0 1px, transparent 1px ${barWidth}px)`;
    grid.style.backgroundImage = `linear-gradient(to right, #353941 1px, transparent 1px), linear-gradient(to right, #292d33 1px, transparent 1px)`;
    grid.style.backgroundSize = `${beatWidth}px 100%, ${barWidth}px 100%`;
    grid.style.height = `${rowsHeight}px`;
    $('#dawTrackCount').textContent = String(state.dawTracks.length);
    $('#projectDuration').textContent = fmtTime(projectEnd());
    $('#timeDisplay').textContent = fmtTimeCode(state.playheadSeconds);

    const marks = [];
    const barCount = Math.ceil(width / Math.max(1, barWidth));
    for (let i = 0; i <= barCount; i++) {
      marks.push(`<div class="ruler-mark" style="left:${i * barWidth}px"><span>${i + 1}</span><small>${fmtTime(i * secPerBar)}</small></div>`);
    }
    ruler.innerHTML = marks.join('');

    if (!state.dawTracks.length) {
      headers.innerHTML = `<div class="no-tracks"><span>♫</span><strong>Start with a track</strong><small>Import an audio file or record a take.</small><button class="outline-button" id="firstTrackImport">Import audio</button></div>`;
      canvas.querySelectorAll('.timeline-row,.audio-clip').forEach(el => el.remove());
      empty.hidden = false;
      empty.style.height = `${rowsHeight}px`;
    } else {
      empty.hidden = true;
      headers.innerHTML = state.dawTracks.map(track => `
        <div class="track-head${state.selectedTrackId === track.id ? ' selected' : ''}" data-track-head="${track.id}" style="--track-color:${track.color}">
          <div class="track-head-top"><span class="track-color"></span><input class="track-name" data-track-name="${track.id}" value="${escapeHTML(track.name)}" aria-label="Track name" /><button class="track-menu-btn" data-track-action="remove" data-track-id="${track.id}" title="Remove track">×</button></div>
          <div class="track-controls"><button class="track-control-btn ${track.muted ? 'active' : ''}" data-track-action="mute" data-track-id="${track.id}" title="Mute">M</button><button class="track-control-btn ${track.solo ? 'active' : ''}" data-track-action="solo" data-track-id="${track.id}" title="Solo">S</button><input class="track-volume" data-track-volume="${track.id}" type="range" min="0" max="1" step="0.01" value="${track.volume}" aria-label="Track volume" /><span class="track-gain-label" data-gain-label="${track.id}">${Math.round(track.volume * 100)}%</span><input class="track-pan" data-track-pan="${track.id}" type="range" min="-1" max="1" step="0.1" value="${track.pan || 0}" aria-label="Track pan" title="Pan L / R" /></div>
        </div>`).join('');
      canvas.querySelectorAll('.timeline-row,.audio-clip').forEach(el => el.remove());
      state.dawTracks.forEach((track, rowIndex) => {
        const row = document.createElement('div');
        row.className = 'timeline-row';
        row.style.top = `${rowIndex * 84}px`;
        row.style.left = '0';
        row.style.width = `${width}px`;
        row.style.position = 'absolute';
        row.dataset.trackRow = track.id;
        canvas.appendChild(row);
        track.clips.forEach(clip => {
          const el = document.createElement('div');
          el.className = `audio-clip${clip.id === state.selectedClipId ? ' selected' : ''}`;
          el.dataset.clipId = clip.id;
          el.dataset.trackId = track.id;
          el.style.setProperty('--clip-color', track.color);
          el.style.left = `${clip.start * pps}px`;
          el.style.top = `${rowIndex * 84 + 10}px`;
          el.style.width = `${Math.max(28, clip.duration * pps)}px`;
          el.innerHTML = `<span class="clip-resize-handle left" data-resize="left" title="Trim start"></span><span class="clip-label">${escapeHTML(clip.name)}</span><span class="clip-waveform"></span><span class="clip-duration">${fmtTime(clip.duration)}</span><span class="clip-resize-handle right" data-resize="right" title="Trim end"></span>`;
          buildWaveform(clip, $('.clip-waveform', el));
          canvas.appendChild(el);
        });
      });
    }
    updatePlayheadVisual();
    syncRulerScroll();
    updateProjectDuration();
    updateUndoRedoButtons();
    queueWorkspaceSave();
  }

  function updateProjectDuration() {
    $('#projectDuration').textContent = fmtTime(actualProjectEnd());
  }

  function updatePlayheadVisual() {
    const playhead = $('#playhead');
    playhead.style.left = `${state.playheadSeconds * state.pixelsPerSecond}px`;
    $('#timeDisplay').textContent = fmtTimeCode(state.playheadSeconds);
    $$('.audio-clip').forEach(el => {
      const track = state.dawTracks.find(t => t.id === Number(el.dataset.trackId));
      const clip = track && track.clips.find(c => c.id === Number(el.dataset.clipId));
      if (!clip) return;
      const progress = Math.max(0, Math.min(1, (state.playheadSeconds - clip.start) / clip.duration));
      let fill = el.querySelector('.clip-play-state');
      if (!fill) { fill = document.createElement('span'); fill.className = 'clip-play-state'; el.appendChild(fill); }
      fill.style.width = `${progress * 100}%`;
    });
  }

  function syncRulerScroll() {
    $('#rulerScroll').scrollLeft = $('#timelineScroll').scrollLeft;
    $('#trackHeaders').scrollTop = $('#timelineScroll').scrollTop;
  }

  function makeReverbImpulse(ctx, seconds = 1.45, decay = 2.5) {
    const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
    return impulse;
  }

  function getMasterChain(ctx) {
    let chain = masterChains.get(ctx);
    if (chain) return chain;
    const input = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = state.masterSettings.cutoff; filter.Q.value = 0.72;
    const dry = ctx.createGain();
    const delay = ctx.createDelay(1.5); delay.delayTime.value = state.masterSettings.delayTime;
    const delayFeedback = ctx.createGain(); delayFeedback.gain.value = 0.22;
    const delayWet = ctx.createGain(); delayWet.gain.value = state.masterSettings.delayWet;
    const convolver = ctx.createConvolver(); convolver.buffer = makeReverbImpulse(ctx);
    const reverbWet = ctx.createGain(); reverbWet.gain.value = state.masterSettings.reverbWet;
    const sum = ctx.createGain(); sum.gain.value = state.masterSettings.volume;
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -10 - (state.masterSettings.compressor * 22);
    compressor.knee.value = 20; compressor.ratio.value = 1 + state.masterSettings.compressor * 11;
    compressor.attack.value = 0.004; compressor.release.value = 0.22;
    input.connect(filter);
    filter.connect(dry); dry.connect(sum);
    filter.connect(delay); delay.connect(delayWet); delayWet.connect(sum);
    delay.connect(delayFeedback); delayFeedback.connect(delay);
    filter.connect(convolver); convolver.connect(reverbWet); reverbWet.connect(sum);
    sum.connect(compressor); compressor.connect(ctx.destination);
    chain = { input, filter, dry, delay, delayFeedback, delayWet, convolver, reverbWet, sum, compressor };
    masterChains.set(ctx, chain);
    return chain;
  }

  function applyMasterSettings() {
    for (const ctx of [state.audioContext].filter(Boolean)) {
      const chain = getMasterChain(ctx);
      chain.sum.gain.setTargetAtTime(state.masterSettings.volume, ctx.currentTime, 0.015);
      chain.filter.frequency.setTargetAtTime(state.masterSettings.cutoff, ctx.currentTime, 0.015);
      chain.delay.delayTime.setTargetAtTime(state.masterSettings.delayTime, ctx.currentTime, 0.015);
      chain.delayWet.gain.setTargetAtTime(state.masterSettings.delayWet, ctx.currentTime, 0.015);
      chain.reverbWet.gain.setTargetAtTime(state.masterSettings.reverbWet, ctx.currentTime, 0.015);
      chain.compressor.threshold.setTargetAtTime(-10 - state.masterSettings.compressor * 22, ctx.currentTime, 0.015);
      chain.compressor.ratio.setTargetAtTime(1 + state.masterSettings.compressor * 11, ctx.currentTime, 0.015);
    }
  }

  function setMasterSettings(settings = {}) {
    Object.entries(settings).forEach(([key, value]) => {
      if (key !== 'automation' && Object.prototype.hasOwnProperty.call(state.masterSettings, key) && Number.isFinite(Number(value))) {
        const ranges = { volume: [0, 1], cutoff: [250, 20000], delayWet: [0, 0.65], delayTime: [0.05, 0.8], reverbWet: [0, 0.65], compressor: [0, 1], automationStart: [0, 1], automationEnd: [0, 1] };
        if (ranges[key]) state.masterSettings[key] = Math.max(ranges[key][0], Math.min(ranges[key][1], Number(value)));
      } else if (key === 'automation') state.masterSettings.automation = Boolean(value);
    });
    applyMasterSettings();
    return { ...state.masterSettings };
  }

  function scheduleMasterAutomation(ctx, startAt, startSeconds, endSeconds) {
    const chain = getMasterChain(ctx);
    const gain = chain.sum.gain;
    const settings = state.masterSettings;
    gain.cancelScheduledValues(startAt);
    if (!settings.automation || endSeconds <= startSeconds) {
      gain.setValueAtTime(settings.volume, startAt);
      return;
    }
    const progress = Math.max(0, Math.min(1, startSeconds / endSeconds));
    const initial = settings.automationStart + (settings.automationEnd - settings.automationStart) * progress;
    gain.setValueAtTime(initial, startAt);
    gain.linearRampToValueAtTime(settings.automationEnd, startAt + Math.max(0.02, endSeconds - startSeconds));
  }

  function scheduleDawSources() {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const anySolo = activeSoloExists();
    state.scheduledSources = [];
    state.dawTracks.forEach(track => {
      if (track.muted || (anySolo && !track.solo)) return;
      track.clips.forEach(clip => {
        const clipEnd = clip.start + clip.duration;
        if (clipEnd <= state.playheadSeconds + 0.0001) return;
        const buffer = clip.buffer || clip.item.buffer;
        if (!buffer) return;
        const offset = Math.max(0, state.playheadSeconds - clip.start) + Math.max(0, clip.offset || 0);
        const startAt = now + Math.max(0, clip.start - state.playheadSeconds);
        const remaining = Math.max(0.01, clip.duration - Math.max(0, state.playheadSeconds - clip.start));
        const source = ctx.createBufferSource();
        const gain = ctx.createGain();
        const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
        source.buffer = buffer;
        gain.gain.value = Math.max(0, Math.min(1, track.volume));
        if (panner) panner.pan.value = Math.max(-1, Math.min(1, track.pan || 0));
        source.connect(panner || gain);
        if (panner) panner.connect(gain);
        gain.connect(getMasterChain(ctx).input);
        try { source.start(startAt, offset, remaining); }
        catch (error) { console.warn('Could not schedule clip', error); }
        state.scheduledSources.push(source);
      });
    });
    scheduleMasterAutomation(ctx, now, state.playheadSeconds, projectEnd());
  }

  function stopDawSources() {
    state.scheduledSources.forEach(source => { try { source.stop(); } catch (_) {} });
    state.scheduledSources = [];
  }

  async function startDaw() {
    if (state.dawPlaying || state.isStartingPlayback) return;
    if (!state.dawTracks.some(track => track.clips.length)) {
      toast('Tambahkan audio clip dulu untuk memutar arrangement.');
      askImport('daw');
      return;
    }
    const startToken = ++state.playbackStartToken;
    state.isStartingPlayback = true;
    try {
      const ctx = getAudioContext();
      if (ctx.state === 'suspended') await ctx.resume();
      // Make sure all clips are decoded before they are scheduled.
      for (const track of state.dawTracks) {
        for (const clip of track.clips) {
          if (startToken !== state.playbackStartToken) return;
          if (!clip.buffer) clip.buffer = await decodeItem(clip.item);
        }
      }
      if (startToken !== state.playbackStartToken) return;
      stopDawSources();
      scheduleDawSources();
      state.dawPlaying = true;
      state.dawStartPosition = state.playheadSeconds;
      state.dawStartWallTime = performance.now();
      $('#dawPlay').textContent = 'Ⅱ';
      $('#dawPlay').classList.add('active');
      setStatus('Playing arrangement');
      dawAnimationTick();
    } catch (error) {
      if (startToken === state.playbackStartToken) {
        toast(`Tidak bisa memutar DAW: ${error.message}`, 'error');
        setStatus('Playback error');
      }
    } finally {
      if (startToken === state.playbackStartToken) state.isStartingPlayback = false;
    }
  }

  function pauseDaw() {
    // Allow Play/Pause or Stop to cancel an asynchronous decode/start operation.
    if (state.isStartingPlayback) {
      state.playbackStartToken += 1;
      state.isStartingPlayback = false;
      stopDawSources();
      $('#dawPlay').textContent = '▶';
      $('#dawPlay').classList.remove('active');
      setStatus('Paused');
      return;
    }
    if (!state.dawPlaying) return;
    state.playheadSeconds = Math.min(projectEnd(), state.dawStartPosition + (performance.now() - state.dawStartWallTime) / 1000);
    state.dawPlaying = false;
    stopDawSources();
    if (state.animationFrame) cancelAnimationFrame(state.animationFrame);
    state.animationFrame = null;
    $('#dawPlay').textContent = '▶';
    $('#dawPlay').classList.remove('active');
    setStatus('Paused');
    updatePlayheadVisual();
  }

  function restartArrangementIfPlaying() {
    if (!state.dawPlaying) return;
    pauseDaw();
    startDaw();
  }

  function stopDaw() {
    state.playbackStartToken += 1;
    state.isStartingPlayback = false;
    state.dawPlaying = false;
    stopDawSources();
    if (state.animationFrame) cancelAnimationFrame(state.animationFrame);
    state.animationFrame = null;
    state.playheadSeconds = 0;
    $('#dawPlay').textContent = '▶';
    $('#dawPlay').classList.remove('active');
    setStatus('Stopped — ready');
    updatePlayheadVisual();
  }

  function dawAnimationTick() {
    if (!state.dawPlaying) return;
    state.playheadSeconds = state.dawStartPosition + (performance.now() - state.dawStartWallTime) / 1000;
    if (state.playheadSeconds >= projectEnd()) {
      state.playheadSeconds = 0;
      stopDaw();
      setStatus('Playback complete');
      return;
    }
    updatePlayheadVisual();
    state.animationFrame = requestAnimationFrame(dawAnimationTick);
  }

  async function toggleRecording() {
    const button = $('#dawRecord');
    if (state.recording && state.recording.recorder.state === 'recording') {
      state.recording.recorder.stop();
      button.classList.remove('recording');
      button.textContent = '●';
      setStatus('Finishing microphone take…');
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
      toast('Perekaman mikrofon butuh browser modern dan izin mic. Jalankan via localhost/HTTPS.', 'error');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find(type => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks = [];
      recorder.addEventListener('dataavailable', event => { if (event.data && event.data.size) chunks.push(event.data); });
      recorder.addEventListener('stop', async () => {
        stream.getTracks().forEach(track => track.stop());
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        if (blob.size > 0) {
          const recordedType = (recorder.mimeType || blob.type || 'audio/webm').toLowerCase();
          const ext = /ogg/.test(recordedType) ? 'ogg' : /mp4|m4a|aac/.test(recordedType) ? 'm4a' : /wav/.test(recordedType) ? 'wav' : 'webm';
          const file = new File([blob], `EUPHONIA-Take-${new Date().toISOString().replace(/[:.]/g, '-')}.${ext}`, { type: recordedType, lastModified: Date.now() });
          const item = createLibraryItem(file);
          renderLibrary(); renderHomeRecent(); updateLibraryCount();
          try { await addItemToDaw(item); setStatus('Microphone take added to arrangement'); }
          catch (error) { toast(`Take terekam, tetapi tidak bisa dibuka: ${error.message}`, 'error'); }
        } else {
          setStatus('No audio captured');
          toast('Tidak ada audio yang terekam.', 'error');
        }
        state.recording = null;
        button.classList.remove('recording');
        button.textContent = '●';
      });
      recorder.start(250);
      state.recording = { recorder, stream, chunks };
      button.classList.add('recording');
      button.textContent = '■';
      setStatus('Recording microphone — press record to finish');
      toast('Recording aktif. Tekan tombol merah untuk mengakhiri take.');
    } catch (error) {
      toast(`Akses mikrofon gagal: ${error.message || 'izin ditolak'}`, 'error');
      setStatus('Microphone permission denied');
    }
  }

  function bytesToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    return btoa(binary);
  }

  function base64ToBytes(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  async function saveSessionJSON() {
    const button = $('#saveProjectBtn');
    const priorText = button.textContent;
    const totalSourceBytes = state.files.reduce((total, item) => total + (Number(item.size) || 0), 0);
    const mobileDevice = window.matchMedia('(max-width: 700px)').matches || /android|iphone|ipad|ipod/i.test(navigator.userAgent);
    const portableLimit = mobileDevice ? 40 * 1024 * 1024 : 120 * 1024 * 1024;
    if (totalSourceBytes > portableLimit) {
      toast(`Project portable terlalu besar (${fmtSize(totalSourceBytes)}). Autosave lokal tetap tersedia; kurangi aset atau ekspor di perangkat dengan RAM lebih besar.`, 'error');
      return;
    }
    button.disabled = true;
    button.textContent = 'Packaging…';
    try {
      const assets = [];
      for (const item of state.files) {
        const buffer = await item.file.arrayBuffer();
        assets.push({ id: item.id, name: item.name, type: item.file.type || 'application/octet-stream', size: item.size, lastModified: item.lastModified, data: bytesToBase64(buffer) });
      }
      const data = {
        format: 'EUPHONIA-PROJECT', version: '0.3.1', application: 'EUPHONIA Studio', savedAt: new Date().toISOString(),
        settings: { tempo: Number($('#bpmInput').value) || 118, key: $('#keySelect').value, grid: $('#gridSelect').value, master: { ...state.masterSettings }, playheadSeconds: state.playheadSeconds, pixelsPerSecond: state.pixelsPerSecond },
        currentFileId: state.currentFileId, favorites: [...state.favorites], assets,
        tracks: state.dawTracks.map(track => ({ id: track.id, name: track.name, color: track.color, volume: track.volume, pan: track.pan || 0, muted: track.muted, solo: track.solo, clips: track.clips.map(clip => ({ id: clip.id, assetId: clip.item.id, name: clip.name, start: clip.start, offset: clip.offset || 0, duration: clip.duration })) })),
        advanced: window.EUPHONIA_DAW && typeof window.EUPHONIA_DAW.serialize === 'function' ? window.EUPHONIA_DAW.serialize() : {}
      };
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      downloadBlob(blob, `euphonia-project-${new Date().toISOString().slice(0,10)}.euphonia.json`);
      setStatus('Project saved with source audio and arrangement');
      toast(`Project EUPHONIA tersimpan (${assets.length} file audio disertakan). Simpan file ini sebagai backup lengkap.`);
    } catch (error) {
      toast(`Project gagal disimpan: ${error.message}`, 'error');
    } finally { button.disabled = false; button.textContent = priorText; }
  }

  async function loadFullProject(file) {
    if (!file) return;
    if (state.recording && state.recording.recorder.state === 'recording') { toast('Akhiri rekaman sebelum membuka project lain.', 'error'); return; }
    let previousSession = null;
    if (file.size > 512 * 1024 * 1024) { toast('Project terlalu besar untuk dibuka dengan aman di browser (maksimal 512 MB).', 'error'); return; }
    try {
      const project = JSON.parse(await file.text());
      if (project.format !== 'EUPHONIA-PROJECT' || !Array.isArray(project.assets) || !Array.isArray(project.tracks)) throw new Error('File ini bukan project EUPHONIA yang valid.');
      if (project.assets.length > 1000 || project.tracks.length > 256) throw new Error('Project melewati batas jumlah aset/track yang aman.');
      for (const asset of project.assets) {
        if (!asset || typeof asset.id !== 'string' || typeof asset.name !== 'string' || typeof asset.data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(asset.data)) throw new Error('Project berisi data aset yang tidak valid. Session lama tetap dipertahankan.');
        if (asset.data.length > 400 * 1024 * 1024 * 1.4) throw new Error(`Aset ${asset.name} terlalu besar untuk dimuat dengan aman.`);
      }
      for (const track of project.tracks) {
        if (!track || !Array.isArray(track.clips)) throw new Error('Struktur track tidak valid. Session lama tetap dipertahankan.');
        if (track.clips.length > 10000) throw new Error('Project berisi terlalu banyak clip.');
      }
      // Decode Base64 and construct files before touching the active workspace.
      const stagedAssets = project.assets.map(asset => {
        let bytes;
        try { bytes = base64ToBytes(asset.data); }
        catch (_) { throw new Error(`Data audio “${asset.name}” rusak. Session saat ini tetap aman.`); }
        return { asset, fileObject: new File([bytes], asset.name, { type: asset.type || 'audio/wav', lastModified: asset.lastModified || Date.now() }) };
      });
      previousSession = {
        files: state.files, favorites: new Set(state.favorites), currentFileId: state.currentFileId, dawTracks: state.dawTracks,
        nextTrackId: state.nextTrackId, nextClipId: state.nextClipId, selectedTrackId: state.selectedTrackId, selectedClipId: state.selectedClipId,
        playheadSeconds: state.playheadSeconds, pixelsPerSecond: state.pixelsPerSecond, masterSettings: { ...state.masterSettings },
        tempo: $('#bpmInput').value, key: $('#keySelect').value, grid: $('#gridSelect').value,
        advanced: window.EUPHONIA_DAW && window.EUPHONIA_DAW.serialize ? window.EUPHONIA_DAW.serialize() : {},
        activePage: $('.page.active')?.id.replace('page-', '') || 'home', isRestoring: state.isRestoring
      };
      state.isRestoring = true;
      state.dawPlaying = false; stopDawSources();
      if (state.animationFrame) cancelAnimationFrame(state.animationFrame);
      if (audioPlayer) { audioPlayer.pause(); audioPlayer.removeAttribute('src'); audioPlayer.load(); }
      state.files = []; state.favorites.clear(); state.currentFileId = null;
      state.dawTracks = []; state.nextTrackId = 1; state.nextClipId = 1; state.selectedTrackId = null; state.selectedClipId = null;
      const assetMap = new Map();
      for (const staged of stagedAssets) {
        const item = createLibraryItem(staged.fileObject);
        assetMap.set(staged.asset.id, item);
      }
      for (const savedTrack of project.tracks) {
        const track = createDawTrack(savedTrack.name || 'Audio Track');
        track.color = savedTrack.color || track.color;
        track.volume = Number.isFinite(savedTrack.volume) ? savedTrack.volume : 0.82;
        track.pan = Number.isFinite(savedTrack.pan) ? savedTrack.pan : 0;
        track.muted = Boolean(savedTrack.muted); track.solo = Boolean(savedTrack.solo);
        for (const savedClip of savedTrack.clips || []) {
          const item = assetMap.get(savedClip.assetId);
          if (!item) continue;
          const buffer = await decodeItem(item);
          track.clips.push({ id: Number(savedClip.id) || state.nextClipId++, item, name: savedClip.name || item.name, start: Math.max(0, Number(savedClip.start) || 0), offset: Math.max(0, Number(savedClip.offset) || 0), duration: Math.max(0.01, Math.min(Number(savedClip.duration) || buffer.duration, buffer.duration - Math.max(0, Number(savedClip.offset) || 0))), buffer });
          state.nextClipId = Math.max(state.nextClipId, track.clips[track.clips.length - 1].id + 1);
        }
      }
      const settings = project.settings || {};
      $('#bpmInput').value = Math.max(40, Math.min(240, Number(settings.tempo) || 118));
      if (settings.key) $('#keySelect').value = settings.key;
      if (settings.grid !== undefined) $('#gridSelect').value = String(settings.grid);
      state.playheadSeconds = Math.max(0, Number(settings.playheadSeconds) || 0);
      state.pixelsPerSecond = Math.max(17, Math.min(112, Number(settings.pixelsPerSecond) || 44));
      if (settings.master) setMasterSettings(settings.master);
      if (window.EUPHONIA_DAW && typeof window.EUPHONIA_DAW.deserialize === 'function') window.EUPHONIA_DAW.deserialize(project.advanced || {});
      state.selectedTrackId = state.dawTracks.length ? state.dawTracks[state.dawTracks.length - 1].id : null;
      state.currentFileId = assetMap.has(project.currentFileId) ? assetMap.get(project.currentFileId).id : null;
      state.favorites = new Set((project.favorites || []).map(id => assetMap.get(id)?.id).filter(Boolean));
      renderLibrary(); renderHomeRecent(); updateLibraryCount(); renderDaw(); showPage('studio');
      if (state.currentFileId) { const current = state.files.find(item => item.id === state.currentFileId); if (current) { audioPlayer.src = current.url; audioPlayer.load(); $('#playerTitle').textContent = current.name; $('#playerArtist').textContent = 'Local Library · Project'; } }
      state.isRestoring = previousSession.isRestoring;
      previousSession.files.forEach(item => { try { URL.revokeObjectURL(item.url); } catch (_) {} });
      state.files.forEach(persistAsset);
      queueWorkspaceSave();
      setStatus('Project loaded');
      toast(`Project EUPHONIA berhasil dibuka: ${state.dawTracks.length} track, ${state.files.length} file audio.`);
    } catch (error) {
      // Keep the previous working session intact if decoding or validation fails mid-load.
      if (typeof previousSession !== 'undefined' && previousSession) {
        state.files.filter(item => !previousSession.files.includes(item)).forEach(item => { try { URL.revokeObjectURL(item.url); } catch (_) {} });
        state.files = previousSession.files; state.favorites = previousSession.favorites; state.currentFileId = previousSession.currentFileId; state.dawTracks = previousSession.dawTracks;
        state.nextTrackId = previousSession.nextTrackId; state.nextClipId = previousSession.nextClipId; state.selectedTrackId = previousSession.selectedTrackId; state.selectedClipId = previousSession.selectedClipId;
        state.playheadSeconds = previousSession.playheadSeconds; state.pixelsPerSecond = previousSession.pixelsPerSecond; setMasterSettings(previousSession.masterSettings);
        $('#bpmInput').value = previousSession.tempo; $('#keySelect').value = previousSession.key; $('#gridSelect').value = previousSession.grid;
        if (window.EUPHONIA_DAW?.deserialize) window.EUPHONIA_DAW.deserialize(previousSession.advanced);
        renderLibrary(); renderHomeRecent(); updateLibraryCount(); renderDaw(); showPage(previousSession.activePage);
        if (state.currentFileId) { const current = state.files.find(item => item.id === state.currentFileId); if (current) { audioPlayer.src = current.url; audioPlayer.load(); } } else { audioPlayer.removeAttribute('src'); audioPlayer.load(); }
        state.isRestoring = previousSession.isRestoring;
      }
      toast(`Tidak bisa membuka project: ${error.message}. Session sebelumnya dipertahankan.`, 'error');
    }
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1800);
  }

  function audioBufferToWav(buffer) {
    const channels = Math.min(2, buffer.numberOfChannels);
    const sampleRate = buffer.sampleRate;
    const length = buffer.length;
    const bytesPerSample = 2;
    const blockAlign = channels * bytesPerSample;
    const dataSize = length * blockAlign;
    const arrayBuffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(arrayBuffer);
    const writeString = (offset, string) => { for (let i = 0; i < string.length; i++) view.setUint8(offset + i, string.charCodeAt(i)); };
    writeString(0, 'RIFF'); view.setUint32(4, 36 + dataSize, true); writeString(8, 'WAVE');
    writeString(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
    view.setUint16(22, channels, true); view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true); view.setUint16(32, blockAlign, true); view.setUint16(34, 16, true);
    writeString(36, 'data'); view.setUint32(40, dataSize, true);
    const channelData = Array.from({ length: channels }, (_, index) => buffer.getChannelData(index));
    let offset = 44;
    for (let i = 0; i < length; i++) {
      for (let ch = 0; ch < channels; ch++) {
        let sample = Math.max(-1, Math.min(1, channelData[ch][i] || 0));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        offset += 2;
      }
    }
    return new Blob([arrayBuffer], { type: 'audio/wav' });
  }

  async function exportMix() {
    const clips = state.dawTracks.flatMap(track => track.clips.map(clip => ({ track, clip })));
    if (!clips.length) { toast('Belum ada audio clip untuk diekspor.', 'error'); return; }
    const exportButton = $('#exportMixBtn');
    const originalText = exportButton.innerHTML;
    exportButton.disabled = true;
    exportButton.textContent = 'Rendering…';
    setStatus('Rendering audio mix…');
    try {
      const sampleRate = 44100;
      let duration = Math.max(...clips.map(({ clip }) => clip.start + clip.duration)) + 1.8;
      duration = Math.min(600, Math.max(1, duration));
      const frameCount = Math.ceil(duration * sampleRate);
      const estimatedWorkingBytes = frameCount * 12;
      if (estimatedWorkingBytes > 280 * 1024 * 1024) throw new Error('Mix terlalu panjang untuk dirender dengan aman dalam satu proses browser. Kurangi durasi arrangement atau export bagian yang lebih pendek.');
      const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!OfflineCtx) throw new Error('OfflineAudioContext tidak tersedia di browser ini.');
      const offline = new OfflineCtx(2, frameCount, sampleRate);
      const hasSolo = activeSoloExists();
      for (const { track, clip } of clips) {
        if (track.muted || (hasSolo && !track.solo) || clip.start >= duration) continue;
        const buffer = clip.buffer || await decodeItem(clip.item);
        const source = offline.createBufferSource();
        const gain = offline.createGain();
        const panner = offline.createStereoPanner ? offline.createStereoPanner() : null;
        source.buffer = buffer;
        gain.gain.value = Math.max(0, Math.min(1, track.volume));
        if (panner) panner.pan.value = Math.max(-1, Math.min(1, track.pan || 0));
        source.connect(panner || gain); if (panner) panner.connect(gain);
        gain.connect(getMasterChain(offline).input);
        const remaining = Math.min(clip.duration, duration - clip.start);
        source.start(clip.start, Math.max(0, clip.offset || 0), Math.min(remaining, buffer.duration - Math.max(0, clip.offset || 0)));
      }
      scheduleMasterAutomation(offline, 0, 0, duration);
      const rendered = await offline.startRendering();
      const wav = audioBufferToWav(rendered);
      downloadBlob(wav, `euphonia-mix-${new Date().toISOString().slice(0,10)}.wav`);
      setStatus('Export complete — WAV downloaded');
      toast(`Mix berhasil dirender (${fmtTime(duration)}).`);
    } catch (error) {
      setStatus('Export failed');
      toast(`Export WAV gagal: ${error.message}`, 'error');
    } finally {
      exportButton.disabled = false;
      exportButton.innerHTML = originalText;
    }
  }

  function showConfirmModal({ title, message, confirmLabel = 'Confirm', onConfirm }) {
    $('#modalTitle').textContent = title;
    $('#modalMessage').textContent = message;
    $('#modalConfirm').textContent = confirmLabel;
    $('#modalBackdrop').hidden = false;
    state.pendingModalAction = onConfirm;
  }

  function closeModal() {
    $('#modalBackdrop').hidden = true;
    state.pendingModalAction = null;
  }

  function clearSession() {
    if (state.recording && state.recording.recorder.state === 'recording') {
      toast('Akhiri rekaman sebelum menghapus session.', 'error'); return;
    }
    if (!state.dawTracks.length) { toast('Session sudah kosong.'); return; }
    showConfirmModal({
      title: 'Clear this session?',
      message: 'Semua track dan clip pada arrangement akan dihapus. Pola MIDI/drum dikosongkan; file sumber di Local Library tetap ada.',
      confirmLabel: 'Clear session',
      onConfirm: () => {
        pushUndoSnapshot(); stopDaw(); state.dawTracks = []; state.selectedClipId = null; state.playheadSeconds = 0; if (window.EUPHONIA_DAW && window.EUPHONIA_DAW.clearPatterns) window.EUPHONIA_DAW.clearPatterns(); renderDaw(); setStatus('Session cleared'); toast('Session dibersihkan.');
      }
    });
  }

  function moveClip(clipId, trackId, newStart, targetTrackId = trackId) {
    const sourceTrack = state.dawTracks.find(t => t.id === trackId);
    const clip = sourceTrack && sourceTrack.clips.find(c => c.id === clipId);
    if (!clip) return;
    clip.start = snapTime(newStart);
    const targetTrack = state.dawTracks.find(t => t.id === targetTrackId);
    if (targetTrack && targetTrack.id !== sourceTrack.id) {
      sourceTrack.clips = sourceTrack.clips.filter(c => c.id !== clip.id);
      targetTrack.clips.push(clip);
      state.selectedTrackId = targetTrack.id;
    }
    state.selectedClipId = clip.id;
    renderDaw();
    setStatus(`Moved ${clip.name} to ${fmtTime(clip.start)}`);
    queueWorkspaceSave();
    restartArrangementIfPlaying();
  }

  function handleTrackAction(action, trackId) {
    const index = state.dawTracks.findIndex(track => track.id === trackId);
    if (index < 0) return;
    const track = state.dawTracks[index];
    if (action === 'mute' || action === 'solo') pushUndoSnapshot();
    if (action === 'mute') track.muted = !track.muted;
    else if (action === 'solo') track.solo = !track.solo;
    else if (action === 'remove') {
      showConfirmModal({
        title: 'Remove track?',
        message: `Track “${track.name}” dan semua clip di dalamnya akan dihapus dari session. File asli tetap ada di Library.`,
        confirmLabel: 'Remove track',
        onConfirm: () => { pushUndoSnapshot(); state.dawTracks = state.dawTracks.filter(t => t.id !== trackId); renderDaw(); setStatus('Track removed'); toast('Track dihapus dari session.'); }
      });
      return;
    }
    renderDaw();
    if (state.dawPlaying) { pauseDaw(); startDaw(); }
  }

  // Navigation and global search.
  $$('[data-page]').forEach(button => {
    button.addEventListener('click', () => showPage(button.dataset.page));
  });
  $('#mobileMenu').addEventListener('click', () => { const open = !$('#sidebar').classList.contains('open'); $('#sidebar').classList.toggle('open', open); $('#mobileScrim').hidden = !open; $('#mobileMenu').setAttribute('aria-expanded', String(open)); });
  $('#mobileScrim').addEventListener('click', () => { $('#sidebar').classList.remove('open'); $('#mobileScrim').hidden = true; $('#mobileMenu').setAttribute('aria-expanded', 'false'); });
  $('#quickImport').addEventListener('click', () => askImport('library'));
  $('#emptyImport')?.addEventListener('click', () => askImport('library'));
  $('#hubImport').addEventListener('click', () => askImport('library'));
  $('#libraryImport').addEventListener('click', () => askImport('library'));
  $('#libraryEmptyImport')?.addEventListener('click', () => askImport('library'));
  $('#timelineImport').addEventListener('click', () => askImport('daw'));
  $('#dawImportBtn').addEventListener('click', () => askImport('daw'));
  $('#addTrackBtn').addEventListener('click', () => { pushUndoSnapshot(); createDawTrack(); setStatus('Empty track created — import audio to add a clip'); toast('Track kosong dibuat. Gunakan Import untuk menambahkan clip.'); });
  audioFilesInput.addEventListener('change', event => importFiles(event.target.files, state.inputPurpose));
  singleAudioInput.addEventListener('change', event => importFiles(event.target.files, state.inputPurpose));

  $('#globalSearch').addEventListener('keydown', event => {
    if (event.key === 'Enter') navigateSearch(event.currentTarget.value);
  });
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault(); $('#globalSearch').focus();
    }
    if (event.key === 'Escape') { $('#sidebar').classList.remove('open'); $('#mobileScrim').hidden = true; closeModal(); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); }
    if ((event.ctrlKey || event.metaKey) && $('#page-studio').classList.contains('active') && (!window.EUPHONIA_DAW || window.EUPHONIA_DAW.getView() === 'arrangement')) {
      if (event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redoArrangement() : undoArrangement(); }
      else if (event.key.toLowerCase() === 'y') { event.preventDefault(); redoArrangement(); }
      else if (event.key.toLowerCase() === 'd' && !/input|textarea|select/i.test(event.target.tagName)) { event.preventDefault(); duplicateSelectedClip(); }
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && $('#page-studio').classList.contains('active') && (!window.EUPHONIA_DAW || window.EUPHONIA_DAW.getView() === 'arrangement') && !/input|textarea|select/i.test(event.target.tagName)) { event.preventDefault(); deleteSelectedClip(); }
    if (event.code === 'Space' && !['INPUT','TEXTAREA','SELECT','BUTTON'].includes(document.activeElement.tagName)) {
      if ($('#page-studio').classList.contains('active')) { event.preventDefault(); state.dawPlaying ? pauseDaw() : startDaw(); }
      else if (state.currentFileId) { event.preventDefault(); togglePlayer(); }
    }
  });

  // In-app Music Hub: catalog previews and official embeds only; never frame entire service search pages.
  $('#searchAll').addEventListener('click', () => { void doHubSearch(); });
  $('#hubSearch').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); void doHubSearch(); } });
  $('#hubSearch').addEventListener('input', () => syncPlatformLinks());
  $$('[data-platform]').forEach(link => {
    const platform = link.dataset.platform;
    link.addEventListener('click', event => {
      event.preventDefault();
      selectPlatformInHub(platform);
    });
  });
  $('#clearSavedPlaylist').addEventListener('click', () => {
    if (activeHubProvider === 'catalog') {
      setHubStatus('Pilih salah satu platform sebelum menghapus link yang tersimpan.', 'info');
      return;
    }
    try {
      localStorage.removeItem(`euphonia.musicHubPlaylist.${activeHubProvider}`);
      updateSavedPlaylistNote();
      setHubStatus(`Link playlist ${platformNames[activeHubProvider]} dihapus dari penyimpanan browser EUPHONIA.`, 'success');
    } catch (_) {
      setHubStatus('Browser menolak menghapus link tersimpan.', 'error');
    }
  });
  $('#hubApiSettings').addEventListener('click', () => {
    const panel = $('#youtubeApiPanel');
    panel.hidden = !panel.hidden;
    if (!panel.hidden) {
      $('#youtubeApiKeyInput').value = getYoutubeApiKey();
      $('#youtubeApiKeyInput').focus();
    }
  });
  $('#saveYoutubeApiKey').addEventListener('click', () => {
    const key = $('#youtubeApiKeyInput').value.trim();
    if (!key) { setHubStatus('Masukkan API key terlebih dahulu, atau gunakan Hapus untuk meniadakan key tersimpan.', 'error'); return; }
    try {
      localStorage.setItem('euphonia.youtubeDataApiKey', key);
      $('#youtubeApiPanel').hidden = true;
      setHubProvider('youtube');
      setHubStatus('YouTube API key tersimpan di localStorage browser ini. Pastikan key dibatasi untuk HTTP referrer dan YouTube Data API v3.', 'success');
    } catch (_) { setHubStatus('Browser menolak penyimpanan lokal. Periksa pengaturan privasi atau gunakan browser lain.', 'error'); }
  });
  $('#clearYoutubeApiKey').addEventListener('click', () => {
    try { localStorage.removeItem('euphonia.youtubeDataApiKey'); } catch (_) {}
    $('#youtubeApiKeyInput').value = '';
    setHubProvider(activeHubProvider);
    setHubStatus('YouTube API key dihapus dari browser ini.', 'success');
  });
  $('#embedLinkForm').addEventListener('submit', event => { event.preventDefault(); playPastedEmbedLink(); });
  $('#hubPreviewStop').addEventListener('click', () => {
    const audio = $('#hubPreviewAudio'); audio.pause(); audio.currentTime = 0;
    setHubStatus('Preview dihentikan.', 'info');
  });
  $('#platformViewerClose').addEventListener('click', closePlatformViewer);
  $('#platformViewerReload').addEventListener('click', () => {
    const frame = $('#platformFrame');
    if (frame.src && frame.src !== 'about:blank') frame.src = frame.src;
  });
  $('#platformViewerFullscreen').addEventListener('click', async () => {
    const frameWrap = $('#viewerFrameWrap');
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await frameWrap.requestFullscreen();
    } catch {
      toast('Mode fullscreen tidak didukung di browser ini.');
    }
  });
  setHubProvider('catalog');
  initializeSpotifyConnectUI();

  // Streaming home interactions: preview playback, My List, and mood-based catalog search.
  $('#page-home').addEventListener('click', event => {
    const playFeatured = event.target.closest('#homeFeaturedPlay');
    if (playFeatured) {
      if (homeFeaturedItem) playApplePreview(homeFeaturedItem, homeCatalogQueues.get(homeTrackKey(homeFeaturedItem)) || [homeFeaturedItem]);
      else { showPage('discover'); setHubProvider('catalog'); $('#hubSearch').value = 'alternative r&b'; void doHubSearch(); }
      return;
    }
    const saveFeatured = event.target.closest('#homeFeaturedSave');
    if (saveFeatured) { if (homeFeaturedItem) toggleHomeSaved(homeFeaturedItem); else toast('Featured track belum tersedia.', 'error'); return; }
    const playButton = event.target.closest('[data-stream-play]');
    if (playButton) {
      const key = playButton.dataset.streamPlay;
      const item = homeCatalogItems.get(key);
      if (item) playApplePreview(item, homeCatalogQueues.get(key) || [item]);
      return;
    }
    const saveButton = event.target.closest('[data-stream-save]');
    if (saveButton) {
      const item = homeCatalogItems.get(saveButton.dataset.streamSave);
      if (item) toggleHomeSaved(item);
      return;
    }
    const searchButton = event.target.closest('[data-home-search]');
    if (searchButton) {
      const query = searchButton.dataset.homeSearch || '';
      if (!query) return;
      showPage('discover');
      setHubProvider('catalog');
      $('#hubSearch').value = query;
      void doHubSearch();
    }
  });

  // Library filters and delegated file rows.
  $$('.library-tab').forEach(button => button.addEventListener('click', () => {
    state.libraryFilter = button.dataset.libraryFilter;
    $$('.library-tab').forEach(tab => tab.classList.toggle('active', tab === button));
    renderLibrary();
  }));
  $('#homeRecent').addEventListener('click', event => {
    const row = event.target.closest('[data-play-file]');
    if (row) {
      const item = state.files.find(file => file.id === row.dataset.playFile);
      if (item) playItem(item);
    }
  });
  $('#libraryRows').addEventListener('click', event => {
    const menu = event.target.closest('[data-row-action="menu"]');
    if (menu) {
      const item = state.files.find(file => file.id === menu.dataset.fileId);
      if (!item) return;
      showConfirmModal({
        title: item.name,
        message: 'Pilih tindakan untuk file audio ini. File sumber disimpan di Library lokal browser jika autosave tersedia; file tidak ikut terhapus saat track dihapus dari arrangement.',
        confirmLabel: 'Send to DAW',
        onConfirm: async () => {
          try { await addItemToDaw(item); showPage('studio'); }
          catch (error) { toast(error.message, 'error'); }
        }
      });
      return;
    }
    const row = event.target.closest('[data-row-file]');
    if (row) {
      const item = state.files.find(file => file.id === row.dataset.rowFile);
      if (item) playItem(item);
    }
  });
  $('#libraryRows').addEventListener('keydown', event => {
    if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[data-row-file]')) {
      event.preventDefault(); const item = state.files.find(file => file.id === event.target.dataset.rowFile); if (item) playItem(item);
    }
  });

  // Player controls.
  $('#playerToggle').addEventListener('click', togglePlayer);
  $('#prevTrack').addEventListener('click', () => nextPlayerTrack(-1));
  $('#nextTrack').addEventListener('click', () => nextPlayerTrack(1));
  $('#playerSeek').addEventListener('input', event => {
    if (Number.isFinite(audioPlayer.duration) && audioPlayer.duration > 0) audioPlayer.currentTime = Number(event.target.value) / 1000 * audioPlayer.duration;
  });
  $('#playerVolume').addEventListener('input', event => { audioPlayer.volume = Number(event.target.value) / 100; });
  audioPlayer.volume = .75;
  audioPlayer.addEventListener('timeupdate', updatePlayerProgress);
  audioPlayer.addEventListener('loadedmetadata', updatePlayerProgress);
  audioPlayer.addEventListener('play', () => { $('#playerToggle').textContent = 'Ⅱ'; renderLibrary(); });
  audioPlayer.addEventListener('pause', () => { $('#playerToggle').textContent = '▶'; renderLibrary(); });
  audioPlayer.addEventListener('ended', () => nextPlayerTrack(1));
  $('#playerFav').addEventListener('click', () => {
    if (state.externalTrack) { toggleHomeSaved(state.externalTrack); return; }
    if (!state.currentFileId) { toast('Pilih track dulu untuk menandai favorite.'); return; }
    if (state.favorites.has(state.currentFileId)) state.favorites.delete(state.currentFileId); else state.favorites.add(state.currentFileId);
    $('#playerFav').classList.toggle('is-fav', state.favorites.has(state.currentFileId));
    $('#playerFav').textContent = state.favorites.has(state.currentFileId) ? '♥' : '♡';
    queueWorkspaceSave();
  });
  $('#sendToDaw').addEventListener('click', async () => {
    const item = currentItem();
    if (!item && state.externalTrack) { toast('Preview dari katalog tidak dapat dimasukkan ke DAW. Import file audio yang kamu miliki atau berhak gunakan.', 'error'); return; }
    if (!item) { toast('Putar track lokal dulu, atau import audio ke Library.'); askImport('daw'); return; }
    try { await addItemToDaw(item); showPage('studio'); }
    catch (error) { toast(error.message, 'error'); }
  });
  $('#playerQueue').addEventListener('click', () => { showPage('library'); toast(`${state.files.length} file audio di library lokal.`); });

  // DAW transport, settings, import, and export.
  $('#dawPlay').addEventListener('click', () => (state.dawPlaying || state.isStartingPlayback) ? pauseDaw() : startDaw());
  $('#dawStop').addEventListener('click', stopDaw);
  $('#dawRecord').addEventListener('click', toggleRecording);
  $('#bpmInput').addEventListener('change', () => { $('#bpmInput').value = String(Math.max(40, Math.min(240, Number($('#bpmInput').value) || 118))); renderDaw(); setStatus(`Tempo set to ${$('#bpmInput').value} BPM`); queueWorkspaceSave(); });
  $('#keySelect').addEventListener('change', () => { setStatus(`Key/scale guide: ${$('#keySelect').value}`); window.EUPHONIA_DAW?.renderPiano?.(); queueWorkspaceSave(); });
  $('#gridSelect').addEventListener('change', () => { setStatus('Snap grid updated'); queueWorkspaceSave(); });
  $('#rulerZoomIn').addEventListener('click', () => { state.pixelsPerSecond = Math.min(112, state.pixelsPerSecond * 1.25); renderDaw(); queueWorkspaceSave(); });
  $('#rulerZoomOut').addEventListener('click', () => { state.pixelsPerSecond = Math.max(17, state.pixelsPerSecond / 1.25); renderDaw(); queueWorkspaceSave(); });
  $('#saveProjectBtn').addEventListener('click', saveSessionJSON);
  $('#exportMixBtn').addEventListener('click', exportMix);
  $('#clearSessionBtn').addEventListener('click', clearSession);
  $('#dawUndo').addEventListener('click', undoArrangement);
  $('#dawRedo').addEventListener('click', redoArrangement);
  $('#splitClipBtn').addEventListener('click', splitSelectedClipAtPlayhead);
  $('#duplicateClipBtn').addEventListener('click', duplicateSelectedClip);
  $('#deleteClipBtn').addEventListener('click', deleteSelectedClip);
  $$('[data-tool]').forEach(button => button.addEventListener('click', () => {
    state.activeTool = button.dataset.tool;
    $$('[data-tool]').forEach(tool => { const active = tool === button; tool.classList.toggle('active', active); tool.setAttribute('aria-pressed', String(active)); });
    setStatus(state.activeTool === 'draw' ? 'Draw tool — click the timeline to place the currently playing library audio' : 'Select tool — choose or move clips');
  }));

  $('#trackHeaders').addEventListener('click', event => {
    if (event.target.closest('#firstTrackImport')) { askImport('daw'); return; }
    const actionButton = event.target.closest('[data-track-action]');
    if (actionButton) { handleTrackAction(actionButton.dataset.trackAction, Number(actionButton.dataset.trackId)); return; }
    const head = event.target.closest('[data-track-head]');
    if (head) { state.selectedTrackId = Number(head.dataset.trackHead); $$('.track-head').forEach(el => el.classList.toggle('selected', el === head)); }
  });
  $('#trackHeaders').addEventListener('change', event => {
    const nameInput = event.target.closest('[data-track-name]');
    if (nameInput) {
      const track = state.dawTracks.find(t => t.id === Number(nameInput.dataset.trackName));
      if (track && nameInput.value.trim()) { pushUndoSnapshot(); track.name = nameInput.value.trim(); setStatus(`Renamed track to ${track.name}`); queueWorkspaceSave(); }
      return;
    }
    const volumeInput = event.target.closest('[data-track-volume]');
    if (volumeInput) {
      const track = state.dawTracks.find(t => t.id === Number(volumeInput.dataset.trackVolume));
      if (track) track.volume = Number(volumeInput.value);
      queueWorkspaceSave();
      if (window.EUPHONIA && window.EUPHONIA.refreshDawMix) window.EUPHONIA.refreshDawMix();
      return;
    }
    const panInput = event.target.closest('[data-track-pan]');
    if (panInput) { const track = state.dawTracks.find(t => t.id === Number(panInput.dataset.trackPan)); if (track) track.pan = Number(panInput.value); queueWorkspaceSave(); window.EUPHONIA?.refreshDawMix?.(); }
  });
  $('#trackHeaders').addEventListener('input', event => {
    const volumeInput = event.target.closest('[data-track-volume]');
    if (volumeInput) {
      const track = state.dawTracks.find(t => t.id === Number(volumeInput.dataset.trackVolume));
      if (track) { track.volume = Number(volumeInput.value); queueWorkspaceSave(); const label = $(`[data-gain-label="${track.id}"]`); if (label) label.textContent = `${Math.round(track.volume * 100)}%`; }
    }
    const panInput = event.target.closest('[data-track-pan]');
    if (panInput) { const track = state.dawTracks.find(t => t.id === Number(panInput.dataset.trackPan)); if (track) track.pan = Number(panInput.value); queueWorkspaceSave(); }
  });
  $('#timelineCanvas').addEventListener('click', event => {
    if (event.target.closest('.audio-clip')) {
      const clipEl = event.target.closest('.audio-clip');
      state.selectedClipId = Number(clipEl.dataset.clipId);
      state.selectedTrackId = Number(clipEl.dataset.trackId);
      $$('.audio-clip').forEach(el => el.classList.toggle('selected', el === clipEl));
      $$('.track-head').forEach(el => el.classList.toggle('selected', Number(el.dataset.trackHead) === state.selectedTrackId));
      updateUndoRedoButtons();
      return;
    }
    if (event.target.closest('button')) return;
    const rect = $('#timelineCanvas').getBoundingClientRect();
    const rawSeconds = Math.max(0, (event.clientX - rect.left) / state.pixelsPerSecond);
    if (state.activeTool === 'draw') { placeClipFromCurrentLibrary(snapTime(rawSeconds)); return; }
    state.playheadSeconds = snapTime(rawSeconds);
    updatePlayheadVisual();
    setStatus(`Playhead: ${fmtTime(state.playheadSeconds)}`);
  });

  // Pointer editing supports mouse, pen, and touch. Resize handles trim the source range.
  let drag = null;
  $('#timelineCanvas').addEventListener('pointerdown', event => {
    const clipEl = event.target.closest('.audio-clip');
    if (!clipEl || event.button !== 0 || state.activeTool === 'draw') return;
    if (event.target.closest('button')) return;
    const clipId = Number(clipEl.dataset.clipId);
    const trackId = Number(clipEl.dataset.trackId);
    const track = state.dawTracks.find(t => t.id === trackId);
    const clip = track && track.clips.find(c => c.id === clipId);
    if (!clip) return;
    const resize = event.target.closest('[data-resize]');
    drag = {
      clipId, trackId, startX: event.clientX, startY: event.clientY, originalStart: clip.start,
      originalDuration: clip.duration, originalOffset: clip.offset || 0, type: resize ? resize.dataset.resize : 'move', moved: false, undoSaved: false
    };
    state.selectedClipId = clipId;
    $$('.audio-clip').forEach(el => el.classList.toggle('selected', el === clipEl));
    try { clipEl.setPointerCapture(event.pointerId); } catch (_) {}
  });
  $('#timelineCanvas').addEventListener('pointermove', event => {
    if (!drag) return;
    const delta = (event.clientX - drag.startX) / state.pixelsPerSecond;
    if (Math.abs(delta) > 2 / state.pixelsPerSecond) drag.moved = true;
    if (!drag.moved) return;
    if (!drag.undoSaved) { pushUndoSnapshot(); drag.undoSaved = true; }
    const clipEl = $(`.audio-clip[data-clip-id="${drag.clipId}"]`);
    if (!clipEl) return;
    if (drag.type === 'move') {
      clipEl.style.left = `${snapTime(Math.max(0, drag.originalStart + delta)) * state.pixelsPerSecond}px`;
    } else if (drag.type === 'left') {
      const newStart = snapTime(Math.max(0, drag.originalStart + delta));
      const actualDelta = newStart - drag.originalStart;
      const nextDuration = drag.originalDuration - actualDelta;
      if (nextDuration >= 0.05) {
        clipEl.style.left = `${newStart * state.pixelsPerSecond}px`;
        clipEl.style.width = `${Math.max(28, nextDuration * state.pixelsPerSecond)}px`;
      }
    } else if (drag.type === 'right') {
      const track = state.dawTracks.find(t => t.id === drag.trackId);
      const clip = track && track.clips.find(c => c.id === drag.clipId);
      const sourceDuration = clip && (clip.buffer || clip.item.buffer) ? (clip.buffer || clip.item.buffer).duration : (clip && clip.item.duration) || drag.originalDuration;
      const maxDuration = Math.max(0.05, sourceDuration - drag.originalOffset);
      const nextDuration = Math.min(maxDuration, Math.max(0.05, snapTime(drag.originalStart + drag.originalDuration + delta) - drag.originalStart));
      clipEl.style.width = `${Math.max(28, nextDuration * state.pixelsPerSecond)}px`;
    }
  });
  const finishDrag = event => {
    if (!drag) return;
    const current = drag;
    drag = null;
    if (current.moved) {
      const sourceTrack = state.dawTracks.find(t => t.id === current.trackId);
      const clip = sourceTrack && sourceTrack.clips.find(c => c.id === current.clipId);
      if (!clip) return;
      const delta = (event.clientX - current.startX) / state.pixelsPerSecond;
      if (current.type === 'move') {
        const canvasRect = $('#timelineCanvas').getBoundingClientRect();
        const contentY = Math.max(0, event.clientY - canvasRect.top);
        const targetIndex = Math.min(state.dawTracks.length - 1, Math.floor(contentY / 84));
        const targetTrack = state.dawTracks[targetIndex];
        // moveClip takes care of snapping and cross-track moves.
        moveClip(current.clipId, current.trackId, current.originalStart + delta, targetTrack ? targetTrack.id : current.trackId);
      } else if (current.type === 'left') {
        const newStart = snapTime(Math.max(0, current.originalStart + delta));
        const applied = newStart - current.originalStart;
        if (current.originalDuration - applied >= 0.05) {
          clip.start = newStart;
          clip.offset = Math.max(0, current.originalOffset + applied);
          clip.duration = Math.max(0.05, current.originalDuration - applied);
        }
        renderDaw(); setStatus('Clip start trimmed'); queueWorkspaceSave(); restartArrangementIfPlaying();
      } else if (current.type === 'right') {
        const sourceDuration = (clip.buffer || clip.item.buffer) ? (clip.buffer || clip.item.buffer).duration : (clip.item.duration || current.originalOffset + current.originalDuration);
        const requested = snapTime(current.originalStart + current.originalDuration + delta) - current.originalStart;
        clip.duration = Math.max(0.05, Math.min(sourceDuration - current.originalOffset, requested));
        renderDaw(); setStatus('Clip end trimmed'); queueWorkspaceSave(); restartArrangementIfPlaying();
      }
    }
  };
  $('#timelineCanvas').addEventListener('pointerup', finishDrag);
  $('#timelineCanvas').addEventListener('pointercancel', finishDrag);
  $('#timelineScroll').addEventListener('scroll', syncRulerScroll, { passive: true });

  // Modal actions.
  $('#modalClose').addEventListener('click', closeModal);
  $('#modalCancel').addEventListener('click', closeModal);
  $('#modalBackdrop').addEventListener('click', event => { if (event.target === $('#modalBackdrop')) closeModal(); });
  $('#modalConfirm').addEventListener('click', async () => {
    const action = state.pendingModalAction;
    closeModal();
    if (action) await action();
  });

  window.EUPHONIA = {
    getAudioContext,
    getMasterInput: (ctx = getAudioContext()) => getMasterChain(ctx).input,
    getMasterSettings: () => ({ ...state.masterSettings }),
    persistAdvanced: () => window.EUPHONIA_DAW && window.EUPHONIA_DAW.serialize ? window.EUPHONIA_DAW.serialize() : {},
    setMasterSettings,
    toast,
    setStatus,
    showPage,
    audioBufferToWav,
    getTempo: () => Math.max(40, Math.min(240, Number($('#bpmInput').value) || 118)),
    getTracks: () => state.dawTracks,
    getFiles: () => state.files,
    addGeneratedAudio: async (blob, name = 'Generated audio') => {
      const file = new File([blob], name.toLowerCase().endsWith('.wav') ? name : `${name}.wav`, { type: blob.type || 'audio/wav', lastModified: Date.now() });
      const item = createLibraryItem(file);
      renderLibrary(); renderHomeRecent(); updateLibraryCount();
      const track = createDawTrack(name.replace(/\.wav$/i, ''));
      await addItemToDaw(item, track.id);
      showPage('studio');
      return track;
    },
    loadProject: loadFullProject,
    setPlayhead: seconds => { state.playheadSeconds = Math.max(0, Number(seconds) || 0); updatePlayheadVisual(); },
    renderDaw,
    setTrackControl: (trackId, action) => handleTrackAction(action, Number(trackId)),
    refreshDawMix: () => { if (state.dawPlaying) { pauseDaw(); startDaw(); } renderDaw(); },
    saveProject: saveSessionJSON,
    markDirty: queueWorkspaceSave,
    getView: () => window.EUPHONIA_DAW?.getView?.() || 'arrangement'
  };

  $('#loadProjectBtn')?.addEventListener('click', () => $('#projectFileInput').click());
  $('#projectFileInput')?.addEventListener('change', event => {
    const file = event.target.files && event.target.files[0];
    if (file) loadFullProject(file);
    event.target.value = '';
  });


  // PWA install prompt: gracefully falls back to browser instructions (not a guaranteed platform prompt).
  let deferredInstallPrompt = null;
  const installButton = $('#installAppBtn');
  if (installButton) {
    installButton.addEventListener('click', async () => {
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        await deferredInstallPrompt.userChoice.catch(() => null);
        deferredInstallPrompt = null;
        installButton.hidden = true;
      } else {
        toast(/iphone|ipad|ipod/i.test(navigator.userAgent) ? 'Di Safari: Share → Add to Home Screen.' : 'Gunakan menu browser lalu pilih Install app atau Install EUPHONIA.', 'success');
      }
    });
    window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferredInstallPrompt = event; installButton.hidden = false; });
    window.addEventListener('appinstalled', () => { installButton.hidden = true; toast('EUPHONIA berhasil dipasang.'); });
  }

  // Mobile drag-and-drop is optional; file picker remains the accessible fallback.
  document.addEventListener('dragover', event => { if (event.dataTransfer?.types?.includes('Files')) event.preventDefault(); });
  document.addEventListener('drop', event => {
    const files = event.dataTransfer && event.dataTransfer.files;
    if (!files || !files.length) return;
    event.preventDefault();
    const purpose = $('#page-studio').classList.contains('active') ? 'daw' : 'library';
    importFiles(files, purpose);
  });

  // Initialize the app shell; IndexedDB recovery runs after both scripts are ready.
  syncPlatformLinks();
  renderHomeRecent();
  renderHomeSavedRail();
  void loadHomeCatalog();
  renderLibrary();
  renderDaw();
  updatePlayerProgress();
  window.addEventListener('load', async () => {
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('./sw.js').catch(error => console.warn('Service worker registration failed:', error));
    await handleSpotifyOAuthCallback();
    await restoreLocalWorkspace();
    // restoreLocalWorkspace already sets the most accurate final status (restored, ready, or warning).
  });
  window.addEventListener('pagehide', () => { if (workspaceReady) Promise.resolve(saveLocalWorkspace({ quiet: true })).catch(() => {}); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && workspaceReady) Promise.resolve(saveLocalWorkspace({ quiet: true })).catch(() => {}); });
})();