// NEON DRIVE's front door: a title screen over an attract-mode camera that
// drifts around the night city, and a menu that hands out the game modes.
// Everything is drawn on the HUD canvas — no DOM, no CSS, all arcade.
'use strict';

function nextMissionName() {
  const names = { race: 'street race', wreck: 'wreck the gang',
                  chase: 'stop the armoured car', blood: 'hospital rush' };
  return `next job: ${names[MISSION_ORDER[(game.missions.level - 1) % MISSION_ORDER.length]]}`;
}

class GameMenu {
  constructor() {
    this.open = true;
    this.screen = 'title';
    this.sel = 0;
    this.everStarted = false;
    this.attract = Math.random() * 6.28;
    this.focus = null;
  }

  show() {
    this.open = true;
    this.screen = 'main';
    this.sel = 0;
  }

  close() {
    this.open = false;
    this.everStarted = true;
    game.last = performance.now();     // no dt spike from time spent in menus
  }

  // Attract camera home: over the tallest part of town.
  focusPoint() {
    if (!this.focus) {
      const blk = game.city.zones.findBlock
        ? (game.city.zones.findBlock([Z.DOWNTOWN, Z.HIGHST], game.rand) || { bi: 8, bj: 8 })
        : { bi: 8, bj: 8 };
      this.focus = { x: roadCenter(blk.bi) + CELL / 2, z: roadCenter(blk.bj) + CELL / 2 };
    }
    return this.focus;
  }

  items() {
    if (this.screen === 'options') {
      return [
        { id: 'style', label: `STYLE  <  ${game.retro ? 'NEON NIGHTS' : 'PLAIN DAYLIGHT'}  >` },
        { id: 'crt', label: `CRT EFFECTS  <  ${game.crtFx ? 'ON' : 'OFF'}  >`,
          hint: 'scanlines, grain and colour fringing' },
        { id: 'music', label: `MUSIC  <  ${game.music.enabled ? 'ON' : 'OFF'}  >` },
        { id: 'track', label: `TRACK  <  ${MUSIC_TRACKS[game.music.idx].name.toUpperCase()}  >` },
        { id: 'musicvol', label: `MUSIC VOLUME  <  ${Math.round(game.musicVol * 100)}%  >` },
        { id: 'sfxvol', label: `SOUND VOLUME  <  ${Math.round(game.sfxVol * 100)}%  >` },
        { id: 'back', label: 'BACK' },
      ];
    }
    const it = [];
    if (this.everStarted) it.push({ id: 'resume', label: 'RESUME' });
    it.push({ id: 'drive', label: 'FREE DRIVE', hint: 'downtown, dusk, a full tank — no rules' });
    it.push({ id: 'race', label: 'STREET RACE', hint: 'four rivals, the route drawn on your map' });
    it.push({ id: 'missions', label: `MISSIONS — LEVEL ${game.missions.level}`,
              hint: nextMissionName() + ' · they get harder as you win' });
    it.push({ id: 'newcity', label: 'NEW CITY', hint: 'a fresh map from a fresh seed' });
    it.push({ id: 'options', label: 'OPTIONS' });
    return it;
  }

  // Returns true when the key was the menu's to eat.
  key(code) {
    if (!this.open) {
      if (code === 'Escape') { this.show(); return true; }
      return false;
    }
    if (this.screen === 'title') {
      if (code === 'Enter' || code === 'Space' || code === 'NumpadEnter') {
        this.screen = 'main';
        this.sel = 0;
      }
      return true;
    }
    const items = this.items();
    if (code === 'ArrowUp' || code === 'KeyW') this.sel = (this.sel + items.length - 1) % items.length;
    else if (code === 'ArrowDown' || code === 'KeyS') this.sel = (this.sel + 1) % items.length;
    else if (code === 'ArrowLeft' || code === 'KeyA') this.adjust(items[this.sel].id, -1);
    else if (code === 'ArrowRight' || code === 'KeyD') this.adjust(items[this.sel].id, 1);
    else if (code === 'Enter' || code === 'Space' || code === 'NumpadEnter') this.pick(items[this.sel].id);
    else if (code === 'Escape') {
      if (this.screen === 'options') { this.screen = 'main'; this.sel = 0; }
      else if (this.everStarted) this.close();
    }
    return true;
  }

  adjust(id, dir) {
    if (id === 'style') { game.retro = !game.retro; }
    else if (id === 'crt') { game.crtFx = !game.crtFx; }
    else if (id === 'music') { game.music.toggle(); }
    else if (id === 'track') { game.music.next(); }
    else if (id === 'musicvol') {
      game.musicVol = clamp(Math.round((game.musicVol + dir * 0.25) * 4) / 4, 0, 1);
      if (game.music.audio) game.music.audio.volume = 0.30 * game.musicVol;
    } else if (id === 'sfxvol') {
      game.sfxVol = clamp(Math.round((game.sfxVol + dir * 0.25) * 4) / 4, 0, 1);
    } else this.pick(id);
  }

  pick(id) {
    switch (id) {
      case 'resume': this.close(); break;
      case 'drive':
        spawnFreeDrive();
        this.close();
        break;
      case 'race':
        this.close();
        if (!game.race) startRace();
        break;
      case 'missions':
        this.close();
        if (!game.missions.m) game.missions.start();
        break;
      case 'newcity':
        buildWorld((Math.random() * 0xffffffff) >>> 0);
        this.focus = null;
        break;
      case 'options': this.screen = 'options'; this.sel = 0; break;
      case 'back': this.screen = 'main'; this.sel = 0; break;
      default: this.adjust(id, 1);
    }
  }

