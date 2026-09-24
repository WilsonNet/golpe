# Hero art — edit in Blender, render to sprites

`art/<hero>/<hero>.blend` **is that hero's art** — Lia's and Jeffs' today.
Every sprite they draw in-game, and their portraits on the menus and the
ultimate card, are rendered from these files. Open one, change anything,
save, run one command:

```bash
blender art/lia/lia.blend               # edit, then Ctrl+S   (or art/jeffs/jeffs.blend)
python3 scripts/make-hero-art.py lia    # render + pack → public/assets/lia.{png,json}, lia-portrait.png
```

| Hero | Source | Look module | Notes |
|---|---|---|---|
| Lia | `art/lia/lia.blend` | `scripts/blender/lia_build.py` | Toriyama chibi swordswoman: teal ponytail, circlet, crimson tunic, sword and rifle |
| Jeffs | `art/jeffs/jeffs.blend` | `scripts/blender/jeffs_build.py` | the executioner: grey-templed slick hair, stubble, trench coat with tails, sword and pump shotgun |
| Anands | hand-drawn boards (`unprocessed-sprites/`) | `scripts/make-anands-art.py` | **not rendered, on purpose** — her boards are the reference this whole look chases; a move to Blender must keep her soul, and there is no plan yet that does |

Every hero shares one skeleton, shader, camera and set of clip poses
(`scripts/blender/sprite_rig.py`); a hero's build module is only their
palette and their model.

Vite hot-reloads the PNG; refresh the page. Blender 4.4+ is required (5.2
tested — the scripts use slotted actions) and Python 3 with Pillow.

## The look, and where it comes from

The target is Toriyama by way of the SNES — Chrono Trigger, Dragon Quest III
and its HD-2D remake: chibi proportions (~2.6 heads), big dark eyes with one
hard shine, spiky clumped hair, heavy ink outlines, flat two-tone shading
with hue-shifted shadows. The technique is the Dead Cells pipeline: a real
3D model, toon-lit, rendered *small* with no anti-aliasing so every pixel is
a flat colour.

| What | Where in the .blend |
|---|---|
| Flat SNES shading | node group **LiaToon** — every material is one group node with *Lit*, *Shade*, *Highlight* colours. It lights a **camera-space normal flattened toward the viewer** (`Flatten`), so each shape is one flat fill with a shade band only along the edge facing away from the light — pixel-art shading, not form shading. `Flatten` up = flatter, `Shade Below` up = more shade; only hair, steel, gold and the gem get a highlight. The light direction is `LIGHT_CAM` in the build script (upper-left, frontal). |
| Ink lines | each part's **Outline** modifier (Solidify, flipped normals, `outline` material with back-face culling) — the inverted hull, for lines between overlapping parts. `make-hero-art.py` adds the silhouette line as a *selective outline* (ink tinted by the colour it borders) and removes single stray pixels. |
| The camera | **SpriteCam**, orthographic, 32 px per metre, **no tilt** — a flat front elevation like a drawn sprite. Don't move it: its centre is the collider's centre. (The **Key** sun is unused by the shader.) |
| Flat poses | limbs and swings stay in the picture plane: `SWING_DEPTH_DEG` keeps a blade's travel through the screen small, and every pose turns the head `HEAD_TO_VIEWER_DEG` toward the camera — body side-on, face to the viewer, the SNES convention. The reference is Anands' hand-drawn boards (`unprocessed-sprites/`). |

## Rules the game depends on

1. **Units: 1 m = 32 sprite px.** The fighter's collider is the *body box*:
   2 m × 3 m, feet at z = 0, centre at (0, 0, 1.5). A hero stands about 3 m
   tall (Lia exactly, Jeffs a little under). The game draws them at
   `PLAYER_HEIGHT / bodyH` — the body box, **never** the cell — so a longer
   sword or a raised blade grows the sprite's cell and never resizes them. `make-hero-art.py` measures
   this on every run (feet on the floor line, figure ≈ 96 px) and refuses to
   ship a render that broke it.
2. **The hero faces +X** inside the rig; the armature object is yawed −20°
   toward the camera, and the head a further −22°. Left-facing clips are mirrors made by
   the packer — never animate a left version.
