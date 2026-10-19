# Voxel generator — engineering notes

The asset-facing description, final counts and verification table live in
`public/assets/skybox/voxel/NOTES.md`. This file is the map of the code.

## Files

- `generate.mjs` — bundles the scene, boots headless Chromium, writes PNGs,
  hashes them, writes `manifest.json` and `build-stats.json`, and deletes its
  build directory.
- `layout.js` — palette import, deterministic hash noise, `Builder`, the single
  shared layout, and every drawing routine (clouds, planet, towers, trees,
  aqueducts, bridge, waterwheel, near foliage).
- `scene.js` — Three.js renderer, orthographic pitched camera, four
  `InstancedMesh` objects, sky gradient, palette quantiser, falls strip,
  contact composite, seam-check composite and seam metrics.
- `build-stats.json` — generated counts, seam metrics and content hashes.
- `seam-check.png` — generated debug view: the four layers cropped across
  x=1400..1800 so the wrap seam sits at the centre of each quadrant.

## Render model

- Design coordinates are final pixels: 1600 x 600, y down. World conversion is
  `X = x - 800`, `Y = 300 - (y - z * tan(8°))`, `Z = z`. The z shear keeps a
  cube's centre on its design y after the camera pitch, so layer composition
  and the falls item coordinates stay exact.
- Camera: `OrthographicCamera`, width 1600, vertical extent
  `600 * cos(8°)`, at `(0, 1400 tan 8°, 1400)`, `rotation.x = -8°`; no yaw,
  so horizontal tiling is exact.
- A single `BoxGeometry` has per-face brightness in a vertex colour attribute.
  Each `InstancedMesh` carries palette instance colours; the shader multiplies
  the two. `THREE.ColorManagement` is off and output is Linear-sRGB so the
  palette bytes stay predictable until quantisation.
- Render size is 800x300, pixel ratio 1, antialias false, transparent clear.
  Sky is composited over the dithered 2D gradient, then quantised. Every layer
  is upscaled 2x with `imageSmoothingEnabled = false`.
- Quantisation: weighted nearest RGB with a cache, alpha threshold at 128
  (binary alpha). The canvas encoder stores RGB 0 in fully transparent pixels,
  so "no pure black" is asserted over opaque pixels; nothing visible is black.
  Sky and contact force alpha 255.

## Why a layout and a renderer are separate

`buildLayout()` returns plain data for `sky`, `far`, `mid` and `near`.
`buildLayer(name, layout)` turns one slice into `{ items, original,
duplicates }`. The four instanced meshes are built once from that result. This
is what keeps a fall mouth, the aqueduct spout and the aqueduct geometry
sharing the same coordinates: `FALLS` is exported and used by both the layout
and the manifest.

## Tiling

`Builder.finish()` duplicates any instance whose x extent crosses 0 or 1600 at
x±1600. Because the camera has no yaw, that is sufficient for the panorama to
tile. The numerical check (`seamMetrics`) compares the 1599→0 boundary with all
other adjacent-column boundaries; a seam that cut a silhouette would be a
percentile outlier. The last build's numbers are in `build-stats.json`.

## Falls loop

`fallsFrame(frame)` draws 24x120 with a 96 px scroll period, phase 16 px per
frame. Every frame-dependent term uses either `yLoop` or `frameAngle =
frame/6 * 2π`, so frame 5 → 0 is the same 16 px step as the others. The strip
is assembled at 48x240 per frame via nearest 2x. Measured consecutive mean
diffs on the last build: 65.03, 65.13, 65.11, 61.79, 62.21, 52.38 (5→0), so
the loop step is not an outlier.

## Tools, and the esbuild trap

The repository has esbuild only as a transitive pnpm dependency. The `.bin`
shim in this checkout tries to run the Mach-O binary with node and fails, so
`generate.mjs` resolves `node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js`
and calls the JS API. Playwright is a direct dependency.

## Iteration notes

- The first render used 61.6k cubes and looked like a tan wall of skyscrapers;
  face brightness at 0.9 turned ivory into brown, and the clouds were low
  pancake slabs overlapping the skyline.
- The second pass raised face brightness to 0.97, made cloud lobes
  seed-jittered, raised the cloud band, opened the mid city into landmarks, and
  moved the aqueduct mouth over the fall.
- The third pass removed two pavilions that blocked the hero pool, enlarged the
  pool, added the waterwheel, moved the curved bridge, added teal domes, the
  blossom tree, the hero turbine, and a darker near rooftop/railing.
- The fourth pass simplified the far domes and removed the floating gold flat
  caps.
- The final pass made the falls loop periodic and added the seam metric/QA.

## Re-running after a change

```bash
node scripts/skybox/voxel/generate.mjs
```

The script recreates `.build`, then deletes it. `seam-check.png` is written
beside this file (not into the shipped asset folder). `build-stats.json` is
rewritten every run. The public `NOTES.md` is hand-maintained; if the voxel
count changes materially, update its table from `build-stats.json`.
