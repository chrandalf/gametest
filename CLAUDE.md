# Neon Drive — code index

**Read this before going looking for anything.** It is the map of the
repository: what lives where, who owns which concept, and the handful of
conventions that are easy to get wrong. Grep second, this first. When a
change adds a system or moves one, update the entry here in the same
commit — an index that has drifted is worse than none.

Two games share the repo and do **not** share code:

| | |
|---|---|
| `js/`, `index.html` | **Neon Drive 1** — raw WebGL2, no libraries. Frozen unless asked. |
| `sequel/` | **Neon City** — a Turbo Esprit tribute on Babylon.js. All current work. |
| `tools/` | Bundlers. `bundle.js` → ND1, `bundle-sequel.js` → `dist/neon-drive-2.html`. |
| `assets/music/` | Licensed Epidemic Sound tracks. See the licence note in `README.md`. |

---

## Neon City — `sequel/src/`

The whole game is eleven ES modules bundled by esbuild into one inline
script. There is no framework and no build step beyond the bundler.

### `network.mjs` — the road network, and the single source of truth
Everything else is generated from it or navigates on it. If a question is
about *where roads are*, it is answered here.

- `buildNetwork(seed)` — **the seed is the town.** Pitches, avenue rows,
  the street cull and the forecourts all fall out of it; `citygen` takes
  the same seed for the districts. `main.mjs` owns `CITIES`, the four
  named towns, picked on the intro screen (◄ ► before Enter; the choice
  rides in the URL hash and switching reloads). The towns are also one
  campaign: two contracts each, then the mission goes `travel`, landfall
  on the island hops to the next town (`hopTown` → sessionStorage
  `neoncity_hop` → reload → restore), carrying score/level/hull/tank/
  ledger/paint.
- The street cull never leaves a dead end: every junction keeps at least
  two ways out (`degree < 3` guard), and the map stays one piece.
- The footprint is a per-seed **rectangle**: `GX`×`GZ` junctions, each
  9–13 and never equal (returned on the net). The crossings leave two
  per-seed rows of the eastern ring, pushed apart until the bridges fit,
  and the island centres between them — so it wanders along the coast
  from town to town. `GRID` (11) survives only as the notional average;
  `CELL` (67 m average; pitches are irregular per row/column)
- `CLASSES` — `street`, `avenue`, `highway` (the coastal ring), `express`
  (elevated deck), `ramp` (slip road), `service` (garage spur). Each has
  `lanesPer`, `laneW`, `limit`.
- `halfWidth(cls)`, `DECK_Y` (9.5 m — how high the bridges fly)
- `buildNetwork()` returns `{ nodes, edges, at, xs, zs, bounds, extent,
  island, bridges, forecourts, deckY }`
- `lanePos(e, dir, lane, s)` → `{ x, y, z, yaw }`. **Nodes and edges carry
  a `y`**, so a slip road is just an edge whose ends are at different
  heights.
- Navigation: `nodeAhead`, `nodeBehind`, `headingSlot`, `outgoing`,
  `turnOptions`

**Order matters inside `buildNetwork`.** Grid → island and bridges → the
street cull → forecourt spurs → bridge widths and junction boxes. Two
things depend on it and both have bitten:
- The bridges are laid **before** the cull so the cull works around them.
- The forecourt spurs are added **after** it, because before the cull every
  junction is still a crossroads with no free arm to hang one off.

### `driver.mjs` — the lane grammar, and how everything drives
Player, traffic, police and the target all use this one class.

A vehicle is either `mode:'edge'` (in a lane, analog steering magnetised to
the lane centre, quantised lane changes, soft walls) or `mode:'turn'`
(committed to a quadratic bezier through a junction, auto-braked to
`CORNER_SPEED`). Turns are chosen in advance by indicator. Scenery is
unhittable; traffic is not. That is the game.

A driver flagged `overtake` (the player only) may push from lane 0 past
the centre line into the oncoming lane and the magnet tucks it home on
release — the single-lane pass; time out there at speed pays (`overT` in
main). AI never crosses. A driver flagged `canReverse` (the player only)
backs up at 4.5 m/s when holding brake at a standstill; blocked AI still
does the instant spin.

