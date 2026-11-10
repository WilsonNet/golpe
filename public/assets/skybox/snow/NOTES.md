# Frostpeak — alpine noon

The Snow theme's parallax panorama: jagged peaks, a summit team, a busy ski
bowl, a rescue hut, a chairlift, helicopters and a timed avalanche. Same manifest
contract as the Waterfront and Castle, so the runtime's `Skybox` draws it:
four image layers at different parallax factors, seven fixed loops, three
ambient helicopters and one timed event.

```
.venv/bin/python scripts/skybox/snow/generate.py
```

That writes every PNG below, plus `manifest.json` (SHA-256 first-12 per file,
appended as `?v=`), `contact.png` and `NOTES.md`.

## Files

| File | Size | Layers | Parallax |
|---|---|---|---:|
| `sky.png` | 1600x600 opaque | blue gradient, sun and ice halo, cumulus, birds | 0.015 |
| `far.png` | 1600x600 alpha | jagged peaks, summit, avalanche chute, shelf village, frozen valley | 0.06 |
| `mid.png` | 1600x600 alpha | ski bowl, piste, lodge, ski school, lift hut, camp, rescue hut, snowpark, chairlift pylons, slalom gates | 0.18 |
| `near.png` | 1600x600 alpha | foreground snowbank, pines, fence and rescue marker | 0.50, alpha 0.55 |
| `slope-skiers.png` | 36x44, 6 frames | skiers carving the piste, each with its own snow patch | align `mid`, `filtered` |
| `boarders.png` | 52x44, 6 frames | snowboard jump and trick over the kicker | align `mid` |
| `sherpas.png` | 54x28, 4 frames | three porters with packs and a route flag | align `mid` |
| `climbers.png` | 48x36, 4 frames | two summit climbers planting the flag | align `far` |
| `rescue.png` | 54x30, 4 frames | stretcher team, red cross and rescue dog | align `mid` |
| `campers.png` | 48x28, 4 frames | two people by the camp fire | align `mid` |
| `gondola.png` | 40x26, 4 frames | open chairlift chair with two riders | 0.18 |
| `helicopter.png` | 64x34, 4 frames | rotor blur, rescue cross and winch | 0.05 |
| `avalanche.png` | 128x128, 6 frames | the timed snow plume | align `far` |

## Composition

The hero crop is **x 0–800** — Frostpeak is a one-screen map, so that is the
only view a match sees. The rest of the 1600 px is for wider authored maps.

- **The summit** is at x 470, top 110. The two climbers and their flag sit at
  (450, 80), aligned to the far layer so they ride the peak.
- **The avalanche chute** is the dark gully on the summit's right face. The
  timed plume starts at (540, 140), aligned to `far`, and is 128 px square.
- **The hero bowl** has the lodge at x 54–246, the ski school at x 300–366,
  the big kicker at x 324–448, a lift hut at x 522–596, the camp at x 460–608,
  and the rescue hut/team at x 630–730.
- **Skiers are a filtered loop.** `slope-skiers` carries its own patch of
  `#f4f8ff` piste under the skis, and `"filtered": true` keeps it inside the
  background's blur/grade instead of the crisp inhabitants container. Eight
  actors at (135, 350), (282, 390), (382, 408), (480, 422), (540, 454),
  (628, 495), (700, 476) and (882, 458) are scaled 0.85–1.2 and tagged
  `depth` 0/1/2. The depth buckets add a second blur and desaturation, so a
  far skier is softer and less vivid than a near one — the atmospheric
  perspective the baked pass had, now animated. **Snowboarders** remain the
  two crisp(er) trick loops at (365, 404) and (788, 420).
- **Sherpas** walk the lower trail at (260, 520); **campers** sit by the fire
  at (460, 520); the **rescue team** is at (630, 516).
- **Chairlift** chairs hang from the mid cable at (560, 250), (820, 240) and
  (1080, 234).
- **Helicopters** are ambient movers at (300, 82), (1180, 62) and a low rescue
  hover at (930, 172).
- **The near layer** is a low snowbank/snow shadow at 544, with pines, a fence
  and a rescue marker; the arena floor covers its lower half, so it frames the
  bottom without hiding the bowl.

## Programs

- `loops` (14000 ms): 7 groups, 17 actors — the filtered slope skiers,
  boarders, Sherpas, climbers, rescue, campers and the chairlift. Each actor
  has a `frameOffset` so the crowd is not in lockstep.
- `ambient` (140000 ms): 3 helicopters, one high, one far, one low rescue
  hover, each with `speedX`, `bobAmp`, `bobFreq`, `phase`.
- `timed` (avalanche): first at **40000 ms**, every **75000 ms**, visible for
  **9000 ms**, at (540, 140), aligned to `far`. A five-minute match sees it at
  40 s, 115 s, 190 s and 265 s; a short one may not see it at all, which is the
  point. `__skyboxDebug().timed` exposes `{ events: 1, active: ["avalanche"] }`
  while it runs.

## Palette

[`art/skybox/snow/palette.json`](../../../art/skybox/snow/palette.json) is the
only legal source of colour. No pure black, no pure white: the brightest snow
is `#f4f8ff`, the deepest shadow `#22213a`, and the saturated notes are the
red/blue ski shells, the red rescue cross, the yellow chalet windows, the gold
sun and the green pines.

## What changed in this pass

The old Snow backdrop was a pale gradient, two procedural hills and falling
dots. It read as an empty slope. This panorama keeps the bright alpine value
band but gives the theme the Waterfront/Castle treatment: four separated
layers, a focal summit with climbers, a busy hero bowl with people and
structures, and a timed avalanche that is a real event rather than a looping
dot. The runtime falls back to `ThemeSky` if this manifest is missing, so a
probe boot with no asset server still plays.
