# Hand-painted solarpunk waterfront

`?sky=hand` — a 1600×600 parallax panorama drawn one deliberate pixel at a
time with Pillow + numpy. No upscaling, no anti-aliasing, no colour outside
`art/skybox/palette.json`.

The silhouette language is deliberately **horizontal**: a long aqueduct/terrace,
broad low blocks, half-domes, a giant tree and a canal. There are no onion
domes, pointed spires, finials, minarets or shaft-and-bulb towers. The only
vertical masts are the requested wind turbines, and they are roof-sized.

## Regenerate

From the repository root:

```bash
.venv/bin/python scripts/skybox/hand/generate.py
```

That writes every file below into `public/assets/skybox/hand/` and refreshes
`manifest.json` with the SHA-256 first-12 for each PNG.

```
sky.png               1600x600  opaque   parallax 0.015, driftX 0.6
far.png               1600x600  alpha    parallax 0.06
mid.png               1600x600  alpha    parallax 0.18
falls.png              288x240   alpha    parallax 0.30, six 48x240 frames, 9 fps
near.png              1600x600  alpha    parallax 0.50, alpha 0.6
boats.png              128x16    alpha    4 frames, 4 fps, parallax 0.50
zeppelin.png           192x28    alpha    3 frames, 10 fps, parallax 0.10
birds.png               64x8     alpha    4 frames, 10 fps, parallax 0.06
contact.png           1600x600  RGB      flattened review image
preview-3screens.png  2400x600  RGB      camera x = 0, 800, 1600
```

`NOTES.md` is copied into the variant directory by the generator as well, as
the contract asks.

### Manifest and motion

- `"haze": 1.4` and `"alpha": 0.6` on `near` are the readability hand-offs
  described in `specs/skybox.md`. The near layer is bright water and quay, not
  dark foliage, so it can carry much more than the old 0.2; 0.6 keeps the
  waterfront visible while softening the dark dock at the spawn corner.
- `falls` carries `"align": "mid"` and nominal `factor: 0.30`; the runtime
  resolves it to the mid layer's 0.18 so the water stays glued to its spouts.
  Its items are pure `{u, v}`: no `speedX`, no bob.
- `boats`, `zeppelin` and `birds` are mover strips. Every item has `u`, `v`,
  `speedX`, `bobAmp`, `bobFreq`, `phase` and `flip`.
  - **Boats** (4): `speedX` −2.2 … −4.6, `bobAmp` 0.8–1.2, `bobFreq` 0.7–1.0.
    The art faces left, so no item is flipped.
  - **Zeppelin** (2): `speedX` 4.2 / 3.0, `bobAmp` 2.4 / 2.0,
    `bobFreq` 0.32 / 0.28, at `(300,112)` and `(1300,70)`.
  - **Birds** (12): `speedX` −12 … +10, `bobAmp` 1–2, `bobFreq` 0.7–1.4,
    heights 55–185. Negative-speed birds are mirrored with `flip`.
- There is no `ambient` block: the runtime's strip items are the motion plan.
  The falls keep their own frame loop; the movers use the global strip clock.

## Composition map

The hero crop is **x 0–800**, and it is composed as one waterfront view.

### Sky (y 0–180)

- Bright golden-hour 8×8 Bayer gradient: indigo-blue `#2f6b98` at the top to
  warm cream `#fff3c9` at the horizon.
- Small ringed planet at (238, 98), radius 44, and a warm sun at (700, 100)
  with an ordered-dither halo. One small moon at (1008, 58).
- Six chunky cumulus banks, each with a warm top rim and warm
  `#e9c9a2`/`#d3a17f` undersides. The hero has a cloud on the left, a cloud
  around the sun, and a big bank crossing the right edge.
- **No static airships or birds remain in `sky.png`.** They are movers.

### Far (sparse low skyline, y ~440–512)

- A low, hazy waterfront ridge of broad blocks, flat roofs and shallow
  half-domes in `farCity` colours. It is deliberately low so the aqueduct's
  arch openings read as sky and distance, not a blue wall.
- A tiny pale far waterline at the bottom of the layer. No spires, no towers.

### Mid (the waterfront)

