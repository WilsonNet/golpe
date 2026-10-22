# Tilemap and platform art

**Intent:** the places a fighter stands should look like places, not debugging
rectangles — and the same collision map must be able to wear a painted skin or
the original flat competitive skin without a tick changing. The map is data, so
the map maker can author it ([map-maker.md](map-maker.md)); the renderer is the only thing that knows what a
tile looks like.

## Two skins, one collider

| URL | Look | What it is |
|---|---|---|
| `?tiles=art` (default) | the **Waterfront platform tileset** | mossy stone quay: cream/brass lip, deep green face, vines under the ledges |
| `?tiles=flat` | the original monochrome green blocks | the competitive surface; every rectangle exactly as it shipped |

The choice lives beside the bindings in `localStorage` (`golpe:tiles`), has a
side-by-side comparison in **Graphics**, and applies **immediately** in a live
match. `applyTileStyle` emits one event; `Match` clears and redraws only
`stage.arena`. The skybox, camera, fighters and simulation are untouched, and
the fighter's position is the probe's evidence that no reset happened.

**Platforms are independent of the skybox.** `?sky=off` removes the city; it
does not remove the platform art. A player can have the plain blue background
with painted quays, or the Waterfront with flat competitive blocks — the two
settings are deliberately not one switch. `scripts/tiles-probe.ts` boots with
the sky off and the platforms painted, then flips the platforms and proves the
sky is still off.

The collider is always `World.platforms`. Neither style may add, remove or move
a rectangle. In particular, the **painted platform's visible top edge is the
collider's top edge**; the art never overhangs the surface a fighter stands on.

## The format

A map is a `TilemapSpec` (`src/game/simulation/Tilemap.ts`):

```json
{
  "format": "golpe-tilemap",
  "version": 1,
  "tileSize": 8,
  "tileset": "waterfront-platforms",
  "width": 100,
  "height": 75,
  "layers": [
    {
      "name": "platforms",
      "type": "platforms",
      "objects": [{ "x": 90, "y": 450, "w": 130, "h": 24 }]
    },
    {
      "name": "props",
      "type": "props",
      "objects": [{ "type": "vine", "x": 96, "y": 474, "flip": false }]
    }
  ]
}
```

- **`tileSize` is the map's cell.** The current arena uses **8px**, which
  divides both the 24px ledges and the 32px ground exactly. A future map may
  choose another size, but the tileset's cell and the map cell must agree.
- **`width`/`height` are in cells**, origin top-left, Y down. They bound a grid
  layer and the editor's canvas; object coordinates remain world pixels.
- **`platforms` is an object layer of rectangles.** Each object *is* a collider.
  The current arena is converted from `Arena.ts` by `tilemapFromWorld`, so the
  renderer already consumes the format rather than a private layout.
- **`solid` is a painted cell grid** for the future editor. Non-zero means
  solid. `solidRectsFromTilemap` converts the runs to colliders: horizontal
  runs first, identical runs merged vertically, so a painted floor is one solid
  rather than a wall of cell seams. It is the only collision authority in that
  map; there is no hidden second hitbox layer.
- **`spawns` is an object layer of fighter positions** (body top-left, like
  `SpawnPoint`, plus `facing`). An authored map declares its own; a map
  with none gets one on every standable top, and failing that two on the
  world's floor — never an empty list for `pickSpawn`.
- **`theme`** (`waterfront | castle | meadow | snow`, default waterfront)
  picks the tileset (`<theme>-platforms`) and the backdrop. **`meta`**
  carries `id` (the `maps/<id>/` slug), `name`, `author`, `description`.
- **`props` never collide.** A prop names a frame in the tileset's prop atlas;
  the current map places vines under wide ledges only, alternating sides. Props
  are decoration and are not drawn in the Flat style.
- A map has **one collision source**: either platform objects or solid cells.
  A future validator should reject a map that carries both with overlapping
  intent.

The map maker's contract is therefore small: paint or place rectangles in
8px world space, save the layer, and hand `solidRectsFromTilemap` the result.
The runtime has no second path for "editor maps"; the same function that
validates the current arena is what a new map uses.

## Autotiling: a 9-slice, not a 47-blob

The arena is made of axis-aligned rectangles: one ground strip, six ledges and
two pillars. The art literature separates two cases, and this is the first one:

- **Rectangles, panels and UI boxes want a 9-slice** — four corners, four
  edges and a repeated middle.
- **Organic terrain wants a Wang set** (16 tiles) or a **47-tile blob set**
  with inner corners and isolated pieces. Tilesetter's Blob set is explicitly
  the platformer/sidescroller tool; its Wang set is 16 tiles for top-down.
- The 47-blob set spends most of its budget on inner corners a 24px ledge can
  never show, and the current map cannot produce diagonal or one-cell islands.

Sources: [Tiled's JSON map format](https://doc.mapeditor.org/en/stable/reference/json-map-format/)
for layers/tilesets/objects; [Tilesetter's generating-tilesets guide](https://www.tilesetter.org/docs/generating_tilesets)
for blob vs Wang sets; [TonyStr's autotiling article](https://tonystr.net/blog/autotiling)
for the neighbour-mask approach; and the autotiling pattern rules commonly
attributed to **Pixeli** (rectangles/UI → 9-slice; platformer kits → a 3x3
block with inner corners; organic cave terrain → 47-blob).

`PlatformArt.drawTiledPlatform` implements the 9-slice with `TilingSprite` for
the repeated middle and edges. That keeps an eight-screen ground at nine display
objects instead of thousands of 8px sprites while preserving the tile pattern.
The repeated top, face and underside are broken by full-tile variants at
tile-aligned intervals (flowers, moss, cracks) so the wall does not read as
wallpaper. The variants are the same 8x8 family, so their lips and mortar lines
land on the repeated grid.

A future map with a solid grid can still use the same renderer: the grid is
reduced to rectangles before drawing. If a later map needs organic terrain, that
is a second autotile strategy, not a change to this one.

## The tileset

`public/assets/tilesets/waterfront-platforms.json` is the contract:

- `tiles`: named 8x8 frames — `topLeft`, `topA/B`, `topRight`, `midLeft`,
  `fillA/B/C`, `fillMoss`, `fillCrack`, `midRight`, `bottomLeft`,
  `bottomA/B`, `bottomMoss`, `bottomShadow`, `bottomRight`.
- `props`: named frames of any size — vines, planters, a lantern, a crate, a
  barrel, a flower box. The current map uses only the vines; the rest are map
  maker furniture.
- `version` is the first 12 hex characters of the PNG's SHA-256 and is appended
  to the image URL. A cached atlas beside a new JSON crops every tile at the
  wrong rect — the same trap the packed hero sheets hit.

The source generator is `scripts/tilesets/generate.py`; it draws from the
shared Waterfront palette (`art/skybox/palette.json`). `waterfront-preview.png`
is the Art card in Graphics: a real ledge/ground sample, not a mock-up.

## Readability

The painted platforms are **saturated and darker than the city**, continuing
the rule the flat blocks already followed: the places a fighter can stand are
the high-contrast surfaces in the combat band, and the background is quiet,
desaturated and blurred. Every combat colour above them keeps its meaning. The
readability gate is still `scripts/readability-probe.ts`: value, chroma,
silhouette, coverage and background detail are measured against the flat-sky
control. The tile art must not make the fighter harder to find.

## Authored maps on the wire

An authored map (`?map=<id>`, from the map maker or `maps/`) is **untrusted
input on the server**. `sanitizeTilemap` parses `unknown`, snaps to the 8px
cell, clips to the arena, caps the lists (160 platforms, 48 spawns, 160
props) and refuses a map with no surface. It is **idempotent**, which is what
lets the creator compare the server's copy (`match.map`) against the map it
built by `mapKey` and rebuild only when they differ. `worldFromTilemap` builds
the `World`, keeping the spec in `World.source` for the renderer. Creator-only
like `?screen=`; ignored by 5CP and the training room; a map under three
screens is refused for team deathmatch (the room plays the classic arena).
See [map-maker.md](map-maker.md).

## Not implemented

- Painting a solid grid. The map maker places rectangles, and the shipped
  arena remains an object layer generated from `Arena.ts`;
  `solidRectsFromTilemap` is tested against synthetic grids only.
- Slopes, one-way/drop-through platforms, destructible terrain and layered
  background tiles. Every current surface is solid from all sides.
