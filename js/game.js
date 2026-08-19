// Main game: camera, input, simulation loop, rendering and HUD.
'use strict';

const game = {
  time: 0,
  clock: 21.4,         // hours; Neon Drive boots into the night, obviously
  dayLength: 300,      // real seconds for a full 24h
  paused: false,
  showHelp: true,
  camMode: 0,          // 0 chase, 1 far, 2 bonnet
  fps: 0,
  shake: 0,
  stats: { hits: 0, knocked: 0, topSpeed: 0, hospitalised: 0, flattened: 0 },
  // Pickup powers currently running (seconds left), and the oil-drum count.
  power: { oil: 0, ram: 0, freeze: 0, magnet: 0, big: 0, star: 0 },
  slicks: [],          // oil on the road: { x, z, r, life }
  bursts: [],          // pickup collection flashes: { x, y, z, t, color }
  zone: null,          // the shrinking mission ring
  zoneOut: false,
  missionTarget: null, // where the mission compass points
  retro: true,         // the synthwave look; Y toggles it
  crtFx: true,         // scanlines / grain / fringing, separable in options
  musicVol: 1,
  sfxVol: 1,
  // How much of every hit the player's car actually takes. Hard is the game
  // as designed; easy is a tenth of it and exists to be laughed at, not
  // balanced around.
  difficulty: 'normal',
  run: { active: false, score: 0, best: 0, timeLeft: 0, target: null, streak: 0, message: '', messageT: 0 },
  trial: { active: false, phase: 'idle', route: [], idx: 0, t: 0, countdown: 0, best: null, last: null },
  tyreLoad: 0,
  nitro: { charge: 1, active: false },
  sensor: { dist: Infinity, rev: false, timer: 0 },
  credits: 500,        // earned by mayhem, spent on repairs and recovery
  repairSpend: 0,
  repairing: false,
};

const keys = Object.create(null);
const mouse = { yaw: 0, pitch: 0, locked: false };

// -------------------------------------------------------------- startup ----

function start() {
  const canvas = document.getElementById('view');
  const hud = document.getElementById('hud');
  game.canvas = canvas;
  game.hud = hud;
  game.hctx = hud.getContext('2d');

  let renderer;
  try {
    renderer = new Renderer(canvas);
  } catch (e) {
    document.getElementById('fatal').style.display = 'flex';
    document.getElementById('fatal').textContent = e.message;
    console.error(e);
    return;
  }
  game.renderer = renderer;
  const gl = renderer.gl;

  game.carMeshes = buildCarMeshes(gl);
  game.vanMeshes = buildVanMeshes(gl);
  game.cube = buildCubeMesh(gl);
  game.body = buildBodyMeshes(gl);
  game.marker = buildMarkerMesh(gl, 3.4, 3.05, 5.5);
  game.dogMeshes = buildDogMeshes(gl);
  game.dog = new NoddingDog();
  game.streamer = new ToiletStreamer(gl);
  game.skids = new SkidMarks(gl, 460);
  game.stunts = new StuntTracker();
  game.markerBeam = buildMarkerMesh(gl, 1.5, 1.35, 70);
  // Unit ring for the mission storm circle, scaled out to whatever radius
  // the ring has shrunk to. Thin-walled so it reads as a curtain of light.
  game.zoneMesh = buildMarkerMesh(gl, 1.0, 0.99, 1.0);

  // Sprite people. Any hand-drawn sheets that were inlined at build time take
  // over from the painted ones, character for character.
  game.sprites = buildSpriteAtlas(gl, null);
  renderer.setSpriteAtlas(game.sprites.tex);
  loadCharacterSheets((imgs) => {
    gl.deleteTexture(game.sprites.tex);
    game.sprites = buildSpriteAtlas(gl, imgs);
    renderer.setSpriteAtlas(game.sprites.tex);
  });
  game.spriteBuilder = new MeshBuilder();
  game.spriteMesh = new DynamicMesh(gl, 4 * 700, 6 * 700);

  game.rand = makeRandom(99);
  game.car = new Vehicle(0, 0, 0, [0.85, 0.12, 0.14]);
  game.player = { inCar: true, walker: null };
  buildWorld(DEFAULT_SEED);

  game.cam = {
    pos: [game.car.x, 6, game.car.z - 12],
    target: [game.car.x, 1.5, game.car.z],
    fov: 62,
  };
  game.mats = {
    view: M4.create(), proj: M4.create(), viewProj: M4.create(),
    invViewProj: M4.create(), lightVP: M4.create(), model: M4.create(),
    tmp: M4.create(),
  };
  game.frustum = new Float32Array(24);
  game.lightFrustum = new Float32Array(24);

  game.recorder = new Recorder();
  game.hudVisible = true;
  game.missions = new MissionControl();
  game.music = new MusicPlayer();
  game.menu = new GameMenu();
  syncSpeedStage(false);

  const mf = document.getElementById('mapfile');
  if (mf) mf.addEventListener('change', (ev) => {
    if (ev.target.files && ev.target.files[0]) loadMapFromFile(ev.target.files[0]);
  });

  bindInput();
  window.addEventListener('resize', layout);
  layout();

  document.getElementById('loading').style.display = 'none';
  game.last = performance.now();
  requestAnimationFrame(frame);
}

function layout() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  game.hud.width = Math.floor(game.hud.clientWidth * dpr);
  game.hud.height = Math.floor(game.hud.clientHeight * dpr);
  game.hdpr = dpr;
}

// ---------------------------------------------------------------- input ----

function bindInput() {
  addEventListener('keydown', (e) => {
    // The menu eats every key while it is open, and Escape summons it.
    if (game.menu && (game.menu.open || e.code === 'Escape')) {
      if (game.menu.key(e.code)) {
        keys[e.code] = false;
        e.preventDefault();
        startAudio();
        return;
      }
    }
    if (e.repeat) { keys[e.code] = true; return; }
    keys[e.code] = true;
    if (e.code === 'KeyC') game.camMode = (game.camMode + 1) % 3;
    if (e.code === 'KeyH') game.showHelp = !game.showHelp;
    if (e.code === 'KeyP') game.paused = !game.paused;
    if (e.code === 'KeyF') toggleCar();
    if (e.code === 'KeyR') recoverCar();
    if (e.code === 'KeyT') game.clock = (game.clock + 4) % 24;
    if (e.code === 'KeyV') game.recorder.toggle();
    if (e.code === 'KeyU') game.hudVisible = !game.hudVisible;
    if (e.code === 'KeyG') toggleTimeTrial();
    if (e.code === 'KeyM') buildWorld((Math.random() * 0xffffffff) >>> 0);
    if (e.code === 'KeyN') document.getElementById('mapfile').click();
    if (e.code === 'KeyK') startRace();
    if (e.code === 'KeyJ') game.missions.toggle();
    if (e.code === 'KeyY') {
      game.retro = !game.retro;
      say(game.retro ? 'STYLE: NEON NIGHTS' : 'STYLE: PLAIN DAYLIGHT');
    }
    if (e.code === 'KeyX') game.music.next();
    if (e.code === 'KeyO') game.music.toggle();
    if (e.code === 'KeyB' && game.isMap) location.reload();
    if (e.code === 'BracketRight') game.recorder.adjustExposure(0.06);
    if (e.code === 'BracketLeft') game.recorder.adjustExposure(-0.06);
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) e.preventDefault();
    startAudio();
  });
  addEventListener('keyup', (e) => { keys[e.code] = false; });
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

  game.canvas.addEventListener('click', () => {
    startAudio();
    if (mouse.locked) return;
    try {
      const r = game.canvas.requestPointerLock();
      if (r && typeof r.catch === 'function') r.catch(() => {});
    } catch (e) { /* mouse look unavailable; keyboard still works */ }
  });
  document.addEventListener('pointerlockchange', () => {
    mouse.locked = document.pointerLockElement === game.canvas;
  });
  addEventListener('mousemove', (e) => {
    if (!mouse.locked) return;
    mouse.yaw -= e.movementX * 0.0022;
    mouse.pitch = clamp(mouse.pitch - e.movementY * 0.0018, -0.5, 0.9);
  });
}

function toggleCar() {
  const p = game.player;
  if (p.inCar) {
    const car = game.car;
    if (car.speed > 6) return;                  // no jumping out at speed
    const side = car.yaw + Math.PI / 2;
    const wx = car.x + Math.sin(side) * 2.2, wz = car.z + Math.cos(side) * 2.2;
    p.walker = new Walker(wx, wz, car.yaw);
    const pos = { x: wx, z: wz };
    game.city.resolveCircle(pos, 0.45);
    p.walker.x = pos.x; p.walker.z = pos.z;
    p.inCar = false;
    game.abandoned.push(car);
    car.vx = 0; car.vz = 0;
  } else {
    // Get into the nearest vehicle within reach — somebody's parked car very
    // much included.
    const w = p.walker;
    let best = null, bestD = 4.0;
    for (const list of [game.abandoned, game.traffic, game.parked]) {
      for (const car of list) {
        const d = Math.hypot(car.x - w.x, car.z - w.z);
        if (d < bestD) { bestD = d; best = { car, list }; }
      }
    }
    if (!best) return;
    best.list.splice(best.list.indexOf(best.car), 1);
    // Taking somebody's parked car has consequences in the ledger.
    if (best.list === game.parked && game.life) game.life.onStolen(best.car);
    game.car = best.car;
    game.car.ai = null;
    if (game.car instanceof TrafficCar) game.car.isPlayer = true;
    p.inCar = true;
    p.walker = null;
  }
}

function resetCar() {
  const car = game.car;
  const i = clamp(Math.round(car.x / CELL), 0, GRID - 1);
  const j = clamp(Math.round(car.z / CELL), 0, GRID - 1);
  const t = laneTarget(i, j, 0, 1);
  car.x = t.x; car.z = t.z; car.yaw = 0;
  car.vx = 0; car.vz = 0; car.roll = 0; car.pitch = 0;
  if (!game.player.inCar) { game.player.inCar = true; game.player.walker = null; }
}

// Recovery, as in Carmageddon: stuck upside down in a hedge is not a failure
// state, it is a bill. You are craned back onto the nearest road and charged
// for it — and if you cannot pay, it happens anyway, because being stranded
// is not interesting. The damage stays: recovery is not a repair.
const RECOVER_COST = 120;
function recoverCar() {
  const paid = Math.min(game.credits, RECOVER_COST);
  game.credits -= paid;
  resetCar();
  game.car.y = game.city.topAt(game.car.x, game.car.z);
  say(paid >= RECOVER_COST ? `RECOVERED — ${RECOVER_COST} credits`
                           : 'RECOVERED — on the house, you are skint');
}

// Repair, likewise: hold the key and the car comes back together as fast as
// you can pay for it. This is the sink that gives credits a point. Doing it
// on a petrol station forecourt is three times as fast at half the price —
// that is what the stations are for.
const REPAIR_RATE = 1400;     // credits per unit of condition restored
function atStation() {
  const car = game.car;
  const stations = game.city.stations;
  if (!stations) return null;
  for (const s of stations) {
    if (car.x > s.x0 && car.x < s.x1 && car.z > s.z0 && car.z < s.z1) return s;
  }
  return null;
}
function updateRepair(dt) {
  const car = game.car;
  game.repairing = false;
  game.atGarage = game.player.inCar && car.speed < 8 && !!atStation();
  if (game.atGarage && car.wreckage > 0.1 && !game.garageHinted) {
    game.garageHinted = true;
    say('GARAGE — hold E: fast repairs at half price');
  }
  if (!game.atGarage) game.garageHinted = false;
  if (!keys['KeyE'] || !game.player.inCar) return;
  if (car.wreckage <= 0.001) return;
  if (game.credits < 20) { say('CANNOT AFFORD TO REPAIR'); return; }
  const got = car.repair(game.atGarage ? dt * 3 : dt);
  const cost = Math.min(game.credits, Math.round(got * REPAIR_RATE * (game.atGarage ? 0.5 : 1)));
  game.credits -= cost;
  game.repairSpend += cost;
  game.repairing = true;
}

// ---------------------------------------------------------------- audio ----

function startAudio() {
  if (game.music) game.music.start();
  if (game.audio) { if (game.audio.ctx.state === 'suspended') game.audio.ctx.resume(); return; }
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  const ctx = new Ctx();
  const master = ctx.createGain();
  master.gain.value = 0.28;
  master.connect(ctx.destination);

  // The engine: two sawtooths a hair apart (the beat between them is the
  // growl), a square an octave down for the block, all driven through a
  // tanh waveshaper — the distortion is what turns a buzzer into a V8 —
  // then a resonant lowpass that opens with the revs.
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.value = 55;
  const osc2 = ctx.createOscillator();
  osc2.type = 'sawtooth';
  osc2.frequency.value = 55 * 1.013;
  const sub = ctx.createOscillator();
  sub.type = 'square';
  sub.frequency.value = 27.5;
  const pre = ctx.createGain();
  pre.gain.value = 1.6;
  const shaper = ctx.createWaveShaper();
  const curve = new Float32Array(512);
  for (let i = 0; i < 512; i++) {
    const x = (i / 255.5) - 1;
    curve[i] = Math.tanh(x * 3.2);
  }
  shaper.curve = curve;
  shaper.oversample = '2x';
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 700;
  filter.Q.value = 3;
  const gain = ctx.createGain();
  gain.gain.value = 0.0;
  osc.connect(pre); osc2.connect(pre); sub.connect(pre);
  pre.connect(shaper); shaper.connect(filter);
  filter.connect(gain); gain.connect(master);
  osc.start(); osc2.start(); sub.start();

  // Tyre squeal: looping noise through a resonant bandpass.
  const noiseLen = 2;
  const buf = ctx.createBuffer(1, ctx.sampleRate * noiseLen, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.04 * white) / 1.04;      // slightly pink, less hissy
    data[i] = last * 3.2;
  }
  const skidSrc = ctx.createBufferSource();
  skidSrc.buffer = buf;
  skidSrc.loop = true;
  const skidFilter = ctx.createBiquadFilter();
  skidFilter.type = 'bandpass';
  skidFilter.frequency.value = 1600;
  skidFilter.Q.value = 3.2;
  const skidGain = ctx.createGain();
  skidGain.gain.value = 0;
  skidSrc.connect(skidFilter); skidFilter.connect(skidGain); skidGain.connect(master);
  skidSrc.start();

  game.audio = { ctx, master, osc, osc2, sub, filter, gain, skidGain, skidFilter };
}

