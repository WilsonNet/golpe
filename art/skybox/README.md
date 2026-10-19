# Skybox art

Two ways to make the same asset. The contract is
[`scripts/skybox/CONTRACT.md`](../scripts/skybox/CONTRACT.md); the palette is
[`palette.json`](palette.json); the runtime decision and measurements are in
[`specs/skybox.md`](../specs/skybox.md).

## Candidates

- **`public/assets/skybox/voxel/`** — `scripts/skybox/voxel/generate.mjs`,
  Three.js. Tens of thousands of instanced voxels, rendered headless through
  Playwright at 800x300, nearest-upscaled 2x and snapped to the shared palette.
  `node scripts/skybox/voxel/generate.mjs`.
- **`public/assets/skybox/hand/`** — `scripts/skybox/hand/generate.py`, Pillow
  and numpy. Hand-authored pixel art with wrap-aware primitives and dithered
  skies. `.venv/bin/python scripts/skybox/hand/generate.py`
  (set it up with `uv venv .venv && uv pip install --python .venv/bin/python pillow numpy`).

Both write a `manifest.json` with a content hash per PNG, a `contact.png` (the
flattened review image) and a `NOTES.md`. The game loads the manifest under
`?sky=voxel|hand`; the hash is what keeps a regenerated layer from being paired
with a cached old one.

## The shape

`sky`, `far`, `mid`, `falls`, `near` — 1600x600, seamless horizontally, with
the falls strip (6 frames of 48x240) pinned to the aqueduct mouths at the same
parallax as `mid`. The first 800 px of each panorama is the single-screen hero
crop; the middle band stays quiet because the gameplay platforms cross it.

## Checking a render

```bash
tsx scripts/sky-probe.ts     # loads both candidates, animates, measures parallax
```

The probe writes `.playwright-mcp/skybox/*-1-screen.png` and
`*-3-screens.png`. Open those beside the `contact.png`; a skyline that reads
well flattened can still disappear behind the platforms.

The **fighter-vs-background** side is separate: `tsx scripts/readability-probe.ts`
renders the same frame with and without fighter sprites, measures value
contrast, silhouette contrast/coverage and local background detail, and gates
both candidates against the old flat-sky control. The principles and the
sources are in [`specs/skybox.md`](../specs/skybox.md#readability-contract).
If the art changes, run both probes: one proves the depth, the other proves the
body is still readable over it.
