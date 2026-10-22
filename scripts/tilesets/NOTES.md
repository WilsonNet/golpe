# Waterfront platform tileset

The standable surfaces of the arena, painted as a dark mossy stone quay from
the hand-painted Waterfront palette. This is a **skin over the existing
colliders**, not a map or a physics change: `World.platforms` still owns every
rectangle, and the runtime's 9-slice only decides what the rectangle looks like.

## Regenerate

From the repository root:

```bash
.venv/bin/python scripts/tilesets/generate.py
```

The generator is deterministic (two consecutive runs produce byte-identical
PNGs), palette-only, and uses no anti-aliasing. It writes the four shipped
files plus two QA-only images:

```
public/assets/tilesets/waterfront-platforms.png     64x24   version 975e22046d00
public/assets/tilesets/waterfront-props.png         256x216 version (see the JSON) — 125 props, 161 frames
public/assets/tilesets/waterfront-platforms.json    frames + SHA-256 versions
public/assets/tilesets/waterfront-preview.png       320x80  1x Art card

scripts/tilesets/tiling-test.png                    528x168 6x QA sheet
scripts/tilesets/preview-2x.png                     640x160 nearest QA view
```

`version` is the first 12 hex characters of the PNG's SHA-256. The runtime
appends it to the image URL, so a cached atlas cannot be paired with a new
JSON's rectangles.

## Palette

Every pixel comes from `art/skybox/palette.json`; there are no new colours and
no transparent RGB outside the palette (transparent pixels are given the deep
indigo `#22213a` so a naive full-pixel audit still sees only palette values).

| Role | Values |
|---|---|
| stone face | `#235342` deep, `#2f6c4d` mid, `#478a58` lit bevel |
| mortar / indigo shadow | `#22213a` deepest, `#2d2b4b` mortar, `#3b395e` faint glint |
| moss / grass | `#68a963`, `#8dc46f`, `#b7d879`, `#d7e98c` |
| cream stone lip | `#fff2d6`, `#f3e0bb`, `#e4c99b` |
| tan stone / corbel | `#d2b07c`, `#b98f61` |
| brass | `#ffe08a`, `#f7c85f`, `#e4a73f`, `#c9852f`, `#a36428` |
| flowers | `#ffd2e0`, `#f49bb8`, `#e66d97`, `#c94d7c` |
| wood (props) | `#cfa074`, `#b9855e`, `#9b6a50`, `#7f5446` |
| warm lantern | `#ffe6a1`, `#ffd37a`, `#f6b45b` |
| preview sky / city / cloud | `#2f6b98`, `#3f88ad`, `#5aa6bd`; `#688596`, `#587387`, `#4b657e`; `#fff8e8`, `#f6e6c9`, `#e9c9a2`; `#2b6c8b` glass, `#f6b45b` windows |

## Composition

### 8x8 tiles

The tile family is one vertical wall slice. Top, middle and underside all put
their mortar joint on `x = 0`, so a `TilingSprite` of `topA`/`fillA`/`bottomA`
lines up with the side caps.

- **Top (`top*`)** — rows 0–1 are the moss fringe, row 2 the cream stone lip,
  row 3 the thin brass trim, row 4 the lip's deep shadow, rows 5–7 a short lit
  face course (1px indigo joint, 2px bevel, stone body).
  - `topA` is the repeated base: a green moss fringe.
  - `topB` adds flowers and a brighter brass run.
  - `topMoss` is the extra-lush variant: moss spills over the lip and down the
    first face rows.
  - `topStone` is the plain weathered stone top, for variety in a future map.
  - `topLeft` / `topRight` are the corner caps, with a 2px darker edge and a
    2x2 brass corner stud.
- **Middle (`mid*` / `fill*`)** — a 1px indigo mortar grid, a two-pixel
  top-left bevel and a deep green body. The mortar is `#2d2b4b`, not near-black,
  so at 1x the wall reads as coursed masonry rather than a UI waffle.
  - `fillA` is the repeated dark stone block.
  - `fillB` is a lighter block with a small chipped bevel.
  - `fillC` is a broken-course repair: one 3px course over a staggered pair of
    smaller stones in one 8px cell, which breaks the square rhythm without
    moving the tile boundary.
  - `fillMoss` is heavily mossed and carries a small pink flower.
  - `fillCrack` is the cracked variant; the crack is reserved for this tile so
    repeated wall fill is not a field of identical cracks.
  - `fillTrim` is a vertical brass downpipe with a darker coupling; it crosses
    the horizontal joint so it remains continuous when stacked.
  - `midLeft` / `midRight` are the vertical side caps: continuous dark outline,
    a lit inner bevel and a 2x2 brass stud that repeats as a rivet line.