function updateAudio(dt) {
  const a = game.audio;
  if (!a) return;
  a.master.gain.value = 0.28 * game.sfxVol;
  const car = game.car;
  const inCar = game.player.inCar;
  const sp = Math.abs(car.forwardSpeed);
  // A fake gearbox: revs climb through each gear and drop on the shift.
  // Speed-proportional pitch sounds like a hair dryer; this sounds like a car.
  const GEARS = [7, 14, 22, 32, 46, 999];
  let lo = 0, rpm = 0.16;
  for (const hi of GEARS) {
    if (sp < hi) { rpm = 0.24 + 0.76 * clamp((sp - lo) / (Math.min(hi, 64) - lo), 0, 1); break; }
    lo = hi;
  }
  if (sp < 0.6) rpm = 0.15 + Math.sin(game.time * 9.5) * 0.012;   // idle lope
  if (game.nitro.active) rpm = Math.min(1.1, rpm + 0.18);
  const target = inCar ? 0.17 + rpm * 0.30 : 0.02;
  a.gain.gain.value += (target - a.gain.gain.value) * Math.min(1, dt * 6);
  const f0 = 42 + rpm * 168;
  a.osc.frequency.value = f0;
  a.osc2.frequency.value = f0 * 1.013;
  a.sub.frequency.value = f0 * 0.5;
  a.filter.frequency.value = 240 + rpm * rpm * 2900;

  const squeal = inCar ? clamp((game.tyreLoad - 1.6) / 7, 0, 1) : 0;
  a.skidGain.gain.value += (squeal * 0.5 - a.skidGain.gain.value) * Math.min(1, dt * 12);
  a.skidFilter.frequency.value = 1250 + squeal * 1500 + Math.sin(game.time * 9) * 120;
}

function playThud(strength) {
  const a = game.audio;
  if (!a) return;
  const ctx = a.ctx;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'square';
  o.frequency.setValueAtTime(120 + strength * 90, ctx.currentTime);
  o.frequency.exponentialRampToValueAtTime(38, ctx.currentTime + 0.22);
  g.gain.setValueAtTime(Math.min(0.5, 0.16 + strength * 0.4), ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
  o.connect(g); g.connect(a.master);
  o.start(); o.stop(ctx.currentTime + 0.32);
}

// A scream: a short falling wail with a bit of grit on it. Voices are the one
// thing a street cannot do without, and half a dozen at once as you come round
// a corner is worth more than any amount of extra geometry.
let lastScream = 0;
function playScream(pitch, gainScale) {
  const a = game.audio;
  if (!a) return;
  const ctx = a.ctx;
  // Never more than a handful at once, or a crowd turns into a siren.
  if (ctx.currentTime - lastScream < 0.07) return;
  lastScream = ctx.currentTime;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  const vib = ctx.createOscillator();
  const vibGain = ctx.createGain();
  const g = ctx.createGain();
  const f = ctx.createBiquadFilter();
  o.type = 'sawtooth';
  const base = 420 * pitch;
  o.frequency.setValueAtTime(base * 1.5, t);
  o.frequency.exponentialRampToValueAtTime(base * 0.62, t + 0.55);
  // Vibrato is what makes it a voice rather than a slide whistle.
  vib.frequency.value = 11 + pitch * 4;
  vibGain.gain.value = base * 0.06;
  vib.connect(vibGain); vibGain.connect(o.frequency);
  f.type = 'bandpass';
  f.frequency.value = base * 2.2;
  f.Q.value = 2.2;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.10 * gainScale, t + 0.05);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
  o.connect(f); f.connect(g); g.connect(a.master);
  o.start(t); vib.start(t);
  o.stop(t + 0.62); vib.stop(t + 0.62);
}

// The ambulance's two-tone, alternating each call. Distance sets the volume.
let sirenTone = 0;
function playSiren(loud) {
  const a = game.audio;
  if (!a) return;
  const ctx = a.ctx, t = ctx.currentTime;
  sirenTone = 1 - sirenTone;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'sawtooth';
  o.frequency.value = sirenTone ? 660 : 494;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.05 * loud, t + 0.03);
  g.gain.setValueAtTime(0.05 * loud, t + 0.5);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
  o.connect(g); g.connect(a.master);
  o.start(t); o.stop(t + 0.62);
}

// Car-to-car collisions, resolved as impulses between two masses rather
// than as two circles shoving each other apart. What comes out of that for
// free is everything that used to be missing: a van moves a hatchback more
// than the hatchback moves the van, a glancing blow scrubs along instead of
// bouncing, a corner impact spins you, and both cars take the damage — on
// the face that actually took it.
function resolveVehicleCollisions(all, onPlayer) {
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i], b = all[j];
      const dx = b.x - a.x, dz = b.z - a.z;
      const d = Math.hypot(dx, dz);
      if (d > 5.2 || d < 1e-4) continue;
      const nx = dx / d, nz = dz / d;
      // Bodies are boxes, so how close they can get depends on which way they
      // are pointing: bumper to bumper is four and a half metres, door to
      // door is under two.
      const minD = a.extentAlong(nx, nz) + b.extentAlong(nx, nz);
      if (d > minD) continue;

      const ima = 1 / a.mass, imb = 1 / b.mass, imSum = ima + imb;
      // Separate them in proportion to how easy each is to move.
      const pen = (minD - d) * 0.85;
      a.x -= nx * pen * (ima / imSum); a.z -= nz * pen * (ima / imSum);
      b.x += nx * pen * (imb / imSum); b.z += nz * pen * (imb / imSum);

      const vRel = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
      if (vRel >= 0) continue;                    // already separating

      // Restitution up from 0.16: real cars barely bounce, but a shunt that
      // parts the two cars visibly reads as a hit where a dead stop reads as
      // driving into a wall — which is exactly what it used to feel like.
      const REST = 0.42;
      const jn = -(1 + REST) * vRel / imSum;
      // Panels dragging along each other: a tangential impulse, capped the way
      // friction is capped, which is what turns a sideswipe into a scrape.
      const tx = -nz, tz = nx;
      const vt = (b.vx - a.vx) * tx + (b.vz - a.vz) * tz;
      const jt = clamp(-vt / imSum, -0.5 * jn, 0.5 * jn);

      const Jx = nx * jn + tx * jt, Jz = nz * jn + tz * jt;
      a.vx -= Jx * ima; a.vz -= Jz * ima;
      b.vx += Jx * imb; b.vz += Jz * imb;

      // Spin. The contact sits on the line between them, so how far off each
      // car's centre it lands is what decides whether it shoves or slews.
      const cx = a.x + nx * (a.extentAlong(nx, nz)), cz = a.z + nz * (a.extentAlong(nx, nz));
      const rax = cx - a.x, raz = cz - a.z;
      const rbx = cx - b.x, rbz = cz - b.z;
      a.yawKick += (raz * -Jx - rax * -Jz) / a.inertia;
      b.yawKick += (rbz * Jx - rbx * Jz) / b.inertia;
      a.yawKick = clamp(a.yawKick, -5, 5);
      b.yawKick = clamp(b.yawKick, -5, 5);

      // Knock the grip out of whoever was hit hard, so the impulse actually
      // carries them: with full grip the tyres scrub the sideways part of the
      // shove away within a tenth of a second and nothing appears to move.
      const shock = Math.abs(vRel);
      if (shock > 5) {
        const spin = Math.min(1.4, shock / 13);
        if (a !== onPlayer || shock > 12) a.skid = Math.max(a.skid, spin);
        if (b !== onPlayer || shock > 12) b.skid = Math.max(b.skid, spin);
      }

      // Damage. The closing speed along the normal is the part that actually
      // gets absorbed — two cars meeting head on at thirty is a sixty impact,
      // and two side by side drifting together is barely anything. The lighter
      // car comes off worse, in proportion to the mass it is up against.
      const bite = Math.abs(vRel) / 26;
      const force = bite * bite * 1.15;
      if (force > 0.02) {
        // A ram plate or a star scales up what its owner dishes out.
        a.takeHit(force * (2 * b.mass / (a.mass + b.mass)) * (b.attackScale || 1), -nx, -nz,
                  b === onPlayer ? 'the player' : b.van ? 'a van' : 'another car');
        b.takeHit(force * (2 * a.mass / (a.mass + b.mass)) * (a.attackScale || 1), nx, nz,
                  a === onPlayer ? 'the player' : a.van ? 'a van' : 'another car');
      }
      // The disco star: whatever the player touches gets launched, hard.
      if (onPlayer && game.power.star > 0) {
        if (a === onPlayer) { b.vx += nx * 11; b.vz += nz * 11; b.skid = Math.max(b.skid, 1.4); }
        if (b === onPlayer) { a.vx -= nx * 11; a.vz -= nz * 11; a.skid = Math.max(a.skid, 1.4); }
      }
      if (onPlayer && (a === onPlayer || b === onPlayer)) {
        const strength = Math.min(1, Math.abs(vRel) / 18);
        if (strength > 0.12) {
          onPlayer.crashImpulse = Math.max(onPlayer.crashImpulse, strength);
          game.stats.hits++;
        }
      }
    }
  }
}

// ------------------------------------------------------- parking sensor ----
// What a real car does when you are creeping: three probes across whichever
// bumper you are travelling towards, and a blip that gets faster the closer
// anything is. It only runs at manoeuvring speed — a sensor that chirped at
// every parked car you passed at forty would be unbearable, and no real one
// does it either.

const SENSOR_RANGE = 4.0;         // metres; beyond this it says nothing
const SENSOR_SPEED = 9.0;         // m/s above which it goes quiet

function sensorScan(car) {
  const rev = car.forwardSpeed < -0.3;
  const dir = rev ? -1 : 1;
  const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
  const rx = fz, rz = -fx;
  let best = Infinity;
  for (const lateral of [-0.8, 0, 0.8]) {
    const px = car.x + fx * dir * car.halfLen + rx * lateral;
    const pz = car.z + fz * dir * car.halfLen + rz * lateral;
    for (const c of game.city.query(px, pz, SENSOR_RANGE)) {
      // A kerb is not an obstacle, and neither is anything you are on top of.
      if (c.top <= car.y + 0.4) continue;
      const dx = Math.max(c.x0 - px, 0, px - c.x1);
      const dz = Math.max(c.z0 - pz, 0, pz - c.z1);
      const d = Math.hypot(dx, dz);
      if (d < best) best = d;
    }
    for (const list of [game.traffic, game.parked, game.abandoned]) {
      for (const v of list) {
        if (v === car) continue;
        const ox = v.x - px, oz = v.z - pz;
        const len = Math.hypot(ox, oz);
        if (len > SENSOR_RANGE + 3) continue;
        const d = len - v.extentAlong(ox / (len || 1), oz / (len || 1));
        if (d < best) best = Math.max(0, d);
      }
    }
  }
  return { dist: best, rev };
}

function updateSensor(dt) {
  const s = game.sensor;
  s.timer -= dt;
  if (!game.player.inCar || Math.abs(game.car.forwardSpeed) > SENSOR_SPEED) {
    s.dist = Infinity;
    return;
  }
  const scan = sensorScan(game.car);
  s.dist = scan.dist;
  s.rev = scan.rev;
  if (scan.dist > SENSOR_RANGE) return;
  // Quickening blips, running together into one tone at arm's length.
  const t = clamp((scan.dist - 0.35) / (SENSOR_RANGE - 0.35), 0, 1);
  const interval = lerp(0.075, 0.66, t * t);
  if (s.timer <= 0) {
    s.timer = interval;
    playBeep(scan.dist);
  }
}

function playBeep(dist) {
  const a = game.audio;
  if (!a) return;
  const ctx = a.ctx, t = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'sine';
  // Rising slightly as it closes, the way a real one does.
  o.frequency.value = 1950 + clamp(1 - dist / SENSOR_RANGE, 0, 1) * 750;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.028, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.072);
  o.connect(g); g.connect(a.master);
  o.start(t); o.stop(t + 0.09);
}

// ------------------------------------------------------------- simulate ----

