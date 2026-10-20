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
cheer.png               96x20    alpha    4 frames, 6 fps, parallax 0.50 (loops)
picnic.png             128x20    alpha    4 frames, 6 fps, parallax 0.50 (loops)
date.png               128x20    alpha    4 frames, 6 fps, parallax 0.50 (loops)
spar.png               128x20    alpha    4 frames, 8 fps, parallax 0.50 (loops)
sport.png              160x24    alpha    4 frames, 8 fps, parallax 0.50 (loops)
walkers.png             72x20    alpha    6 frames, 8 fps, parallax 0.50 (ambient)
boats.png              128x16    alpha    4 frames, 4 fps, parallax 0.50
zeppelin.png           192x28    alpha    3 frames, 10 fps, parallax 0.10
birds.png               64x8     alpha    4 frames, 10 fps, parallax 0.06
contact.png           1600x600  RGB      flattened review image
preview-3screens.png  2400x600  RGB      camera x = 0, 800, 1600
```

`NOTES.md` is copied into the variant directory by the generator as well, as
the contract asks.

### Manifest and motion

- `"haze": 1.0` and `"alpha": 0.6` on `near` are the readability hand-offs
  requested for this pass. The near layer is bright water and quay, not the old
  dark foliage; 0.6 softens the canal and pier while keeping the waterline.
- `falls` carries `"align": "mid"` and nominal `factor: 0.30`; the runtime
  resolves it to the mid layer's 0.18 so the water stays glued to its spouts.
  Its only items are pure `{u, v}`: no `speedX`, no bob.
- The **looping layer** is `loops`, with `clockMs: 16000`, five groups and
  eight fixed actors. Each group references one strip; each actor has `u`,
  `v`, `frameOffset` and optional `flip`. The strips have no own `items`; the
  loop plan is the source of truth.
  - `cheer`: (140, 492, +0) and (1000, 492, +2).
  - `picnic`: (360, 492, +1) and (1160, 492, +3).
  - `date`: (1340, 492, +2).
  - `spar`: (850, 492, +1).
  - `sport`: (640, 488, +0) and (1230, 488, +2).
  - The 20 px strips end at y 512; the 24 px sport strip ends at y 512. Feet
    land on the quay line, not over the water.
  - The first 800 px contains cheer, picnic and sport; date is in the second screen.
- The **moving layer** is `ambient`, `loopMs: 90000`, with four groups:
  - `walkers` (7 actors) at y 492, `speedX` 4.5 … 7.0 / −4.5 … −6.2,
    `bobAmp` 0.5–0.6, `bobFreq` 1.5–1.8. Negative-speed walkers are flipped.
  - `boats` (4) at y 530–554, `speedX` −2.2 … −4.6.
  - `zeppelin` (2) at (300,112) and (1300,70), `speedX` 4.2 / 3.0.
  - `birds` (12) at heights 55–185, `speedX` −12 … +10.
  - Every actor has `u`, `v`, `speedX`, `bobAmp`, `bobFreq`, `phase`, `flip`.
    Plan-driven strips have no duplicate layer `items`; the plan is the source.
- The runtime samples each plan from one elapsed clock. The loop strips use
  their own `frameOffset` only for phase variety, never for travel.

## Composition map

The hero crop is **x 0–800**, and it is composed as one waterfront view.

### Sky (y 0–180)

- Bright golden-hour 8×8 Bayer gradient: indigo-blue `#2f6b98` at the top to
  warm cream `#fff3c9` at the horizon.
- Small ringed planet at (238, 98), radius 44, and a warm sun at (700, 100)
  with an ordered-dither halo. One small moon at (1008, 58).
- Six chunky cumulus banks, each with a warm top rim and warm
  `#e9c9a2`/`#d3a17f` undersides.
- **No static airships or birds remain in `sky.png`.** They are ambient actors.

### Far (sparse low skyline, y ~440–512)

- A low, hazy waterfront ridge of broad blocks, flat roofs and shallow
  half-domes in `farCity` colours. It is deliberately low so the aqueduct's
  arch openings read as sky and distance.
- A tiny pale far waterline at the bottom. No spires, no towers.

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
  hoops, teal glass, interior plants and a lit central entrance.
