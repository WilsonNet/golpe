# The golpe badge

**Source:** `scripts/make-logo.py` — a 176 x 86 pixel grid, exported at 4x
(704 x 344) with nearest-neighbour scaling, and displayed at 352px so the menu
is an exact 2x. Every colour is from
[`art/skybox/palette.json`](../skybox/palette.json), so the badge sits in the
same Waterfront world: cream stone, brass sun, teal water, aqueduct gardens.

```bash
.venv/bin/python scripts/make-logo.py
```

## Why it is a badge

The bare wordmark was cream letters whose indigo outline was the same value as
the near-black menu card. The outline vanished into the page, so the thin `l`
disappeared and the counters of `g` and `o` merged with the background behind
them. A sign carries its own plate; the word no longer competes with whatever
it is standing on.

The frame is the city's: an ink keyline, a hazard-tape band on a 4px diagonal
staircase, a brass rail, and four corner brackets with a bolt each. The plate is
enamel, with a dark lip above and a lit edge below.

## Two variants, one geometry

| File | Plate | Hazard | Use |
|---|---|---|---|
| `src/ui/assets/logo.png` | ink | teal | the root menu's Vite import, content-hashed so Caddy's immutable `/assets/*` rule is safe |
| `public/assets/logo.png` | ink | teal | light pages — the README's default |
| `public/assets/logo-cream.png` | cream | gold | dark pages — the README's `prefers-color-scheme: dark` |

The ink plate is the default because it is the one that works on both: on a dark
menu it doesn't out-shout the gold *Quick match* button, and on a white page the
plate is what makes the logo a badge rather than floating text. The cream plate
is the loud one, for a dark page that wants the sign to be the brightest thing
on it — it dissolves into a white page, so it is never used there.

| Master | Size |
|---|---|
| `golpe-badge-ink.png` | 704 x 344 |
| `golpe-badge-cream.png` | 704 x 344 |
| `golpe-badge@2x.png` | 1408 x 688 |
| `preview-menu.png` | the badge over the menu's deep-teal gradient |
| `preview-readme.png` | both variants at README size, on GitHub's two themes |
| `preview-waterfront.png` | the badge over the skybox contact sheet |

The lettering is a custom 20-pixel lowercase face rather than a font: `g o l p e`
with a brass sun-ring `o`, a sprout from the `l`, a ringed planet, mDNS-era
aqueduct arches and a lily. No pure black or white; the deepest ink is
`#22213a`, the brightest highlight `#fff8e8`.

The PNG is deliberately small (6 KB) and the menu uses `image-rendering:
pixelated`; do not resample it with a smooth filter.

`tsx scripts/logo-probe.ts` measures the result: letter-vs-plate contrast, the
plate-vs-page contrast, one connected component per letter, and the thinnest
stroke at the size the menu actually draws.
