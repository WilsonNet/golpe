---
name: ai-art-pipeline
description: "Use when making or remaking game art with AI tools — a new hero's sprites, a new clip for a rendered hero, a reference board, or deciding whether an asset needs 3D at all. The pipeline Anands was built with: Gemini (Nano Banana) boards for the look → Tripo multi-view image-to-3D for the mesh → the live Blender through the Blender MCP for rig, toon look and clips → make-hero-art.py to render and pack, gated against the boards. Covers when 3D is worth it (a 2D game: most assets are not), driving Gemini and Tripo through Claude in Chrome (and their traps: the chat-preview bug, batch vs multi-view, paid exports, separate API billing), the texture-to-toon conversion that made a generated mesh read like Lia, the rig-from-T-pose trick, and the measurements that gate each step. Triggers on: Gemini, Nano Banana, sprite board, reference board, Tripo, image to 3D, multi-view, Hunyuan, Rodin, 3DAI Studio, Blender MCP, generate a model, new hero art, remake art, T-pose, rig a generated mesh, toon look, anands_look, anands_rig, anands_clips."
license: MIT
---

# The AI art pipeline

How Anands went from Gemini pixel-art boards to a rendered, rigged, toon-shaded
sprite sheet in one session (2026-09-26). The full log — every route tried,
every number — is [`docs/anands-art.md`](../../../docs/anands-art.md); the
Blender side is documented in [`art/README.md`](../../../art/README.md).

## First: does this asset need 3D at all?

This is a **2D game**. 3D earns its cost only for something that must be seen
in **many poses and angles from one consistent design** — a fighter with 35
clips, both facings and nine aim bands. Everything else is drawn or generated
flat:

| Asset | Route |
|---|---|
| A hero (walk, attacks, hits, aim bands) | **3D**: this whole pipeline |
| A new clip for a hero who is already rigged | pose it in Blender (`anands_clips.py`-style) — no new generation |
| An ultimate's screen-filling effect (the dragon ride) | a **board**, cut flat (`make-anands-art.py`) |
| Props, pickups, effects, UI, portraits-as-art | a board or code-drawn (`render/`), never 3D |
| A one-off illustration (menu, ceremony) | a board or `make-potg-art.py`-style generation |

When in doubt, ask whether the thing will ever be drawn from a second angle or
in a second pose. No → flat.

## The pipeline

```
Gemini boards (the look)          unprocessed-sprites/<hero>-*.jpeg
   │  cut clean (flood fill, not colour keying) → art/<hero>/reference/*.png
   │  de-pixelate (blur ~1 board pixel, unsharp) → *-smooth.png   ← generator input
   ▼
Tripo multi-view (the mesh)       art/<hero>/generated/<hero>-tripo-*.glb
   ▼  Blender MCP, live Blender, art/<hero>/<hero>.blend
merge UV-seam splits → rig (shared bone names, her joints; T-pose → arms-down rest)
   → toon look (texture → colour families → LiaToon + ink hull + smoothed normals)
   → weapons + clips (shared poses adapted to her reach, her own moves from the boards)
   ▼
scripts/make-hero-art.py <hero>   public/assets/<hero>.{png,json}, <hero>-portrait.png
   ▼
gates: scale contract · heroAtlas.test.ts · art-probe --hero=<hero> · diagnose --mode=online
```

## 1. Boards — Gemini ("Nano Banana")

- **One conversation per character.** Every new board is asked for *in the
  same chat* that made the originals, naming the earlier sheet ("the exact same
  girl from the 'Idle & Walking Actions' sheet you made earlier"), with the
  palette spelled out part by part. The board prompt template and the history
  of what worked are in `docs/anands-art.md` ("Board prompts").
- **Always give the layout.** Beige panels, pale-gold grid, row labels in the
  left column, side view like a 2D platformer, face turned to the viewer. Left
  unstated, the model drifts (a top-down sheet; a dark 16-direction sheet with
  tiny figures).
- **For a 3D generation, ask for a turnaround on white**: T-pose, front / left
  / back / right in one row, no grid, no labels, as large as possible. That
  board is the best generator input there is (`anands-tpose.jpeg`).
- **The chat preview is buggy** — an image can show as an empty box. It is
  there: scroll to it and use the response's **"Download full size image"**
  button (find it by `aria-label` from `javascript_tool`).
- Reaction/pose boards are useful as *pose references* even when off-model.

## 2. Cut the boards cleanly

`scripts/make-anands-art.py` is the reference: **flood the board away from the
crop's edge** under a tight tolerance so her outline stops the fill (keying the
board's colour anywhere deleted 21% of her silhouette — skin and shirt sit near
the beige); strip grid lines only as runs walking in from the edge; enclosed
pockets are board only if light; `--legacy` measures holes / debris / colours.

## 3. The mesh — Tripo Studio, multi-view

Driven through **Claude in Chrome** (`studio.tripo3d.ai`, the user's Starter
plan — the UI may be in Portuguese).

- **Multi-view is the second (cube) input icon**: slots *Frente / Esquerda /
  Direita / Verso*. Left = the view facing screen-left, Right = facing
  screen-right. **The third icon is batch** ("Imagens em lote"): one *paid*
  generation per image — never use it for a turnaround.