function update(dt) {
  game.time += dt;
  game.clock = (game.clock + dt * 24 / game.dayLength) % 24;

  const car = game.car;
  const p = game.player;

  if (p.inCar) {
    const throttle = (keys.KeyW || keys.ArrowUp ? 1 : 0) + (keys.KeyS || keys.ArrowDown ? -1 : 0);
    // Screen-right is -X for a camera looking down +Z, so D must decrease yaw.
    // (The AI's steering sign is the opposite convention and must stay as is:
    // its control loop needs positive steer to increase yaw.)
    const steer = (keys.KeyA || keys.ArrowLeft ? 1 : 0) + (keys.KeyD || keys.ArrowRight ? -1 : 0);
    // Nitro: a finite tank on Shift that refills slowly, plus a chunk back for
    // every stunt landed.
    const n = game.nitro;
    const wants = (keys.ShiftLeft || keys.ShiftRight) && throttle > 0;
    n.active = wants && n.charge > 0.02;
    n.charge = clamp(n.charge + (n.active ? -dt * 0.42 : dt * 0.13), 0, 1);
    car.drive(dt, throttle, steer, !!keys.Space, game.city, n.active);
    game.stats.topSpeed = Math.max(game.stats.topSpeed, car.speed * 3.6);

    // Tyres protest from actual sliding and from sheer cornering load, so a
    // fast clean corner squeals without the car ever stepping out.
    const lateralG = Math.abs(car.steerRate || 0) * Math.abs(car.forwardSpeed);
    game.tyreLoad = (car.slip || 0) * 2.2 + lateralG * 0.55 + (keys.Space && car.speed > 6 ? 5 : 0);
    game.skids.track(car, car.airborne ? 0 : game.tyreLoad, throttle < 0);
    game.stunts.update(dt, car);
    if (game.stunts.bannerT > 3.15) game.nitro.charge = clamp(game.nitro.charge + 0.35, 0, 1);
    game.dog.update(dt, car);
    game.streamer.update(dt, car);
  } else {
    const w = p.walker;
    // Movement is relative to where the camera is looking.
    const camYaw = w.yaw + 0; // filled below from mouse-driven camera
    void camYaw;
    let mx = (keys.KeyD || keys.ArrowRight ? -1 : 0) + (keys.KeyA || keys.ArrowLeft ? 1 : 0);
    let mz = (keys.KeyW || keys.ArrowUp ? 1 : 0) + (keys.KeyS || keys.ArrowDown ? -1 : 0);
    const yaw = game.walkCamYaw || 0;
    const wx = Math.sin(yaw) * mz + Math.cos(yaw) * mx;
    const wz = Math.cos(yaw) * mz - Math.sin(yaw) * mx;
    w.update(dt, wx, wz, keys.ShiftLeft || keys.ShiftRight, game.city);
  }

  // Traffic sees the player's car, parked cars, abandoned cars and each other.
  const blockers = game.traffic.slice();
  blockers.push(car);
  for (const c of game.parked) blockers.push(c);
  for (const c of game.abandoned) blockers.push(c);
  // `threat` is what the pedestrians are frightened of, and `onScream` is how
  // they say so. Only the player counts: traffic obeys the rules, so nobody
  // needs to run from it.
  const world = {
    city: game.city, blockers, lights: game.lights,
    threat: p.inCar ? car : null,
    onScream: (ped) => {
      const d = Math.hypot(ped.x - car.x, ped.z - car.z);
      // Height stands in for who is doing the screaming.
      playScream(1.35 - ped.height * 0.45, clamp(1 - d / 30, 0.15, 1));
    },
  };
  if (game.lights) game.lights.update(dt);

  const px = p.inCar ? car.x : p.walker.x;
  const pz = p.inCar ? car.z : p.walker.z;

  // Rush hour: the number of cars on the road tracks the clock.
  if (game.population) game.population.update(dt, game.clock, game.traffic, { x: px, z: pz });
  // The census: parked cars, commuters and the ambulance.
  if (game.life) game.life.update(dt, game.clock, { x: px, z: pz }, world);

  // Cars beyond the fog are not simulated: with a rush-hour fleet the
  // look-ahead scan is the most expensive thing in the frame.
  for (const t of game.traffic) {
    if (Math.hypot(t.x - px, t.z - pz) > 300) continue;
    t.update(dt, world);
  }

  // A parked car is asleep until something hits it; then it is just a car
  // with nobody's foot on the brake, and it rolls, slides and spins with
  // whatever the impact gave it until that runs out.
  for (const pk of game.parked) {
    if (pk.speed > 0.05 || Math.abs(pk.yawKick) > 0.02 || pk.airborne) {
      pk.disturbed = true;
      pk.drive(dt, 0, 0, false, game.city);
    }
  }

  const all = blockers;
  resolveVehicleCollisions(all, car);

  // Pedestrians (only the ones near the player need simulating). Everyone the
  // player takes down in the same instant counts as one shot, which is what
  // makes a whole queue at a crossing worth going for.
  let splatted = 0;
  const magnetOn = p.inCar && game.power.magnet > 0;
  for (const ped of game.peds) {
    if (Math.hypot(ped.x - px, ped.z - pz) > 200) continue;
    ped.update(dt, world);
    if (ped.knocked > 0) continue;
    // The magnet: everyone nearby is dragged toward the car, flailing against
    // it the whole way. There is no dignified response to a pedestrian magnet.
    if (magnetOn) {
      const mdx = car.x - ped.x, mdz = car.z - ped.z;
      const md = Math.hypot(mdx, mdz);
      if (md > 2 && md < 38) {
        const pull = clamp(52 / md, 2, 10) * dt;
        ped.x += (mdx / md) * pull;
        ped.z += (mdz / md) * pull;
      }
    }
    for (const v of all) {
      if (Math.hypot(v.x - ped.x, v.z - ped.z) < 2.3 * (v.bodyScale || 1) && v.speed > 2.5) {
        ped.knock(v.vx, v.vz);
        if (v === car) {
          game.stats.knocked++;
          if (ped.downed) game.stats.flattened++;
          game.shake = Math.min(1, game.shake + 0.25);
          playThud(0.4);
          splatted++;
        }
        break;
      }
    }
  }
  if (splatted) game.stunts.splat(car, splatted);

  // Nose to nose with the traffic at speed. Worth a lot, and worth a lot of
  // damage: this is the one collision the game actively wants you to look for.
  for (const t of game.traffic) {
    const dx = t.x - car.x, dz = t.z - car.z;
    if (dx * dx + dz * dz > 36) continue;
    const facing = Math.sin(car.yaw) * Math.sin(t.yaw) + Math.cos(car.yaw) * Math.cos(t.yaw);
    if (facing > -0.55) continue;                       // not head to head
    const closing = Math.hypot(car.vx - t.vx, car.vz - t.vz);
    if (game.headOnCool > 0) break;
    game.headOnCool = 1.5;
    game.stunts.headOn(closing);
    break;
  }
  game.headOnCool = Math.max(0, (game.headOnCool || 0) - dt);

  // The countryside is not a rally stage. Off the tarmac in open country the
  // ground is OutRun treacle: it slows the car hard, drags it gently back
  // toward the road, and rattles the camera — but it is never a wall, never
  // does damage, and a three-and-a-half-metre verge is free, so clipping a
  // corner costs nothing. That is the whole trick to a hard boundary that
  // does not feel like one.
  if (p.inCar && !game.isMap && !car.airborne && !game.drown) {
    const bi = clamp(Math.floor(car.x / CELL), 0, GRID - 2);
    const bj = clamp(Math.floor(car.z / CELL), 0, GRID - 2);
    const zone = game.city.zones.zoneAt(bi, bj);
    if ((zone === Z.WILD || zone === Z.FARM) &&
        !game.city.onRoadSurface(car.x, car.z, 3.5)) {
      const k = Math.exp(-4.0 * dt);
      car.vx *= k; car.vz *= k;
      const rp = roadPointNear(game.city, car.x, car.z);
      if (rp) {
        const rdx = rp.x - car.x, rdz = rp.z - car.z;
        const rd = Math.hypot(rdx, rdz) || 1;
        car.vx += (rdx / rd) * 7 * dt;
        car.vz += (rdz / rd) * 7 * dt;
      }
      game.shake = Math.min(0.3, game.shake + car.speed * 0.0035 * dt * 60);
      if ((game.roughSayT || 0) <= 0) {
        game.roughSayT = 7;
        say('ROUGH GROUND — keep to the roads out here');
      }
    }
    game.roughSayT = Math.max(0, (game.roughSayT || 0) - dt);
  }

  // Into the river. The bank is a slope, not a wall, so this is a real way to
  // lose a delivery — you get fished out a few seconds later.
  if (p.inCar && !game.drown && !car.airborne &&
      game.city.waterAt && game.city.waterAt(car.x, car.z)) {
    game.drown = 1.5;
    game.shake = Math.min(1.2, game.shake + 0.5);
    say('SPLASH! — in the drink');
    playThud(0.55);
  }
  if (game.drown > 0) {
    game.drown = Math.max(0, game.drown - dt);
    const sunk = 1 - game.drown / 1.5;
    car.vx *= Math.exp(-dt * 4.5);
    car.vz *= Math.exp(-dt * 4.5);
    const surface = game.city.groundY(car.x, car.z);
    car.y = lerp(surface, surface - 2.8, smoothstep(0, 1, sunk));
    if (game.drown === 0) {
      resetCar();
      car.y = game.city.topAt(car.x, car.z);
    }
  }

  if (car.crashImpulse > 0.05) {
    game.shake = Math.min(1.2, game.shake + car.crashImpulse);
    playThud(car.crashImpulse);
    car.crashImpulse = 0;
  }
  game.shake *= Math.exp(-dt * 3.4);

  if (game.race) {
    game.race.update(dt, { city: game.city }, car);
    if (game.race.state === 'countdown') { car.vx = 0; car.vz = 0; }
  }

  game.credits += game.stunts.collectCredits();
  updatePowers(dt);
  if (game.pickups) game.pickups.update(dt, { x: px, z: pz }, p.inCar);
  game.missions.update(dt);
  updateSensor(dt);
  updateRepair(dt);
  if (car.lastHitT > 0) car.lastHitT -= dt;
  updateRun(dt);
  updateTrial(dt);
  game.stunts.tick(dt);
  game.snipers.update(dt, { x: px, z: pz });
  updateCamera(dt);
  updateAudio(dt);
}

function updateCamera(dt) {
  const cam = game.cam;
  const p = game.player;
  let tx, ty, tz, yaw, dist, height, look;

  if (p.inCar) {
    const car = game.car;
    yaw = car.yaw + mouse.yaw;
    const sp = Math.min(car.speed, 45);
    if (game.camMode === 2) {
      // Bonnet cam.
      const f = 0.6;
      cam.pos[0] = car.x + Math.sin(car.yaw) * f;
      cam.pos[1] = car.y + 1.55;
      cam.pos[2] = car.z + Math.cos(car.yaw) * f;
      cam.target[0] = car.x + Math.sin(yaw) * 14;
      cam.target[1] = car.y + 1.5 + mouse.pitch * 8;
      cam.target[2] = car.z + Math.cos(yaw) * 14;
      cam.fov = 66 + sp * 0.22;
      return applyShake(cam);
    }
    dist = game.camMode === 1 ? 15 : 9.2 + sp * 0.08;
    height = game.camMode === 1 ? 7.5 : 3.5 + sp * 0.02;
    tx = car.x; ty = car.y + 1.1; tz = car.z;
    look = 6 + sp * 0.16;
  } else {
    const w = p.walker;
    game.walkCamYaw = mouse.yaw;
    yaw = mouse.yaw;
    dist = 5.2; height = 2.4;
    tx = w.x; ty = (w.y || 0) + 1.1; tz = w.z;
    look = 4;
  }

  const pitchLift = mouse.pitch * 6;
  const wantX = tx - Math.sin(yaw) * dist;
  const wantZ = tz - Math.cos(yaw) * dist;
  const wantY = ty + height + pitchLift;

  const k = 1 - Math.exp(-dt * (p.inCar ? 7 : 12));
  cam.pos[0] = lerp(cam.pos[0], wantX, k);
  cam.pos[1] = lerp(cam.pos[1], wantY, k);
  cam.pos[2] = lerp(cam.pos[2], wantZ, k);

  // Keep the camera out of walls.
  const cp = { x: cam.pos[0], z: cam.pos[2] };
  const hit = game.city.query(cp.x, cp.z, 0.8);
  for (const c of hit) {
    if (cam.pos[1] > c.top + 0.5) continue;
    game.city.resolveCircle(cp, 0.8);
    break;
  }
  cam.pos[0] = cp.x; cam.pos[2] = cp.z;
  // Keep the camera above the ground, which is no longer at y = 0.
  const floor = game.city.groundY ? game.city.groundY(cam.pos[0], cam.pos[2]) : 0;
  cam.pos[1] = Math.max(cam.pos[1], floor + 1.2);

  cam.target[0] = lerp(cam.target[0], tx + Math.sin(yaw) * look, k);
  cam.target[1] = lerp(cam.target[1], ty + 0.8 + pitchLift * 0.7, k);
  cam.target[2] = lerp(cam.target[2], tz + Math.cos(yaw) * look, k);
  cam.fov = lerp(cam.fov, 60 + (p.inCar ? Math.min(game.car.speed, 45) * 0.32 : 4), 1 - Math.exp(-dt * 3));

  // Free-look recentre while driving.
  mouse.yaw *= Math.exp(-dt * (p.inCar ? 1.6 : 0));
  applyShake(cam);
}

function applyShake(cam) {
  if (game.shake < 0.01) return;
  const s = game.shake * 0.45;
  const t = game.time * 47;
  cam.pos[0] += Math.sin(t) * s;
  cam.pos[1] += Math.sin(t * 1.7) * s * 0.6;
  cam.pos[2] += Math.cos(t * 1.3) * s;
}

// ------------------------------------------------------------ map import ---

// Replace the world with one built from OSM data. Grid-specific systems
// (traffic lanes, courier drops) are rebuilt from the map's own road nodes.
function loadMapWorld(json, label) {
  const gl = game.renderer.gl;
  let world;
  try {
    const data = osmToWorld(json);
    world = new MapWorld(gl, data);
    if (!world.chunks.length) throw new Error('nothing drawable in this file');
    game.mapLabel = label || data.origin.label || 'imported map';
  } catch (e) {
    say(`Map failed: ${e.message}`);
    console.error(e);
    return false;
  }

  game.city = world;
  game.ramps = world.ramps;
  game.isMap = true;
  // Real roads are not a grid, so the grid traffic and pedestrians go.
  game.traffic = [];
  game.peds = [];
  game.abandoned = [];
  game.parked = [];
  game.life = null;
  game.pickups = null;
  game.slicks = [];
  if (game.missions && game.missions.m) { game.missions.cleanup(); game.missions.m = null; }
  game.snipers = new Snipers(gl, world, game.rand);
  game.skids = new SkidMarks(gl, 460);

  const spawn = world.roadNodes.length
    ? world.roadNodes[(game.rand() * world.roadNodes.length) | 0]
    : { x: world.center[0], z: world.center[1] };
  const car = game.car;
  car.x = spawn.x; car.z = spawn.z; car.y = 0;
  car.vx = 0; car.vz = 0; car.airborne = false;
  if (!game.player.inCar) { game.player.inCar = true; game.player.walker = null; }
  game.streamer.reset(car);
  game.trial.active = false; game.trial.phase = 'idle';
  nextDrop();
  say(`Loaded ${game.mapLabel} — ${world.buildings.length} buildings`);
  console.log(`map: ${world.buildings.length} buildings, ${world.chunks.length} chunks, ` +
              `${world.roadNodes.length} road nodes`);
  return true;
}

// --------------------------------------------------------- world building --

