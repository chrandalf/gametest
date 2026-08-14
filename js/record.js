// In-game video capture.
//
// The game draws to two stacked canvases — WebGL for the world, 2D for the HUD —
// so neither one alone is the picture you see. Each frame we composite both into
// an offscreen canvas and capture *that*, mixing in the Web Audio engine note so
// the clip has sound. Output is a WebM the browser downloads.
'use strict';

// Hosted viewers cap a save at 16 MiB; stop just short so a long take still
// produces a file instead of failing at the finish line.
const SAVE_LIMIT_BYTES = 16 * 1024 * 1024;
const SAVE_SOFT_LIMIT = 15.2 * 1024 * 1024;

const REC_MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=vp9',
  'video/webm',
];

class Recorder {
  constructor() {
    this.active = false;
    this.chunks = [];
    this.bytes = 0;
    this.startedAt = 0;
    this.elapsed = 0;
    this.status = '';
    this.statusT = 0;
    this.lastUrl = null;
    // WebM from MediaRecorder is tagged limited-range but carries full-range
    // pixels, so most players crush the result. Lift the frames on the way in.
    this.exposure = 1.18;
  }

  adjustExposure(delta) {
    this.exposure = clamp(this.exposure + delta, 1.0, 2.0);
    this.note(`Recording brightness ${Math.round(this.exposure * 100)}%`, 2.5);
  }

  get supported() {
    return typeof MediaRecorder !== 'undefined' &&
           typeof HTMLCanvasElement.prototype.captureStream === 'function';
  }

  note(msg, seconds) {
    this.status = msg;
    this.statusT = seconds || 3.5;
  }

  toggle() {
    if (this.active) this.stop(); else this.start();
  }

  start() {
    if (this.active) return;
    if (!this.supported) {
      this.note('Recording needs MediaRecorder — try Chrome, Edge or Firefox', 5);
      return;
    }

    const view = game.canvas, hud = game.hud;
    // Lock the output size at start; later resizes get scaled to fit.
    this.w = Math.max(2, view.width);
    this.h = Math.max(2, view.height);
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    this.ctx = this.canvas.getContext('2d', { alpha: false });
    this.view = view;
    this.hudCanvas = hud;

    let stream;
    try {
      stream = this.canvas.captureStream(60);
    } catch (e) {
      this.note('This browser refused to capture the canvas', 5);
      return;
    }

    // Mix in the engine audio if the sound is already running.
    this.audioTap = null;
    const audio = game.audio;
    if (audio && audio.ctx && typeof audio.ctx.createMediaStreamDestination === 'function') {
      try {
        const dest = audio.ctx.createMediaStreamDestination();
        audio.master.connect(dest);
        this.audioTap = { dest, master: audio.master };
        for (const track of dest.stream.getAudioTracks()) stream.addTrack(track);
      } catch (e) { /* silent clip is better than no clip */ }
    }

    // A host-mediated save is capped at 16 MB, so trade some bitrate for length
    // there; a local recording keeps the higher rate and cleaner dark areas.
    const hosted = !!((typeof window !== 'undefined' && window.claude) ||
                      (typeof claude !== 'undefined' ? claude : null));
    const bitrate = hosted ? 8000000 : 14000000;
    const mime = REC_MIME_CANDIDATES.find(
      (m) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m));
    let rec;
    try {
      rec = new MediaRecorder(stream, mime
        ? { mimeType: mime, videoBitsPerSecond: bitrate }
        : { videoBitsPerSecond: bitrate });
    } catch (e) {
      this.note('Could not start the recorder: ' + e.message, 5);
      return;
    }

    this.chunks = [];
    this.bytes = 0;
    this.stream = stream;
    this.rec = rec;
    rec.ondataavailable = (e) => {
      if (!e.data || !e.data.size) return;
      this.chunks.push(e.data);
      this.bytes += e.data.size;
      if (this.hostMediated && this.active && this.bytes > SAVE_SOFT_LIMIT) {
        this.note('Hit the 16 MB save limit — wrapping up the clip', 5);
        this.stop();
      }
    };
    rec.onstop = () => this.save();
    rec.onerror = (e) => this.note('Recorder error: ' + (e.error && e.error.name), 5);
    rec.start(1000);

    this.hostMediated = false;
    const host = (typeof window !== 'undefined' && window.claude) ||
                 (typeof claude !== 'undefined' ? claude : null);
    if (host && typeof host.use === 'function') {
      Promise.resolve(host.use('downloads'))
        .then((d) => { this.hostMediated = !!d; })
        .catch(() => {});
    }