- Settings that matter: H3.1 max quality, **Quad topology, ~30k faces** (the
  default 2,000,000 triangles is useless for a sprite), 4K texture, "remove
  lighting" on. That run costs **60 credits**; confirm before spending.
- **Feed de-pixelated images.** Pixel-art input comes back as voxel-staircase
  geometry (seen on Hunyuan3D-2.1); a transparent input came back as an empty
  pole. White background, square, same scale for every view.
- Export **GLB** (textures embedded). Auto-rig exists (20 credits, Mixamo
  skeleton) but our rig is the shared one — rig it ourselves.
- **The Tripo API is billed separately** from the Studio subscription
  (pay-as-you-go, 100 credits = $1). Stay in the web app unless the user says
  otherwise.
- Tried and rejected: 3DAI Studio (every export is paywalled — never pull a
  model out of a web viewer to get around it); Hunyuan3D-2.1's free Space
  (usable, rough); the Blender MCP's Rodin/Hunyuan need the user's own keys —
  **never type API keys for the user**.

## 4. Blender through the MCP

`claude mcp add blender -- ~/.local/bin/uvx mcp-for-blender` (ahujasid's
blender-mcp; addon enabled in Blender's prefs, "Connect" in the N panel;
Claude Code must restart to see the tools). `execute_blender_code` runs in the
live GUI — **save the .blend before every render**: `make-hero-art.py` renders
the file on disk, and forgetting cost two renders of stale work.

The modules, all `scripts/blender/anands_*.py`, are templates for the next hero:

- **Import** (see `anands_rig.py` notes): bake the GLB's transforms, scale to
  3 m, turn to face +X, and **merge by distance (0.0005)** — the importer
  splits vertices on every UV seam (1035 islands) and heat weighting fails on
  them.
- **Rig** — `anands_rig.rig(tpose=True)`: `sprite_rig.build_armature` with *the
  shared bone names* at *her* joints (measured from the mesh's cross-sections),
  heat weights, then fixes: above the neck is the head's (but not the T-pose
  arms), the torso core never follows an arm, `heal_weightless` for vertices
  whose weights sum to ~0 (they stretched a strand out of her knocked-down
  poses). With a T-pose mesh, `drop_arms` poses the arms down, bakes it, and
  applies it as the rest pose — clean weights *and* the shared poses work
  (mute the hand IK during the bake).
- **Look** — `anands_look.apply()`, what made her read like Lia: every texel
  classified into her **colour families** (lit / shade / highlight from the
  boards), a **majority vote** in texture space (never a blur — averaging green
  and orange makes brown), families disambiguated by bone (hair vs boot purple,
  trousers vs leather brown, eyes vs lens teal), `LiaToon` per family, the ink
  hull, and **smoothed normals** transferred from a hidden smoothed copy so the
  shade band follows broad forms instead of every generated bump.
- **Clips** — `anands_clips.build()`: the render scene, weapons (by name:
  `Dagger`, `DaggerL`, `Gun` — `hero_render.PROPS` shows/hides them), the
  shared clips **adapted to her reach** (`adapt()`: a grip is moved from Lia's
  shoulder space into hers, or the steel floats off a chibi fist), and her own
  moves posed from the boards' key frames. A presentation-only clip (the item
  `throw`) needs a `ClipName`, a `POSE_BY_CLIP` entry and a trigger in the
  animation system — gate it on `ownClip` so other heroes are unaffected.

## 5. Render, pack, gate

`python3 scripts/make-hero-art.py <hero>`. With an `art/<hero>/palette.json`,
`board_look` snaps every frame to the boards' palette (and, for an *unlit
textured* render only, lifts saturation and inks inner edges — flags `lift` /
`inner_ink`; a toon render sets both false).

Every step is measured, never eyeballed alone:

| Gate | Tool |
|---|---|
| Silhouette vs the boards (front/side/back IoU) | `anands_model.compare()` + `scripts/anands-compare.py` |
| Feet on the floor line, figure ≈ 96 px (refuses to ship otherwise) | `make-hero-art.py` scale contract — `lowest_point` measures the *evaluated* mesh, so skinned bodies work |
| Every clip the game picks exists, per melee weapon | `pnpm exec vitest run src/game/render/heroAtlas.test.ts` |
| Drawn in a live match, zero fallbacks, gun tracks the aim | `tsx scripts/art-probe.ts --hero=<hero>` |
| Nothing else broke | `pnpm run verify`, `tsx scripts/diagnose.ts --mode=online --hero=<hero>`, `tsx scripts/movelist-probe.ts` |
| Looks right next to the others | a contact sheet of her frames beside Lia's at the same scale — show the user |

## Wiring a new rendered hero into the game

`HEROES` in `make-hero-art.py`, `PACKED_SHEETS` in `render/assets.ts`, the
hero's `sheet` in `simulation/Heroes.ts`, `RENDERED_HEROES` + `MELEE` in
`heroAtlas.test.ts`, the melee group in `art-probe.ts`, the portrait CSS
(`HeroSelect.tsx`, `ultimateStyles.ts`). `sheetDrawsBlade` is true for a sheet
with a `slash` or `stab` clip, so `MeleeFx` draws only the trail.