// Generate a whole world from one seed and repopulate everything that lives in
// it. Also used by the "new map" key, so a fresh seed is a keypress away.
function buildWorld(seed) {
  const gl = game.renderer.gl;
  const t0 = performance.now();
  const city = new City(gl, seed);
  game.city = city;
  game.seed = city.seed;
  game.drown = 0;
  game.ramps = city.ramps;
  game.isMap = false;
  game.race = null;
  const rand = game.rand;

  // Traffic only bothers with streets that have something on them.
  const urbanCells = [];
  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) if (city.roadRank(i, j) >= 3) urbanCells.push([i, j]);
  }
  game.traffic = [];
  const wanted = clamp(Math.round(urbanCells.length * 0.55), 8, 40);
  for (let n = 0; n < wanted && urbanCells.length; n++) {
    const [i, j] = urbanCells[(rand() * urbanCells.length) | 0];
    const horiz = rand() < 0.5;
    const d = horiz ? [rand() < 0.5 ? 1 : -1, 0] : [0, rand() < 0.5 ? 1 : -1];
    const car = new TrafficCar(i, j, d[0], d[1],
      CAR_COLORS[(rand() * CAR_COLORS.length) | 0], rand);
    if (Math.hypot(car.x - city.spawn.x, car.z - city.spawn.z) < 18) continue;
    game.traffic.push(car);
  }
  // One NPC is the van, in white with the novelty prop on the front.
  if (game.traffic.length) {
    const van = game.traffic[(rand() * game.traffic.length) | 0];
    van.van = true;
    van.mass = 2350;                 // a loaded van, and it shows in a shunt
    van.halfLen = 2.55; van.halfWid = 1.05;
    van.color = [0.95, 0.95, 0.97];
    van.maxSpeed = Math.min(van.maxSpeed, 15);
    game.van = van;
  }
  game.abandoned = [];
  game.parked = [];

  // Pedestrians go where there are pavements and front doors, and there are
  // far more of them the further into town you get: a village green with two
  // people on it and a high street with forty is most of what sells the
  // difference between the two.
  game.peds = [];
  const pedBlocks = [];
  for (let bi = 0; bi < GRID - 1; bi++) {
    for (let bj = 0; bj < GRID - 1; bj++) {
      const rank = city.zones.rankAt(bi, bj);
      if (rank < 2 || city.zones.zoneAt(bi, bj) === Z.WATER) continue;
      const weight = rank >= 5 ? 8 : rank === 4 ? 5 : rank === 3 ? 2 : 1;
      for (let k = 0; k < weight; k++) pedBlocks.push([bi, bj]);
    }
  }
  // People come in knots — round a crossing, outside a shop, waiting to cross
  // — not evenly dusted over the pavement. Clustering the same number makes a
  // street look several times busier than scattering it does.
  let knot = null;
  for (let n = 0; n < 4200 && game.peds.length < 620 && pedBlocks.length; n++) {
    if (knot && rand() < 0.62) {
      const gx = knot.x + (rand() - 0.5) * 9, gz = knot.z + (rand() - 0.5) * 9;
      if (!onRoad(gx, gz)) {
        const q = { x: gx, z: gz };
        if (!city.resolveCircle(q, 0.6)) {
          const mate = new Pedestrian(gx, gz, rand() * 6.28, rand);
          mate.y = city.groundY(gx, gz);
          mate.sheet = (rand() * TOWNSFOLK.length) | 0;
          game.peds.push(mate);
        }
      }
      continue;
    }
    const [bi, bj] = pedBlocks[(rand() * pedBlocks.length) | 0];
    // Hug the kerb: people walk on pavements, not across the middle of a plot.
    const edge = (rand() * 4) | 0;
    // On the pavement band itself. Reaching further into the plot only meant
    // landing inside a building and being thrown away, which is why downtown
    // — where the buildings cover nearly the whole block — came out emptiest
    // of anywhere despite being weighted heaviest.
    const near = 1.1 + rand() * 2.0;
    const along = 3 + rand() * (BLOCK - 6);
    const x0 = roadCenter(bi) + ROAD/2, z0 = roadCenter(bj) + ROAD/2;
    const x = edge === 2 ? x0 + near : edge === 3 ? x0 + BLOCK - near : x0 + along;
    const z = edge === 0 ? z0 + near : edge === 1 ? z0 + BLOCK - near : z0 + along;
    if (onRoad(x, z)) continue;
    const p = { x, z };
    if (city.resolveCircle(p, 0.6)) continue;   // spawned inside a wall
    const ped = new Pedestrian(x, z, rand() * 6.28, rand);
    // Stand them on the pavement now rather than at y = 0: a block is levelled
    // to its own height, so an unplaced pedestrian is buried in it until their
    // first update, and the ones out of simulation range never get one.
    ped.y = city.groundY(x, z);
    // Which townsperson's sheet they wear, fixed for their lifetime.
    ped.sheet = (rand() * TOWNSFOLK.length) | 0;
    game.peds.push(ped);
    // The next few gather round this one.
    knot = rand() < 0.55 ? { x, z } : null;
  }

  game.snipers = new Snipers(gl, city, rand);
  game.skids = new SkidMarks(gl, 460);
  game.lights = new TrafficLights(city);
  // The census: who lives where, works where, and parks what where.
  game.life = new CityLife(city, rand);
  console.log('census:', JSON.stringify(game.life.censusSummary));
  // Toys on the tarmac, and a clean mission slate for the new town.
  game.pickups = new Pickups(gl, city, rand);
  game.slicks = [];
  if (game.missions && game.missions.m) { game.missions.cleanup(); game.missions.m = null; }
  if (game.menu) game.menu.focus = null;
  // The fleet a full rush hour is allowed to reach. Scaled by how much city
  // there is, so a map that came out mostly farmland stays quiet.
  game.population = new TrafficPopulation(city, rand, clamp(urbanCells.length * 2.4, 40, 190));

  const car = game.car;
  car.x = city.spawn.x; car.z = city.spawn.z; car.y = 0;
  car.yaw = city.spawn.yaw; car.vx = 0; car.vz = 0; car.airborne = false;
  car.roll = 0; car.pitch = 0;
  if (!game.player.inCar) { game.player.inCar = true; game.player.walker = null; }
  game.streamer.reset(car);
  game.trial.active = false; game.trial.phase = 'idle';
  nextDrop();

  const v = city.zones.violations().length;
  const stray = city.strayBuildings().length;
  console.log(`world ${city.seed} built in ${(performance.now() - t0) | 0} ms: ` +
              `${city.chunks.length} chunks, ${city.buildings.length} buildings, ` +
              `${city.zones.repairs} zone repairs, ${v} rule violations, ` +
              `${stray} overhanging the road`);
  console.log('zones:', city.zones.summary());
  return city;
}

// Line up a race on the world's street circuit.
function startRace() {
  const world = game.city;
  if (!world.circuit) { say('No circuit on this map'); return; }
  if (game.race) { game.race = null; say('Race abandoned'); return; }
  game.race = new Race(game.renderer.gl, world, game.rand, 3);
  const car = game.car;
  car.x = game.race.playerGrid.x;
  car.z = game.race.playerGrid.z;
  car.yaw = game.race.playerGrid.yaw;
  car.vx = 0; car.vz = 0; car.y = 0; car.airborne = false;
  if (!game.player.inCar) { game.player.inCar = true; game.player.walker = null; }
  game.streamer.reset(car);
  game.race.say('STREET RACE — 3 laps', 3);
}

function loadMapFromFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      loadMapWorld(JSON.parse(reader.result), file.name);
    } catch (e) {
      say('That file is not JSON the importer understands');
    }
  };
  reader.readAsText(file);
}

// ---------------------------------------------------------- courier run ----

// Pick a drop-off at a random intersection, always a decent drive away.
function nextDrop() {
  const rand = game.rand;
  if (game.isMap && game.city.roadNodes && game.city.roadNodes.length > 4) {
    const px0 = game.player.inCar ? game.car.x : game.player.walker.x;
    const pz0 = game.player.inCar ? game.car.z : game.player.walker.z;
    let pick = null, bestScore = -1;
    for (let n = 0; n < 30; n++) {
      const c = game.city.roadNodes[(rand() * game.city.roadNodes.length) | 0];
      const d = Math.hypot(c.x - px0, c.z - pz0);
      const score = -Math.abs(d - 190) + rand() * 40;
      if (d > 70 && score > bestScore) { bestScore = score; pick = { x: c.x, z: c.z }; }
    }
    game.run.target = pick || game.city.roadNodes[0];
    return;
  }
  const px = game.player.inCar ? game.car.x : game.player.walker.x;
  const pz = game.player.inCar ? game.car.z : game.player.walker.z;
  let best = null, bestScore = -1;
  for (let n = 0; n < 24; n++) {
    const i = (rand() * GRID) | 0, j = (rand() * GRID) | 0;
    const t = laneTarget(i, j, 0, 1);
    const d = Math.hypot(t.x - px, t.z - pz);
    // Prefer 120-320 m away: far enough to be a drive, close enough to reach.
    const score = -Math.abs(d - 210) + rand() * 30;
    if (d > 90 && score > bestScore) { bestScore = score; best = { x: t.x, z: t.z }; }
  }
  game.run.target = best || { x: roadCenter(2), z: roadCenter(2) };
}

function say(msg) { game.run.message = msg; game.run.messageT = 2.6; }

function updateRun(dt) {
  const r = game.run;
  if (r.messageT > 0) r.messageT -= dt;
  if (!r.target || game.trial.active) return;

  const px = game.player.inCar ? game.car.x : game.player.walker.x;
  const pz = game.player.inCar ? game.car.z : game.player.walker.z;
  r.distance = Math.hypot(r.target.x - px, r.target.z - pz);

  if (r.active) {
    r.timeLeft -= dt;
    // Mayhem buys time. Once a run is going the clock is the only thing that
    // matters, and every bonus is a few more seconds of it.
    const won = game.stunts.collectTime();
    if (won > 0) r.timeLeft = Math.min(90, r.timeLeft + won);
    if (r.timeLeft <= 0) {
      r.timeLeft = 0;
      r.active = false;
      r.best = Math.max(r.best, r.score);
      say(`OUT OF TIME — ${r.score} delivered`);
      r.score = 0;
      r.streak = 0;
      nextDrop();
      return;
    }
  }

  if (r.distance < 4.6) {
    const first = !r.active;
    r.active = true;
    r.score++;
    r.streak++;
    // Speedy deliveries top the clock up more.
    const bonus = first ? 60 : clamp(26 - r.score * 0.4, 12, 26) + Math.min(6, r.streak);
    r.timeLeft = Math.min(90, r.timeLeft + bonus);
    r.best = Math.max(r.best, r.score);
    say(first ? 'RUN STARTED — get to the next drop' : `DELIVERY ${r.score}  +${bonus | 0}s`);
    game.shake = Math.min(0.5, game.shake + 0.12);
    playThud(0.18);
    nextDrop();
  }
}

// ---------------------------------------------------------- time trial -----

// Builds a route from one edge of the city to the opposite edge: a start, a few
// checkpoints that jog across the grid so it is not a single straight blast,
// and a finish.
function buildTrialRoute(rand) {
  const last = GRID - 1;
  const horizontal = rand() < 0.5;
  const forward = rand() < 0.5;
  const startMain = forward ? 0 : last;
  const endMain = forward ? last : 0;
  const cross = [1 + ((rand() * (GRID - 2)) | 0), 1 + ((rand() * (GRID - 2)) | 0)];

  const nodes = [];
  const steps = 4;
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    const main = Math.round(lerp(startMain, endMain, t));
    // Weave between two cross-streets so the route needs real corners.
    const lane = k === 0 || k === steps ? cross[0]
               : clamp(Math.round(lerp(cross[0], cross[1], (k % 2) ? 1 : 0.15)), 0, last);
    nodes.push(horizontal ? { i: main, j: lane } : { i: lane, j: main });
  }

  const route = [];
  for (let k = 0; k < nodes.length; k++) {
    const n = nodes[k];
    const prev = nodes[k - 1] || n;
    const di = Math.sign(n.i - prev.i), dj = Math.sign(n.j - prev.j);
    const t = laneTarget(n.i, n.j, di || (horizontal ? (forward ? 1 : -1) : 0),
                                   dj || (horizontal ? 0 : (forward ? 1 : -1)));
    route.push({ x: t.x, z: t.z, node: n });
  }
  return route;
}

function toggleTimeTrial() {
  if (game.isMap) { say('Time trials are city-only for now'); return; }
  const tr = game.trial;
  if (tr.active) {
    tr.active = false;
    tr.phase = 'idle';
    say('Time trial cancelled');
    return;
  }
  const route = buildTrialRoute(game.rand);
  if (route.length < 2) return;
  tr.route = route;
  tr.idx = 1;
  tr.t = 0;
  tr.countdown = 3.2;
  tr.phase = 'countdown';
  tr.active = true;

  // Put the car on the start line, pointing at the first checkpoint.
  if (!game.player.inCar) { game.player.inCar = true; game.player.walker = null; }
  const car = game.car;
  const s = route[0], n = route[1];
  car.x = s.x; car.z = s.z;
  car.vx = 0; car.vz = 0; car.roll = 0; car.pitch = 0;
  car.yaw = Math.atan2(n.x - s.x, n.z - s.z);
  game.streamer.reset(car);
  say('TIME TRIAL — cross the city');
}

function updateTrial(dt) {
  const tr = game.trial;
  if (!tr.active) return;
  const car = game.car;

  if (tr.phase === 'countdown') {
    tr.countdown -= dt;
    car.vx = 0; car.vz = 0;
    if (tr.countdown <= 0) { tr.phase = 'running'; say('GO!'); }
    return;
  }
  if (tr.phase !== 'running') return;

  tr.t += dt;
  const cp = tr.route[tr.idx];
  if (!cp) { tr.phase = 'idle'; tr.active = false; return; }
  tr.distance = Math.hypot(cp.x - car.x, cp.z - car.z);
  if (tr.distance < 6.5) {
    tr.idx++;
    if (tr.idx >= tr.route.length) {
      tr.phase = 'done';
      tr.active = false;
      tr.last = tr.t;
      const record = tr.best === null || tr.t < tr.best;
      if (record) tr.best = tr.t;
      say(record ? `FINISH ${tr.t.toFixed(2)}s — NEW BEST` : `FINISH ${tr.t.toFixed(2)}s (best ${tr.best.toFixed(2)}s)`);
      playThud(0.5);
    } else {
      playThud(0.15);
      say(`CHECKPOINT ${tr.idx - 1}/${tr.route.length - 1}  ${tr.t.toFixed(1)}s`);
    }
  }
}

// ------------------------------------------------------------ environment --

function environment() {
  const h = game.clock;
  // Sun elevation: peaks at noon, below the horizon between 18:30 and 05:30.
  const el = Math.sin((h - 6) / 12 * Math.PI);
  const az = (h / 24) * Math.PI * 2 + 0.6;
  const ce = Math.cos((h - 6) / 12 * Math.PI);
  const sunDir = [Math.cos(az) * Math.abs(ce), Math.max(el, -0.9), Math.sin(az) * Math.abs(ce)];
  const len = Math.hypot(sunDir[0], sunDir[1], sunDir[2]) || 1;
  sunDir[0] /= len; sunDir[1] /= len; sunDir[2] /= len;

  const night = smoothstep(0.10, -0.10, el);
  const dusk = smoothstep(0.34, 0.02, el) * (1 - night * 0.7);
  const day = clamp(1 - night - dusk * 0.4, 0, 1);

  const mix3 = (a, b, t) => [lerp(a[0],b[0],t), lerp(a[1],b[1],t), lerp(a[2],b[2],t)];
  let sunColor = mix3([1.38, 1.30, 1.15], [1.45, 0.66, 0.30], dusk);
  sunColor = mix3(sunColor, [0.10, 0.13, 0.24], night);
  let skyColor = mix3([0.42, 0.62, 0.95], [0.62, 0.42, 0.42], dusk);
  skyColor = mix3(skyColor, [0.075, 0.10, 0.19], night);
  let fogColor = mix3([0.70, 0.80, 0.94], [0.86, 0.55, 0.38], dusk);
  fogColor = mix3(fogColor, [0.085, 0.105, 0.175], night);
  let ambColor = mix3([0.46, 0.47, 0.52], [0.36, 0.32, 0.36], dusk);
  ambColor = mix3(ambColor, [0.36, 0.40, 0.55], night);

  // The synthwave grade: every hour of the day pulled toward hot pink and
  // deep violet, hardest at dusk and after dark. The banded sun and the
  // scanlines live in the shaders; this is just the palette.
  if (game.retro) {
    sunColor = mix3(mix3([1.45, 0.95, 1.10], [1.65, 0.38, 0.80], dusk),
                    [0.22, 0.14, 0.45], night);
    skyColor = mix3(mix3([0.34, 0.24, 0.66], [0.42, 0.13, 0.60], dusk),
                    [0.030, 0.018, 0.085], night);
    // The horizon runs orange at dusk under the purple sky — the exact
    // gradient on every retrowave sleeve ever printed.
    fogColor = mix3(mix3([0.82, 0.44, 0.74], [1.00, 0.46, 0.32], dusk),
                    [0.09, 0.035, 0.17], night);
    ambColor = mix3(mix3([0.48, 0.42, 0.62], [0.44, 0.34, 0.60], dusk),
                    [0.30, 0.25, 0.55], night);
  }

  // Where the banded sun hangs. By day it is the sun; once the real one dips
  // it stays pinned just over the horizon, drifting slowly along it through
  // the night like the arcade cabinet art it is.
  let retroSun = sunDir;
  if (game.retro && sunDir[1] < 0.085) {
    const rl = Math.hypot(sunDir[0], sunDir[2]) || 1;
    const rx = sunDir[0] / rl, rz = sunDir[2] / rl;
    const rlen = Math.hypot(rx, 0.085, rz);
    retroSun = [rx / rlen, 0.085 / rlen, rz / rlen];
  }

  void day;
  return {
    sunDir, sunColor, skyColor, fogColor, ambColor, night, retroSun,
    retro: game.retro ? 1 : 0,
    retroFx: (game.retro && game.crtFx) ? 1 : 0,
    fogDensity: (game.isMap ? 0.0011 : 1) * lerp(0.0026, 0.0034, night),
    time: game.time,
    lights: collectLights(night),
  };
}

