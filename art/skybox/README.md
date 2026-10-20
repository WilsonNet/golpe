# Skybox art

The contract is [`scripts/skybox/CONTRACT.md`](../scripts/skybox/CONTRACT.md);
the palette is [`palette.json`](palette.json); the runtime decision and
measurements are in [`specs/skybox.md`](../specs/skybox.md).

## The style

- **`public/assets/skybox/hand/`** — `scripts/skybox/hand/generate.py`, Pillow
  and numpy. **The house style**: the hand-painted solarpunk waterfront with
  canal, quay, aqueduct, tree, low conservatory, people, birds, airship and
  boats.
  `.venv/bin/python scripts/skybox/hand/generate.py`
  (set it up with `uv venv .venv && uv pip install --python .venv/bin/python pillow numpy`).
  This is the only shipped background.

The generator writes a `manifest.json` with a content hash per PNG, a
`contact.png` (the flattened review image) and a `NOTES.md`. The game loads the
manifest under `?sky=hand|off`; the hash is what keeps a regenerated layer from
being paired with a cached old one.

## The shape

`sky`, `far`, `mid`, `falls`, `near` — 1600x600, seamless horizontally, with
the falls strip (6 frames of 48x240) pinned to the aqueduct mouths at the same
parallax as `mid`. The first 800 px is the single-screen hero crop; the middle
band stays quiet because the gameplay platforms cross it.

People are split into two plans:

- **`loops`** — fixed quayside vignettes that cycle in place: cheering, picnic,
  date, spar, sport. One clock.
- **`ambient`** — the moving layer: walkers, birds, zeppelin and boats. One
  elapsed clock; the panorama wrap is the continuous loop.

## Checking a render

```bash
tsx scripts/sky-probe.ts     # loads the Waterfront, animates, measures parallax, movers and loops
```

The probe writes `.playwright-mcp/skybox/*-1-screen.png` and
`*-3-screens.png`. Open those beside the `contact.png`; a stage that reads
well flattened can still disappear behind the platforms.

The **fighter-vs-background** side is separate: `tsx scripts/readability-probe.ts`
renders the same frame with and without fighter sprites, measures value
contrast, silhouette contrast/coverage and local background detail, and gates
the Waterfront against the old flat-sky control. The principles and the
sources are in [`specs/skybox.md`](../specs/skybox.md#readability-contract).
If the art changes, run both probes: one proves the depth and the inhabitants,
the other proves the body is still readable over it.