- **The aqueduct/terrace is the spine.** A cream stone wall runs the full
  1600 px with nine wide bays, 40 px piers and open arches. The deck is at
  y 350, the quay at y 512. The arches crown at ~384 and spring at ~438; the
  openings are open to the far skyline. A water channel and a brass-railed
  parapet run along the top.
- **Hero, left:** a broad three-storey block (x −34…180, top 232) with a
  roof garden, solar panel, laundry and a small roof tree; a lower warm-stone
  wing at 156…252. A wind turbine sits on the tall roof. A rope footbridge
  runs from the roof edge to the giant tree.
- **Hero, centre:** the giant tree at cx 392, rooted behind the wall. Its crown
  spans roughly x 230–555 and y 122–263. A flat-roofed tree hut, awning,
  lanterns, a swing, visible limbs and vines hang in and under the crown.
  A low barrel-roof warehouse and market terraces sit at its feet.
- **Hero, right:** a wide low conservatory block (x 518…782) carrying a
  **half-dome** 264 px wide and 74 px tall, with four cream/brass ribs, two
  hoops, teal glass, interior plants and a lit central entrance. This is the
  only large dome in the hero, and it is wider than it is tall.
- **Deck life:** parasols, flower boxes, potted plants, benches, people,
  laundry, market awnings, solar panels, turbines and roof trees. The quay has
  **seven varied shopfronts** — a café with parasol, a boathouse and a flower
  shop among them — plus crates, rings and more people.
- **Second screen (x 800–1600):** broad garden blocks, a low barrel-roof
  warehouse, a second broad tree, a low glasshouse, roof turbines, laundry,
  shops and parasols. No vertical tower.
- **Falls:** two mouths at x 236 and x 500. The strip items are
  `{u: 212, v: 350}` and `{u: 476, v: 350}`. Both empty into the canal.

### Near (water, quay and foreground)

- The canal starts at a **hard waterline at y 512** and fills to the bottom.
  Four horizontal depth bands (`#42b2c2` → `#2f8ba8` → `#2b6c8b` → deeper)
  with ordered-dither transitions.
- Reflections are a broken colour pool at the wall plus interrupted vertical
  trails under the city and tree; long lazy ripple lines cross the canal.
- Three mallards with wakes, floating leaves and buoys.
- The left foreground is a timber pier at x 0–198 (short posts, planks,
  crates, a rope coil, a lantern, a moored dinghy and a fisher with a rod).
- The right foreground is a short stone stair into the water with a lantern.
- `alpha: 0.6` in the manifest. The contact/preview sheets show the raw layer
  at full strength for art review.

### Movers (draw order after near)

- `boats.png`: four small left-facing canal boats, oar sweep and wake included
  in the strip. `u/v`: (160,536), (540,554), (980,530), (1370,548).
- `zeppelin.png`: two small cream/brass airships with a spinning propeller
  (three frames) and a fluttering pennant at (300,112) and (1300,70).
- `birds.png`: twelve tiny indigo gulls flapping through the sky at 55–185 px.

## Palette and silhouette decisions

- Every drawn RGB value is in `art/skybox/palette.json`; the render uses **56**
  colours. Transparent pixels are given a palette RGB (sky indigo) so even a
  naive all-pixel audit sees no pure black.
- The sky is ordered-dithered (8×8 Bayer), never blended. The move from cool
  blue to warm cream is what changes the mood from the old night-like top to
  the reference's daylight.
- Aerial perspective is in three depths: far = `farCity`; mid = cream/tan
  sandstone and teal glass; near = saturated water and dark pier timber.
- Brass is the connective tissue (rails, arch rings, medallions, shop signs,
  boat fittings, treehouse awning). Orange, coral and pink are reserved for
  awnings, parasols, flowers and laundry.
- **Silhouette rules:** broad blocks, horizontal floor bands, flat or rounded
  roofs, half-domes wider than tall, a horizontal aqueduct. Nothing is a
  vertical shaft ending in a bulb; no onion dome, minaret, spire or finial.
  The turbine masts are the only thin verticals and they are explicitly part
  of the solarpunk kit.
- No anti-aliasing and no feathered alpha: every pixel is transparent or a
  palette colour at alpha 255. Ordered dithering appears only in the sky, cloud/canopy volume, the far
  haze and the water transitions.

