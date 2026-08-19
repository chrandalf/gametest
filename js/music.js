// The soundtrack. Licensed tracks (Epidemic Sound, licence held by the
// project owner) dropped into assets/music/ as 0.mp3, 1.mp3, ... — the
// bundler inlines whatever it finds there, so the single-file build carries
// its own music. The player shuffles the deck, X skips, O turns it off.
'use strict';

const MUSIC_TRACKS = [
  { file: 'assets/music/0.mp3', name: 'RISE — Ballpoint' },
  { file: 'assets/music/1.mp3', name: 'Neon City Funk — Paper Twins' },
  { file: 'assets/music/2.mp3', name: '1984 Lasers — OTE' },
  { file: 'assets/music/3.mp3', name: 'Space Worm — AGST' },
  { file: 'assets/music/4.mp3', name: 'Born in the 80s — Falcon Dives' },
];

class MusicPlayer {
  constructor() {
    this.enabled = true;
    this.started = false;
    this.failed = 0;
    this.idx = (Math.random() * MUSIC_TRACKS.length) | 0;
    this.audio = null;
  }

  srcFor(i) {
    const inlined = window.MUSIC_SRC;
    if (inlined) return inlined[i] || null;
    return MUSIC_TRACKS[i].file;
  }

  // Browsers only allow sound after a user gesture; startAudio() calls this
  // on the first key or click, so the music comes in with the engine.
  start() {
    if (this.started || !this.enabled) return;
    this.started = true;
    this.play(this.idx, true);
  }

  play(i, quiet) {
    const n = MUSIC_TRACKS.length;
    if (this.audio) { this.audio.pause(); this.audio = null; }
    this.idx = ((i % n) + n) % n;
    const src = this.srcFor(this.idx);
    if (!src) { this.skipFrom(this.idx, quiet); return; }
    const a = new Audio(src);
    a.volume = 0.30 * (game.musicVol === undefined ? 1 : game.musicVol);
    a.addEventListener('ended', () => this.play(this.idx + 1, false));
    a.addEventListener('error', () => this.skipFrom(this.idx, quiet));
    const p = a.play();
    if (p && p.catch) p.catch(() => { /* gesture policy; start() retries */ this.started = false; });
    this.audio = a;
    this.failed = 0;
    if (!quiet) say(`♪ ${MUSIC_TRACKS[this.idx].name}`);
  }

  // A missing file is the normal case for a fresh clone with no music in it;
  // try the next track, and give up quietly after a full lap of nothing.
  skipFrom(i, quiet) {
    this.failed++;
    if (this.failed >= MUSIC_TRACKS.length) { this.enabled = false; return; }
    this.play(i + 1, quiet);
  }

  next() {
    this.enabled = true;
    this.started = true;
    this.play(this.idx + 1, false);
  }

  toggle() {
    if (this.enabled && this.audio && !this.audio.paused) {
      this.audio.pause();
      this.enabled = false;
      say('MUSIC OFF');
    } else {
      this.enabled = true;
      this.started = true;
      if (this.audio) {
        const p = this.audio.play();
        if (p && p.catch) p.catch(() => {});
        say(`♪ ${MUSIC_TRACKS[this.idx].name}`);
      } else {
        this.play(this.idx, false);
      }
    }
  }
}
