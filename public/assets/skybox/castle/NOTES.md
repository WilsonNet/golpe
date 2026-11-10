# Castle Keep — dusk siege

The Castle theme's own parallax panorama, drawn one pixel at a time with
Pillow + numpy. It uses the same manifest contract as the Waterfront, so the
runtime's `Skybox` draws it: four image layers at different parallax factors,
seven fixed vignettes and one ambient flock.

```
.venv/bin/python scripts/skybox/castle/generate.py
```

That writes every PNG below, plus `manifest.json` (with a SHA-256 first-12 per
file, appended as `?v=`) and `contact.png` for review.

## Files

| File | Size | Layers | Parallax |
|---|---|---|---:|
| `sky.png` | 1600x600 opaque | gradient, stars, moon, ringed planet, thin cloud | 0.015 |
| `far.png` | 1600x600 alpha | ridge, distant town, watchtower, bridge, mist | 0.06 |
| `mid.png` | 1600x600 alpha | the keep, walls, gate, banners, camp, ram, breach | 0.18 |
| `near.png` | 1600x600 alpha | low foreground parapet, rubble, torch brackets | 0.50, alpha 0.62 |
| `flags.png` | 32x24, 4 frames | waving tower pennants | align `mid` |
| `princess.png` | 24x34, 4 frames | the princess at her lit window | align `mid` |
| `trebuchet.png` | 72x52, 4 frames | the siege engine's arm cycle | align `mid` |
| `battle.png` | 40x24, 4 frames | two soldiers fighting on the wall walk | align `mid` |
| `archers.png` | 28x18, 4 frames | bow draw and loose | align `mid` |
| `torches.png` | 10x18, 4 frames | wall torches flickering | align `mid` |
| `crows.png` | 10x5, 4 frames | the ambient flock | 0.04 |

`contact.png` flattens the four image layers and one frame of every vignette;
`preview-3screens.png` repeats it twice for a quick wrap check.

## Composition

The hero crop is **x 0–800**, and the keep is its focal landmark. The middle
band (y 150–470) stays low-contrast, because that is where fighters, nameplates
and platforms live. The colour is deliberately dusk: indigo and violet stone,
rose horizon, and warm lamplight/banners as the only saturated notes.

- The **keep** sits at x 548–832, the central tower and spire above it. The
  princess's window is the one large warm opening; the stone balcony under it
  is the player's read of "someone lives here".
- The **curtain wall** runs the full 1600 px at y 404, with five towers. The
  gatehouse, portcullis, lowered drawbridge and covered battering ram are at
  the centre; the breach and siege tower are at x 860–1040.
- The **camp** is the y 500–556 terrace: tents, wagon, fires and smoke. The
  trebuchet strip sits in it at (278, 504). The foreground parapet starts at
  556, so the camp is not swallowed by it — the strip anchors were moved up
  from the old y 580 when the first pass was measured on the arena floor.
- **Flags** are on the tower tops (u/v chosen from the tower apexes) and on the
  keep flanks; the loop layer cycles all twelve from one clock.
- **Battles** are the wall walk at (196, 380) and (1128, 282), plus the melee
  around the breach at (990, 332); **archers** are at (512, 386) and
  (1200, 386).
- **Torches** are mid-layer vignettes at (300, 386), (560, 386), (880, 386)
  and (1230, 386), each with a dithered warm glow baked into `mid.png`.
- The **near** layer is a low dark parapet, not a wall in front of the fight:
  it is only 12 px above the arena floor at 568 and alpha 0.62, so it frames
  the bottom without covering the camp or the fighters.

## Programs

The manifest has both plans the runtime supports:

- `loops` (12000 ms): 12 flags, the princess, the trebuchet, three battles,
  two archer pairs and four torches. These are fixed-position vignettes; each
  actor's `frameOffset` de-syncs its cycle.
- `ambient` (120000 ms): six crows crossing the sky, with `speedX`, `bobAmp`,
  `bobFreq`, `phase` and `flip`.

The Waterfront's runtime samples every actor in a plan from one elapsed clock,
so the loop stays composed; the panorama wrap is the loop.

## Palette

[`art/skybox/castle/palette.json`](../../../art/skybox/castle/palette.json) is the
only legal source of colour. No pure black, no pure white: the deepest shadow
is `#191733`, the brightest moonlit stone is `#d7d4e6` (reserved for metal
highlights), and the warm windows are `#fff3c9` → `#f6b45b`.

## What changed in this pass

The old Castle backdrop was two procedural `Graphics` silhouettes plus stars.
It read as a row of rectangles at game scale, and the map's own published
overview was only a gradient. This panorama keeps the same readability budget
but gives the theme the same treatment as the Waterfront: separate sky/far/
mid/near layers, a focal keep, a camp and a breach, and a handful of crisp
looping vignettes. The runtime falls back to `ThemeSky` for the Castle if this
manifest is missing, so a probe boot with no asset server still plays.