## Iteration history

1. **Silhouette rewrite.** Replaced the tower-and-dome city with a horizontal
   waterfront: a full-width aqueduct/terrace, broad low blocks, a giant tree, a
   half-dome conservatory, shops at the quay, a canal, a pier and boats.
   Removed the static sky birds and airships and introduced the boat, zeppelin
   and bird mover strips.
2. **Arch depth and daylight.** The first waterfront had the far city filling
   the arch openings like a blue wall. Lowered the far layer to a sparse low
   skyline, removed the checkerboard haze overlay, opened the arches to sky,
   moved the sun into the hero crop, and added the quay shops, wall medallions,
   lamps, vines, parasols, roof trees and laundry. Darkened the conservatory
   glass and reduced its ribs from six to four so it reads as a glasshouse
   rather than a birdcage.
3. **Water and human scale.** Rebuilt water reflections from blocky bars into
   a colour pool with interrupted vertical trails and long ripples. Removed
   the optional `water.png` mover strip: at 1× its glints read as a dotted
   grid across the canal. Added ducks, a moored dinghy, a fisher, more people,
   the rope bridge, the tree hut awning, perched birds and the roof trees.
   Fixed the boat strip so every frame has a distinct oar sweep; fixed the
   falls loop so all six transitions are even.
4. **Finish pass.** Moved the zeppelin into a clear blue gap, gave it pennant
   flutter, added the sun glints on the water, tuned the shop variety and
   reduced the far roof sawtooth. Re-ran the seam, palette, animation and
   manifest checks.

## Verification performed

- Dimensions checked with `sips` and Pillow:
  - sky/far/mid/near 1600×600, contact 1600×600, preview 2400×600
  - falls 288×240
  - boats 128×16, zeppelin 192×28, birds 64×8
- `manifest.json` parsed; every `src` resolves; every `version` matches the
  file's SHA-256 first 12; every item stays inside 1600×600; each strip's
  `frameW`/`frameH`/`frames`/`fps` match the generated sheet.
- Full-pixel palette audit on every layer and strip: zero off-palette RGB
  values; alpha is only 0 or 255.
- Seam metrics (mean RGBA delta between column 1599 and column 0, compared
  with a normal adjacent pair):
  - sky 6.7 vs 6.8
  - far 0.1 vs 0.2
  - mid 0.4 vs 3.8 (the wrap is not a jump; the whole width shares the deck
    and quay bands, so the seam is quieter than ordinary interior columns)
  - near 0.4 vs 1.2
- `tiled-2x.png` and `seam-zoom.png` inspected by eye. The seam runs through
  the full-width aqueduct band, the water, and the seam-spanning pier, with
  no visible join.
- Strip frame deltas (mean RGBA difference per transition):
  - falls ≈ 20.6–21.8, uniform around the loop
  - boats ≈ 1.9–2.4
  - zeppelin ≈ 1.1–1.2
  - birds ≈ 12.2–14.2
- `contact.png` and `preview-3screens.png` inspected at 1× and 2×. The preview
  shows the near water moving twice as far as mid, the far ridge barely moving
  and the sky nearly locked.

## Known weaknesses / next moves

- The aqueduct wall is long and repeats nine bays; the shops, medallions,
  lamps and parasols are what break it up. More per-bay variation would be the
  next density pass.
- The far skyline is intentionally sparse; through the arches it reads as a
  low hazy waterfront, not a fully detailed city.
- The conservatory is a broad glazed half-dome, not a fully resolved Victorian
  frame; its glass panels are deliberately simple.
- Water reflections are stylised vertical trails, not a physically mirrored
  canal. Boats and zeppelins are small at 1×.
- The near layer is bright water and quay, so `alpha: 0.6` was chosen instead
  of the old dark-foliage 0.2. The readability probe should confirm it; if the
  dark left-hand pier is still too strong at the spawn, lower it to 0.7 before
  touching the art.
- Both waterfalls reuse one 48×240 strip; their mouths align but the
  silhouettes are identical.
- The contact and preview are raw-layer review composites. In the game the
  runtime applies `haze: 1.4` and `near.alpha: 0.6`, so the water and quay are
  slightly lighter and fainter than the review sheet.
