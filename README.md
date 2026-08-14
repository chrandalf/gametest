# Nightfall City

An open-world driving game that runs in a browser tab. Raw WebGL2 — no engine, no
libraries, no build step, no assets on disk. Every texture is painted into a canvas
at load time and the whole city is generated from a seed in about 300 ms.

## Play

Open `index.html` in any browser with WebGL2 (Chrome, Firefox, Safari 15+, Edge).
Double-clicking the file works — there is nothing to install and nothing to build.

```
git clone -b claude/game-graphics-dev-vcra4y https://github.com/chrandalf/gametest
cd gametest && python3 -m http.server 8000   # then visit localhost:8000
```

A local web server is optional but recommended: `file://` works in Chrome and
Firefox, and some Safari builds restrict pointer lock there.

### Single-file build

To get one portable HTML file you can email or drop on any static host:

```
node tools/bundle.js            # writes dist/nightfall-city.html (~105 KB)
```

## Controls

| Key | |
|---|---|
| `W` / `S` | accelerate, brake, reverse |
| `A` / `D` | steer |
| `Space` | handbrake (breaks traction — you can drift) |
| `Shift` | boost, or sprint on foot |
| `F` | get out of the car / get into the nearest one |
| `C` | camera: chase, wide, bonnet |
| `R` | respawn on the nearest road |
| `T` | skip four hours |
| `P` / `H` | pause / hide help |
| click | pointer-lock mouse look |

## The game

Drive through the yellow pillar of light to start a courier run. Every delivery
tops the clock back up, and the top-ups get smaller as your streak grows, so the
run ends eventually — the score is how many you made before it did.

You can also just get out and walk around, steal any car on the road, and drive
into things.

## What's in it

**Rendering**
- Deferred-free forward renderer with a 2048² shadow map (hardware PCF, texel-snapped
  to stop crawling, faded at the edges)
- Up to 16 dynamic point/spot lights — street lamps pool on the road, headlights
  throw a cone ahead of each car
- 24-hour cycle driving sun angle, colour, ambient, fog and window lighting; a
  procedural sky with sun bloom and stars
- A 16-layer `TEXTURE_2D_ARRAY` painted procedurally at startup. The alpha channel
  is a lit-window mask, which is why buildings light up from the inside after dark
- Frustum-culled chunks, batched static geometry, mipmapped + anisotropic sampling

**World**
- 9×9 block grid: roads, kerbs, zebra crossings, lane markings, parks, benches,
  street lamps, parked cars
- Buildings generated per lot with facade styles, shop fronts, parapets, roof
  clutter, water towers, setback towers and aircraft warning lights
- Density and height fall off from downtown

**Simulation**
- Arcade car physics with a real velocity vector: grip, weight transfer, body roll,
  a handbrake that steps the tail out
- Traffic AI that follows lanes, picks turns at junctions, and brakes for whatever
  is in front of it
- Pedestrians who wander the pavement, avoid the road, and get knocked flying
- Spatial-hash collision against every building, tree and parked car
- Web Audio engine note that tracks revs, plus impact thuds

## Layout

```
index.html      canvas, HUD, loading screen
js/math.js      matrices, frustum culling, seeded RNG
js/gl.js        shader helpers, mesh builder, procedural texture array
js/render.js    shaders, shadow pass, frame renderer
js/city.js      city generation and collision
js/entities.js  vehicles, traffic AI, pedestrians, on-foot player
js/game.js      camera, input, simulation, courier run, HUD
```