`update(dt, { throttle, steer, indicate, maxSpeed, stopAt })`,
`beginUTurn()`, `place()`.

### `citygen.mjs` — the network made visible
Nothing here is data the game reasons about. Roads, pavements, kerbs, stop
lines, neon edging, buildings, signs, street lights, the elevated
crossings, the coast, the island, the garages, roadworks.

Returns `{ glow, stations, roadworks, surf, districtAt, zones }`.

**Districts.** Every block belongs to a quarter — downtown, the strip, the
terraces, the works, the docks, a park — and the quarter decides height,
density, window colour, sign rate and what stands between the buildings.
`DISTRICTS`, `FAMILIES`, `zones`, `districtAt(x, z)` (which is what the
mission briefing names).

Conventions worth knowing:
- Anything that stands up off a deck stops short of a junction box
  (`e.padA` / `e.padB`); pavements likewise stop short of whatever crosses
  them. Run either to the node and you get a wall in the road.
- `slab()` builds a deck piece from the four lateral offsets it has at its
  two ends, which is what lets ramps taper into what they join.
- A Babylon `CreatePlane` faces **away** from its `rotation.y` normal.
  `twoSidedSign()` exists because of it.

### `main.mjs` — the game itself
Boot, scene, backdrop, the merge/district passes, `buildCar`, traffic, the
gun, collisions, cameras, the garage, HUD wiring, intro, game over, `tick`.
Also `CITIES` (the four towns and their seeds; hash-selected on the intro)
and the clean-driving bonus (`clean` — a minute with no heat, no shunt, no
red run pays 100).

The campaign has an ending: level 9 (eight contracts, four towns) is
`mission.finale()` — the paymaster on the ring road; killing it pays
2000 and flags `stats.campaignDone`, then free play continues. `DIFFS`
(EASY/NORMAL/HARD → `mission.diff` multipliers) and the CONTINUE menu
item (localStorage `neoncity_save`, written at each town arrival) also
live in main. Each `CITIES` entry carries `sky` (night palette) and
`coast` (default mood).

**The front door** lives here too: title → menu (`menuKey`, `menuItems`,
`RULES_TEXT`) over an attract mode — pre-start the car self-drives the
sunward boulevard (`startEdge`) and `updateAttractCam` holds the poster
shot. Everything the attract car does is gated off the law and the tank
by `live`. Plus `boom`/`shards` (explosions), `bigWord` (level/kill word
art), `stats` (the game-over ledger) and `egg` (TURBO/KITT/OUTRUN/VHS/
GOONIES typed on the front door; 88 mph; eight seconds held at 55 mph;
score 1986; a clean coupe kill quotes the A-Team). The toy layer also
lives in main: `air` (jumps off speed bumps and works planks — vertical
arcs over the road, never off it), `weather` (rain per town/contract:
wet flag on drivers, streak planes on the camera, thunder), `hornBlast`
(H), `upgrades`/`buyUpgrade` (tank/plate/turbo for score at a serviced
garage, keys 1/2/3, carried through hops), and `carFeel` (roll/pitch
body language). The scrambler (pickups, at 4★+) blinds the fleet for
15 s — they flee, stars shed every 5 s, rams knock cruisers out at +200
— and at 5★ the fleet hunts with Pac-Man roles (mission). Touch devices get tap-to-navigate
menus and on-screen buttons (`#touch`) that dispatch real KeyboardEvents,
shown via `body.touchmode`; music starts as early as autoplay policy
allows (`tryMusic`, `sound.resume`).

Things that live here and are easy to hunt for:
- **Districts / streaming** — `TILE`, `tileAt`, `updateDistricts`,
  `DRAW_RANGE`. Static geometry is merged **per tile per material**; merge
  it globally and frustum culling has nothing left to reject.
