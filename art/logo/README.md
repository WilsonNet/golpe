# The golpe logo

**Source:** `scripts/make-logo.py` — a 160 x 70 pixel grid, exported at 4x and
8x with nearest-neighbour scaling. Every colour is from
[`art/skybox/palette.json`](../skybox/palette.json), so the wordmark sits in the
same Waterfront world: cream stone, brass sun, teal water, aqueduct gardens.

```bash
.venv/bin/python scripts/make-logo.py
```

| File | Use |
|---|---|
| `src/ui/assets/logo.png` | the root menu's Vite import, content-hashed so Caddy's immutable `/assets/*` rule is safe |
| `public/assets/logo.png` | the README / share asset, 640 x 280 |
| `golpe-solarpunk.png` | the 640 x 280 master |
| `golpe-solarpunk@2x.png` | the 1280 x 560 master |
| `preview-waterfront.png` | the logo over the skybox contact sheet |
| `preview-menu.png` | the logo over the menu's deep-teal gradient |

The lettering is a custom 20-pixel lowercase face rather than a font: `g o l p e`
with a brass sun-ring `o`, a sprout from the `l`, a ringed planet, mDNS-era
aqueduct arches and a lily. No pure black or white; the deepest ink is
`#22213a`, the brightest highlight `#fff8e8`.

The PNG is deliberately small (4.5 KB) and the menu uses `image-rendering:
pixelated`; do not resample it with a smooth filter.
