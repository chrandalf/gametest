# Ideas from `amilich/isometric-city`

Handoff notes. Source read at `/workspace/chrandalf/isometric-city` (fork of
`amilich/isometric-city`, MIT-ish OSS, Next.js + TypeScript + HTML5 Canvas).

**What it is:** an isometric city builder (IsoCity) plus a theme-park builder
(IsoCoaster), 2D canvas, no game engine. Roughly 7.5k lines across its three
biggest systems alone (`simulation.ts` 4341, `vehicleSystems.ts` 1897,
`pedestrianSystem.ts` 1238).

**Caveat on depth:** I read the README, the source tree, and the exported
symbols of the main systems. I did **not** read the implementations line by
line — context ran out. Treat the specifics below as "verified this exists",
not "verified how it works".

**Not transferable:** the isometric renderer itself (`CanvasIsometricGrid`,
depth sorting, sprite layering). We're 3D WebGL; that whole layer is moot.

---

## Ranked by value to us

### 1. Terrain from Perlin noise — the biggest single gap  ✅ DONE
`simulation.ts` exports `perlinNoise(x, y, seed, octaves)` and builds the world
on it. **Our world is dead flat.** This is the root cause of the "sparse" and
"blocky" complaints that vegetation alone didn't fix — real places have relief,
and a flat plane reads as a diagram no matter how good the lighting is.

- Add a heightfield to `City`/`MapWorld`; sample it for ground mesh vertices.
- `Vehicle.drive()` already queries a surface height (`city.topAt`) for rooftop
  landings — that hook is where terrain height plugs in, so the physics side is
  mostly already there.
- Roads should cut/fill the terrain rather than float over it.
- Real OSM has no elevation in our current query; SRTM tiles or an
  `ele` tag pass would be the follow-up.

### 2. Traffic lights and junction rules
They have a dedicated `trafficSystem.ts` and vehicles that "respect traffic
lights". **Ours brake for whatever is ahead and otherwise barrel through
junctions.** Cheap, high realism-per-line.

- Per-intersection light phase on a timer, N-S green / E-W green.
- `TrafficCar.update()` already has a lookahead brake — feed a "red light
  ahead" distance into the same `limit` calculation.
- We already draw traffic-light poles as static props in `city.js`; wiring
  the emissive lamp colour to the phase is nearly free.

### 3. More vehicle classes
They run cars, buses, trains, planes, barges, seaplanes. We have cars and one
novelty van. The van already proved the pattern: **vehicles pick their mesh set
at draw time and share physics/AI.**

- Buses on fixed routes with stops are the natural next one (routes reuse the
  lane graph).
- Trains would need rails as their own graph — bigger job, high payoff visually.

### 4. Pedestrian pathfinding
Theirs pathfind and behave as a crowd. Ours wander randomly and turn at kerbs.

- A* over the pavement graph, with crossings at the zebra markings we already
  draw.
- Pedestrians waiting at lights ties 2 and 4 together.

### 5. Zoning and growth (R/C/I), service buildings  ✅ DONE (generation half)
`SERVICE_CONFIG`, `SERVICE_MAX_LEVEL`, `SERVICE_RANGE_INCREASE_PER_LEVEL`,
zoning by Residential/Commercial/Industrial. Our city is generated once and
never changes.

- Even without a builder UI, **zoning would improve generation**: cluster
  building types by zone instead of the current distance-from-centre rule, so
  you get an industrial edge, a retail high street, and suburbs.
- That is a generation-quality win with no new gameplay surface.

### 6. Save/load
They persist multiple cities. We persist nothing — every reload regenerates.
`localStorage` for: current world, courier best, trial bests, stunt score,
time of day. Small job, immediately noticeable.

### 7. Water, bridges, adjacency rules  ✅ DONE
`requiresWaterAdjacency`, `getWaterAdjacency`, `createBridgesOnPath`. We parse
water from OSM (`natural=water`) but **never render it** — see
`mapimport.js`, where `areas` is collected and then unused. Low-hanging: draw
water polygons with the ear-clipper we already have, then bridge roads crossing
them.

### 8. Neighbouring cities
`checkForDiscoverableCities`, `getConnectableCities` — settlements you discover
and connect. Maps nicely onto our courier runs: deliveries to an outlying
village, reached by a road out of the map.

### 9. Co-op / multiplayer
`src/components/multiplayer`, `src/app/coop`. Far out of scope for us, but
worth knowing it exists if the racing ever wants a second player.

---

## Suggested order

Done, in this order (see `js/zones.js`, `js/blocks.js`, `js/terrain.js`):

1. **Zoning-driven generation.** One seeded world running from wildwood and
   farmland through village, suburb, town and high street to a downtown core.
   Blocks are banded off a continuous urbanity field, so it can only step one
   band at a time, and a repair pass then enforces that outright — checked by
   `ZoneMap.violations()`, which is zero across every seed tried. Parks and
   industrial estates are overlays with host rules and a cap on their share.
2. **Water.** A river carved from the seed across the whole map, bridges where
   roads meet it, and a splash-and-respawn if you drive in.
3. **Terrain heightfield.** Heights at road junctions, interpolated between;
   blocks are terraces at their highest corner with a retaining face below.

### Still to do

1. **Save/load** — small, high perceived polish. Nothing persists yet.
2. **Traffic lights** — medium; the poles are already drawn and `TrafficCar`
   already has a lookahead brake to feed.
3. **More vehicle classes** — buses on fixed routes reuse the lane graph.
4. **Pedestrian pathfinding** — A* over the pavements, crossings at the zebras.
5. **Neighbouring cities** — maps onto courier runs to an outlying village.

## Open defects

- Imported OSM buildings shade too dark on unlit sides (ring winding; walls
  currently emitted double-sided as a workaround). The OSM importer is also
  the one part of the game that has not been taught about terrain — an
  imported map is still flat.
- Mega ramps have never been confirmed to put a car on a roof: the climb
  works, the launch off the lip has not been observed.
