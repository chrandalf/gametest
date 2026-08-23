// The CRT map and HUD. The map is drawn FROM the road network - the same
// data the cars drive on - in the green/cyan line-graphics style of an
// imagined 1985 police terminal. North-up, player as a heading wedge.
'use strict';
// Reads only the network object handed in; no grid assumptions.

export class Hud {
  constructor(net, stations) {
    this.net = net;
    this.stations = stations || [];
    this.map = document.getElementById('map');
    this.mctx = this.map.getContext('2d');
    this.speedEl = document.getElementById('speed');
    this.msgEl = document.getElementById('msg');
    this.indL = document.getElementById('indL');
    this.indR = document.getElementById('indR');
    this.time = 0;
    // Static road layer, drawn once.
    this.base = document.createElement('canvas');
    this.base.width = this.map.width; this.base.height = this.map.height;
    this.drawBase();
  }

  // The map covers everything the network reaches, which since the
  // crossings were built means the island as well as the city.
  worldToMap(x, z) {
    const b = this.net.bounds ||
      { x0: 0, z0: 0, x1: this.net.extent.x, z1: this.net.extent.z };
    const pad = 10;
    const w = b.x1 - b.x0, h = b.z1 - b.z0;
    const span = Math.max(w, h);
    const s = (this.map.width - pad * 2) / span;
    const ox = pad + (span - w) * s / 2, oz = pad + (span - h) * s / 2;
    return [ox + (x - b.x0) * s, this.map.height - oz - (z - b.z0) * s];
  }

  drawBase() {
    const c = this.base.getContext('2d');
    c.fillStyle = 'rgba(2, 12, 8, 0.92)';
    c.fillRect(0, 0, this.base.width, this.base.height);
    // Scanlines.
    c.fillStyle = 'rgba(0, 0, 0, 0.25)';
    for (let y = 0; y < this.base.height; y += 3) c.fillRect(0, y, this.base.width, 1);
    for (const e of this.net.edges) {
      const [ax, ay] = this.worldToMap(e.a.x, e.a.z);
      const [bx, by] = this.worldToMap(e.b.x, e.b.z);
      c.strokeStyle = e.cls === 'highway' ? 'rgba(255, 80, 200, 0.9)'
                    : e.cls === 'express' ? 'rgba(120, 200, 255, 0.95)'
                    : e.cls === 'ramp' ? 'rgba(255, 200, 90, 0.9)'
                    : e.cls === 'avenue' ? 'rgba(90, 255, 210, 0.85)'
                    : 'rgba(60, 190, 140, 0.55)';
      c.lineWidth = e.cls === 'highway' || e.cls === 'express' ? 3
                  : e.cls === 'avenue' || e.cls === 'ramp' ? 2 : 1;
      c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.stroke();
    }
    // Petrol stations: green squares, always on.
    for (const st of this.stations) {
      const [x, y] = this.worldToMap(st.x, st.z);
      c.fillStyle = 'rgba(90, 255, 140, 0.95)';
      c.fillRect(x - 2.5, y - 2.5, 5, 5);
    }
    c.strokeStyle = 'rgba(90, 255, 210, 0.5)';
    c.lineWidth = 1;
    c.strokeRect(1, 1, this.base.width - 2, this.base.height - 2);
  }

  update(dt, player, others) {
    this.time += dt;
    const c = this.mctx;
    c.clearRect(0, 0, this.map.width, this.map.height);
    c.drawImage(this.base, 0, 0);

    // Other vehicles: dim cyan dots. Entries flagged `big` - the armoured
    // van, the coupe, the last radio sighting - are drawn twice the size
    // with a dark surround, so they read against the road lines instead of
    // passing for one more car.
    if (others) {
      for (const o of others) {
        const [x, y] = this.worldToMap(o.pos.x, o.pos.z);
        if (o.big) {
          c.fillStyle = 'rgba(0, 0, 0, 0.85)';
          c.fillRect(x - 4, y - 4, 8, 8);
          c.fillStyle = o.mapColour || 'rgba(120, 220, 255, 0.7)';
          c.fillRect(x - 3, y - 3, 6, 6);
        } else {
          c.fillStyle = o.mapColour || 'rgba(120, 220, 255, 0.7)';
          c.fillRect(x - 1.5, y - 1.5, 3, 3);
        }
      }
    }

    // The player: a heading wedge, blinking faintly like a cursor.
    const [px, py] = this.worldToMap(player.pos.x, player.pos.z);
    const a = player.pos.yaw;
    c.save();
    c.translate(px, py);
    // World +z is drawn as map-up; canvas rotation is clockwise-positive
    // with y down, so world yaw maps straight through.
    c.rotate(a);
    c.fillStyle = (this.reduceFlash || Math.sin(this.time * 6) > -0.6)
      ? '#e8fff4' : 'rgba(232,255,244,0.4)';
    c.beginPath();
    c.moveTo(0, -6); c.lineTo(4, 5); c.lineTo(0, 2.4); c.lineTo(-4, 5);
    c.closePath(); c.fill();
    c.restore();

    // Speed, in mph because it is 1986.
    const mph = Math.round(player.speed * 2.237);
    this.speedEl.textContent = `${mph} MPH`;
    // Indicators.
    const blink = this.reduceFlash || Math.sin(this.time * 9) > 0;
    this.indL.style.opacity = player.indicator === -1 && blink ? 1 : 0.12;
    this.indR.style.opacity = player.indicator === 1 && blink ? 1 : 0.12;
    // Status line.
    if (player.blocked) this.say('DEAD END — S BACKS OUT · HELD INDICATOR SWINGS ROUND');
  }

  say(text, sticky) {
    this.msgEl.textContent = text;
    if (!sticky) {
      clearTimeout(this._t);
      this._t = setTimeout(() => { this.msgEl.textContent = ''; }, 2600);
    }
  }
}