// Picks the point lights that matter this frame: the closest street lamps plus
// headlights from the player and nearby traffic.
function collectLights(night) {
  const out = [];
  if (night < 0.03) return out;
  const cam = game.cam.pos;
  const intensity = night;

  const nearby = [];
  for (const L of game.city.lights) {
    const d = (L.x - cam[0]) ** 2 + (L.z - cam[2]) ** 2;
    if (d > 150 * 150) continue;
    nearby.push({ d, L });
  }
  nearby.sort((a, b) => a.d - b.d);
  // Sodium orange, and enough of them at once that the pools overlap into a
  // lit street instead of a line of isolated puddles. In neon mode the lamps
  // alternate pink and cyan down the street instead, which is most of the
  // synthwave look done in one line.
  for (let i = 0; i < Math.min(22, nearby.length); i++) {
    const L = nearby[i].L;
    let col = [1.12, 0.86, 0.52];
    if (game.retro) {
      col = (((L.x * 7 + L.z * 13) | 0) % 2) ? [1.15, 0.35, 0.95] : [0.25, 0.70, 1.25];
    }
    out.push({
      pos: [L.x, L.y, L.z], radius: 34,
      color: [col[0] * intensity, col[1] * intensity, col[2] * intensity], dir: null,
    });
  }

  // Neon underglow beneath the player's car after dark: teal, so it reads
  // against the red tail bar the way the arcade original does. Pure vanity.
  if (game.retro && game.player.inCar) {
    const c = game.car;
    out.push({
      pos: [c.x, (c.y || 0) + 0.25, c.z], radius: 9,
      color: [0.2 * intensity, 1.1 * intensity, 1.15 * intensity], dir: null,
    });
  }

  const t = game.run.target;
  if (t && (t.x - cam[0]) ** 2 + (t.z - cam[2]) ** 2 < 90 * 90) {
    out.push({
      pos: [t.x, 3.5, t.z], radius: 22,
      color: [1.0 * intensity, 0.80 * intensity, 0.18 * intensity], dir: null,
    });
  }

  // Headlights. The player's own beam is what you actually see by out in the
  // country, where there is not a lamp post for half a mile, so it goes in
  // first and is thrown much further than the traffic's.
  const beams = [];
  for (const car of game.traffic) {
    const d = (car.x - cam[0]) ** 2 + (car.z - cam[2]) ** 2;
    if (d > 140 * 140) continue;
    beams.push({ d, car });
  }
  beams.sort((a, b) => a.d - b.d);
  const lit = [{ car: game.car, main: true }];
  for (let i = 0; i < Math.min(4, beams.length); i++) lit.push({ car: beams[i].car });
  for (const { car, main } of lit) {
    if (!car) continue;
    const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
    const y = (car.y || 0) + 1.0;
    if (main) {
      // Near pool and a longer throw, so the road ahead reads at speed.
      out.push({ pos: [car.x + fx * 6, y, car.z + fz * 6], radius: 30,
                 color: [1.5 * intensity, 1.42 * intensity, 1.22 * intensity],
                 dir: [fx, -0.34, fz] });
      out.push({ pos: [car.x + fx * 24, y + 0.4, car.z + fz * 24], radius: 46,
                 color: [1.15 * intensity, 1.10 * intensity, 0.95 * intensity],
                 dir: [fx, -0.16, fz] });
    } else {
      out.push({ pos: [car.x + fx * 4.5, y, car.z + fz * 4.5], radius: 30,
                 color: [1.0 * intensity, 0.94 * intensity, 0.80 * intensity],
                 dir: [fx, -0.30, fz] });
    }
  }
  return out;
}

// --------------------------------------------------------------- render ----

function render() {
  const r = game.renderer;
  const gl = r.gl;
  const m = game.mats;
  const cam = game.cam;
  const env = environment();

  // Neon mode runs the bloom hotter: glow is the whole point.
  r.bloomStrength = game.retro ? 1.15 : 0.8;
  r.bloomThreshold = game.retro ? 1.3 : 1.5;

  const aspect = r.resize();
  M4.perspective(m.proj, cam.fov * Math.PI / 180, aspect, 0.25, 1200);
  M4.lookAt(m.view, cam.pos, cam.target, [0, 1, 0]);
  M4.mul(m.viewProj, m.proj, m.view);
  M4.invert(m.invViewProj, m.viewProj);
  frustumFromMatrix(m.viewProj, game.frustum);

  env.viewProj = m.viewProj;
  env.invViewProj = m.invViewProj;
  env.camPos = cam.pos;

  // --- shadow map, centred a little ahead of the player ---
  const focusX = cam.target[0], focusZ = cam.target[2];
  const R = 150;
  const texelWorld = (R * 2) / SHADOW_SIZE;
  const sx = Math.round(focusX / texelWorld) * texelWorld;
  const sz = Math.round(focusZ / texelWorld) * texelWorld;
  const sd = env.sunDir[1] > 0.05 ? env.sunDir : [0.35, 0.9, 0.25];
  const eye = [sx + sd[0] * 300, sd[1] * 300, sz + sd[2] * 300];
  M4.lookAt(m.tmp, eye, [sx, 0, sz], [0, 1, 0]);
  const lightProj = M4.ortho(M4.create(), -R, R, -R, R, 1, 620);
  M4.mul(m.lightVP, lightProj, m.tmp);
  frustumFromMatrix(m.lightVP, game.lightFrustum);

  r.beginShadowPass(m.lightVP);
  for (const chunk of game.city.chunks) {
    if (!aabbInFrustum(game.lightFrustum, chunk.min, chunk.max)) continue;
    r.draw(chunk, null);
  }
  drawActors(r, env, true);

  // --- main pass ---
  r.beginScenePass(env);
  r.setMaterial([1, 1, 1], 0);
  r.draw(game.city.groundMesh, null);
  let drawn = 0;
  for (const chunk of game.city.chunks) {
    if (!aabbInFrustum(game.frustum, chunk.min, chunk.max)) continue;
    r.draw(chunk, null);
    drawn++;
  }
  // Road paint. Scene pass only — it was left out of the shadow pass on
  // purpose, so a painted line lights like the road it is on and casts
  // nothing. In neon mode the paint itself glows faintly after dark, which
  // is what keeps the road readable under a black sky.
  r.setMaterial([1, 1, 1], game.retro ? 0.22 * env.night : 0, 0);
  for (const chunk of game.city.decals) {
    if (!aabbInFrustum(game.frustum, chunk.min, chunk.max)) continue;
    r.draw(chunk, null);
    drawn++;
  }
  r.setMaterial([1, 1, 1], 0, 0);
  game.chunksDrawn = drawn;
  drawActors(r, env, false);
  r.drawSky(env);
  r.present(env);
  gl.bindVertexArray(null);
}

const _m = M4.create(), _m2 = M4.create(), _m3 = M4.create();

