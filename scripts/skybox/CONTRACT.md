# Skybox asset contract

Two candidates are generated independently, then compared in the game through
the `?sky=` URL switch. Both must obey this contract exactly so the runtime
does not need to know which one it is drawing.

## The world it has to sit in

The game is authored at **800x600 logical pixels**, one screen. A room may be
1-8 screens wide: the world is `screens * 800` wide and 600 tall. The camera
scrolls horizontally (never vertically in a match) and the arena's flat
platforms are drawn over the skybox.

Composition rules that keep the fight readable:

- The background is **behind** flat, very dark green platforms. A busy
  background directly behind a platform reads as visual noise.
- The **middle band (y 150-470)** should be quiet and hazy: the fighters,
  nameplates and platforms live there.
- Put the strongest detail in **y 0-180** (sky, clouds, planet, airships) and
  **y 470-600** (near rooftops, gardens, water, framing foliage).
- Keep contrast low in the far layers and higher in the near layers — aerial
  perspective is what sells depth.
- The first 800 px of every panorama is the hero view. A single-screen match
  shows exactly that crop and never moves. Make it beautiful on its own.

## Stage, not an illustration

The arena is a **Smash Bros. stage**, not a painting with a fight in front of it.
Sakurai's stage rules are the brief:

- *"The characters have to be easy to identify. Characters tend to be pretty
  small in Smash, so we can't make the background colors too pronounced or
  prominent, or it'll make the characters hard to see."*
- *"Platforms that can be stood on have saturated colors, parts that can't be
  stood on have unsaturated colors."*
- *"Emphasize things with hitboxes, and don't emphasize the rest."*
- *"Don't draw too much, don't draw too little."*
- *"Distinguish the major from the minor."*

That means:

- **One focal landmark, not a city of props.** Pick one huge aqueduct/tree/
  conservatory mass and let the rest be negative space. If you cannot point at
  the one thing the eye should read first, the composition is too busy.
- **Large shapes, low contrast, few details.** The background is a set. Do not
  fill the combat band with windows, people, laundry, market stalls, small
  trees, or repeated domes. Detail belongs at the frame's edges, not behind the
  fighters.
- **Saturate the floor, desaturate the world.** The dark green arena platforms
  are the only saturated, high-contrast surfaces in the play band; the sky and
  city stay pale, cool and quiet.
- **Keep a clear central line.** The horizon/water line and the platform line
  should read at a glance. Do not put a background edge directly behind a
  platform edge.
- **Sparse, slow, one plan.** Three or four ambient groups maximum (a flock, one
  airship, two boats, water glints). They are all driven by one `ambient` plan
  and one clock, never one clock per element.
- **Stand back from the reference.** The DeepSeek reference is the visual
  language; Smash is the amount. When in doubt, remove an element.

## The single ambient plan

All moving background actors are declared once, in the manifest's `ambient`
object:

```json
"ambient": {
  "loopMs": 90000,
  "groups": [
    {
      "layer": "birds",
      "actors": [
        { "u": 120, "v": 90, "speedX": 12, "bobAmp": 2, "bobFreq": 0.4, "phase": 0 }
      ]
    },
    { "layer": "zeppelin", "actors": [ ... ] },
    { "layer": "boats", "actors": [ ... ] }
  ]
}
```

- `layer` is the id of a `type: "strip"` layer that supplies that group's
  frames, fps and parallax. The actor list supplies positions and paths.
- `loopMs` is the intended loop length. The runtime samples every actor from
  the same elapsed clock; the panorama wrap is the continuous loop. Do not
  force a reset that teleports an actor whose speed does not divide the
  panorama.
- Actor fields: `u`, `v`, `speedX` (texture px/s), `bobAmp` (px), `bobFreq`
  (Hz), `phase` (radians), `flip` (mirror art drawn facing right).
- A waterfall is not an ambient actor: it has no speed and no group.
- If `ambient` is absent, the runtime falls back to the strip's own `items` for
  backward compatibility, but a candidate with moving actors should ship the
  single plan.

## Texture contract

- Every panorama is **1600 x 600 px**, one texture pixel = one world pixel.
  It tiles horizontally. Left and right edges must join without a visible
  seam (compare column 0 with column 1599, and tile it twice to check).
