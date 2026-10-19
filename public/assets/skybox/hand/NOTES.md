# Hand-painted solarpunk skybox

`?sky=hand` — a 1600×600 parallax panorama drawn one deliberate pixel at a
time with Pillow + numpy. No upscaling, no anti-aliasing, no colour outside
`art/skybox/palette.json`.

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
near.png              1600x600  alpha    parallax 0.50
contact.png           1600x600  RGB      flattened review image
preview-3screens.png  2400x600  RGB      camera x = 0, 800, 1600
```

The strip carries `"align": "mid"`. The contract's own runtime resolves a
strip's factor through `align` (see `specs/skybox.md` and
`src/game/render/skyboxAssets.ts`), so the water follows the aqueduct exactly
as the camera moves. Its nominal `factor` remains the contracted `0.30`; the
preview uses the resolved `mid` factor of `0.18`.

The manifest also carries the two readability hand-offs described in
`specs/skybox.md`: `"haze": 1.3` (the pale screen grade through the combat band)
and `"alpha": 0.2` on the near layer (so the dark framing foliage cannot sit in
the fighter's value band at full strength). The contact and preview images below
are **raw-layer review composites** — they intentionally show the art at full
opacity, before the runtime grade, so the drawing can be judged on its own.

Other artefacts live in `scripts/skybox/hand/review/` (not loaded by the game):
`tiled-2x.png` and `seam-zoom.png` are the two seam checks, kept so the join
can be audited without re-rendering.

## Composition map

The hero crop is **x 0–800**. Everything below is in the shared 1600×600 texture
coordinate space.

### Sky (y 0–180 is the detail band)

- 8×8 Bayer-dithered gradient from indigo `#244f7d` to cream `#fff3c9`.
- Ringed gas giant at (452, 150), radius 91; a warm banded sphere with a gold
  ring, a front/back ring split, and a narrow ring shadow.
- A low sun at (1168, 344) with a tight ordered-dither halo, mostly hidden by
  the city so the light reads as late morning.
- Two small moons in the blue gaps at (1316, 70) and (872, 52).
- Six stacked-lobe cumulus banks, each with a warm cream top rim, warm
  `#e9c9a2`/`#d3a17f` undersides, and smile-shaped lobe shadows. The biggest
  banks frame the planet at x 21–347 and x 578–850; the second screen has a
  bank at 911–1265, a high bank at 1360–1532 and one that wraps the seam at
  1416–1600 / 0–48.
- Four tiny airships, bird flocks, and four thin cirrus ribbons.

### Far (pale skyline, y ~330–512)

- A back ridge of large pale domes and spires, then a closer row of about 28
  rounded towers, domed roofs, roof gardens and antennae.
- A soft aqueduct/viaduct line at y 462 with pale round arches.
- Only `farCity` colours (`#8ea9ae` … `#4b657e`), so the layer reads as haze.

### Mid (the city, the middle band kept lower-contrast)

Hero view:

- A turret crosses the seam at x −30 so the wrap reads as architecture, not a
  cut. The tall left tower is fully visible at x 8–100, with a teal glazed
  stairwell, an arched lit entrance, a sun mosaic, balcony gardens and an onion
  cap with a pennant.
- A long cream-and-brass aqueduct runs from the left tower at (100, 374) down to
  the hero fall mouth at (304, 356); cream arches, a water-filled channel and
  hanging moss.
- The conservatory at x 298–534: a tiered sandstone drum, a glass onion with
  cream/brass ribs, a brass rose window, banners, a fountain terrace, a lit
  triple entrance and a finial.
- Twin capsule homes at 512 and 568, connected by a curved footbridge, a glass
  bay, a roof pergola and a rope bridge to the treehouse.
- The giant tree at cx 704: three crown clumps, a visible trunk and limbs, a
  brass-roofed treehouse with a balcony, ladder, chimney and lanterns, hanging
  vines, and a root-side pool pavilion.
- Around them: the three-storey skyline row, sandstone middle-distance row,
  bottom rooftops with solar panels, turbines, market parasols and crates.

Second screen (x 800–1600):

- A needle observatory at 886 with a glass crown, a wide brass halo, hanging
  garden pods, a spiral stair and a three-arch base.
- Fall two at (970, 310), fed by a cream aqueduct from the needle tower; a
  botanical stadium/arcade at 1044; a solar roof and two turbines at 1128–1240.
- A smaller giant tree at 1304 with a balcony, then an ogee-domed telescope
  observatory at 1382 with its brass barrel aimed up-left.
- Fall three at (1416, 292), fed from the tall right-hand tower at 1502; that
  tower has a sun mosaic, arch window, gardens and a flag.

### Falls

- `items` are the strip's top-left corners in mid space:
  - `{u: 280, v: 356}` — mouth at (304, 356), the hero fall.
  - `{u: 970, v: 310}` — mouth at (994, 310).
  - `{u: 1416, v: 292}` — mouth at (1440, 292).
- The strip is a 48-wide ribbon: foam crest, a teal body with a snaking edge,
  fixed vertical ribbons that shift eight pixels per frame, a 48-pixel stream
  period (6 × 8 = 48, so the sixth frame wraps into the first), and an ordered
  dither mist at the basin. No alpha fades, so every edge stays hard.

### Near (framing the bottom, never the feet)

- A sandstone parapet with trefoil niches, moss and flowers along y 576–600.
- An oval reflecting pool at x 292–486 with koi, lilies and a fountain jet.
- A brass rail and hanging lanterns at x 500–708.
- Large foreground planters at 8, 744, 980, 1466 and 1584; pointed leaf clusters,
  long architectural leaves, vines and lanterns. The tallest foliage lives at
  the screen edges (roughly y 470 at the very corners), while the centre of the
  parapet stays low so the ground line at y 568 is visually clear.
