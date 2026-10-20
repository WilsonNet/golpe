# Solarpunk Stage — a quiet Smash-style set

`?sky=stage` — the default. This is not a city illustration. It is a stage
background built around one rule from Smash Bros.: the fighter must be easy to
identify, so the background stays muted, large and sparse while the standable
surfaces keep the contrast.

## Regenerate

```bash
.venv/bin/python scripts/skybox/stage/generate.py
```

The generator writes every PNG, the manifest with SHA-256 versions, the raw
contact and the 3-screen preview into `public/assets/skybox/stage/`, and review
images into `scripts/skybox/stage/review/` (gitignored).

## The composition

Hero crop is x 0–800; the calm variation continues to 1600.

| Layer | Content |
|---|---|
| `sky` | golden-hour gradient, three large cumulus banks, ringed planet, low sun |
| `far` | one low hazy waterfront, mostly read through the arches |
| `mid` | broad conservatory half-dome → long aqueduct terrace with two waterfalls → giant tree and treehouse → low garden blocks with a turbine and windmill |
| `falls` | six 48x240 frames, pinned to the two aqueduct mouths with `align: "mid"` |
| `near` | bright canal at y=500, stone quay, pier, reeds, reflections, three mallards |

No onion domes, pointed spires, finials or minarets. Domes are broad half-spheres
wider than they are tall. Buildings are horizontal blocks and terraces.

## The ambient plan

All moving actors are in the manifest's single `ambient` object, driven by one
clock (`loopMs` is the intended programme length; the panorama wrap is the
continuous loop):

| Group | Frames | Actors | Motion |
|---|---|---|---|
| `birds` | 4 × 12×8 | 6 | speedX 16, bob 1.6–2.4, phases spread |
| `zeppelin` | 2 × 64×28 | 1 | speedX 8, slow bob |
| `boats` | 4 × 32×14 | 2 | speedX ±4, bob |
| `water` | 4 × 32×8 | 6 | frame-animated glints, no translation |

The sky image has no static birds or airships; the movers are the only flying
things. The runtime samples all four groups from the same elapsed clock.

## Readability hand-off

- `haze: 1.15` — pale screen grade through the combat band.
- `near.alpha: 0.5` — the canal and quay are bright, so the near layer can carry
  more than the old dark-foliage layer; the readability probe is the judge.
- The actors layer gets the 1px ink outline in the runtime; no outline is baked
  into the background.

Measured by `tsx scripts/readability-probe.ts` against the flat-sky control:
value separation ΔL* ~44, core silhouette ΔE ~71, outline coverage ~97–99%,
luminance ratio ~2.9–3.0. This is the first candidate to clear the 3:1
large-element contrast figure while still matching the old sky on silhouette.

## Verification

- All panoramas 1600×600; falls 288×240; movers and contact dimensions match.
- Full-palette audit, binary alpha, SHA-256 manifest versions.
- Seam metrics compare the wrap pair against normal adjacent columns.
- `tsx scripts/sky-probe.ts` checks layers, falls, the ambient plan, mover
  advance and parallax; `tsx scripts/readability-probe.ts` checks the fight
  read.

## Remaining weaknesses

- The conservatory is a simple broad glazed half-dome, not a fully resolved
  Victorian frame.
- The two waterfalls reuse one strip.
- The far waterfront is intentionally soft; it exists to support the arches,
  not to be read as a second city.
