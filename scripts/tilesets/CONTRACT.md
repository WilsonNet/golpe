# Waterfront platform tileset

This is the art contract for the arena's standable surfaces. The game's
collision stays the existing AABBs; this tileset only changes what the player
sees. The matching `Flat` style keeps the original monochrome green blocks for
competitive play.

## Style

A dark, mossy **stone quay** matching the hand-painted Waterfront:
- top: moss/grass fringe, a cream stone lip, a thin brass trim;
- face: deep green/teal stone blocks with mortar, cracks, moss and occasional
  small flowers;
- bottom: an indigo shadow with a moss drip;
- side caps: a darker outline and a brass corner stud.
- **Saturated enough to read as the standable surface**, darker than the pale
  city behind it. The current flat platforms are dark green; keep that value
  relationship.
- Palette-only from `art/skybox/palette.json`, no anti-aliasing, hard pixels.
- 8x8 tiles. They must tile seamlessly in a 3x3 test.

## Outputs

```
public/assets/tilesets/waterfront-platforms.png     64x24  (8x3 8px tiles)
public/assets/tilesets/waterfront-props.png         64x48  (prop atlas)
public/assets/tilesets/waterfront-platforms.json    frames + prop frames + SHA-256 versions
public/assets/tilesets/waterfront-preview.png       320x80  a representative ledge + ground sample
scripts/tilesets/generate.py                        generator, .venv/bin/python
scripts/tilesets/NOTES.md
```

### Platform tiles (8x8, atlas 8 columns x 3 rows)

Use these **names** in the JSON. The renderer selects them as a 9-slice with
variants; every name must exist and be exactly 8x8.

Row 0 (top surface):
- `topLeft` — moss/stone corner cap, left edge.
- `topA` — top surface, moss/grass variant.
- `topB` — top surface, flowers/brass variant.
- `topRight` — right corner cap.
- `topMoss` — extra mossy top variant.
- `topStone` — plainer stone top variant.

Row 1 (face):
- `midLeft` — left edge.
- `fillA`, `fillB`, `fillC` — three stone-block variants.
- `midRight` — right edge.
- `fillMoss` — a heavily mossed fill.
- `fillCrack` — cracked fill.
- `fillTrim` — a brass band / pipe detail.

Row 2 (bottom):
- `bottomLeft` — bottom-left corner, dark under-edge.
- `bottomA`, `bottomB` — underside variants.
- `bottomRight` — bottom-right corner.
- `bottomMoss` — moss drip.
- `bottomShadow` — deep shadow/void.
- `bottomTrim` — brass underside detail.

### Props atlas (64x48)

Named frames in the JSON, any size:
- `vine` (8x24) — hanging green vine, top at y=0.
- `vineFlower` (8x24) — vine with small pink flowers.
- `planter` (24x12) — cream stone planter with plants; base at its bottom.
- `lantern` (8x16) — brass lamp post with a warm light; base at bottom.
- `crate` (16x16) — wooden crate; base at bottom.
- `barrel` (14x16) — wooden barrel; base at bottom.
- `flowerBox` (16x8) — low planter box; base at bottom.

Only the lives/props the map spec places are drawn. The current map uses vines
hanging under some ledge edges; the rest are for the future map maker.

## Tileset JSON

```json
{
  "name": "waterfront-platforms",
  "image": "assets/tilesets/waterfront-platforms.png",
  "version": "<sha256 first 12>",
  "tileWidth": 8,
  "tileHeight": 8,
  "tiles": {
    "topLeft": [0, 0, 8, 8],
    "topA": [8, 0, 8, 8],
    "...": [0, 0, 0, 0]
  },
  "props": {
    "image": "assets/tilesets/waterfront-props.png",
    "version": "<sha256 first 12>",
    "frames": {
      "vine": [0, 0, 8, 24],
      "vineFlower": [8, 0, 8, 24],
      "planter": [16, 0, 24, 12],
      "lantern": [40, 0, 8, 16],
      "crate": [48, 0, 16, 16],
      "barrel": [0, 24, 14, 16],
      "flowerBox": [16, 24, 16, 8]
    }
  }
}
```

- Every frame is `[x, y, w, h]`.
- `version` is the SHA-256 first 12 of the referenced PNG.

## Preview

`waterfront-preview.png` 320x80: a 256x32 ledge assembled from the tiles plus a
64px ground sample and a vine/planter, on the Waterfront's sky color. This is
the Art card in Graphics; it must show the platform at 2x scale (source 160x40
upscaled 2x) or crisp 1x with clear shapes. No text.

## Gates

- Exact dimensions; every named frame exists and is exact.
- Full-pixel palette audit; alpha only 0/255.
- A 3x3 tiling test: `topA`/`fillA`/`bottomA` and the cap variants join with no
  seams or misaligned pixels.
- Preview inspected at 1x and 2x.
- NOTES.md: generator command, palette, composition, iteration log.
- Only edit `scripts/tilesets/**` and `public/assets/tilesets/**`.