- **Deck life:** parasols, flower boxes, potted plants, a few distant deck
  silhouettes, laundry, market awnings, solar panels, turbines and roof trees.
  The old static quay/shop people were removed; the people are the loop and
  ambient strips now.
- **Quay:** seven varied shopfronts (a café with parasol, a boathouse, a flower
  shop among them), cargo, mooring rings and planters. The animated vignettes
  sit in the gaps between the shops.
- **Second screen (x 800–1600):** broad garden blocks, a low barrel-roof
  warehouse, a second broad tree, a low glasshouse, roof turbines, laundry,
  shops and parasols. No vertical tower.
- **Falls:** two mouths at x 236 and x 500. Items are `{u:212,v:350}` and
  `{u:476,v:350}`; both empty into the canal.

### Near (water, quay and foreground)

- The canal starts at a **hard waterline at y 512** and fills to the bottom,
  in four depth bands with ordered-dither transitions.
- Reflections are a broken colour pool at the wall plus interrupted vertical
  trails; long lazy ripple lines cross the canal.
- Three mallards with wakes, floating leaves and buoys.
- Left foreground: a timber pier at x 0–198 with short posts, planks, crates,
  a rope coil, a lantern, a moored dinghy and a fisher with a rod.
- Right foreground: a short stone stair into the water with a lantern.
- `alpha: 0.6` in the manifest. The contact/preview sheets show the raw layer
  at full strength for art review.

### Loops (fixed vignettes, factor 0.50)

All five are 1× pixel strips with 4 frames and no travel; they are placed in
the shop gaps on the quay. The strip bottoms sit exactly on y 512.

- `cheer`: 3 people at a low railing with arms up and small flags; 24×20.
- `picnic`: two seated figures on a checked blanket with a basket and a cup;
  32×20.
- `date`: a couple on a bench with a tiny pulsing heart; 32×20.
- `spar`: two figures in a playful scuffle with a dust puff and a dropped
  cloth; 32×20.
- `sport`: three players, a moving ball and a dark-framed goal with a pale net;
  40×24.
- `loops.clockMs` is 16 s. The actors' `frameOffset` values stagger the four
  frames so the same activity does not animate in lockstep at both sites.

### Ambient (moving, factor 0.50 for walkers/boats, 0.10/0.06 for air)

- `walkers`: a single 12×20 six-frame walk cycle, reused by seven actors.
  They move left/right along the quay, flipped for the leftward ones. They do
  not touch the water: `v + 20 = 512`.
- `boats`, `zeppelin`, `birds`: unchanged art, now driven by the same ambient
  plan. Their positions and speeds are listed above.
- There is no per-element clock. Every strip is sampled from the single
  `ambient.loopMs` programme.

## Palette and silhouette decisions

- Every drawn RGB value is in `art/skybox/palette.json`; the render uses **57**
  colours. Transparent pixels are given a palette RGB (sky indigo) so even a
  naive all-pixel audit sees no pure black.
- The sky is ordered-dithered (8×8 Bayer), never blended. Aerial perspective is
  in three depths: far = `farCity`; mid = cream/tan sandstone and teal glass;
  near = saturated water and dark pier timber.
- Brass is the connective tissue (rails, arch rings, medallions, shop signs,
  boat fittings, treehouse awning). Orange, coral and pink are reserved for
  awnings, parasols, flowers and laundry.
- The activity strips are deliberately small and muted: 10–12 px figures,
  tan/teal/coral clothing, no white and no black. They sit at y 492–512, below
  the 470 px fight band.
- **Silhouette rules:** broad blocks, horizontal floor bands, flat or rounded
  roofs, half-domes wider than tall, a horizontal aqueduct. Nothing is a
  vertical shaft ending in a bulb; no onion dome, minaret, spire or finial.
  The turbine masts are the only thin verticals and they are explicitly part
  of the solarpunk kit.
- No anti-aliasing and no feathered alpha: every pixel is transparent or a
  palette colour at alpha 255. Ordered dithering appears only in the sky,
  cloud/canopy volume, far haze and water transitions.

## Iteration history