- In the game this layer runs at `alpha: 0.2` by the readability contract. The
  raw pixels are deliberately dark and contrasty so that the faint runtime
  layer still frames the bottom; the contact sheet shows them at full strength.
- A little water garden at 720–796 and a glasshouse/eaves detail in the
  skyline above.

## Palette decisions

- Every drawn RGB value is in `art/skybox/palette.json`; the render uses **56**
  of its colours. Transparent pixels are also given a palette RGB (sky indigo)
  so even a naive all-pixel audit sees no pure black.
- Sky: ordered dithering only (8×8 Bayer), never a blend. Each adjacent pair of
  gradient stops is mixed by threshold, which keeps the retro breakup.
- Aerial perspective: far = `farCity`; middle = warm `cityCream`/`cityStone` plus
  sandstone; near = the darkest greens and stone shadows. Detail rises toward
  the bottom, contrast falls toward the horizon.
- Brass is the connective tissue: aqueduct edges, balcony rails, window rims,
  dome ribs, airship gondolas, treehouse roof and the telescope. Orange/red is
  reserved for awnings, pennants, flowers and the cat.
- Water is `#2f8ba8`/`#42b2c2`/`#66d0cf` with `#c8f7ec`/`#effff4` foam; it is
  deliberately cooler than the cream city.
- No anti-aliasing and no feathered alpha: every pixel is either transparent or
  a palette colour at alpha 255. The only ordered dithering in the layers is
  the sky gradient, cloud/canopy volume, and waterfall mist.

## Iteration history

1. **Blockout.** First render established the hero composition (left tower,
   aqueduct, conservatory, giant tree) and the five-layer contract. Viewing it
   exposed four problems: cloud banks were clipped flat cream slabs with
   contour-ring shading; the tree canopy swallowed the trunk and read as a
   green cloud; the waterfalls looked like pale light columns with barcode
   stripes; and the facades were sparse cream rectangles. The near layer was a
   flat wall of circle-bushes.
2. **Clouds and tree.** Rebuilt clouds from stacked lobe masks with a padded
   patch, per-column warm top rim, lower-half shadow smiles and a right-side
   cast shadow. Split the tree into three crown clumps, exposed the trunk,
   added limbs, a proper treehouse and vines. Replaced the flat near wall with
   a parapet, a reflecting pool, leaf polygons and hanging vines. Rebuilt the
   skyline in three depths (far haze, pale cream row, sandstone middle row).
3. **Water and skyline.** Thickened the aqueduct deck and gave it a real water
   channel and cream arches. Redesigned the falls three times: first to remove
   full-width brightness bars, then to broaden the mist and crest, and finally
   to replace the remaining barcode with vertical ribbons, a snaking body and
   a rounded foam crown. Added the needle observatory, the telescope dome, the
   conservatory terrace, the rose window, market parasols, side pods, rope
   bridge, bunting and the cat.
4. **Finish pass.** Tightened the sun halo, added moons in clear sky, reduced
   cloud/canopy speckle, added tree limbs at the canopy underside, repositioned
   the treehouse below the crown, and introduced the near pond and trefoil
   parapet. Checked the seam with a 2× tile and a 3× seam crop; verified the
   manifest, hashes, dimensions and palette.

## Verification performed

- `sips -g pixelWidth -g pixelHeight` on all seven outputs; `falls.png` is
  288×240 and every panorama is 1600×600.
- `manifest.json` parsed; every `src` resolves; every `version` matches the
  file's SHA-256 first 12; all fall items lie inside the panorama and their
  strip footprint stays inside it. The readability fields (`haze: 1.3`,
  `near.alpha: 0.2`) are present and match `specs/skybox.md`.
- Full-pixel palette audit (not sampled) over sky/far/mid/near/falls: zero
  off-palette RGB values. Alpha is only 0 or 255.
- Seam metrics (mean RGBA delta between column 1599 and column 0, compared with
  a normal adjacent pair):
  - sky 7.3 vs 7.3
  - far 0.1 vs 0.1
  - mid 1.4 vs 1.8
  - near 0.6 vs 0.4
  There is no discontinuity: the differences are at the level of ordinary
  neighbouring columns.
- `tiled-2x.png` and `seam-zoom.png` inspected by eye; the seam runs through the
  two seam turrets, a shared bunting line and a continuous cloud, and the near
  bushes join without a step.
- `contact.png` and `preview-3screens.png` inspected by eye at 1× and 2–4×
  crops. The preview shows the expected parallax ordering: near foliage slides
  twice as far as mid, the far skyline barely moves, and the sky is nearly
  locked.

## Known weaknesses / next moves

- The middle band still has a lot of large cream and green mass (the
  conservatory and the tree). Contrast is deliberately low and detail is kept
  near the edges, but a readability probe should have the final say.
- The far skyline is intentionally soft; some of its towers are still boxy
  silhouettes rather than fully drawn buildings.
- The three waterfalls reuse one strip. Their mouths align exactly, but the
  hero fall and the two far falls have identical silhouettes.
- The canopy is a stylised clump tree; its 1px leaf specks read at 2× more than
  at 1×. A future pass could hand-place more leaf clumps at the silhouette.
- The near foliage is dark by design, but the far-left spawn corner is the one
  place where a dark fighter may sit against a dark bush. The runtime fades the
  near layer to 20% to protect that case; the bright rim highlights keep the
  raw art readable in the review sheet.
- The hero crop cuts the left dome by a few pixels and the right tree/near
  planter at x 800. That is the tiling composition, not a bad seam; moving the
  camera start would show the same art.