function drawActors(r, env, shadowPass) {
  const cam = game.cam;

  // Signal heads. Three lenses on a post at each corner of a signalled
  // junction, lit for the phase the traffic on that axis is being given.
  if (!shadowPass && game.lights) {
    for (const node of game.lights.nodes) {
      const d = Math.hypot(node.x - cam.pos[0], node.z - cam.pos[2]);
      if (d > 170) continue;
      const base = game.city.groundY(node.x, node.z);
      for (const [sx, sz, alongX] of [[-1, -1, true], [1, 1, true], [-1, 1, false], [1, -1, false]]) {
        const phase = game.lights.phaseFor(node, alongX);
        const hx = node.x + sx * (ROAD / 2 + 1.1), hz = node.z + sz * (ROAD / 2 + 1.1);
        // Post.
        r.setMaterial([0.16, 0.17, 0.18], 0, 0);
        M4.compose(_m, hx, base + 1.6, hz, 0, 0, 0, 0.09, 1.6, 0.09);
        r.draw(game.cube, _m);
        // Lenses, top to bottom: red, amber, green.
        const lens = [['red', [1.0, 0.10, 0.08]], ['amber', [1.0, 0.62, 0.10]],
                      ['green', [0.20, 1.0, 0.35]]];
        for (let k = 0; k < 3; k++) {
          const lit = lens[k][0] === phase;
          r.setMaterial(lens[k][1], lit ? 3.4 : 0.04, 0, 0.9);
          M4.compose(_m, hx, base + 3.62 - k * 0.42, hz, 0, 0, 0, 0.17, 0.17, 0.17);
          r.draw(game.cube, _m);
        }
        // Housing behind the lenses.
        r.setMaterial([0.10, 0.11, 0.12], 0, 0);
        M4.compose(_m, hx, base + 3.2, hz, 0, 0, 0, 0.24, 0.72, 0.14);
        r.draw(game.cube, _m);
      }
    }
    r.setMaterial([1, 1, 1], 0, 0);
  }

  const cars = [game.car, ...game.traffic, ...(game.parked || []), ...game.abandoned];
  if (game.race) for (const r of game.race.racers) cars.push(r);
  const headlightsOn = env.night > 0.25;

  for (const car of cars) {
    if (!game.player.inCar && car === game.car && game.abandoned.includes(car)) continue;
    const d = Math.hypot(car.x - cam.pos[0], car.z - cam.pos[2]);
    if (d > (shadowPass ? 180 : 460)) continue;
    car.modelMatrix(_m);

    const M = car.van ? game.vanMeshes : game.carMeshes;
    // Damage you can see across the street: past half wrecked the body swaps
    // for the crumpled shell, and the paint dulls with every panel it loses.
    const dmg = car.damage;
    const battered = car.wreckage > 0.42;
    if (!shadowPass) {
      if (car === game.car && game.power.star > 0) {
        // Disco star: the paint job cycles the whole rainbow, glowing.
        const h = game.time * 4;
        r.setMaterial([0.65 + 0.45 * Math.sin(h), 0.65 + 0.45 * Math.sin(h + 2.09),
                       0.65 + 0.45 * Math.sin(h + 4.19)], 0.4, 0);
      } else if (game.power.freeze > 0 && car !== game.car && !car.ambulance) {
        // Frozen solid, and it looks it: iced-over paint with a cold sheen.
        r.setMaterial([car.color[0] * 0.35 + 0.55, car.color[1] * 0.35 + 0.65,
                       car.color[2] * 0.35 + 0.85], 0.10, 0);
      } else {
        const dk = 1 - Math.min(0.55, dmg.body * 0.5 + car.wreckage * 0.15);
        r.setMaterial([car.color[0] * dk, car.color[1] * dk * 0.97, car.color[2] * dk * 0.94], 0, 0);
      }
    }
    r.draw(battered ? M.paintWreck : M.paint, _m);
    if (car.van && !car.ambulance && !shadowPass) {
      r.setMaterial([1, 1, 1], 0, 0);
      r.draw(M.prop, _m);
    }

    if (!shadowPass) {
      // Its own registration, front and back, out of the 4x4 plate sheet.
      const plate = car.plate || 0;
      r.setUVWindow(0.25, 0.25, (plate & 3) * 0.25, (plate >> 2) * 0.25);
      r.setMaterial([1, 1, 1], 0.22, 0);
      r.draw(M.plates, _m);
      r.setUVWindow(1, 1, 0, 0);

      r.beginTranslucent();
      r.setMaterial([1, 1, 1], 0, 0, 0.62);
      r.draw(battered ? M.glassWreck : M.glass, _m);
      r.endTranslucent();
      r.setMaterial([1, 1, 1], 0, 0);
      // A wrecked engine takes the headlights with it.
      const lightsDead = dmg.engine > 0.65;
      r.setMaterial([1, 1, 1], lightsDead ? 0.02 : (headlightsOn ? 1.2 : 0.05), 0);
      r.draw(M.lights, _m);
      r.setMaterial([1, 1, 1], car.braking ? 1.4 : (headlightsOn ? 0.45 : 0.05), 0);
      r.draw(M.tail, _m);
      // Ambulance dressing: red crosses on the box sides and a light bar
      // that flashes red and blue while it is running hot.
      if (car.ambulance) {
        r.setMaterial([0.92, 0.10, 0.10], 0.25, 0);
        for (const s of [-1, 1]) {
          M4.compose(_m2, s * 1.08, 1.5, -0.55, 0, 0, 0, 0.05, 0.95, 0.3);
          M4.mul(_m3, _m, _m2);
          r.draw(game.cube, _m3);
          M4.compose(_m2, s * 1.08, 1.5, -0.55, 0, 0, 0, 0.05, 0.3, 0.95);
          M4.mul(_m3, _m, _m2);
          r.draw(game.cube, _m3);
        }
        const strobe = Math.sin(game.time * 16) > 0;
        r.setMaterial([1, 0.12, 0.10], car.siren && strobe ? 3.4 : 0.2, 0);
        M4.compose(_m2, -0.4, 2.34, 0.8, 0, 0, 0, 0.3, 0.16, 0.24);
        M4.mul(_m3, _m, _m2); r.draw(game.cube, _m3);
        r.setMaterial([0.2, 0.4, 1.0], car.siren && !strobe ? 3.4 : 0.2, 0);
        M4.compose(_m2, 0.4, 2.34, 0.8, 0, 0, 0, 0.3, 0.16, 0.24);
        M4.mul(_m3, _m, _m2); r.draw(game.cube, _m3);
        r.setMaterial([1, 1, 1], 0, 0);
      }
      // The armoured car wears its plating where the windows should be.
      if (car.armoured) {
        r.setMaterial([0.46, 0.48, 0.53], 0.04, 0);
        M4.compose(_m2, 0, 1.55, 1.30, 0, 0, 0, 1.8, 0.62, 0.08);
        M4.mul(_m3, _m, _m2); r.draw(game.cube, _m3);
        for (const s of [-1, 1]) {
          M4.compose(_m2, s * 1.10, 1.35, -0.55, 0, 0, 0, 0.06, 1.4, 3.6);
          M4.mul(_m3, _m, _m2); r.draw(game.cube, _m3);
        }
        r.setMaterial([0.95, 0.75, 0.1], 0.5, 0);
        M4.compose(_m2, 0, 1.9, -2.42, 0, 0, 0, 1.6, 0.18, 0.05);
        M4.mul(_m3, _m, _m2); r.draw(game.cube, _m3);
        r.setMaterial([1, 1, 1], 0, 0);
      }
      // Engine smoke, then flame: rising translucent puffs off the bonnet.
      if (dmg.engine > 0.4 && d < 200) {
        const heat = clamp((dmg.engine - 0.4) / 0.5, 0, 1);
        const fx2 = Math.sin(car.yaw), fz2 = Math.cos(car.yaw);
        r.beginTranslucent();
        for (let k = 0; k < 3; k++) {
          const t = (game.time * (0.55 + k * 0.12) + k * 0.37) % 1;
          const sway = Math.sin(game.time * 2.2 + k * 4) * 0.4;
          const px2 = car.x + fx2 * 1.55 + sway * fz2;
          const pz2 = car.z + fz2 * 1.55 - sway * fx2;
          const size = 0.35 + t * (0.9 + heat * 0.9);
          const g = 0.16 - t * 0.1;
          r.setMaterial([g, g, g], 0, 0, (1 - t) * (0.30 + heat * 0.25));
          M4.compose(_m2, px2, car.y + 0.95 + t * (1.1 + heat * 0.9), pz2, 0, 0, 0, size, size, size);
          r.draw(game.body.ball, _m2);
        }
        if (dmg.engine > 0.8) {
          const flick = 0.7 + Math.sin(game.time * 37) * 0.3;
          r.setMaterial([1.0, 0.45, 0.12], 2.6 * flick, 0, 0.75);
          M4.compose(_m2, car.x + fx2 * 1.5, car.y + 1.05, car.z + fz2 * 1.5,
                     0, 0, 0, 0.4, 0.55 * flick, 0.4);
          r.draw(game.body.ball, _m2);
        }
        r.endTranslucent();
        r.setMaterial([1, 1, 1], 0, 0);
      }
      // Nitro flame out of the back.
      if (car === game.car && game.nitro.active) {
        const flick = 0.75 + Math.sin(game.time * 47) * 0.25;
        r.beginTranslucent();
        r.setMaterial([1.0, 0.55, 0.18], 3.2 * flick, 0, 0.8);
        M4.compose(_m2, 0, 0.62, -2.5 - flick * 0.5, 0, 0, 0, 0.5, 0.42, 1.4 + flick);
        M4.mul(_m3, _m, _m2);
        r.draw(game.body.ball, _m3);
        r.endTranslucent();
      }

      // The player's running powers are worn, not just listed on the HUD.
      if (car === game.car) {
        const P = game.power;
        if (P.ram > 0) {
          // A glowing prow on the nose: the thing that is about to hit you.
          r.beginTranslucent();
          const rp = 0.8 + Math.sin(game.time * 9) * 0.2;
          r.setMaterial([1.0, 0.45, 0.10], 1.6 * rp, 0, 0.55);
          M4.compose(_m2, 0, 0.52, 2.42, 0, 0, 0, 0.95, 0.28, 0.35);
          M4.mul(_m3, _m, _m2);
          r.draw(game.cube, _m3);
          r.endTranslucent();
        }
        if (P.magnet > 0) {
          // The field: a slowly turning crimson ring around the car.
          r.beginTranslucent();
          r.setMaterial([1.0, 0.2, 0.2], 1.1, 0, 0.30 + Math.sin(game.time * 5) * 0.1);
          M4.compose(_m2, car.x, car.y + 0.35, car.z, game.time * 1.4, 0, 0, 2.3, 0.14, 2.3);
          r.draw(game.marker, _m2);
          r.endTranslucent();
        }
        if (P.star > 0) {
          // Orbiting sparks to go with the rainbow paint.
          r.beginTranslucent();
          for (let k = 0; k < 6; k++) {
            const a = game.time * 4 + k * 1.047;
            const hh = game.time * 4 + k;
            r.setMaterial([0.7 + 0.5 * Math.sin(hh), 0.7 + 0.5 * Math.sin(hh + 2.09),
                           0.7 + 0.5 * Math.sin(hh + 4.19)], 3.0, 0, 0.85);
            M4.compose(_m2, car.x + Math.cos(a) * 2.5,
                       car.y + 0.9 + Math.sin(game.time * 7 + k) * 0.5,
                       car.z + Math.sin(a) * 2.5, 0, 0, 0, 0.17, 0.17, 0.17);
            r.draw(game.body.ball, _m2);
          }
          r.endTranslucent();
        }
      }
      r.setMaterial([1, 1, 1], 0, 0);
    }

    if (d < (shadowPass ? 60 : 140)) {
      for (const [wx, wy, wz, steerable] of (car.van ? VAN_WHEELS : WHEELS)) {
        M4.compose(_m2, wx, wy, wz, steerable ? car.steer : 0, car.wheelSpin, 0, 1, 1, 1);
        M4.mul(_m3, _m, _m2);
        r.draw(game.carMeshes.wheel, _m3);
      }
    }
  }

  // Pedestrians and the on-foot player, as camera-facing sprites. One draw
  // call for the lot: the batch is rebuilt each frame because every billboard
  // depends on where the camera is standing.
  if (game.sprites) {
    const b = game.spriteBuilder;
    b.reset();
    b.style(0, [1, 1, 1], 0);
    const reach = shadowPass ? 70 : 190;
    for (const ped of game.peds) {
      const d = Math.hypot(ped.x - cam.pos[0], ped.z - cam.pos[2]);
      if (d > reach) continue;
      pushPersonSprite(b, game.sprites, ped, cam.pos[0], cam.pos[2], 1.78 * ped.height);
    }
    if (!game.player.inCar && game.player.walker) {
      pushPersonSprite(b, game.sprites, game.player.walker,
                       cam.pos[0], cam.pos[2], 1.78 * game.player.walker.height);
    }
    if (b.i.length) {
      game.spriteMesh.update(b);
      r.setMaterial([1, 1, 1], 0, 0);
      r.setSpriteMode(true);
      r.draw(game.spriteMesh, null);
      r.setSpriteMode(false);
    }
  }

  // Pickups, spinning over the tarmac.
  if (game.pickups) game.pickups.draw(r, cam.pos, game.time, shadowPass);

  // The storm ring: a curtain of hot pink light, closing all mission long.
  if (!shadowPass && game.zone) {
    const z = game.zone;
    const pulse = 0.75 + Math.sin(game.time * 3.2) * 0.25;
    r.beginTranslucent();
    r.setMaterial([1.0, 0.16, 0.70], 1.5 * pulse, 0, 0.28);
    M4.compose(_m, z.x, game.city.groundY(z.x, z.z) - 3, z.z, 0, 0, 0, z.r, 60, z.r);
    r.draw(game.zoneMesh, _m);
    r.endTranslucent();
    r.setMaterial([1, 1, 1], 0, 0);
  }

  // Pickup collection bursts: an expanding shell of the toy's own colour,
  // so what you just drove through is never a mystery.
  if (!shadowPass && game.bursts.length) {
    r.beginTranslucent();
    for (const bu of game.bursts) {
      const t = bu.t / 0.7;
      const rad = 0.8 + t * 15;
      r.setMaterial(bu.color, 2.0 * (1 - t), 0, 0.5 * (1 - t));
      M4.compose(_m, bu.x, bu.y, bu.z, 0, 0, 0, rad, rad * 0.75, rad);
      r.draw(game.body.ball, _m);
    }
    r.endTranslucent();
    r.setMaterial([1, 1, 1], 0, 0);
  }

  // Oil slicks: dark translucent pools, fading as they dry out.
  if (!shadowPass && game.slicks.length) {
    r.beginTranslucent();
    for (const s of game.slicks) {
      const y = game.city.groundY(s.x, s.z);
      r.setMaterial([0.02, 0.02, 0.05], 0, 0, Math.min(0.7, s.life * 0.15));
      M4.compose(_m, s.x, y + 0.07, s.z, 0, 0, 0, s.r, 0.05, s.r);
      r.draw(game.body.ball, _m);
    }
    r.endTranslucent();
    r.setMaterial([1, 1, 1], 0, 0);
  }

  // Sniper lasers.
  if (!shadowPass && game.snipers.mesh.count) {
    r.beginTranslucent();
    r.setMaterial([1, 1, 1], 1.2, 0, 0.75);
    r.draw(game.snipers.mesh, null);
    r.endTranslucent();
  }

  // Skid marks lie flat on the road, under everything else.
  if (!shadowPass && game.skids.mesh.count) {
    r.setMaterial([1, 1, 1], 0, 0);
    r.draw(game.skids.mesh, null);
  }

  // Props that ride with the player's car.
  if (game.player.inCar) {
    const car = game.car;
    car.modelMatrix(_m);
    if (!shadowPass) r.setMaterial([1, 1, 1], 0, 0);
    // Nodding dog on the parcel shelf — set lower now the roofline is a wedge.
    M4.compose(_m2, 0, 0.88, -1.05, 0, 0, 0, 1, 1, 1);
    M4.mul(_m3, _m, _m2);
    r.draw(game.dogMeshes.body, _m3);
    M4.compose(_m2, 0, 0.88 + 0.20, -1.05 - 0.02, game.dog.yawAngle, game.dog.angle, 0, 1, 1, 1);
    M4.mul(_m3, _m, _m2);
    r.draw(game.dogMeshes.head, _m3);
    // Toilet roll trailing out of the back door.
    if (game.streamer.mesh.count) {
      if (!shadowPass) r.setMaterial([1, 1, 1], 0, 0);
      r.draw(game.streamer.mesh, null);
    }
  }

  // Time-trial checkpoints.
  const tr = game.trial;
  if (tr.active && !shadowPass) {
    const pulse = 0.5 + Math.sin(game.time * 4) * 0.35;
    r.beginTranslucent();
    for (let k = tr.idx; k < Math.min(tr.route.length, tr.idx + 2); k++) {
      const cp = tr.route[k];
      const nextUp = k === tr.idx;
      const finish = k === tr.route.length - 1;
      const tint = finish ? [0.5, 1.0, 0.55] : [0.35, 0.85, 1.0];
      M4.compose(_m, cp.x, 0.12, cp.z, game.time * 0.7, 0, 0, 1, 1, 1);
      r.setMaterial(tint, nextUp ? pulse : pulse * 0.4, 0, nextUp ? 0.45 : 0.2);
      r.draw(game.marker, _m);
      M4.compose(_m, cp.x, 0.12, cp.z, -game.time * 0.35, 0, 0, 1, 1, 1);
      r.setMaterial(tint, pulse * 0.5, 0, nextUp ? 0.14 : 0.07);
      r.draw(game.markerBeam, _m);
    }
    r.endTranslucent();
  }

  // Delivery marker: spins, pulses, and glows at night.
  const t = game.trial.active ? null : game.run.target;
  if (t && !shadowPass) {
    const pulse = 0.55 + Math.sin(game.time * 3.2) * 0.35;
    r.beginTranslucent();
    M4.compose(_m, t.x, 0.12, t.z, game.time * 0.7, 0, 0, 1, 1, 1);
    r.setMaterial([1, 1, 1], pulse, 0, 0.42);
    r.draw(game.marker, _m);
    M4.compose(_m, t.x, 0.12, t.z, -game.time * 0.35, 0, 0, 1, 1, 1);
    r.setMaterial([1, 1, 1], pulse * 0.6, 0, 0.13);
    r.draw(game.markerBeam, _m);
    r.endTranslucent();
  }
}

function drawPerson(r, p, shadowPass, dist) {
  const s = p.height;
  const H = 1.75 * s;
  const walking = p.speed !== undefined ? Math.min(1, p.speed / 3) : 1;
  const swing = Math.sin(p.phase) * 0.55 * (p.knocked > 0 ? 0 : walking);
  const swing2 = -swing;
  const fallen = p.knocked > 0;
  const bodyPitch = fallen ? -1.45 : 0;
  const baseY = (p.y || 0) + (fallen ? 0.35 * H : 0);
  const yaw = p.yaw;

  const put = (out, lx, ly, lz, pitch, sx, sy, sz) => {
    // Local offset -> world, honouring yaw and the fallen-body pitch.
    const cp = Math.cos(bodyPitch), sp2 = Math.sin(bodyPitch);
    const ry = ly * cp - lz * sp2;
    const rz = ly * sp2 + lz * cp;
    const cy = Math.cos(yaw), sy_ = Math.sin(yaw);
    const wx = p.x + (lx * cy + rz * sy_);
    const wz = p.z + (-lx * sy_ + rz * cy);
    return M4.compose(out, wx, baseY + ry, wz, yaw, bodyPitch + pitch, 0, sx, sy, sz);
  };

  const legLen = 0.82 * s, armLen = 0.60 * s;
  const hipY = 0.86 * s, shoulderY = 1.42 * s;

  if (!shadowPass) r.setMaterial(p.shirt, 0, 0);
  put(_m, 0, 1.15 * s, 0, 0, 0.62 * s, 0.74 * s, 0.44 * s);
  r.draw(game.body.ball, _m);

  if (shadowPass) {
    // The torso alone is enough of a shadow silhouette.
    put(_m, 0, 0.45 * s, 0, 0, 0.44 * s, 0.9 * s, 0.3 * s);
    r.draw(game.cube, _m);
    return;
  }

  r.setMaterial(p.skin, 0, 0);
  put(_m, 0, 1.60 * s, 0, 0, 0.42 * s, 0.48 * s, 0.42 * s);
  r.draw(game.body.ball, _m);

  if (dist < 90) {
    r.setMaterial(p.pants, 0, 0);
    for (const [side, sw] of [[-1, swing], [1, swing2]]) {
      const cx = Math.sin(sw) * legLen * 0.5;
      const cy = -Math.cos(sw) * legLen * 0.5;
      put(_m, side * 0.16 * s, hipY + cy, cx, sw, 0.30 * s, legLen / 2, 0.32 * s);
      r.draw(game.body.limb, _m);
    }
    r.setMaterial(p.shirt, 0, 0);
    for (const [side, sw] of [[-1, swing2 * 0.8], [1, swing * 0.8]]) {
      const cz = Math.sin(sw) * armLen * 0.5;
      const cy = -Math.cos(sw) * armLen * 0.5;
      put(_m, side * 0.37 * s, shoulderY + cy, cz, sw, 0.24 * s, armLen / 2, 0.26 * s);
      r.draw(game.body.limb, _m);
    }
  }
  r.setMaterial([1, 1, 1], 0, 1);
}

// ------------------------------------------------------------------ HUD ----