- **Quality ladder** — `VIEWS`, `applyQuality`, `scaleStep`, `AUTO_BEST`
  (defaults to MEDIUM). Keys: `C` camera, `G` quality, `F` reduced
  flashing, `B` coast mood (`coast2.mode`: off/day/sunset via `MOODS`),
  `M`/`X` music. Petrol at garages costs score, priced up by wanted
  stars.
- **Cameras** — `VIEWS`, `updateCamera`.
- **The garage** — `SERVICE`, `updateGarage`, `signpostGarage`.
- **`window.game`** — the debug/test surface: `player, traffic, net, hud,
  tick, mission, coast, tiles, pickups, run, tank, turbo, garage, peds,
  signals, coast2, stations, nav`. The bot drives the game through it.

### The rest
| file | owns |
|---|---|
| `mission.mjs` | The director: target coupe (decides **once per block** — `edgeMark` — indicating in advance like all traffic; cruises to a persistent `wanderPoint` destination when it has no meet; the rival commits the same way), the armoured van and the exchange (the van drives to a picked `meet`; its crew escalates by level — ≤2 settled, 3–4 runner, 5+ hunter that U-turns onto you and rams via `onVanRam`), `runners` (level 4+: extra couriers for the meet; delivered = coupe armour, stopped = +150), the `rival` (level 3+: a white competing hunter that races you to the mark — its kill pays you nothing; +200 bounty), police fleet, the wanted ladder (`OFFENCES` — each has a cap; only killing reaches 5; 1–2★ the police tail, 3★ they ram and can bust, 4★ they shoot), lie-low, respray, levels. Dead coupes burn off after 2.5 s (`targetGone`) and leave the collision world |
| `lights.mjs` | Traffic signals. Three real lenses per head, `green → amber → red → red+amber → green`. Each head faces one approach |
| `peds.mjs` | Pedestrians: walk, cross, get hit |
| `pickups.mjs` | Six cassettes and the briefcase the coupe drops |
| `outrun.mjs` | The coast layer: races and the cruise bonus on the ring road |
| `hud.mjs` | The CRT minimap, drawn from the network, and the HUD text |
| `sound.mjs` | WebAudio synth rack plus the licensed tape deck |

---

## Conventions that have caused bugs

- **Babylon is left-handed.** Forward is `(sin yaw, 0, cos yaw)`, left is
  `(-cos yaw, 0, sin yaw)`. Slots are `0:+x 1:-x 2:+z 3:-z`.
- **A merged mesh's world bounding box is not computed until it first
  renders.** Read it at merge time and you get zeroes. Derive positions
  from the meshes going in.
- **Meshes that change with the game must not be tiled**, or the district
  system's `setEnabled` fights whatever else is toggling them. See the
  `DYNAMIC` set in `main.mjs`.
- **Anything longer than a couple of districts** (surf strips, sand, sea)
  belongs to no district and must never be distance-culled.
- **The artifact host wraps the page** in its own `<!doctype>/<head>/
  <body>`, so the bundle is content only.
- **The artifact sandbox forbids the Gamepad API** and Chrome *throws* on
  `navigator.getGamepads()` there. `main.mjs` stubs it before Babylon boots.

## Testing

Harnesses live in the scratchpad, not the repo. They drive the real game
through `window.game.tick(dt)` at sim speed under headless Chromium
(`--use-angle=swiftshader`, `executablePath: '/opt/pw-browsers/chromium'`),
served by `cspserve.js`, which replays the artifact's CSP *and* its
permissions policy so sandbox-only bugs surface before publishing.

`bot.js` plays the game unattended and files a report. It has found real
faults; when changing anything about the chase, the law or the economy,
run it (`MINUTES=8 node bot.js`) and read the log.

Software rendering cannot resolve GPU fill differences — its noise is
larger than most of the effects worth measuring. Draw calls, active mesh
counts and CPU-side churn it measures fine. For anything fill-bound, the
on-screen counter on a real machine is the instrument.

## Rules for this repo

- Work on the branch named in the task. Never push elsewhere.
- No model identifiers in commits, code, or anything pushed.
- The music is licensed to the owner personally, not to the repo.
