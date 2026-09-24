# Lia's art — edit in Blender, render to sprites

`lia.blend` **is Lia's art.** Every sprite she draws in-game, her portrait on
the menus and the ultimate card, is rendered from this file. Open it, change
anything, save, run one command:

```bash
blender art/lia/lia.blend               # edit, then Ctrl+S
python3 scripts/make-lia-art.py         # render + pack → public/assets/lia.{png,json}, lia-portrait.png
```

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
| Flat banded shading | node group **LiaToon** — every material is one group node with *Lit*, *Shade*, *Highlight* colours and the two band thresholds. Recolour a part by changing its material's group inputs; change the banding for everyone by editing the group. |
| Ink lines | each part's **Outline** modifier (Solidify, flipped normals, `outline` material with back-face culling) — the inverted hull. `make-lia-art.py` adds a 1px silhouette line on top. |
| The light | the **Key** sun, upper-left-front (the SNES convention). No shadows — self-shadowing turns to noise at this size. |
| The camera | **SpriteCam**, orthographic, 32 px per metre, tilted 10° down. Don't move it: its centre is the collider's centre. |

## Rules the game depends on

1. **Units: 1 m = 32 sprite px.** The fighter's collider is the *body box*:
   2 m × 3 m, feet at z = 0, centre at (0, 0, 1.5). She stands exactly 3 m
   tall (hair tip to sole). The game draws her at `PLAYER_HEIGHT / bodyH` —
   the body box, **never** the cell — so a longer sword or a raised blade
   grows the sprite's cell and never resizes her. `make-lia-art.py` measures
   this on every run (feet on the floor line, figure ≈ 96 px) and refuses to
   ship a render that broke it.
2. **She faces +X** inside the rig; the rig object (**LiaRig**) is yawed −25°
   toward the camera for the 3/4 view. Left-facing clips are mirrors made by
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
   | `lia_props` | `sword` (sword in hand), `rifle` (rifle in hands, sword on back), `none` (sword on back) |
   | `lia_ground` | the build planted the lowest sole on the floor for these poses; keep it there when you edit (the measurement will tell you) |

   `clip.portrait` is the menu/card hero shot, rendered at 4× density.
4. **The weapon drives the hands.** The `weapon` bone holds the sword and the
   rifle (the right hand reaches its grip by IK). The off hand reaches
   `hand_ik.L` when `forearm.L`'s IK influence is keyed to 1 (two-handed
   swings, the rifle's fore-grip). To re-aim a swing, rotate the `weapon`
   bone; the arm follows. The swings were built from the game's own arc table
   (`SWING` in `src/game/render/MeleeFx.ts`), so the steel matches the trail.

## Common edits

- **Recolour** — select a part, Material tab, change *Lit* / *Shade* /
  *Highlight* on the LiaToon node. Keep shades hue-shifted (toward purple or
  red), not darker grey.
- **Reshape** — every part is its own mesh (`Head`, `Face`, `Hair`,
  `Ponytail`, `Torso`, `Skirt`, `Cape`, arms, legs, boots, `Sword`, `Rifle`),
  parented to its bone. Edit Mode away; the Outline modifier follows.
- **Retime or repose a clip** — pick the action in the Action Editor, Pose
  Mode, change a key, `I` to re-key. Add a key 4 frames after the last to add
  a sprite frame; the game reads the new count from `lia.json`.
- **A new clip** — duplicate an action, rename it `clip.<name>`, set
  `lia_right`/`lia_left` to clip names the animation system knows. A brand new
  state also needs a line in `animationSystem`.

## Checking your work

```bash
python3 scripts/make-lia-art.py               # prints the scale measurement; fails if feet/height drift
pnpm exec vitest run src/game/render/liaAtlas.test.ts   # the shipped atlas contract
tsx scripts/art-probe.ts                      # in a live match: every clip drawn, zero placeholder fallbacks
```

## Starting over

`scripts/blender/lia_build.py` generated the first version of this file
procedurally (model, rig, materials, every clip). It refuses to overwrite
the .blend unless told to:

```bash
blender -b --factory-startup -P scripts/blender/lia_build.py -- --force   # DISCARDS every hand edit
```

Use it only to start over — the .blend, not the script, is the source of
truth once anyone has touched it.

**Scripting trap (Blender 4.4+):** actions are *slotted*. `action.fcurves` no
longer exists — keys live in `action.layers[].strips[].channelbags[].fcurves` —
and switching the rig's action also needs `animation_data.action_slot =
action.slots[0]`, or it plays nothing. Both scripts already do this.
