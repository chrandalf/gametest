// Sound: a synth SFX rack (WebAudio, no assets) and the licensed tape deck.
// The engine is two detuned saws pitched by speed, the gun is a noise snap,
// the siren is the classic two-tone, and the music comes in as data URIs
// the bundler inlined - Epidemic Sound tracks, licensed to the owner.
'use strict';

export class Sound {
  constructor() {
    this.on = true;
    this.started = false;
  }

  // WebAudio only unlocks on a user gesture; the intro's ENTER is ours.
  start() {
    if (this.started) return;
    this.started = true;
    const C = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = C;
    this.master = C.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(C.destination);

    // Engine: two saws a few cents apart through a lowpass.
    this.engineGain = C.createGain();
    this.engineGain.gain.value = 0;
    const lp = C.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 700;
    this.engineOsc = [C.createOscillator(), C.createOscillator()];
    for (const [i, o] of this.engineOsc.entries()) {
      o.type = 'sawtooth';
      o.frequency.value = 42 + i * 1.5;
      o.connect(this.engineGain);
      o.start();
    }
    this.engineGain.connect(lp); lp.connect(this.master);

    // Siren: two-tone square, gated.
    this.sirenGain = C.createGain();
    this.sirenGain.gain.value = 0;
    this.sirenOsc = C.createOscillator();
    this.sirenOsc.type = 'square';
    this.sirenOsc.frequency.value = 660;
    this.sirenOsc.connect(this.sirenGain);
    this.sirenGain.connect(this.master);
    this.sirenOsc.start();
    this.sirenPhase = 0;

    // Music: whatever the bundler put aboard.
    this.tracks = Object.values(window.MUSIC_SRC || {});
    this.trackIdx = 0;
    if (this.tracks.length) {
      this.audio = new Audio();
      this.audio.volume = 0.45;
      this.audio.addEventListener('ended', () => this.next());
      this.play();
    }
  }

  play() {
    if (!this.audio || !this.tracks.length) return;
    this.audio.src = this.tracks[this.trackIdx % this.tracks.length];
    this.audio.play().catch(() => {});
  }

  // start() may have run before the browser would allow audio (an autoplay
  // attempt on load). Calling this on a real gesture unsticks whatever the
  // policy held back: the tape deck and the synth context both.
  resume() {
    if (!this.started) return;
    try { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
    catch (e) { /* nothing to do */ }
    if (this.audio && this.audio.paused && this.on) this.audio.play().catch(() => {});
  }

  next() {
    if (!this.tracks.length) return;
    this.trackIdx += 1;
    this.play();
  }

  toggle() {
    this.on = !this.on;
    if (this.master) this.master.gain.value = this.on ? 0.5 : 0;
    if (this.audio) this.audio.volume = this.on ? 0.45 : 0;
    return this.on;
  }

  // Per-frame: engine pitch/volume from speed, siren wail when hot.
  update(dt, speed01, turbo, sirenOn) {
    if (!this.started || !this.on) return;
    const f = 40 + speed01 * 160 + (turbo ? 40 : 0);
    this.engineOsc[0].frequency.value = f;
    this.engineOsc[1].frequency.value = f * 1.007 + 1.5;
    this.engineGain.gain.value = 0.05 + speed01 * 0.10 + (turbo ? 0.05 : 0);
    if (sirenOn) {
      this.sirenPhase += dt * 2.2;
      this.sirenOsc.frequency.value = (Math.sin(this.sirenPhase * Math.PI) > 0) ? 740 : 560;
      // A third of its old level. A square wave through phone speakers at
      // 0.045 was not a siren, it was a siege.
      this.sirenGain.gain.value = 0.014;
    } else {
      this.sirenGain.gain.value = 0;
    }
  }

  blip(freq, dur, vol, type) {
    if (!this.started || !this.on) return;
    const C = this.ctx;
    const o = C.createOscillator(), g = C.createGain();
    o.type = type || 'square';
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, C.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, C.currentTime + dur);
    o.connect(g); g.connect(this.master);
    o.start(); o.stop(C.currentTime + dur);
  }

  noise(dur, vol, freq) {
    if (!this.started || !this.on) return;
    const C = this.ctx;
    const n = C.sampleRate * dur;
    const buf = C.createBuffer(1, n, C.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = C.createBufferSource();
    src.buffer = buf;
    const f = C.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = freq || 900;
    const g = C.createGain(); g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start();
  }

  gun() { this.noise(0.07, 0.35, 2600); }
  crash(mag) { this.noise(0.25 + mag * 0.15, 0.3 + mag * 0.3, 500); }
  chime() { this.blip(880, 0.12, 0.12, 'sine'); this.blip(1320, 0.2, 0.08, 'sine'); }
  clunk() { this.blip(140, 0.1, 0.15, 'triangle'); }
  // A vehicle coming apart: a long low rumble under a bass drop.
  boom() {
    if (!this.started || !this.on) return;
    this.noise(0.7, 0.8, 260);
    this.blip(70, 0.6, 0.3, 'sine');
  }
  // An honest cheer for a level: a rising arpeggio and a held top note.
  fanfare() {
    if (!this.started || !this.on) return;
    [523, 659, 784, 1047].forEach((f, i) =>
      setTimeout(() => this.blip(f, 0.28, 0.13, 'square'), i * 110));
    setTimeout(() => this.blip(1568, 0.55, 0.09, 'sine'), 460);
  }
}