- The sky is opaque. Every other layer is transparent where there is no art.
- No anti-aliasing. Hard pixel edges, a shared limited palette, ordered
  dithering is welcome in gradients. Do not use pure black or pure white.
- Use the palette in `art/skybox/palette.json`.
- The camera is a **side view**, slightly above the horizon. Read it as a
  side-scrolling platformer backdrop, not a first-person sky dome.

## Files

```
public/assets/skybox/<variant>/
  sky.png      1600x600  opaque   parallax 0.015
  far.png      1600x600  alpha    parallax 0.06
  mid.png      1600x600  alpha    parallax 0.18
  falls.png    strip      alpha    parallax 0.30   (animated)
  near.png     1600x600  alpha    parallax 0.50
  contact.png  1600x600  opaque   flattened review image, not loaded by the game
  manifest.json
```

`<variant>` is `voxel` or `hand`.

### Falls strip

- Horizontal strip of **6 frames**, each **48 x 240 px** (288 x 240 total),
  drawn top-to-bottom. Frame 0 is the top of the fall; the strip is placed
  with its top at `v`.
- `fps`: 8-10, looped.
- White/very pale foam at the top, long vertical streaks, a mist puff at the
  bottom. It has to read as water over the `mid` layer, and it must animate
  frame-to-frame without a jump.
- The manifest's `items` must line up with actual aqueduct mouths in `mid.png`.

## manifest.json

```json
{
  "name": "voxel",
  "title": "Solar Voxel",
  "width": 1600,
  "height": 600,
  "layers": [
    {
      "id": "sky",
      "type": "image",
      "src": "assets/skybox/voxel/sky.png",
      "version": "<sha256 first 12>",
      "factor": 0.015,
      "driftX": 0.6,
      "alpha": 1
    },
    { "id": "far", "type": "image", "src": "...", "version": "...", "factor": 0.06 },
    { "id": "mid", "type": "image", "src": "...", "version": "...", "factor": 0.18 },
    {
      "id": "falls",
      "type": "strip",
      "src": "assets/skybox/voxel/falls.png",
      "version": "...",
      "factor": 0.30,
      "align": "mid",
      "frameW": 48,
      "frameH": 240,
      "frames": 6,
      "fps": 9,
      "items": [
        { "u": 240, "v": 250 },
        { "u": 920, "v": 300 }
      ]
    },
    { "id": "near", "type": "image", "src": "...", "version": "...", "factor": 0.50 }
  ]
}
```

- `factor` is the fraction of camera movement the layer follows. 0 = locked to
  the screen, 1 = world speed. The listed values are the intended ones; a small
  adjustment is fine if the composition needs it.
- A strip whose water must stay in its aqueduct names `"align": "mid"`; the
  runtime then follows that layer's factor exactly, whatever `factor` says. A
  waterfall moving at a different rate from its own city peels away from the
  spout as soon as the camera scrolls.
- `driftX` is ambient horizontal texture drift in px/s; use it only for clouds
  or a very slow sky. Do not drift the city.
- `version` is the first 12 hex chars of the file's SHA-256. The runtime appends
  `?v=<version>` so a regenerated asset can never be paired with a stale PNG.
- `haze` is an optional art-direction multiplier on the runtime atmospheric
  scrim (default `1`). A city with more fine detail in the combat band should
  push it to `1.4`-`1.7`; a calm, open composition leaves it at `1`.
- `u`/`v` on a fall item are texture coordinates in the `mid` layer's space.

## Both candidates must include

- A retrofuturistic **solarpunk city**: ivory/cream ceramic towers, domes,
  capsule shapes, brass trim, solar arrays, wind turbines, lush hanging
  gardens, aqueducts and waterfalls.
- An **Akira Toriyama flavour**: rounded, chunky, playful silhouettes; big
  cumulus clouds with a warm rim; a ringed planet or a second moon; tiny
  airships; birds; curved bridges; a sense of adventure rather than realism.
- At least one large, readable **waterfall** that animates.
- A near layer that frames the bottom of the screen without covering the
  fighters' feet.
- A `NOTES.md` in the variant directory describing how to regenerate, the
  palette, and the iteration history.
- A `contact.png` so a human can judge the result without booting the game.