- **Bottom (`bottom*`)** — rows 0–2 finish the face, row 3 is the carved
  under-edge, rows 4–7 are deep indigo shadow (a 1px deep line, two rows of
  `#2d2b4b`, and the deepest silhouette row).
  - `bottomA` is the repeated underside, with a single moss clip.
  - `bottomB` adds a tan stone corbel, for a quay that reads as built.
  - `bottomMoss` hangs a green drip into the shadow.
  - `bottomShadow` is the deep void variant.
  - `bottomTrim` is a brass underside band, aligned under the `fillTrim` pipe.
  - `bottomLeft` / `bottomRight` are the corner caps, with the dark edge
    continuing and a brass stud at the under-edge.

All 21 named tiles are exactly 8x8; the three unused atlas cells (row 0
columns 6–7 and row 2 column 7) are transparent.

### Props (64x48 — the original seven; see "Props: the map maker's catalogue" below)

- `vine` (8x24) — a leafy strand, top at y=0, stem at x=4, 2–3px leaves and a
  pale tip.
- `vineFlower` (8x24) — the same strand with three small pink flower clusters.
- `planter` (24x12) — cream stone box with a brass medallion, a 14x6 bush, two
  plus-shaped flowers and green spills over both rims; base at y=11.
- `lantern` (8x16) — brass post, warm panes split by a mullion, shaded base;
  base at y=15.
- `crate` (16x16) — horizontal planks, a 2px diagonal brace and brass nails;
  base at y=15.
- `barrel` (14x16) — bulged staves, two brass hoops and rivets; base at y=15.
- `flowerBox` (16x8) — low wood box with a brass band, a 12x4 bush and two
  flowers; base at y=7.

The current map places only the vines under wide ledges. The rest are the map
maker's furniture.

### Preview (320x80, 1x)

- A 256x32 ledge at `(0, 24)`: four tile rows, both side caps, a mix of top
  variants, two fill rows and every bottom variant.
- A 64x32 ground sample at `(256, 48)`, stepped down to the right so its left
  and right caps and the main ledge's right cap are all visible.
- `vine` hangs from the main ledge underside at `(64, 56)`.
- `planter` `(160, 12)` and `lantern` `(196, 8)` stand on the moss; `crate`
  `(272, 32)` and `flowerBox` `(292, 40)` stand on the lower ground. Each has a
  one-pixel contact shadow on the lip.
- The backdrop is a three-stop Waterfront sky gradient (`#2f6b98` →
  `#3f88ad` → `#5aa6bd`) ordered-dithered with an 8x8 Bayer matrix, a small
  cream cloud, and a low far-city silhouette in the palette's `farCity` values.
  No text.

## Verification performed

- `waterfront-platforms.png` **64x24**, 21 named tiles, **22 colours**,
  alpha `[0, 255]`, 192 transparent pixels (the two unused row-0 cells and the
  unused row-2 cell).
- `waterfront-props.png` **64x48**, 7 named frames, **25 colours**, alpha
  `[0, 255]`, 2049 transparent pixels.
- `waterfront-preview.png` **320x80**, **40 colours**, fully opaque, no text.
- Every frame is inside its atlas; every tile is exactly 8x8; every prop frame
  is exactly the size named in the contract; prop frames do not overlap.
- Full-pixel palette audit passes on all three PNGs; alpha is only 0/255.
- JSON parses; every frame is `[x, y, w, h]`; both `version` fields match the
  SHA-256 first-12 of the file on disk.
