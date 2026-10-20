(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const api = window.EUPHONIA;
  if (!api) { console.error('EUPHONIA core failed to load.'); return; }

  const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  const isBlack = pitch => [1, 3, 6, 8, 10].includes(pitch % 12);
  const noteName = pitch => `${NOTE_NAMES[pitch % 12]}${Math.floor(pitch / 12) - 1}`;
  const SCALE_DEGREES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };
  const KEY_SIGNATURES = { 'A min': { root: 9, type: 'minor' }, 'C maj': { root: 0, type: 'major' }, 'D min': { root: 2, type: 'minor' }, 'E min': { root: 4, type: 'minor' }, 'G maj': { root: 7, type: 'major' }, 'F min': { root: 5, type: 'minor' } };
  function selectedScalePitchClasses() {
    const signature = KEY_SIGNATURES[$('#keySelect')?.value] || KEY_SIGNATURES['A min'];
    return new Set(SCALE_DEGREES[signature.type].map(degree => (signature.root + degree) % 12));
  }
  const safeJSON = value => { try { return JSON.stringify(value); } catch (_) { return '{}'; } };
  const defaultPattern = () => {
    const rows = Array.from({ length: 6 }, () => Array(16).fill(false));
    [0, 4, 8, 12].forEach(s => rows[0][s] = true);
    [4, 12].forEach(s => rows[1][s] = true);
    [2, 6, 10, 14].forEach(s => rows[2][s] = true);
    return rows;
  };
  const drumDefinitions = [
    { id: 'kick', label: 'Kick', type: 'kick', color: 'kick' },
    { id: 'snare', label: 'Snare', type: 'snare', color: 'snare' },
    { id: 'hat', label: 'Closed Hat', type: 'hat', color: 'hat' },
    { id: 'openhat', label: 'Open Hat', type: 'openhat', color: 'hat' },
    { id: 'clap', label: 'Clap', type: 'clap', color: 'perc' },
    { id: 'perc', label: 'Perc', type: 'perc', color: 'perc' }
  ];
  const model = {
    view: 'arrangement',
    piano: { notes: [], bars: 4, baseOctave: 3, noteLength: 2, instrument: 'keys', velocity: 96 },
    drums: { pattern: defaultPattern(), bars: 4 },
    activeNotes: new Set(),
    activeDrumNodes: new Set(),
    drumScheduler: null,
    drumPlaying: false,
    nextDrumTime: 0,
    drumStep: 0,
    drumContext: null,
    previewTimers: [],
    drumHighlightTimers: [],
    keyboardHeld: new Set()
  };

  const instruments = {
    keys: { wave: 'triangle', second: 'sine', detune: 0, attack: 0.012, decay: 0.12, sustain: 0.32, release: 0.12, cutoff: 5200, peak: 0.2 },
    piano: { wave: 'triangle', second: 'sine', detune: -4, attack: 0.006, decay: 0.28, sustain: 0.12, release: 0.2, cutoff: 6800, peak: 0.24 },
    pluck: { wave: 'sawtooth', second: null, detune: 0, attack: 0.004, decay: 0.22, sustain: 0.025, release: 0.08, cutoff: 3800, peak: 0.19 },
    pad: { wave: 'sawtooth', second: 'triangle', detune: 8, attack: 0.18, decay: 0.24, sustain: 0.24, release: 0.48, cutoff: 2800, peak: 0.13 },
    bass: { wave: 'square', second: 'sine', detune: -3, attack: 0.008, decay: 0.11, sustain: 0.22, release: 0.09, cutoff: 1150, peak: 0.2 },
    organ: { wave: 'sine', second: 'square', detune: 0, attack: 0.008, decay: 0.06, sustain: 0.25, release: 0.07, cutoff: 4500, peak: 0.16 }
  };

  function persistAdvanced() {
    try { localStorage.setItem('euphonia-daw-v03', safeJSON(serialize())); } catch (_) { /* IndexedDB autosave remains the primary recovery path. */ }
    if (api && typeof api.markDirty === 'function') api.markDirty();
  }

  function serialize() {
    return {
      piano: { ...model.piano, notes: model.piano.notes.map(n => ({ ...n })) },
      drums: { bars: model.drums.bars, pattern: model.drums.pattern.map(row => row.slice()) },
      master: api.getMasterSettings()
    };
  }

  function deserialize(data = {}) {
    if (data.piano && Array.isArray(data.piano.notes)) {
      model.piano.notes = data.piano.notes.filter(n => Number.isFinite(n.step) && Number.isFinite(n.pitch)).map(n => ({ step: Math.max(0, n.step|0), pitch: Math.max(0, n.pitch|0), velocity: Math.max(1, Math.min(127, n.velocity|0)), length: Math.max(1, n.length|0) }));
      model.piano.bars = [1, 2, 4, 8].includes(Number(data.piano.bars)) ? Number(data.piano.bars) : 4;
      model.piano.baseOctave = [2, 3, 4].includes(Number(data.piano.baseOctave)) ? Number(data.piano.baseOctave) : 3;
      model.piano.noteLength = [1, 2, 4, 8].includes(Number(data.piano.noteLength)) ? Number(data.piano.noteLength) : 2;
      model.piano.instrument = instruments[data.piano.instrument] ? data.piano.instrument : 'keys';
      model.piano.velocity = Math.max(20, Math.min(127, Number(data.piano.velocity) || 96));
    }
    if (data.drums && Array.isArray(data.drums.pattern)) {
      const pattern = data.drums.pattern;
      model.drums.pattern = drumDefinitions.map((_, i) => Array.from({ length: 16 }, (_, step) => Boolean(pattern[i] && pattern[i][step])));
      model.drums.bars = [1, 2, 4, 8].includes(Number(data.drums.bars)) ? Number(data.drums.bars) : 4;
    }
    const pianoInstrument = $('#pianoInstrument'); if (pianoInstrument) pianoInstrument.value = model.piano.instrument;
    const pianoRange = $('#pianoRange'); if (pianoRange) pianoRange.value = String(model.piano.baseOctave);
    const pianoBars = $('#pianoBars'); if (pianoBars) pianoBars.value = String(model.piano.bars);
    const noteLength = $('#pianoNoteLength'); if (noteLength) noteLength.value = String(model.piano.noteLength);
    const velocity = $('#pianoVelocity'); if (velocity) velocity.value = String(model.piano.velocity);
    const drumBars = $('#drumBars'); if (drumBars) drumBars.value = String(model.drums.bars);
    if (data.master) applyMixerSettings(data.master);
    renderPiano(); renderDrums(); renderMixer(); persistAdvanced();
  }

  function setView(view) {
    model.view = view;
    $('#arrangementView').hidden = view !== 'arrangement';
    $('#advancedDawView').hidden = view === 'arrangement';
    $$('.daw-module-tab').forEach(button => {
      const active = button.dataset.dawView === view;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    $$('[data-module-panel]').forEach(panel => panel.hidden = panel.dataset.modulePanel !== view);
    if (view === 'arrangement') api.renderDaw();
    if (view === 'piano') renderPiano();
    if (view === 'drums') renderDrums();
    if (view === 'mixer') renderMixer();
  }

  function midiToFrequency(pitch) { return 440 * Math.pow(2, (pitch - 69) / 12); }

  function makeVoice(ctx, pitch, when, duration, velocity, instrument, destination, captureNodes) {
    const cfg = instruments[instrument] || instruments.keys;
    const freq = midiToFrequency(pitch);
    const voiceGain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.setValueAtTime(cfg.cutoff, when); filter.Q.value = instrument === 'pluck' ? 1.1 : 0.65;
    const peak = Math.max(0.0001, cfg.peak * Math.max(0.08, Math.min(1, velocity)));
    const attackEnd = when + cfg.attack;
    const decayEnd = attackEnd + cfg.decay;
    const releaseStart = Math.max(attackEnd + 0.015, when + Math.max(0.025, duration));
    const releaseEnd = releaseStart + cfg.release;
    voiceGain.gain.setValueAtTime(0.0001, when);
    voiceGain.gain.linearRampToValueAtTime(peak, attackEnd);
    voiceGain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * cfg.sustain), decayEnd);
    voiceGain.gain.setValueAtTime(Math.max(0.0001, peak * cfg.sustain), releaseStart);
    voiceGain.gain.exponentialRampToValueAtTime(0.0001, releaseEnd);
    filter.connect(voiceGain); voiceGain.connect(destination);
    const oscillators = [];
    const makeOsc = (type, detune = 0, level = 1) => {
      const osc = ctx.createOscillator(); const g = ctx.createGain();
      osc.type = type; osc.frequency.setValueAtTime(freq, when); osc.detune.setValueAtTime(detune, when);
      g.gain.value = level; osc.connect(g); g.connect(filter); osc.start(when); osc.stop(releaseEnd + 0.03);
      oscillators.push(osc);
      if (captureNodes) captureNodes.add(osc);
    };
    makeOsc(cfg.wave, cfg.detune, cfg.second ? 0.68 : 1);
    if (cfg.second) makeOsc(cfg.second, -cfg.detune, 0.38);
    if (captureNodes) captureNodes.add(voiceGain);
    return oscillators;
  }

  function stopPianoPreview() {
    model.activeNotes.forEach(node => { try { node.stop(); } catch (_) {} });
    model.activeNotes.clear();
    model.previewTimers.forEach(timer => clearTimeout(timer)); model.previewTimers = [];
    $$('.piano-step.now-step').forEach(cell => cell.classList.remove('now-step'));
    $('#pianoPlay').textContent = '▶ Preview';
  }

  function renderPiano() {
    const grid = $('#pianoGrid'); const keys = $('#pianoKeys');
    if (!grid || !keys) return;
    const steps = model.piano.bars * 16;
    const lowest = (model.piano.baseOctave + 1) * 12;
    const highest = lowest + 23;
    const scalePitchClasses = selectedScalePitchClasses();
    grid.style.setProperty('--steps', steps);
    grid.style.minWidth = `${Math.max(620, steps * 17)}px`;
    keys.innerHTML = '';
    grid.innerHTML = '';
    for (let rowIndex = 0; rowIndex < 24; rowIndex++) {
      const pitch = highest - rowIndex;
      const key = document.createElement('div');
      const inScale = scalePitchClasses.has(pitch % 12);
      key.className = `piano-key${isBlack(pitch) ? ' black-key' : ''}${pitch % 12 === 0 ? ' c-key' : ''}${inScale ? ' in-scale-key' : ' out-of-scale-key'}`;
      key.innerHTML = `<span>${pitch % 12 === 0 ? noteName(pitch) : isBlack(pitch) ? '♯' : ''}</span>`;
      keys.appendChild(key);
      const row = document.createElement('div'); row.className = `piano-pitch-row${isBlack(pitch) ? ' black-row' : ''}${pitch % 12 === 0 ? ' octave-row' : ''}${inScale ? ' in-scale-row' : ' out-of-scale-row'}`;
      row.style.setProperty('--steps', steps); row.dataset.pitch = pitch;
      const byStep = new Map(model.piano.notes.filter(note => note.pitch === pitch && note.step < steps).map(note => [note.step, note]));
      for (let step = 0; step < steps; step++) {
        const cell = document.createElement('button');
        const note = byStep.get(step);
        cell.type = 'button'; cell.className = `piano-step${step % 16 === 0 ? ' bar-start' : ''}${step % 4 === 0 ? ' beat-start' : ''}${inScale ? ' in-scale' : ' out-of-scale'}${note ? ' has-note' : ''}`;
        cell.dataset.step = step; cell.dataset.pitch = pitch;
        cell.setAttribute('aria-label', `${noteName(pitch)}, step ${step + 1}${note ? ', note set' : ''}`);
        if (note) {
          cell.innerHTML = `<span class="note-block" style="width:${Math.min(note.length, steps - step) * 100}%" title="${noteName(pitch)} · velocity ${note.velocity}">${step % 16 === 0 ? noteName(pitch) : ''}</span>`;
        }
        row.appendChild(cell);
      }
      grid.appendChild(row);
    }
    $('#pianoNoteCount').textContent = `${model.piano.notes.length} ${model.piano.notes.length === 1 ? 'note' : 'notes'}`;
    $('#pianoVelocityValue').textContent = String(model.piano.velocity);
  }

  function pianoToggleCell(cell) {
    if (!cell) return;
    const step = Number(cell.dataset.step); const pitch = Number(cell.dataset.pitch);
    const index = model.piano.notes.findIndex(note => note.step === step && note.pitch === pitch);
    if (index >= 0) model.piano.notes.splice(index, 1);
    else model.piano.notes.push({ step, pitch, velocity: model.piano.velocity, length: model.piano.noteLength });
    model.piano.notes.sort((a, b) => a.step - b.step || a.pitch - b.pitch);
    renderPiano(); persistAdvanced();
  }

  async function previewPiano() {
    stopPianoPreview();
    if (!model.piano.notes.length) { api.toast('Tambahkan not dulu di Piano Roll.'); return; }
    const ctx = api.getAudioContext(); await ctx.resume();
    const destination = api.getMasterInput(ctx);
    const bpm = api.getTempo(); const stepSeconds = 60 / bpm / 4; const start = ctx.currentTime + 0.09;
    const instrument = model.piano.instrument; const steps = model.piano.bars * 16;
    for (const note of model.piano.notes) {
      if (note.step >= steps) continue;
      const nodes = makeVoice(ctx, note.pitch, start + note.step * stepSeconds, Math.max(0.035, note.length * stepSeconds * 0.91), note.velocity / 127, instrument, destination, model.activeNotes);
      nodes.forEach(node => model.activeNotes.add(node));
    }
    $('#pianoPlay').textContent = '♫ Playing';
    const durationMs = (steps * stepSeconds + 0.6) * 1000;
    model.previewTimers.push(setTimeout(() => stopPianoPreview(), durationMs));
    api.setStatus(`Preview Piano Roll · ${instrument} · ${bpm} BPM`);
  }


  function encodeVLQ(value) {
    let buffer = value & 0x7f;
    const bytes = [];
    while ((value >>= 7)) { buffer <<= 8; buffer |= ((value & 0x7f) | 0x80); }
    while (true) { bytes.push(buffer & 0xff); if (buffer & 0x80) buffer >>= 8; else break; }
    return bytes;
  }

  function buildStandardMidiFile() {
    if (!model.piano.notes.length) throw new Error('Tambahkan not sebelum export MIDI.');
    const ppq = 480; const ticksPerStep = ppq / 4; const bpm = api.getTempo();
    const tempoMicros = Math.round(60000000 / bpm);
    const events = [];
    events.push({ tick: 0, order: -3, bytes: [0xff, 0x03, 0x0d, ...Array.from('EUPHONIA MIDI').map(ch => ch.charCodeAt(0))] });
    events.push({ tick: 0, order: -2, bytes: [0xff, 0x51, 0x03, (tempoMicros >> 16) & 0xff, (tempoMicros >> 8) & 0xff, tempoMicros & 0xff] });
    events.push({ tick: 0, order: -1, bytes: [0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08] });
    model.piano.notes.forEach(note => {
      if (note.step >= model.piano.bars * 16) return;
      const start = Math.max(0, note.step * ticksPerStep);
      const end = start + Math.max(1, note.length) * ticksPerStep;
      events.push({ tick: start, order: 1, bytes: [0x90, note.pitch & 0x7f, Math.max(1, Math.min(127, note.velocity))] });
      events.push({ tick: end, order: 0, bytes: [0x80, note.pitch & 0x7f, 0] });
    });
    events.sort((a, b) => a.tick - b.tick || a.order - b.order);
    const trackBytes = []; let lastTick = 0;
    for (const event of events) { trackBytes.push(...encodeVLQ(event.tick - lastTick), ...event.bytes); lastTick = event.tick; }
    trackBytes.push(0x00, 0xff, 0x2f, 0x00);
    const be32 = n => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
    const be16 = n => [(n >>> 8) & 255, n & 255];
    const bytes = [0x4d,0x54,0x68,0x64, ...be32(6), ...be16(0), ...be16(1), ...be16(ppq), 0x4d,0x54,0x72,0x6b, ...be32(trackBytes.length), ...trackBytes];
    return new Blob([new Uint8Array(bytes)], { type: 'audio/midi' });
  }

  function downloadMidi() {
    try {
      const blob = buildStandardMidiFile();
      const url = URL.createObjectURL(blob); const link = document.createElement('a');
      link.href = url; link.download = `euphonia-midi-${new Date().toISOString().slice(0,10)}.mid`;
      document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
      api.toast('File MIDI Standard (.mid) berhasil diekspor.');
    } catch (error) { api.toast(`Export MIDI gagal: ${error.message}`, 'error'); }
  }

  async function renderPianoBuffer() {
    if (!model.piano.notes.length) throw new Error('Tambahkan not MIDI terlebih dahulu.');
    const sampleRate = 44100; const bpm = api.getTempo(); const stepSeconds = 60 / bpm / 4;
    const duration = model.piano.bars * 16 * stepSeconds + 0.55;
    const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!Offline) throw new Error('OfflineAudioContext tidak tersedia di browser ini.');
    const offline = new Offline(2, Math.ceil(duration * sampleRate), sampleRate);
    for (const note of model.piano.notes) {
      if (note.step >= model.piano.bars * 16) continue;
      makeVoice(offline, note.pitch, 0.02 + note.step * stepSeconds, Math.max(0.035, note.length * stepSeconds * 0.91), note.velocity / 127, model.piano.instrument, offline.destination, null);
    }
    return offline.startRendering();
  }

  async function commitPiano() {
    const button = $('#pianoRender'); const prior = button.textContent;
    button.disabled = true; button.textContent = 'Rendering…';
    try {
      const buffer = await renderPianoBuffer();
      const blob = api.audioBufferToWav(buffer);
      await api.addGeneratedAudio(blob, `MIDI - ${model.piano.instrument} - ${new Date().toISOString().slice(0,10)}.wav`);
      api.toast('Piano Roll dirender menjadi clip audio dan ditambahkan ke Arrangement.');
      setView('arrangement');
    } catch (error) { api.toast(`Render MIDI gagal: ${error.message}`, 'error'); }
    finally { button.disabled = false; button.textContent = prior; }
  }

  const drumNoiseCache = new WeakMap();
  function getNoiseBuffer(ctx) {
    let buffer = drumNoiseCache.get(ctx); if (buffer) return buffer;
    buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    drumNoiseCache.set(ctx, buffer); return buffer;
  }

  function trackDrumNode(node, collection) {
    if (collection && typeof node.stop === 'function') collection.add(node);
    try { node.addEventListener('ended', () => collection && collection.delete(node), { once: true }); } catch (_) {}
    return node;
  }

  function drumHit(ctx, type, when, velocity = 0.9, destination = ctx.destination, collection = null) {
    const v = Math.max(0.05, Math.min(1, velocity));
    const addOsc = (wave, fStart, fEnd, duration, peak) => {
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.type = wave; osc.frequency.setValueAtTime(fStart, when);
      if (fEnd && fEnd !== fStart) osc.frequency.exponentialRampToValueAtTime(Math.max(10, fEnd), when + duration);
      gain.gain.setValueAtTime(Math.max(0.0001, peak * v), when); gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
      osc.connect(gain); gain.connect(destination); osc.start(when); osc.stop(when + duration + 0.015);
      trackDrumNode(osc, collection); trackDrumNode(gain, collection);
    };
    const addNoise = (duration, filterType, frequency, peak, delay = 0) => {
      const src = ctx.createBufferSource(); src.buffer = getNoiseBuffer(ctx);
      const filter = ctx.createBiquadFilter(); filter.type = filterType; filter.frequency.setValueAtTime(frequency, when);
      const gain = ctx.createGain(); gain.gain.setValueAtTime(0.0001, when + delay); gain.gain.linearRampToValueAtTime(peak * v, when + delay + 0.003); gain.gain.exponentialRampToValueAtTime(0.0001, when + delay + duration);
      src.connect(filter); filter.connect(gain); gain.connect(destination); src.start(when + delay); src.stop(when + delay + duration + 0.015);
      [src, filter, gain].forEach(node => trackDrumNode(node, collection));
    };
    if (type === 'kick') addOsc('sine', 145, 43, 0.22, 0.92);
    else if (type === 'snare') { addNoise(0.19, 'bandpass', 1900, 0.55); addOsc('triangle', 190, 95, 0.12, 0.2); }
    else if (type === 'hat') addNoise(0.065, 'highpass', 7200, 0.28);
    else if (type === 'openhat') addNoise(0.31, 'highpass', 6100, 0.29);
    else if (type === 'clap') { [0, 0.016, 0.032].forEach(d => addNoise(0.055, 'bandpass', 1350, 0.23, d)); }
    else addOsc('triangle', 840, 260, 0.09, 0.34);
  }

  function renderDrums() {
    const grid = $('#drumGrid'); const nums = $('#drumStepNumbers'); if (!grid || !nums) return;
    nums.innerHTML = '';
    for (let step = 0; step < 16; step++) {
      const n = document.createElement('span'); n.className = `step-number${step % 4 === 0 ? ' beat-number' : ''}`; n.textContent = String(step + 1); nums.appendChild(n);
    }
    grid.innerHTML = '';
    drumDefinitions.forEach((def, rowIndex) => {
      const row = document.createElement('div'); row.className = 'drum-row';
      const label = document.createElement('div'); label.className = 'drum-row-label'; label.innerHTML = `<i class="${def.color}"></i><span>${def.label}</span>`; row.appendChild(label);
      const cells = document.createElement('div'); cells.className = 'drum-step-cells';
      for (let step = 0; step < 16; step++) {
        const button = document.createElement('button'); button.type = 'button';
        button.className = `drum-step ${step % 4 === 0 ? 'beat-step' : ''}${model.drums.pattern[rowIndex][step] ? ` on ${def.color}` : ''}`;
        button.dataset.row = rowIndex; button.dataset.step = step; button.setAttribute('aria-label', `${def.label}, step ${step + 1}`); button.setAttribute('aria-pressed', String(model.drums.pattern[rowIndex][step]));
        cells.appendChild(button);
      }
      row.appendChild(cells); grid.appendChild(row);
    });
    $('#drumTempoLabel').textContent = `${api.getTempo()} BPM · ${model.drums.bars} ${model.drums.bars === 1 ? 'bar' : 'bars'}`;
  }

  function stopDrums() {
    model.drumsPlaying = false;
    if (model.drumScheduler) clearInterval(model.drumScheduler);
    model.drumScheduler = null;
    model.activeDrumNodes.forEach(node => { try { node.stop(); } catch (_) {} });
    model.activeDrumNodes.clear();
    model.drumHighlightTimers.forEach(timer => clearTimeout(timer)); model.drumHighlightTimers = [];
    $$('.drum-step.now-step').forEach(cell => cell.classList.remove('now-step'));
    const btn = $('#drumPlay'); if (btn) btn.textContent = '▶ Play loop';
  }

  async function startDrums() {
    stopDrums();
    const ctx = api.getAudioContext(); await ctx.resume();
    const destination = api.getMasterInput(ctx);
    const stepSeconds = 60 / api.getTempo() / 4;
    model.drumPlaying = true; model.drumStep = 0; model.nextDrumTime = ctx.currentTime + 0.06;
    $('#drumPlay').textContent = '♫ Looping';
    const scheduler = () => {
      if (!model.drumPlaying) return;
      while (model.nextDrumTime < ctx.currentTime + 0.12) {
        const step = model.drumStep;
        model.drums.pattern.forEach((row, rowIndex) => {
          if (row[step]) drumHit(ctx, drumDefinitions[rowIndex].type, model.nextDrumTime, 0.88, destination, model.activeDrumNodes);
        });
        const wait = Math.max(0, (model.nextDrumTime - ctx.currentTime) * 1000);
        model.drumHighlightTimers.push(setTimeout(() => {
          $$('.drum-step.now-step').forEach(cell => cell.classList.remove('now-step'));
          $$('.drum-step').forEach(cell => { if (Number(cell.dataset.step) === step) cell.classList.add('now-step'); });
        }, wait));
        model.drumStep = (step + 1) % 16;
        model.nextDrumTime += stepSeconds;
      }
    };
    scheduler(); model.drumScheduler = setInterval(scheduler, 25);
    api.setStatus(`Drum sequencer looping at ${api.getTempo()} BPM`);
  }

  async function renderDrumBuffer() {
    const sampleRate = 44100; const bpm = api.getTempo(); const stepSeconds = 60 / bpm / 4;
    const bars = model.drums.bars; const duration = bars * 16 * stepSeconds + 0.35;
    const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!Offline) throw new Error('OfflineAudioContext tidak tersedia di browser ini.');
    const offline = new Offline(2, Math.ceil(duration * sampleRate), sampleRate);
    for (let bar = 0; bar < bars; bar++) {
      for (let step = 0; step < 16; step++) {
        model.drums.pattern.forEach((row, rowIndex) => {
          if (row[step]) drumHit(offline, drumDefinitions[rowIndex].type, 0.015 + (bar * 16 + step) * stepSeconds, 0.88, offline.destination, null);
        });
      }
    }
    return offline.startRendering();
  }

  async function commitDrums() {
    const button = $('#drumRender'); const prior = button.textContent; button.disabled = true; button.textContent = 'Rendering…';
    stopDrums();
    try {
      const buffer = await renderDrumBuffer(); const blob = api.audioBufferToWav(buffer);
      await api.addGeneratedAudio(blob, `Drum Pattern - ${api.getTempo()} BPM - ${new Date().toISOString().slice(0,10)}.wav`);
      api.toast('Drum pattern dirender menjadi clip audio dan masuk ke Arrangement.'); setView('arrangement');
    } catch (error) { api.toast(`Render drum gagal: ${error.message}`, 'error'); }
    finally { button.disabled = false; button.textContent = prior; }
  }

  function applyMixerSettings(values = {}) {
    const all = { ...api.getMasterSettings(), ...values };
    api.setMasterSettings(all);
    const setRange = (id, value) => { const node = $(`#${id}`); if (node) node.value = String(value); };
    setRange('masterVolume', Math.round(all.volume * 100));
    setRange('masterCutoff', all.cutoff);
    setRange('masterDelay', Math.round(all.delayWet * 100));
    setRange('masterDelayTime', Math.round(all.delayTime * 1000));
    setRange('masterReverb', Math.round(all.reverbWet * 100));
    setRange('masterComp', Math.round(all.compressor * 100));
    setRange('masterAutomationEnabled', all.automation ? 1 : 0);
    $('#masterAutomationEnabled').checked = Boolean(all.automation);
    setRange('automationStart', Math.round(all.automationStart * 100));
    setRange('automationEnd', Math.round(all.automationEnd * 100));
    updateMixerLabels();
  }

  function updateMixerLabels() {
    const settings = api.getMasterSettings();
    $('#masterVolumeValue').textContent = `${Math.round(settings.volume * 100)}%`;
    $('#masterCutoffValue').textContent = settings.cutoff >= 1000 ? `${(settings.cutoff / 1000).toFixed(settings.cutoff < 10000 ? 1 : 0)} kHz` : `${Math.round(settings.cutoff)} Hz`;
    $('#masterDelayValue').textContent = `${Math.round(settings.delayWet * 100)}%`;
    $('#masterDelayTimeValue').textContent = `${Math.round(settings.delayTime * 1000)} ms`;
    $('#masterReverbValue').textContent = `${Math.round(settings.reverbWet * 100)}%`;
    $('#masterCompValue').textContent = `${Math.round(settings.compressor * 100)}%`;
    $('#automationStartValue').textContent = `${Math.round(settings.automationStart * 100)}%`;
    $('#automationEndValue').textContent = `${Math.round(settings.automationEnd * 100)}%`;
  }

  function renderMixer() {
    const host = $('#mixerTracks'); if (!host) return;
    const tracks = api.getTracks();
    $('#mixerTrackCount').textContent = `${tracks.length} CHANNEL${tracks.length === 1 ? '' : 'S'}`;
    if (!tracks.length) { host.innerHTML = '<div class="empty-mixer">Import audio, render MIDI, atau buat beat untuk melihat channel di sini.</div>'; return; }
    host.innerHTML = tracks.map(track => `<div class="mixer-channel" data-mixer-track="${track.id}" style="--channel-color:${track.color}">
      <div class="mixer-channel-head"><i></i><strong title="${escapeHTML(track.name)}">${escapeHTML(track.name)}</strong><span>${track.clips.length} clip${track.clips.length === 1 ? '' : 's'}</span></div>
      <div class="channel-switches"><button type="button" data-mix-action="mute" class="${track.muted ? 'active' : ''}">M</button><button type="button" data-mix-action="solo" class="${track.solo ? 'active' : ''}">S</button><span>VOL</span><output>${Math.round(track.volume * 100)}%</output></div>
      <input type="range" class="mixer-channel-volume" data-mix-control="volume" min="0" max="1" step="0.01" value="${track.volume}" aria-label="${escapeHTML(track.name)} volume">
      <div class="channel-pan-label"><span>L</span><span>PAN</span><span>R</span></div><input type="range" class="mixer-channel-pan" data-mix-control="pan" min="-1" max="1" step="0.1" value="${track.pan || 0}" aria-label="${escapeHTML(track.name)} pan">
    </div>`).join('');
  }

  function getMixerValuesFromUI() {
    return {
      volume: Number($('#masterVolume').value) / 100,
      cutoff: Number($('#masterCutoff').value),
      delayWet: Number($('#masterDelay').value) / 100,
      delayTime: Number($('#masterDelayTime').value) / 1000,
      reverbWet: Number($('#masterReverb').value) / 100,
      compressor: Number($('#masterComp').value) / 100,
      automation: $('#masterAutomationEnabled').checked,
      automationStart: Number($('#automationStart').value) / 100,
      automationEnd: Number($('#automationEnd').value) / 100
    };
  }

  function escapeHTML(value) { return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  function hookEvents() {
    $$('.daw-module-tab').forEach(button => button.addEventListener('click', () => setView(button.dataset.dawView)));
    $('#pianoGrid').addEventListener('click', event => pianoToggleCell(event.target.closest('.piano-step')));
    $('#pianoInstrument').addEventListener('change', e => { model.piano.instrument = e.target.value; persistAdvanced(); });
    $('#pianoRange').addEventListener('change', e => { model.piano.baseOctave = Number(e.target.value); renderPiano(); persistAdvanced(); });
    $('#pianoBars').addEventListener('change', e => { model.piano.bars = Number(e.target.value); model.piano.notes = model.piano.notes.filter(n => n.step < model.piano.bars * 16); renderPiano(); persistAdvanced(); });
    $('#pianoNoteLength').addEventListener('change', e => { model.piano.noteLength = Number(e.target.value); persistAdvanced(); });
    $('#pianoVelocity').addEventListener('input', e => { model.piano.velocity = Number(e.target.value); $('#pianoVelocityValue').textContent = e.target.value; persistAdvanced(); });
    $('#pianoClear').addEventListener('click', () => { if (!model.piano.notes.length) return; model.piano.notes = []; renderPiano(); persistAdvanced(); api.toast('Piano Roll dikosongkan.'); });
    $('#pianoPlay').addEventListener('click', previewPiano);
    $('#pianoStop').addEventListener('click', stopPianoPreview);
    $('#pianoRender').addEventListener('click', commitPiano);
    $('#pianoExportMidi').addEventListener('click', downloadMidi);
    $('#drumGrid').addEventListener('click', event => {
      const cell = event.target.closest('.drum-step'); if (!cell) return;
      const row = Number(cell.dataset.row); const step = Number(cell.dataset.step);
      model.drums.pattern[row][step] = !model.drums.pattern[row][step];
      renderDrums(); persistAdvanced();
      const isOn = model.drums.pattern[row][step];
      if (isOn) { const ctx = api.getAudioContext(); drumHit(ctx, drumDefinitions[row].type, ctx.currentTime + 0.01, 0.65, api.getMasterInput(ctx), model.activeDrumNodes); }
    });
    $('#drumBars').addEventListener('change', e => { model.drums.bars = Number(e.target.value); renderDrums(); persistAdvanced(); });
    $('#drumClear').addEventListener('click', () => { model.drums.pattern = drumDefinitions.map(() => Array(16).fill(false)); renderDrums(); persistAdvanced(); api.toast('Drum pattern dikosongkan.'); });
    $('#drumPlay').addEventListener('click', startDrums);
    $('#drumStop').addEventListener('click', stopDrums);
    $('#drumRender').addEventListener('click', commitDrums);
    ['masterVolume','masterCutoff','masterDelay','masterDelayTime','masterReverb','masterComp','automationStart','automationEnd'].forEach(id => $(`#${id}`).addEventListener('input', () => { api.setMasterSettings(getMixerValuesFromUI()); updateMixerLabels(); persistAdvanced(); }));
    $('#masterAutomationEnabled').addEventListener('change', () => { api.setMasterSettings(getMixerValuesFromUI()); persistAdvanced(); });
    $('#mixerTracks').addEventListener('click', event => {
      const button = event.target.closest('[data-mix-action]'); if (!button) return;
      const holder = event.target.closest('[data-mixer-track]'); const track = api.getTracks().find(t => t.id === Number(holder.dataset.mixerTrack)); if (!track) return;
      api.setTrackControl(track.id, button.dataset.mixAction); renderMixer();
    });
    $('#mixerTracks').addEventListener('input', event => {
      const slider = event.target.closest('[data-mix-control]'); if (!slider) return;
      const holder = event.target.closest('[data-mixer-track]'); const track = api.getTracks().find(t => t.id === Number(holder.dataset.mixerTrack)); if (!track) return;
      if (slider.dataset.mixControl === 'volume') { track.volume = Number(slider.value); const out = holder.querySelector('.channel-switches output'); if (out) out.textContent = `${Math.round(track.volume * 100)}%`; }
      if (slider.dataset.mixControl === 'pan') track.pan = Number(slider.value);
      api.markDirty?.();
    });
    $('#mixerTracks').addEventListener('change', event => { if (event.target.matches('[data-mix-control]')) api.refreshDawMix(); });
    $('#bpmInput').addEventListener('change', () => { renderDrums(); persistAdvanced(); });
    document.addEventListener('keydown', event => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.repeat || !$('#page-studio').classList.contains('active') || model.view !== 'piano') return;
      if (/input|select|textarea/i.test(event.target.tagName)) return;
      const map = { a:60, w:61, s:62, e:63, d:64, f:65, t:66, g:67, y:68, h:69, u:70, j:71, k:72, o:73, l:74, p:75 };
      const pitch = map[event.key.toLowerCase()]; if (!pitch) return;
      event.preventDefault(); const ctx = api.getAudioContext(); const nodes = makeVoice(ctx, pitch, ctx.currentTime + 0.01, 0.25, 0.82, model.piano.instrument, api.getMasterInput(ctx), model.activeNotes); nodes.forEach(node => model.activeNotes.add(node));
    });
    document.addEventListener('keyup', event => {
      // Synth voices are envelope-driven, so key-up is intentionally non-destructive.
      model.keyboardHeld.delete(event.key);
    });
  }

  function init() {
    hookEvents();
    renderPiano(); renderDrums(); renderMixer();
    const defaults = { ...api.getMasterSettings() };
    try {
      const saved = JSON.parse(localStorage.getItem('euphonia-daw-v03') || localStorage.getItem('euphonia-daw-v02') || 'null');
      if (saved) deserialize(saved);
      else applyMixerSettings(defaults);
    } catch (_) { applyMixerSettings(defaults); }
    $('#pianoVelocityValue').textContent = String(model.piano.velocity);
    window.EUPHONIA_DAW = { serialize, deserialize, renderPiano, renderDrums, renderMixer, setView, getView: () => model.view, clearPatterns: () => { stopPianoPreview(); stopDrums(); model.piano.notes = []; model.drums.pattern = drumDefinitions.map(() => Array(16).fill(false)); renderPiano(); renderDrums(); persistAdvanced(); } };
  }

  init();
})();