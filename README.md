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
| `F` | get out of the car / get into the nearest one (parked cars count) |
| `J` | missions: race, wreck the gang, stop the armoured car, hospital rush |
| `K` | street race on the city circuit |
| `E` | hold to repair — fast and half price on a petrol station forecourt |
| `Q` | drop an oil slick (collect an oil drum first) |
| `Y` | toggle the neon synthwave look / plain daylight |
| `C` | camera: chase, wide, bonnet |
| `R` | recovery crane to the nearest road (costs credits) |
| `T` | skip four hours |
| `G` | start / cancel a time trial across the city |
| ramps | hit one to launch — `A`/`D` for barrel rolls, `W`/`S` for flips |
| `V` | start / stop recording a video clip |
| `[` `]` | recording brightness |
| `U` | hide the whole HUD for clean footage |
| `P` / `H` | pause / hide help |
| click | pointer-lock mouse look |

## Recording

Press `V`. The game composites the WebGL view and the HUD canvas into an
offscreen canvas every frame, captures that at 60 fps via `MediaRecorder`, mixes
in the Web Audio engine note, and downloads a WebM when you press `V` again. A
timer and live file size show while it records — drawn *after* the frame is
captured, so the REC badge never appears in the clip itself. Press `U` first if
you want footage with no HUD at all.

Chrome, Edge and Firefox support this; Safari's MediaRecorder support is patchy,
and browsers block page-initiated downloads inside embedded frames — so record
from a local copy rather than an embedded one. If a download ever fails to
appear, the clip is still there: open `game.lastRecording.url` from the console.

To convert to MP4:

```
ffmpeg -i nightfall-city-*.webm -c:v libx264 -crf 18 -pix_fmt yuv420p clip.mp4
```

Any screen recorder works too — OBS, macOS `Cmd+Shift+5`, Windows `Win+Alt+R`.

## The game

**Courier run.** Drive through the yellow pillar of light to start. Every
delivery tops the clock back up, and the top-ups get smaller as your streak
grows, so the run ends eventually — the score is how many you made before it did.

**Time trial** (`G`). Puts you on a start line at one edge of the city and times
you to the opposite edge, through four checkpoints that jog across the grid so
it needs real corners rather than one straight blast. Routes are ~700 m and
randomised each run; your best time is kept for the session.

You can also just get out and walk around, steal any car on the road, and drive
into things.

## What's in it

**Geometry**
- No hard-edged boxes: a `chamferBox` primitive cuts every edge and corner and
  shades them with true rounded-box normals, so buildings, kerbs and props roll
  off into the light instead of ending in a razor line
- Cars are a lofted shell — rounded-rectangle cross-sections skinned down the
  length with smooth normals, giving a waistline, tapered nose and curved roof
- Downtown grows genuinely cylindrical towers; people are ellipsoids and
  capsules; cylinders carry radial normals so nothing looks faceted

**Rendering**
- Physically-sane lighting: albedo and tints are converted from sRGB to linear,
  light is summed in linear space, and the result is tone mapped with an ACES
  filmic curve — the single biggest difference between "flat" and "lit"
- HDR pipeline at RGBA16F with 4x MSAA, resolved and run through a threshold /
  separable-blur bloom chain, so lit windows, headlights and the sun disc bleed
  the way bright things actually do
- Fresnel-weighted specular: surfaces turn reflective at grazing angles, and car
  paint and glass are flagged glossy for a tighter highlight
- Colour grade on the way out: cool shadows, warm highlights, gentle S-curve,
  vignette
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

**Action**
- Stunt ramps scattered on straight stretches. Air time, barrel rolls and flips
  are tracked and scored, with a bonus for landing on the wheels
- Real gravity: 9.81 m/s², with the whole simulation in metres and seconds
- Rooftop snipers track the car with a laser that lags behind you, so holding a
  straight line is what gets you hit. A hit shoves the car and rocks the camera

**Details**
- Lock the tyres up and they squeal — filtered noise driven by combined slide and
  cornering load, so a fast clean corner protests without the car stepping out —
  and they lay dark rubber on the road from a ring buffer of trail quads
- A nodding dog on the parcel shelf, run as a damped spring off the car's own
  acceleration, visible through the tinted rear glass
- A toilet roll streaming out of the back door: a Verlet chain with drag, wake
  lift and flutter, whose unrolled length grows with speed up to nine metres
- Number plates read E901 GBL, painted into the texture array pre-squashed so
  the glyphs come out correctly proportioned on the 4.7:1 plate

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