3. **Every clip is an Action named `clip.<something>`**, and **every keyed
   frame is one sprite frame** (keys are 4 frames apart and constant
   interpolation — pose-to-pose). Its custom properties (Action editor → N
   panel → *Custom Properties*) tell the game what it is:

   | Property | Meaning |
   |---|---|
   | `lia_right` / `lia_left` | the game's clip names (`slash` / `slash-left`); must be `ClipName`s in `src/game/ecs/systems.ts` |
   | `lia_fps`, `lia_loop` | playback for clock-driven clips |
   | `lia_drive` | `"move"` = the frame is chosen by progress through the melee move, so the blade is where the hitbox is. Samples are evenly spaced over the move's whole duration (`lia_ms`) |
   | `lia_drive` = `"aim"`, `lia_bands` | an aim-banded clip (the gun): keys are laid out band-major — `lia_bands` equal runs, one per elevation from straight up to straight down — and the game picks the run from where the fighter aims. Keep every run the same length |
   | `lia_props` | `sword` (sword in hand), `rifle` (the gun in hands, sword on back), `none` (sword on back) |
   | `lia_ground` | the build planted the lowest sole on the floor for these poses; keep it there when you edit (the measurement will tell you) |

   `clip.portrait` is the menu/card hero shot, rendered at 4× density. (The
   properties keep their `lia_` prefix for every hero: it is the pipeline's
   namespace, where it started, not the character.)
4. **The weapon drives the hands.** The `weapon` bone holds the sword and the
   gun (named `Rifle`, `Shotgun` or `Gun`) (the right hand reaches its grip by IK). The off hand reaches
   `hand_ik.L` when `forearm.L`'s IK influence is keyed to 1 (two-handed
   swings, the rifle's fore-grip). To re-aim a swing, rotate the `weapon`
   bone; the arm follows. The swings were built from the game's own arc table
   (`SWING` in `src/game/render/MeleeFx.ts`), so the steel matches the trail.

## Common edits

- **Recolour** — select a part, Material tab, change *Lit* / *Shade* /
  *Highlight* on the LiaToon node. Keep shades hue-shifted (toward purple or
  red), not darker grey.
- **Reshape** — every part is its own mesh (`Head`, `Face`, `Hair`, `Torso`,
  `Skirt`, `Cape`, arms, legs, boots/shoes, `Sword`, the gun), parented to
  its bone. Edit Mode away; the Outline modifier follows.
- **Retime or repose a clip** — pick the action in the Action Editor, Pose
  Mode, change a key, `I` to re-key. Add a key 4 frames after the last to add
  a sprite frame; the game reads the new count from `<hero>.json`.
- **A new clip** — duplicate an action, rename it `clip.<name>`, set
  `lia_right`/`lia_left` to clip names the animation system knows. A brand new
  state also needs a line in `animationSystem`.

## Checking your work

```bash
python3 scripts/make-hero-art.py jeffs        # prints the scale measurement; fails if feet/height drift
pnpm exec vitest run src/game/render/heroAtlas.test.ts  # every rendered hero's atlas contract
tsx scripts/art-probe.ts --hero=jeffs         # in a live match: every clip drawn, zero fallbacks, the gun tracks the aim
```

## Starting over

`scripts/blender/<hero>_build.py` generated the first version of each file
procedurally (model, rig, materials, every clip). It refuses to overwrite
the .blend unless told to:

```bash
blender -b --factory-startup -P scripts/blender/jeffs_build.py -- --force   # DISCARDS every hand edit
```

**A new hero** is a new `<hero>_build.py` (copy Jeffs', change the palette
and the model), one line in `make-hero-art.py`'s `HEROES`, one in
`PACKED_SHEETS` (`render/assets.ts`) and the hero's `sheet` in
`simulation/Heroes.ts`.

Use it only to start over — the .blend, not the script, is the source of
truth once anyone has touched it.

**Scripting trap (Blender 4.4+):** actions are *slotted*. `action.fcurves` no
longer exists — keys live in `action.layers[].strips[].channelbags[].fcurves` —
and switching the rig's action also needs `animation_data.action_slot =
action.slots[0]`, or it plays nothing. Both scripts already do this.