function drawHud() {
  const c = game.hctx;
  const dpr = game.hdpr;
  const W = game.hud.width / dpr, H = game.hud.height / dpr;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, W, H);
  c.textBaseline = 'top';
  if (!game.hudVisible) return;

  const car = game.car;
  const inCar = game.player.inCar;
  const px = inCar ? car.x : game.player.walker.x;
  const pz = inCar ? car.z : game.player.walker.z;
  const pyaw = inCar ? car.yaw : game.player.walker.yaw;

  // --- minimap ---
  const R = Math.min(105, W * 0.13);
  const cx = W - R - 26, cy = R + 26;
  const scale = R / 130;
  c.save();
  c.beginPath(); c.arc(cx, cy, R, 0, 6.284); c.closePath();
  c.fillStyle = 'rgba(8,12,18,0.72)'; c.fill();
  c.save();
  c.clip();
  c.translate(cx, cy);
  c.rotate(pyaw);          // rotate the world so the player always faces up
  c.scale(scale, -scale);
  c.translate(-px, -pz);

  // Zone wash, so the minimap shows which way the country is.
  if (game.city.zones) {
    const zm = game.city.zones;
    const bi0 = Math.max(0, Math.floor((px - 170) / CELL)), bi1 = Math.min(GRID - 2, Math.ceil((px + 170) / CELL));
    const bj0 = Math.max(0, Math.floor((pz - 170) / CELL)), bj1 = Math.min(GRID - 2, Math.ceil((pz + 170) / CELL));
    for (let bi = bi0; bi <= bi1; bi++) {
      for (let bj = bj0; bj <= bj1; bj++) {
        c.fillStyle = ZONES[zm.zoneAt(bi, bj)].map;
        c.fillRect(roadCenter(bi) + ROAD/2, roadCenter(bj) + ROAD/2, BLOCK, BLOCK);
      }
    }
  }

  c.fillStyle = 'rgba(120,132,150,0.30)';
  for (const b of game.city.buildings) {
    if (Math.abs(b.x0 - px) > 150 || Math.abs(b.z0 - pz) > 150) continue;
    c.fillRect(b.x0, b.z0, b.x1 - b.x0, b.z1 - b.z0);
  }
  // The race route, drawn right on the map so the track is unmissable.
  if (game.race && game.race.circuit) {
    const pts = game.race.circuit;
    c.strokeStyle = 'rgba(90,240,255,0.9)';
    c.lineWidth = 7;
    c.beginPath();
    c.moveTo(pts[0].x, pts[0].z);
    for (const q of pts) c.lineTo(q.x, q.z);
    c.closePath();
    c.stroke();
  }

  c.strokeStyle = 'rgba(210,220,235,0.55)';
  c.lineWidth = ROAD * 0.6;
  c.beginPath();
  // Segment by segment: half the grid is not there any more, and a minimap
  // that still shows it sends you down streets that do not exist.
  const city = game.city;
  for (let li = 0; li < GRID; li++) {
    const v = roadCenter(li);
    for (let k = 0; k < GRID - 1; k++) {
      const a = roadCenter(k), b = roadCenter(k + 1);
      if (Math.abs(v - pz) < 170 && b > px - 190 && a < px + 190 && city.edgeOpen(0, li, k)) {
        c.moveTo(a, v); c.lineTo(b, v);
      }
      if (Math.abs(v - px) < 170 && b > pz - 190 && a < pz + 190 && city.edgeOpen(1, li, k)) {
        c.moveTo(v, a); c.lineTo(v, b);
      }
    }
  }
  c.stroke();

  for (const t of [...game.traffic, ...(game.parked || []), ...game.abandoned]) {
    if (Math.abs(t.x - px) > 150 || Math.abs(t.z - pz) > 150) continue;
    c.fillStyle = `rgb(${t.color[0]*255|0},${t.color[1]*255|0},${t.color[2]*255|0})`;
    c.fillRect(t.x - 2.6, t.z - 2.6, 5.2, 5.2);
  }
  if (game.run.target) {
    const t = game.run.target;
    c.fillStyle = '#ffd34d';
    c.beginPath(); c.arc(t.x, t.z, 5.5, 0, 6.284); c.fill();
    c.strokeStyle = 'rgba(255,211,77,0.55)'; c.lineWidth = 2.5;
    c.beginPath(); c.arc(t.x, t.z, 11, 0, 6.284); c.stroke();
  }
  c.fillStyle = 'rgba(255,255,255,0.75)';
  for (const p of game.peds) {
    if (Math.abs(p.x - px) > 140 || Math.abs(p.z - pz) > 140) continue;
    c.fillRect(p.x - 1.2, p.z - 1.2, 2.4, 2.4);
  }
  // Pickups sparkle cyan; the mission target pulses hot pink.
  if (game.pickups) {
    c.fillStyle = '#7adcff';
    for (const it of game.pickups.items) {
      if (Math.abs(it.x - px) > 150 || Math.abs(it.z - pz) > 150) continue;
      c.beginPath(); c.arc(it.x, it.z, 3.4, 0, 6.284); c.fill();
    }
  }
  if (game.missionTarget) {
    const t = game.missionTarget;
    c.fillStyle = '#ff5ad1';
    c.beginPath(); c.arc(t.x, t.z, 6 + Math.sin(game.time * 6) * 2, 0, 6.284); c.fill();
  }
  // The storm ring, so you can see where safe is before the wall arrives.
  if (game.zone) {
    c.strokeStyle = 'rgba(255,60,190,0.9)';
    c.lineWidth = 4;
    c.beginPath(); c.arc(game.zone.x, game.zone.z, game.zone.r, 0, 6.284); c.stroke();
  }
  c.restore();

  // Player arrow (always pointing up).
  c.save();
  c.translate(cx, cy);
  c.fillStyle = '#ffd34d';
  c.beginPath();
  c.moveTo(0, -9); c.lineTo(6.5, 7); c.lineTo(0, 3.5); c.lineTo(-6.5, 7);
  c.closePath(); c.fill();
  c.restore();

  c.beginPath(); c.arc(cx, cy, R, 0, 6.284);
  c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = 2; c.stroke();
  c.fillStyle = 'rgba(255,255,255,0.8)';
  c.font = '600 12px system-ui, sans-serif';
  c.textAlign = 'center';
  c.fillText('N', cx + Math.sin(pyaw) * (R - 11), cy - Math.cos(pyaw) * (R - 11) - 7);
  c.restore();

  // --- speedometer ---
  const sc = { x: W - 108, y: H - 96, r: 66 };
  const kmh = car.speed * 3.6;
  const shown = inCar ? kmh : (game.player.walker.speed * 3.6);
  c.save();
  c.translate(sc.x, sc.y);
  c.beginPath(); c.arc(0, 0, sc.r, 0, 6.284);
  c.fillStyle = 'rgba(8,12,18,0.6)'; c.fill();
  const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
  c.lineWidth = 7; c.lineCap = 'round';
  c.strokeStyle = 'rgba(255,255,255,0.18)';
  c.beginPath(); c.arc(0, 0, sc.r - 10, a0, a1); c.stroke();
  // The gauge is scaled to the engine you have actually unlocked.
  const gaugeTop = game.speedCaps ? game.speedCaps.boost * 3.6 * 1.06 : 220;
  const t = clamp(shown / gaugeTop, 0, 1);
  const grad = c.createLinearGradient(-sc.r, 0, sc.r, 0);
  grad.addColorStop(0, '#5ad1ff'); grad.addColorStop(0.6, '#ffd34d'); grad.addColorStop(1, '#ff5a4d');
  c.strokeStyle = grad;
  c.beginPath(); c.arc(0, 0, sc.r - 10, a0, a0 + (a1 - a0) * t); c.stroke();
  // Neon mode reads its dials in arcade cyan monospace.
  c.fillStyle = game.retro ? '#7dfcf3' : '#fff';
  c.font = game.retro ? '700 26px "Courier New", monospace' : '700 26px system-ui, sans-serif';
  c.textAlign = 'center';
  c.fillText(Math.round(shown), 0, -14);
  c.font = game.retro ? '700 11px "Courier New", monospace' : '600 11px system-ui, sans-serif';
  c.fillStyle = game.retro ? 'rgba(125,252,243,0.7)' : 'rgba(255,255,255,0.6)';
  c.fillText('KM/H', 0, 16);
  c.restore();

  // --- status ---
  const hh = Math.floor(game.clock);
  const mm = Math.floor((game.clock % 1) * 60);
  c.textAlign = 'left';
  c.fillStyle = 'rgba(0,0,0,0.42)';
  roundRect(c, 22, 22, 208, 108, 10); c.fill();
  c.fillStyle = game.retro ? '#7dfcf3' : '#fff';
  c.font = game.retro ? '700 20px "Courier New", monospace' : '700 20px system-ui, sans-serif';
  c.fillText(`${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`, 38, 34);
  if (game.city.zoneAtWorld) {
    const zi = ZONES[game.city.zoneAtWorld(px, pz)];
    c.textAlign = 'right';
    c.font = '700 13px system-ui, sans-serif';
    c.fillStyle = zi.map;
    c.fillText(zi.name.toUpperCase(), 214, 40);
    c.textAlign = 'left';
  }
  c.font = '500 12px system-ui, sans-serif';
  c.fillStyle = 'rgba(255,255,255,0.72)';
  c.fillText(`${game.fps.toFixed(0)} fps · ${inCar ? 'driving' : 'on foot'}`, 38, 60);
  c.fillText(`top ${game.stats.topSpeed.toFixed(0)} km/h · ${game.stats.hits} prangs`, 38, 76);
  // The score that matters: how many people you have put in hospital.
  c.fillStyle = '#ff8f6a';
  c.fillText(`${game.stats.hospitalised} put in hospital`, 38, 92);
  c.fillStyle = 'rgba(255,255,255,0.45)';
  c.fillText(`seed ${game.seed}`, 38, 109);

  // --- time trial panel ---
  const tr = game.trial;
  if (tr.active || tr.phase === 'done') {
    const cp = tr.route[Math.min(tr.idx, tr.route.length - 1)];
    c.textAlign = 'center';
    c.fillStyle = 'rgba(0,0,0,0.45)';
    roundRect(c, W/2 - 132, 8, 264, tr.active ? 52 : 34, 10); c.fill();
    c.fillStyle = '#5ad1ff';
    c.font = '700 11px system-ui, sans-serif';
    c.fillText('TIME TRIAL', W/2, 14);
    c.fillStyle = '#fff';
    c.font = '700 24px system-ui, sans-serif';
    if (tr.phase === 'countdown') {
      c.fillText(Math.ceil(tr.countdown) > 0 ? String(Math.ceil(tr.countdown)) : 'GO', W/2, 28);
    } else {
      c.fillText(`${(tr.phase === 'done' ? (tr.last || 0) : tr.t).toFixed(2)}s`, W/2, 28);
    }
    if (tr.active) {
      c.font = '600 12px system-ui, sans-serif';
      c.fillStyle = 'rgba(255,255,255,0.7)';
      const total = tr.route.length - 1;
      c.fillText(`checkpoint ${Math.min(tr.idx, total)} / ${total}` +
                 (tr.best !== null ? `   ·   best ${tr.best.toFixed(2)}s` : ''), W/2, 44);
    }
    if (cp && tr.phase === 'running') {
      const camYaw = Math.atan2(game.cam.target[0] - game.cam.pos[0],
                                game.cam.target[2] - game.cam.pos[2]);
      const bearing = Math.atan2(cp.x - px, cp.z - pz) - camYaw;
      c.save();
      c.translate(W/2, 116);
      c.fillStyle = 'rgba(0,0,0,0.42)';
      c.beginPath(); c.arc(0, 0, 34, 0, 6.284); c.fill();
      c.rotate(bearing);
      c.fillStyle = '#5ad1ff';
      c.beginPath();
      c.moveTo(0, -22); c.lineTo(13, 12); c.lineTo(0, 5); c.lineTo(-13, 12);
      c.closePath(); c.fill();
      c.restore();
      c.fillStyle = 'rgba(255,255,255,0.85)';
      c.font = '600 13px system-ui, sans-serif';
      c.fillText(`${Math.round(tr.distance || 0)} m`, W/2, 156);
    }
    c.textAlign = 'left';
  }

  // --- mission panel: label, objective, clock and a hot pink compass ---
  const mi = game.missions && game.missions.m;
  if (mi && mi.type !== 'race') {
    c.textAlign = 'center';
    c.fillStyle = 'rgba(0,0,0,0.5)';
    roundRect(c, W/2 - 175, 8, 350, 52, 10); c.fill();
    c.fillStyle = '#ff5ad1';
    c.font = '700 12px system-ui, sans-serif';
    c.fillText(mi.label, W/2, 14);
    c.fillStyle = '#fff';
    c.font = '700 17px system-ui, sans-serif';
    c.fillText(`${mi.progress || mi.goal}`, W/2, 30);
    c.fillStyle = mi.timeLeft < 15 ? '#ff5a4d' : 'rgba(255,255,255,0.7)';
    c.font = '700 12px system-ui, sans-serif';
    c.fillText(`${Math.max(0, Math.ceil(mi.timeLeft))}s`, W/2, 47);
    if (game.missionTarget) {
      const camYaw = Math.atan2(game.cam.target[0] - game.cam.pos[0],
                                game.cam.target[2] - game.cam.pos[2]);
      const t = game.missionTarget;
      const bearing = Math.atan2(t.x - px, t.z - pz) - camYaw;
      c.save();
      c.translate(W/2, 116);
      c.fillStyle = 'rgba(0,0,0,0.42)';
      c.beginPath(); c.arc(0, 0, 34, 0, 6.284); c.fill();
      c.rotate(bearing);
      c.fillStyle = '#ff5ad1';
      c.beginPath();
      c.moveTo(0, -22); c.lineTo(13, 12); c.lineTo(0, 5); c.lineTo(-13, 12);
      c.closePath(); c.fill();
      c.restore();
      c.textAlign = 'center';
      c.fillStyle = 'rgba(255,255,255,0.85)';
      c.font = '600 13px system-ui, sans-serif';
      c.fillText(`${Math.round(Math.hypot(t.x - px, t.z - pz))} m`, W/2, 156);
    }
    c.textAlign = 'left';
  }

  // --- objective compass, score and timer ---
  const run = game.run;
  if (run.target && !tr.active && tr.phase !== 'done' && !mi) {
    const camYaw = Math.atan2(game.cam.target[0] - game.cam.pos[0],
                              game.cam.target[2] - game.cam.pos[2]);
    const bearing = Math.atan2(run.target.x - px, run.target.z - pz) - camYaw;
    const ax = W / 2, ay = 116;
    c.save();
    c.translate(ax, ay);
    c.fillStyle = 'rgba(0,0,0,0.42)';
    c.beginPath(); c.arc(0, 0, 34, 0, 6.284); c.fill();
    c.rotate(bearing);
    c.fillStyle = '#ffd34d';
    c.beginPath();
    c.moveTo(0, -22); c.lineTo(13, 12); c.lineTo(0, 5); c.lineTo(-13, 12);
    c.closePath(); c.fill();
    c.restore();
    c.textAlign = 'center';
    c.fillStyle = 'rgba(255,255,255,0.85)';
    c.font = '600 13px system-ui, sans-serif';
    c.fillText(`${Math.round(run.distance || 0)} m`, ax, ay + 40);

    // Score and the countdown bar.
    c.fillStyle = 'rgba(0,0,0,0.42)';
    roundRect(c, W/2 - 130, 8, 260, 30, 8); c.fill();
    c.textAlign = 'left';
    c.fillStyle = '#fff';
    c.font = '700 15px system-ui, sans-serif';
    c.fillText(`${run.score}`, W/2 - 116, 14);
    c.font = '600 11px system-ui, sans-serif';
    c.fillStyle = 'rgba(255,255,255,0.6)';
    c.fillText('DELIVERED', W/2 - 98, 17);
    c.textAlign = 'right';
    c.fillStyle = 'rgba(255,255,255,0.6)';
    c.fillText(`BEST ${run.best}`, W/2 + 116, 17);
    if (run.active) {
      const frac = clamp(run.timeLeft / 60, 0, 1);
      c.fillStyle = 'rgba(255,255,255,0.15)';
      roundRect(c, W/2 - 130, 42, 260, 7, 3.5); c.fill();
      c.fillStyle = run.timeLeft < 8 ? '#ff5a4d' : '#5ad1ff';
      roundRect(c, W/2 - 130, 42, 260 * frac, 7, 3.5); c.fill();
      c.textAlign = 'center';
      c.fillStyle = run.timeLeft < 8 ? '#ff8a7a' : 'rgba(255,255,255,0.75)';
      c.font = '700 12px system-ui, sans-serif';
      c.fillText(`${run.timeLeft.toFixed(1)}s`, W/2, 54);
    }
  }

  if (run.messageT > 0) {
    const a = clamp(run.messageT / 0.6, 0, 1);
    c.textAlign = 'center';
    c.globalAlpha = a;
    c.fillStyle = 'rgba(0,0,0,0.5)';
    const tw = c.measureText(run.message).width + 60;
    roundRect(c, W/2 - tw/2, H * 0.26, tw, 44, 10); c.fill();
    c.fillStyle = '#ffd34d';
    c.font = '700 20px system-ui, sans-serif';
    c.fillText(run.message, W/2, H * 0.26 + 12);
    c.globalAlpha = 1;
  }
  c.textAlign = 'left';

  // --- running powers ---
  if (game.player.inCar) {
    const P = game.power;
    const chips = [];
    if (P.star > 0) chips.push(['★ ' + Math.ceil(P.star), '#ffd34d']);
    if (P.big > 0) chips.push(['BIG ' + Math.ceil(P.big), '#ff6a5a']);
    if (P.ram > 0) chips.push(['RAM ' + Math.ceil(P.ram), '#9fb6ff']);
    if (P.freeze > 0) chips.push(['FREEZE ' + Math.ceil(P.freeze), '#7adcff']);
    if (P.magnet > 0) chips.push(['MAGNET ' + Math.ceil(P.magnet), '#ff8f8f']);
    if (P.oil > 0) chips.push(['OIL ×' + P.oil + ' (Q)', '#d8c66a']);
    if (chips.length) {
      c.font = '700 11px system-ui, sans-serif';
      let cx2 = W - 26;
      for (const [label, col] of chips) {
        const tw = c.measureText(label).width + 16;
        cx2 -= tw + 6;
        c.fillStyle = 'rgba(0,0,0,0.5)';
        roundRect(c, cx2, H - 202, tw, 20, 6); c.fill();
        c.fillStyle = col;
        c.textAlign = 'left';
        c.fillText(label, cx2 + 8, H - 197);
      }
    }
  }

  // --- nitro ---
  if (game.player.inCar) {
    const n = game.nitro;
    const bw = 150, bx = W - bw - 26, by = H - 176;
    c.fillStyle = 'rgba(0,0,0,0.42)';
    roundRect(c, bx, by, bw, 22, 7); c.fill();
    const g = c.createLinearGradient(bx, 0, bx + bw, 0);
    g.addColorStop(0, '#5ad1ff'); g.addColorStop(1, n.active ? '#ff7a4d' : '#9b8cff');
    c.fillStyle = g;
    roundRect(c, bx + 3, by + 3, (bw - 6) * n.charge, 16, 5); c.fill();
    c.fillStyle = 'rgba(255,255,255,0.85)';
    c.font = '700 10px system-ui, sans-serif';
    c.textAlign = 'left';
    c.fillText(`NITRO (shift) · ${game.speedCaps ? game.speedCaps.name : ''}`, bx + 8, by + 6);
  }

  // --- race ---
  if (game.race) {
    const R = game.race;
    const pos = R.position(), field = R.racers.length + 1;
    c.textAlign = 'center';
    c.fillStyle = 'rgba(0,0,0,0.45)';
    roundRect(c, W/2 - 150, 8, 300, 50, 10); c.fill();
    c.fillStyle = '#ffd34d';
    c.font = '700 11px system-ui, sans-serif';
    c.fillText('STREET RACE', W/2, 13);
    c.fillStyle = '#fff';
    c.font = '700 22px system-ui, sans-serif';
    if (R.state === 'countdown') {
      c.fillText(Math.ceil(R.countdown) > 0 ? String(Math.ceil(R.countdown)) : 'GO', W/2, 28);
    } else {
      c.fillText(`P${pos}/${field}    LAP ${Math.min(R.player.lap + 1, R.laps)}/${R.laps}` +
                 `    ${R.time.toFixed(1)}s`, W/2, 28);
    }
    // The field, in order.
    const order = R.standings();
    c.textAlign = 'left';
    c.font = '600 12px system-ui, sans-serif';
    for (let i = 0; i < order.length; i++) {
      const e = order[i];
      c.fillStyle = e.isPlayer ? '#ffd34d' : 'rgba(255,255,255,0.62)';
      c.fillText(`${i + 1}. ${e.name}${e.finished ? '  ✓' : ''}`, 26, 130 + i * 17);
    }
    if (R.bannerT > 0) {
      c.textAlign = 'center';
      c.globalAlpha = clamp(R.bannerT / 0.6, 0, 1);
      c.fillStyle = 'rgba(0,0,0,0.5)';
      const tw = c.measureText(R.banner).width + 80;
      roundRect(c, W/2 - tw/2, H * 0.3, tw, 46, 10); c.fill();
      c.fillStyle = '#ffd34d';
      c.font = '800 22px system-ui, sans-serif';
      c.fillText(R.banner, W/2, H * 0.3 + 13);
      c.globalAlpha = 1;
      c.textAlign = 'left';
    }
  }

  // --- stunt banner ---
  if (game.stunts.bannerT > 0) {
    const a = clamp(game.stunts.bannerT / 0.7, 0, 1);
    c.save();
    c.globalAlpha = a;
    c.textAlign = 'center';
    c.font = '800 26px system-ui, sans-serif';
    const tw = c.measureText(game.stunts.banner).width + 56;
    c.fillStyle = 'rgba(0,0,0,0.55)';
    roundRect(c, W/2 - tw/2, H * 0.42, tw, 52, 12); c.fill();
    c.fillStyle = '#ffd34d';
    c.fillText(game.stunts.banner, W/2, H * 0.42 + 14);
    c.restore();
  }
  if (game.stunts.score > 0) {
    c.textAlign = 'left';
    c.fillStyle = 'rgba(255,255,255,0.75)';
    c.font = '600 12px system-ui, sans-serif';
    c.fillText(`stunt points ${game.stunts.score}`, 38, 92);
  }
  // --- what you just hit ---
  // The complaint this answers: you stop dead and have no idea why. Naming
  // the thing turns an invisible wall into a lamp post you should have seen.
  if (game.car.lastHitT > 0 && game.player.inCar) {
    const a = clamp(game.car.lastHitT / 0.5, 0, 1);
    c.save();
    c.globalAlpha = a * 0.92;
    c.textAlign = 'center';
    c.font = '700 15px system-ui, sans-serif';
    const txt = `CRUNCH — ${game.car.lastHit}`;
    const tw = c.measureText(txt).width + 34;
    c.fillStyle = 'rgba(0,0,0,0.55)';
    roundRect(c, W/2 - tw/2, H * 0.62, tw, 28, 8); c.fill();
    c.fillStyle = '#ff8f6a';
    c.fillText(txt, W/2, H * 0.62 + 19);
    c.restore();
  }

  // --- condition and credits ---
  if (game.player.inCar) {
    const d = game.car.damage;
    const rows = [['ENGINE', d.engine], ['STEERING', d.steering],
                  ['WHEELS', d.wheels], ['BODY', d.body]];
    // Clear of the speedometer, which these used to sit on top of.
    const bx = W - 336, by = H - 118;
    c.save();
    c.font = '600 10px system-ui, sans-serif';
    c.textAlign = 'left';
    for (let k = 0; k < rows.length; k++) {
      const [name, v] = rows[k];
      const y = by + k * 15;
      c.fillStyle = 'rgba(255,255,255,0.55)';
      c.fillText(name, bx, y + 8);
      c.fillStyle = 'rgba(255,255,255,0.14)';
      c.fillRect(bx + 56, y, 74, 7);
      // Green through amber to red: you can read the car at a glance.
      c.fillStyle = v < 0.4 ? '#5fd07a' : v < 0.75 ? '#e8b04a' : '#e05a45';
      c.fillRect(bx + 56, y, 74 * clamp(v, 0, 1), 7);
    }
    c.textAlign = 'right';
    c.font = '700 15px system-ui, sans-serif';
    c.fillStyle = game.credits < 100 ? '#e05a45' : '#ffd34d';
    c.fillText(`${game.credits} cr`, bx + 130, by - 10);
    if (game.repairing) {
      c.font = '600 11px system-ui, sans-serif';
      c.fillStyle = '#5fd07a';
      c.fillText('REPAIRING', bx + 130, by + 74);
    } else if (game.car.wreckage > 0.35) {
      c.font = '600 11px system-ui, sans-serif';
      c.fillStyle = 'rgba(255,255,255,0.5)';
      c.fillText('E — repair    R — recover', bx + 130, by + 74);
    }
    c.restore();
  }

  // --- parking sensor ---
  // Four arcs behind or in front of a car glyph, filling as it closes. Small,
  // and only there while the sensor has something to say.
  if (game.sensor.dist < SENSOR_RANGE && game.player.inCar) {
    const near = clamp(1 - game.sensor.dist / SENSOR_RANGE, 0, 1);
    const cx = W / 2, cy = H - 62;
    c.save();
    c.translate(cx, cy);
    if (!game.sensor.rev) c.scale(1, -1);          // arcs point the way you go
    for (let k = 0; k < 4; k++) {
      const lit = near > k / 4;
      const r = 13 + k * 7;
      c.beginPath();
      c.arc(0, 0, r, Math.PI * 0.22, Math.PI * 0.78);
      c.lineWidth = 4;
      c.strokeStyle = !lit ? 'rgba(255,255,255,0.10)'
                    : near > 0.85 ? '#e8433a' : near > 0.6 ? '#e8a33c' : '#5fd07a';
      c.stroke();
    }
    c.restore();
    c.textAlign = 'center';
    c.font = '600 11px system-ui, sans-serif';
    c.fillStyle = 'rgba(255,255,255,0.62)';
    c.fillText(`${game.sensor.dist.toFixed(1)} m`, cx, cy + (game.sensor.rev ? 52 : -42));
  }

  // The combo is on a clock of its own, so it needs to be visible while it
  // is running or there is no reason to hurry after the next one.
  if (game.stunts.combo > 1 && game.stunts.comboT > 0) {
    c.textAlign = 'left';
    c.globalAlpha = clamp(game.stunts.comboT / 0.4, 0, 1);
    c.fillStyle = '#ff9a3c';
    c.font = '800 20px system-ui, sans-serif';
    c.fillText(`${game.stunts.combo}x`, 38, 116);
    c.globalAlpha = 1;
  }
  if (game.player.inCar && game.car.airborne) {
    c.textAlign = 'center';
    c.fillStyle = '#ffd34d';
    c.font = '800 20px system-ui, sans-serif';
    c.fillText('AIRBORNE', W/2, H * 0.36);
  }
  if (game.snipers.hitFlash > 0.01) {
    c.fillStyle = `rgba(190,20,20,${(game.snipers.hitFlash * 0.28).toFixed(3)})`;
    c.fillRect(0, 0, W, H);
  }
  // Outside the mission ring: the screen itself tells you you are dying.
  if (game.zoneOut) {
    const a = 0.16 + Math.sin(game.time * 8) * 0.08;
    c.fillStyle = `rgba(255,40,150,${a.toFixed(3)})`;
    c.fillRect(0, 0, W, H);
  }

  // --- help ---
  if (game.showHelp) {
    const lines = [
      'W / S — accelerate, brake & reverse',
      'A / D — steer            Space — handbrake',
      'Shift — NITRO (refills, and stunts top it up)   F — in / out of car',
      'E — repair (hold; fast & half price at a petrol station)   R — recover',
      'C — camera   T — skip time   P — pause',
      'V — record video   U — hide HUD   [ ] — clip brightness',
      'J — MISSIONS (they get harder)   K — street race   G — time trial',
      'Q — drop oil (find a drum)   Y — neon / daylight   M — new map   N — map file',
      'X — next track   O — music on / off',
      'Click the window for mouse look. H hides this.',
    ];
    const bw = 340, bh = lines.length * 19 + 26;
    c.fillStyle = 'rgba(0,0,0,0.42)';
    roundRect(c, 22, H - bh - 22, bw, bh, 10); c.fill();
    c.font = '500 13px system-ui, sans-serif';
    lines.forEach((l, i) => {
      c.fillStyle = i === 0 ? '#fff' : 'rgba(255,255,255,0.78)';
      c.fillText(l, 38, H - bh - 22 + 14 + i * 19);
    });
  }

  if (game.paused) {
    c.fillStyle = 'rgba(0,0,0,0.5)';
    c.fillRect(0, 0, W, H);
    c.fillStyle = '#fff';
    c.textAlign = 'center';
    c.font = '700 44px system-ui, sans-serif';
    c.fillText('PAUSED', W/2, H/2 - 30);
    c.font = '500 15px system-ui, sans-serif';
    c.fillStyle = 'rgba(255,255,255,0.7)';
    c.fillText('press P to resume', W/2, H/2 + 24);
  }
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

// ----------------------------------------------------------------- loop ----

function frame(now) {
  const dt = Math.min(0.05, (now - game.last) / 1000);
  game.last = now;
  game.fps = lerp(game.fps, 1 / Math.max(dt, 1e-4), 0.06);

  // Menu up: the world holds its breath while the camera drifts over town.
  if (game.menu && game.menu.open) {
    game.time += dt;
    game.menu.updateCamera(dt);
    render();
    game.menu.draw(game.hctx, game.hud.width / game.hdpr, game.hud.height / game.hdpr);
    requestAnimationFrame(frame);
    return;
  }

  if (!game.paused) update(dt);
  render();
  drawHud();
  game.recorder.tick(dt);
  game.recorder.capture();
  game.recorder.drawBadge(game.hctx, game.hud.width / game.hdpr, game.hdpr);

  requestAnimationFrame(frame);
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', start);
} else {
  start();
}