- 3x3 tiling test (`scripts/tilesets/tiling-test.png`, 6x nearest):
  - a pure 3x3 `fillA` panel has exact 8px period in x and y;
  - the mortar is exactly 1px wide at every tile boundary (no double joints);
  - the cream lip and brass trim are uninterrupted across the top panel;
  - the face mortar column is continuous from `topA`'s short course into
    `fillA`;
  - `fillA`'s bottom face is pixel-identical to `bottomA`'s top face;
  - the left/right cap outlines are continuous down the capped panel;
  - every cap variant carries a brass stud;
  - the capped 4x3 panel and the `topA`/`fillA`/`bottomA` wall both visually
    join with no seam or step.
- Determinism: two consecutive generator runs produced identical SHA-256
  hashes for the PNGs and the JSON.
- Preview inspected at 1x (`waterfront-preview.png`) and 2x
  (`scripts/tilesets/preview-2x.png`).

## Iteration log

1. **First pass.** Near-black `#22213a` mortar on a 7x7 grid, 1px bevel, a
   sparse two-stem vine, 2x2 flower squares and a flat sky. It read as a dark
   UI waffle, the vine vanished at 1x, and the planter's paired flowers read as
   eyes.
2. **Masonry pass.** Moved the mortar to indigo `#2d2b4b`, extended the block
   body to the tile edge, added the two-pixel bevel and a broken-course `fillC`
   repair. The wall became coursed stone instead of a grid. The vine grew a 2px
   top stem and 2–3px leaf clusters; the flowers became plus shapes; the lantern
   gained a mullion; the pipe moved from bright `#ffe08a`/`#f7c85f` to the
   calmer `#f7c85f`/`#e4a73f` with a coupling.
3. **Calm pass.** Removed the diagonal crack from `fillC` (it repeated as a
   field of `∩` marks) and reserved cracks for `fillCrack`; kept `fillC` as a
   broken two-stone repair. Added the cream cloud and the far-city silhouette
   to the preview so the card reads as Waterfront rather than the plain-blue
   sky. Re-ran the palette, alpha, frame and 3x3 seam audits; inspected the
   preview at 1x and 2x.

## Caveats

- The 8px cell is the constraint: the wall is **small coursed masonry**, not
  large ashlar. Bigger stones would need a larger cell and a different map
  format, not a re-cut of these tiles.
- The present renderer breaks the repeated strips at fixed intervals (7 tiles
  on top, 6 on the face, 9 on the underside), and very short platforms may
  receive few or no overlays. The base `topA`/`fillA`/`bottomA` are designed to
  hold up alone, but they are necessarily more regular than the preview's mix.
- The current renderer draws `topA`/`fillA`/`bottomA` as repeated strips and
  overlays `topB`, `topMoss`, `fillMoss`, `fillCrack`, `fillB`, `fillC`,
  `bottomMoss` and `bottomB` at tile-aligned intervals. `topStone`, `fillTrim`,
  `bottomTrim` and `bottomShadow` are in the atlas for the map maker and the
  preview; the present arena may not show them.
- The preview's cloud and far city are art-card dressing, not prop frames. The
  preview is deliberately 1x; the 2x file is a QA view, not a shipped asset.
- The vine is a stylized 8px strand, not a botanical drawing. At 1x it reads as
  a hanging plant; at 8x its leaf clusters are deliberately chunky.
- This work only touches `scripts/tilesets/**` and
  `public/assets/tilesets/**`. No game code, collision data or simulation was
  changed, and no game/probe run was performed here. The asset is ready for
  `tsx scripts/tiles-probe.ts` and the Graphics Art/Flat switch.

## Props: the map maker's catalogue (2026-10)

The seven original props became a catalogue of 125 (161 frames with
animation) in `props.py`, in seven categories. Iteration notes:

- Drawn with a small key-grid kit (`G`) rather than string maps for most
  props: a lit `ball` (dark crescent, mid, highlight) plus an auto-outline
  gives every round thing the same pixel-art read in a line of code.
- The first arched window cut its arch twice (once from the frame, once from
  the glass) and left a slab; the arch is one `inside()` predicate now, and
  the glass is the frame inset by it.
- Themes recolour props for free because every pixel is a key; the Snow
  theme's moss keys are ice, so its trees and bushes come out frosted — kept,
  it reads as winter.
- Gate: `dress.test.ts` checks every catalogue prop exists in every theme's
  atlas at the catalogue's size and frame count; the palette audit covers the
  new keys.