1. **Silhouette rewrite.** Replaced the tower-and-dome city with a horizontal
   waterfront: a full-width aqueduct/terrace, broad low blocks, a giant tree, a
   half-dome conservatory, shops at the quay, a canal, a pier and boats.
2. **Arch depth and daylight.** Lowered the far layer to a sparse low skyline,
   opened the arches to sky, moved the sun into the hero, added quay shops,
   wall medallions, parasols, roof trees and laundry. Darkened the conservatory
   glass and reduced its ribs from six to four.
3. **Water and human scale.** Rebuilt water reflections, removed the optional
   water mover strip, added ducks, the pier dinghy/fisher, rope bridge, perched
   birds and more people. Fixed the boat frame variation and the falls loop.
4. **Animated inhabitants.** Added the five loop strips and `loops` plan, the
   walk cycle and the `ambient` plan with walkers + birds + zeppelin + boats.
   Removed static quay/shop people and reduced the deck crowd so the fixed
   vignettes do not duplicate. Moved date and spar clear of the staircase.
   Changed arms to shirt-coloured sleeves for readability against the tan quay.
   Enlarged the sport goal frame and ball.
5. **Finish pass.** Verified the plan schema, quay contact (feet at 512), loop
   frame offsets, palette/alpha, seams, frame cycles and final contact/preview.

## Verification performed

- Dimensions checked with `sips` and Pillow:
  - sky/far/mid/near 1600×600, contact 1600×600, preview 2400×600
  - falls 288×240
  - cheer 96×20, picnic/date/spar 128×20, sport 160×24, walkers 72×20
  - boats 128×16, zeppelin 192×28, birds 64×8
- `manifest.json` parsed; every `src` resolves; every `version` matches the
  file's SHA-256 first 12.
- `loops`: 5 groups / 8 actors, `clockMs` 16000. Every loop actor's
  `v + frameH = 512`, so the feet sit on the quay line. The first 800 px
  contains cheer, picnic and sport; date is in the second screen.
- `ambient`: 4 groups / 25 actors, `loopMs` 90000. Walkers, birds, zeppelin and
  boats all use full actor fields; walker speeds are 4.5–7.0 px/s with mirrored
  leftward actors.
- All strips exact dimensions, palette-only, binary alpha, no anti-aliasing.
- Seam metrics (mean RGBA delta between column 1599 and column 0, compared
  with a normal adjacent pair):
  - sky 6.7 vs 6.8
  - far 0.1 vs 0.2
  - mid 0.4 vs 3.8
  - near 0.4 vs 1.2
- Strip frame deltas (mean RGBA difference per transition):
  - falls ≈ 20.6–21.8
  - cheer ≈ 5.3–6.5, picnic 1.5, date 3.2, spar 3.4–4.3,
    sport 1.6–5.1, walkers 5.8–6.2
  - boats ≈ 1.9–2.4, zeppelin ≈ 1.1–1.2, birds ≈ 12.2–14.2
- `contact.png` and `preview-3screens.png` inspected at 1× and 8× crops. The
  fixed vignettes are in the shop gaps and the walkers are on the quay.
- `tiled-2x.png` and `seam-zoom.png` inspected by eye; the waterline, wall and
  water continue across the join.

## Known weaknesses / next moves

- The loop vignettes are deliberately tiny. At 1×, cheer and sport read as
  groups; picnic and date are subtler and depend on the blanket/bench/heart
  cues. A future pass could add one more 1 px prop, not more saturation.
- The walkers and fixed vignettes share the same quay; a walker can pass
  through a picnic/date actor. At this scale that reads as a promenade rather
  than a collision, but it is not solved.
- The sport goal is only 10 px wide; the dark frame and pale net make it
  readable, but it is the least obvious activity at 1×.
- The aqueduct wall still repeats nine bays; shops, medallions, lamps and
  parasols carry the variation.
- The far skyline is intentionally sparse and low.
- `near.alpha: 0.6` is the requested hand-off. The loop/ambient strips are full
  alpha on top of it, so they are slightly more present than the canal. If the
  probe finds the quay too busy, lower the loop strip alpha before the art.
- The contact and preview are raw-layer composites. In the game the runtime
  applies `haze: 1.0` and `near.alpha: 0.6`.
