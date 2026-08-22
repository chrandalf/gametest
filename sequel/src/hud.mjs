// The CRT map and HUD. The map is drawn FROM the road network - the same
// data the cars drive on - in the green/cyan line-graphics style of an
// imagined 1985 police terminal. North-up, player as a heading wedge.
'use strict';
// Reads only the network object handed in; no grid assumptions.

export class Hud {
  constructor(net) {
    this.net = net;
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

  worldToMap(x, z) {
    const ext = this.net.extent;
    const pad = 12;
    const s = (this.map.width - pad * 2) / Math.max(ext.x, ext.z);
    return [pad + x * s, this.map.height - pad - z * s];
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
                    : e.cls === 'avenue' ? 'rgba(90, 255, 210, 0.85)'
                    : 'rgba(60, 190, 140, 0.55)';
      c.lineWidth = e.cls === 'highway' ? 3 : e.cls === 'avenue' ? 2 : 1;
      c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.stroke();
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

    // Other vehicles: dim cyan dots (police/target get their own colours later).
    if (others) {
      for (const o of others) {
        const [x, y] = this.worldToMap(o.pos.x, o.pos.z);
        c.fillStyle = o.mapColour || 'rgba(120, 220, 255, 0.7)';
        c.fillRect(x - 1.5, y - 1.5, 3, 3);
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
    c.fillStyle = Math.sin(this.time * 6) > -0.6 ? '#e8fff4' : 'rgba(232,255,244,0.4)';
    c.beginPath();
    c.moveTo(0, -6); c.lineTo(4, 5); c.lineTo(0, 2.4); c.lineTo(-4, 5);
    c.closePath(); c.fill();
    c.restore();

    // Speed, in mph because it is 1986.
    const mph = Math.round(player.speed * 2.237);
    this.speedEl.textContent = `${mph} MPH`;
    // Indicators.
    const blink = Math.sin(this.time * 9) > 0;
    this.indL.style.opacity = player.indicator === -1 && blink ? 1 : 0.12;
    this.indR.style.opacity = player.indicator === 1 && blink ? 1 : 0.12;
    // Status line.
    if (player.blocked) this.say('DEAD END — INDICATE TO TURN');
  }

  say(text, sticky) {
    this.msgEl.textContent = text;
    if (!sticky) {
      clearTimeout(this._t);
      this._t = setTimeout(() => { this.msgEl.textContent = ''; }, 2600);
    }
  }
}