    this.active = true;
    this.startedAt = performance.now();
    this.elapsed = 0;
    this.note('Recording — press V to stop', 2.5);
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    try { this.rec.stop(); } catch (e) { /* already stopped */ }
    for (const t of this.stream.getTracks()) t.stop();
    if (this.audioTap) {
      try { this.audioTap.master.disconnect(this.audioTap.dest); } catch (e) { /* gone */ }
      this.audioTap = null;
    }
    this.note('Saving clip…', 6);
  }

  // Called once per frame, after the world and HUD are drawn.
  capture() {
    if (!this.active) return;
    this.elapsed = (performance.now() - this.startedAt) / 1000;
    const c = this.ctx;
    // Both source canvases are drawn this same frame, so the WebGL drawing
    // buffer is still readable here even without preserveDrawingBuffer.
    const e = this.exposure;
    if (e > 1.001 && 'filter' in c) {
      c.filter = `brightness(${e.toFixed(3)}) contrast(${(1 + (e - 1) * 0.28).toFixed(3)}) ` +
                 `saturate(${(1 + (e - 1) * 0.35).toFixed(3)})`;
    }
    c.drawImage(this.view, 0, 0, this.w, this.h);
    if ('filter' in c) c.filter = 'none';    // the HUD is already the right level
    c.drawImage(this.hudCanvas, 0, 0, this.w, this.h);
  }

  save() {
    if (!this.chunks.length) { this.note('Nothing was captured', 4); return; }
    const type = (this.rec && this.rec.mimeType) || 'video/webm';
    const blob = new Blob(this.chunks, { type });
    this.chunks = [];
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const name = `nightfall-city-${stamp}.webm`;
    const mb = (blob.size / 1048576).toFixed(1);

    if (this.lastUrl) URL.revokeObjectURL(this.lastUrl);
    this.lastUrl = URL.createObjectURL(blob);
    game.lastRecording = { url: this.lastUrl, blob, name };
    console.log(`Recording ready: ${name} — ${mb} MB (game.lastRecording.url)`);

    this.deliver(blob, name, mb);
  }

  // Hosted viewers block page-initiated downloads and route saves through the
  // host instead; a local copy just uses an anchor.
  async deliver(blob, name, mb) {
    const host = (typeof window !== 'undefined' && window.claude) ||
                 (typeof claude !== 'undefined' ? claude : null);
    let downloads = null;
    if (host && typeof host.use === 'function') {
      try { downloads = await host.use('downloads'); } catch (e) { downloads = null; }
    }

    if (downloads) {
      if (blob.size > SAVE_LIMIT_BYTES) {
        this.note(`Clip is ${mb} MB — this viewer caps saves at 16 MB. Record a shorter take.`, 7);
        return;
      }
      try {
        await downloads.save({ filename: name, data: blob });
        this.note(`Saved ${name} (${mb} MB)`, 6);
      } catch (err) {
        const code = err && err.code;
        if (code === 'declined') this.note('Save cancelled', 3);
        else if (code === 'too_large') this.note(`Clip is ${mb} MB — over the 16 MB save limit`, 6);
        else if (code === 'rate_limited') this.note('A save prompt is already open — try again', 5);
        else this.note(`Could not save the clip (${code || 'unknown'})`, 6);
      }
      return;
    }

    const a = document.createElement('a');
    a.href = this.lastUrl;
    a.download = name;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => a.remove(), 0);
    this.note(`Saved ${name} (${mb} MB)`, 6);
  }

  // Drawn after capture(), so the REC badge stays out of the recording itself.
  drawBadge(c, W, dpr) {
    void dpr;
    if (this.statusT > 0) {
      c.save();
      c.textAlign = 'center';
      c.font = '600 13px system-ui, sans-serif';
      const tw = c.measureText(this.status).width + 34;
      c.globalAlpha = clamp(this.statusT / 0.5, 0, 1);
      c.fillStyle = 'rgba(0,0,0,0.55)';
      roundRect(c, W / 2 - tw / 2, 66, tw, 30, 8);
      c.fill();
      c.fillStyle = '#fff';
      c.fillText(this.status, W / 2, 74);
      c.restore();
    }
    if (!this.active) return;
    const t = this.elapsed;
    const label = `${String(Math.floor(t / 60)).padStart(2, '0')}:` +
                  `${String(Math.floor(t % 60)).padStart(2, '0')}`;
    const size = (this.bytes ? `  ${(this.bytes / 1048576).toFixed(0)} MB` : '') +
                 `  ·  ${Math.round(this.exposure * 100)}%`;
    c.save();
    c.textAlign = 'left';
    c.font = '700 13px system-ui, sans-serif';
    const w = c.measureText(label + size).width + 46;
    c.fillStyle = 'rgba(0,0,0,0.55)';
    roundRect(c, W / 2 - w / 2, 24, w, 30, 8);
    c.fill();
    // Blinking dot.
    c.fillStyle = (game.time % 1) < 0.6 ? '#ff4d4d' : 'rgba(255,77,77,0.25)';
    c.beginPath();
    c.arc(W / 2 - w / 2 + 18, 39, 6, 0, 6.284);
    c.fill();
    c.fillStyle = '#fff';
    c.fillText(label + size, W / 2 - w / 2 + 32, 32);
    c.restore();
  }

  tick(dt) {
    if (this.statusT > 0) this.statusT -= dt;
  }
}