  // The camera drift behind the title: a slow orbit over downtown.
  updateCamera(dt) {
    this.attract += dt * 0.04;
    const f = this.focusPoint();
    const cam = game.cam;
    // High and wide, so the orbit clears every rooftop on the skyline.
    const R = 290;
    cam.pos[0] = f.x + Math.cos(this.attract) * R;
    cam.pos[1] = 135 + Math.sin(this.attract * 0.7) * 20;
    cam.pos[2] = f.z + Math.sin(this.attract) * R;
    cam.target[0] = f.x; cam.target[1] = 20; cam.target[2] = f.z;
    cam.fov = 54;
  }

  draw(c, W, H) {
    c.setTransform(game.hdpr, 0, 0, game.hdpr, 0, 0);
    c.clearRect(0, 0, W, H);
    c.textBaseline = 'top';

    // Scrim so the wordmark never fights the skyline behind it.
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgba(6,2,20,0.42)');
    g.addColorStop(0.45, 'rgba(6,2,20,0.18)');
    g.addColorStop(1, 'rgba(6,2,20,0.66)');
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);

    // The wordmark: chrome-and-neon, glowing.
    const size = Math.min(W * 0.115, 110);
    c.textAlign = 'center';
    c.font = `italic 900 ${size}px "Arial Black", system-ui, sans-serif`;
    const ty = H * 0.16;
    const grad = c.createLinearGradient(0, ty, 0, ty + size);
    grad.addColorStop(0, '#8ffcf6');
    grad.addColorStop(0.45, '#ffffff');
    grad.addColorStop(0.55, '#ff9ad9');
    grad.addColorStop(1, '#ff2fa8');
    c.save();
    c.shadowColor = 'rgba(255,47,168,0.9)';
    c.shadowBlur = 34;
    c.fillStyle = grad;
    c.fillText('NEON DRIVE', W / 2, ty);
    c.shadowColor = 'rgba(120,250,255,0.8)';
    c.shadowBlur = 12;
    c.strokeStyle = 'rgba(255,255,255,0.65)';
    c.lineWidth = 1.4;
    c.strokeText('NEON DRIVE', W / 2, ty);
    c.restore();
    c.font = '700 13px "Courier New", monospace';
    c.fillStyle = '#7dfcf3';
    c.fillText('A N   8 0 s   D R I V I N G   F A N T A S Y', W / 2, ty + size + 14);

    if (this.screen === 'title') {
      const pulse = 0.55 + Math.sin(game.time * 3.5) * 0.4;
      c.font = '700 22px "Courier New", monospace';
      c.fillStyle = `rgba(255,255,255,${pulse.toFixed(2)})`;
      c.fillText('PRESS ENTER', W / 2, H * 0.62);
      c.font = '600 12px "Courier New", monospace';
      c.fillStyle = 'rgba(255,255,255,0.45)';
      c.fillText('best played loud', W / 2, H * 0.62 + 34);
      return;
    }

    // Menu list.
    const items = this.items();
    const y0 = H * 0.42;
    c.font = '700 21px "Courier New", monospace';
    for (let i = 0; i < items.length; i++) {
      const sel = i === this.sel;
      const y = y0 + i * 42;
      if (sel) {
        c.fillStyle = 'rgba(255,47,168,0.16)';
        roundRect(c, W / 2 - 300, y - 7, 600, 34, 8); c.fill();
      }
      c.fillStyle = sel ? '#ffffff' : 'rgba(190,230,235,0.78)';
      c.fillText(`${sel ? '▸ ' : ''}${items[i].label}${sel ? ' ◂' : ''}`, W / 2, y);
      if (sel && items[i].hint) {
        c.font = '600 12px "Courier New", monospace';
        c.fillStyle = '#7dfcf3';
        c.fillText(items[i].hint, W / 2, y + 22);
        c.font = '700 21px "Courier New", monospace';
      }
    }
    c.font = '600 12px "Courier New", monospace';
    c.fillStyle = 'rgba(255,255,255,0.4)';
    c.fillText(this.screen === 'options'
      ? 'W/S choose · A/D change · ESC back'
      : 'W/S choose · ENTER select · ESC ' + (this.everStarted ? 'resume' : 'is patient'),
      W / 2, H - 34);
    c.textAlign = 'left';
  }
}

// Free drive drops you in the thick of it: on a street in the high town, at
// golden hour, pointing somewhere worth going.
function spawnFreeDrive() {
  const city = game.city;
  const car = game.car;
  // Free drive means free: whatever race or job was running is off.
  game.race = null;
  if (game.missions.m) { game.missions.cleanup(); game.missions.m = null; }
  for (let tries = 0; tries < 20; tries++) {
    const blk = city.zones.findBlock([Z.HIGHST, Z.DOWNTOWN], game.rand) ||
                city.zones.findBlock([Z.TOWN], game.rand);
    if (!blk) break;
    if (!city.edgeOpen(0, blk.bj, blk.bi)) continue;
    car.x = roadCenter(blk.bi) + CELL / 2;
    car.z = roadCenter(blk.bj) - city.laneOff(5);
    car.yaw = Math.PI / 2;
    car.vx = 0; car.vz = 0;
    car.y = city.groundY(car.x, car.z);
    car.airborne = false;
    break;
  }
  game.clock = 17.2;                 // golden hour, obviously
  say('FREE DRIVE — the city is yours');
}
