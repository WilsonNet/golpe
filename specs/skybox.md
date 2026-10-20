# Skybox

The backdrop behind the arena is a **parallax skybox**: a hand-painted
panorama split into layers that follow a fraction of the camera's scroll. It is
presentation only. Nothing in `src/game/simulation/` knows it exists, and
`?sky=` never changes a tick.

## The style

| URL | Pipeline | Look |
|---|---|---|
| `?sky=hand` (default) | Pillow/numpy | the **house style**: the hand-painted solarpunk waterfront — tree, aqueduct, canal, quay, low conservatory, people, birds/airship/boats |
| `?sky=off` | the original gradient | the readability fallback |

The Waterfront is the style the game is now pointed at. The pipeline is a folder
under `public/assets/skybox/hand/`; the runtime contract is `SKY_VARIANTS` and
the manifest below. There is deliberately no second style to maintain.

The **Graphics** submenu (root menu and Esc menu) shows a side-by-side
Waterfront/Off comparison, writes the choice to `localStorage`, and applies it
**immediately**: a live match rebuilds only its skybox container around the new
textures, with the simulation, camera and fighters untouched. **Off** draws the
old plain blue gradient with no grade, blur, scenery or motion. A `?sky=` in the
URL chooses the background when the page loads, so a shared link and a probe can
pin it; the menu's launch serializer does not carry the parameter, which is what
lets a player's stored choice take over again.

## How it is drawn

Every layer is a **1600 x 600 panorama** that tiles horizontally. It is a
`Sprite`, not a `TilingSprite`: two or three copies are placed one panorama
apart and moved by a fraction of the camera, so the wrap is explicit and the
image never repeats vertically (a city repeated above the sky reads as a bug).

| Layer | Factor | Content |
|---|---:|---|
| `sky` | 0.015 | gradient, ringed planet, clouds; slow drift |
| `far` | 0.06 | pale skyline |
| `mid` | 0.18 | the city, aqueducts and gardens |
| `falls` | = `mid` | animated waterfall strips, pinned to the aqueduct mouths |
| `near` | 0.50 | canal, stone quay, pier and reflections |
| `loops` | 0.50 | fixed people vignettes: cheer, picnic, date, spar, sport |
| `ambient` | 0.03–0.50 | walkers, birds, zeppelin and boats |

- **A waterfall follows the layer it falls out of.** An `align` on the strip
  resolves its factor through that layer; a strip with its own factor peels
  away from its own aqueduct as soon as the camera moves.
- **No vertical parallax in a match.** The world is exactly one screen tall,
  so the camera never moves vertically; the backdrop stays anchored to the
  arena's floor. The Move list's preview camera does move vertically, and the
  backdrop follows it world-anchored.
- **The scenery is blurred and graded; the inhabitants and actors are crisp.**
  The blur and colour matrix sit on the skybox's `art` container. The looping
  and moving people sit in a separate container above it with only a slight
  chroma reduction; the arena platforms and fighters are above both, and the
  actors get their own small brightness lift. A fighter is never blurred or
  graded with the world behind it.
- **The camera's pitch never changes.** The sky is inside `Stage.background`,
  so it shakes with an impact and pushes in with the Play of the Game zoom.
- **A rebuild rebuilds the sky.** `drawArena` owns `stage.background`; the
  `Skybox` is destroyed and recreated with it, or a room that learns its real
  width would keep a backdrop for the wrong map.
- **Missing art is not a boot failure.** A missing manifest falls back to the
  old gradient. The probe distinguishes `loaded: false` from a real skybox,
  because a screenshot cannot.

## A stage, not an illustration

The first pass was too packed. A background in a fighting game is a **set**, not
a picture: Smash Bros. is the reference, and Sakurai's stage rules are explicit
([Source Gaming's translation](https://sourcegaming.info/2016/04/17/melee-battlestages/)):

> "The characters have to be easy to identify. Characters tend to be pretty
> small in Smash, so we can't make the background colors too pronounced or
> prominent, or it'll make the characters hard to see."

> "Platforms that can be stood on have saturated colors, parts that can't be
> stood on have unsaturated colors."

> "Emphasize things with hitboxes, and don't emphasize the rest."

> "Don't draw too much, don't draw too little."

The stage layers are foreground / midground / background, with the closest
plane getting the focus; Ultimate's team even lights platform edges unnaturally
so the places a fighter can stand stay readable. The background is allowed to
be beautiful, but it leans toward the game side.

Applied here:

- **One focal landmark** (the aqueduct/tree/conservatory mass), not a skyline
  of repeated towers and props.
- **Large shapes and negative space**; the combat band stays quiet. No market
  stalls, laundry lines, rows of windows or crowds directly behind the fight.
  The animated people live on the quay band, not in the play band.
- **Low-contrast, desaturated background; saturated platform surfaces.** The
  dark green ledges are the only high-contrast surfaces in the band.
- **A clear water/horizon line**, kept clear of the platform edges.
- **Sparse ambient motion**: a flock, one airship, a couple of boats and a
  handful of looping quayside vignettes — not a hive.

## Two plans: the looping layer and the moving layer

The background people are deliberately split into two programmes, because they
do different jobs:

- **`loops` — the looping layer.** Fixed-position vignettes cycle in place:
  people cheering, a picnic, a date, a playful spar, a small sports match.
  This is the life of the quay; nobody travels across the screen.
- **`ambient` — the moving layer.** Walkers crossing the quay, plus the birds,
  zeppelin and boats. These translate and wrap at the panorama edge.

Both are single objects in the manifest, each with one clock. The runtime
samples every group from the same elapsed clock; `loopMs`/`clockMs` are the
intended programme lengths. The panorama wrap is the continuous loop — never
force a reset that teleports a walker whose speed does not divide the panorama.

```json
"loops": {
  "clockMs": 16000,
  "groups": [
    { "layer": "cheer", "actors": [{ "u": 180, "v": 500, "frameOffset": 0 }] },
    { "layer": "picnic", "actors": [ ... ] },
    { "layer": "date", "actors": [ ... ] },
    { "layer": "spar", "actors": [ ... ] },
    { "layer": "sport", "actors": [ ... ] }
  ]
},
"ambient": {
  "loopMs": 400000,
  "groups": [
    { "layer": "birds", "actors": [ ... ] },
    { "layer": "zeppelin", "actors": [ ... ] },
    { "layer": "boats", "actors": [ ... ] },
    { "layer": "walkers", "actors": [ ... ] }
  ]
}
```

A strip layer supplies frames, fps and parallax; the plan supplies the actors'
positions and, for the moving layer, travel speed, bob, phase and flip. A
waterfall has no speed and is not part of either plan. If a plan is absent, the
runtime falls back to the strip's own items for compatibility.

## Readability contract

The middle band (y 150-470) is where fighters, nameplates and the dark green
platforms live. The Waterfront keeps it hazy and puts detail in the large edge
masses, the quay band and the waterline, never behind the fight. The animated
people live below the fight, on the quay.

The first painted pass failed the playtest for a measurable reason: the city
put the fighter in the same **value** band. At the spawn, the flat old sky had
a body/background ΔL* of ~32; the city had ~11. The hue was different, which
is why a colour screenshot looked fine, but a grayscale squint lost the body.
That is the classic value failure Game Developer's value analysis describes.

The fix is a **background grade** and a **foreground lift**, not a pale wash
over everything:

1. **The background recedes.** A `BlurFilter` (1.1px) and a `ColorMatrixFilter`
   (a little less brightness and saturation, scaled by the manifest's `haze`)
   sit on the skybox's `art` container — between the painted scenery and the
   arena. The sky, city, water and falls soften with it. The **inhabitants** —
   the looping people, walkers, birds, zeppelin and boats — sit in a separate
   crisp container just above the grade, with only a small chroma reduction so
   a bright shirt or boat cannot out-saturate the fighter. Both layers are
   below the fighters and platforms, which stay crisp.
2. **The near layer is bright, not black.** The quay/water layer uses
   `"alpha": 0.6`; it can carry more than the old dark-foliage layer because it
   is a bright canal, not a bush in the fighter's value band.
3. **The fighters are the bright layer.** The actors container gets a small
   `ColorMatrixFilter` lift (brightness 1.08, saturation 1.06). The old dark
   `OutlineFilter` is gone — it was the thing making the roster read as
   silhouettes. The art's own ink line is the outline; the background is now
   softer and quieter than the body, which is the separation cue.

A faint top scrim (0..160, max 0.08) exists only so the HUD panel keeps its
contrast. It is not the old dark band.

**Off is the old look.** `?sky=off` (or Graphics → *Off — plain blue*) draws
the original `TEX.sky` gradient directly, with no blur, no grade, no top scrim,
no waterfalls, birds or boats. That is the competitive low-distraction mode;
the old blue is not run through the new atmosphere pass.

### Measuring it

`tsx scripts/readability-probe.ts` renders the same frame twice through
`renderer.extract` — once with the fighter sprites, once without — and uses
the difference as the body mask and the without-frame as the background the
body covers. It measures:

| Metric | What it answers |
|---|---|
| `valueContrast` (ΔL*) | Does the body separate from the background at all? |
| `foregroundL - backgroundL` | Is the body much darker than its background? |
| `chromaContrast` | Is the body the more vivid layer? |
| `silhouetteCoreContrast` (ΔE) | Is the solid ink edge visible? |
| `silhouetteCoreCoverage` | What fraction of the solid outline clears ΔE 20? |
| `backgroundDetail` | Is the blurred band quiet enough? |
| `contrastRatio` | The WCAG-style luminance ratio, reported for comparison |

The gates describe this house style, not the old pale-sky look. The body must
not collapse into the background (`min ΔL* ≥ 6`), must not be **more** darkened
relative to the background than the flat-sky control (signed `L*fg - L*bg`), and
must remain the more vivid layer (`chromaContrast`). The silhouette, coverage,
detail budget and a "not lost" luminance ratio (≥0.95) still hold. In a
representative run the control is L* 58.0 / 82.2 (signed -24.5, ΔL* 24.3,
chroma contrast 23.5, core ΔE 50.3, coverage 86%, detail 0.08); the Waterfront
is 56.6 / 66.1 (signed -9.6, ΔL* 9.6, chroma contrast 22.2, core ΔE 52.3,
coverage 97%, detail 0.06). The Waterfront's body is **9.6 darker** than its
background versus **24.5** for the old sky: it is the bright, crisp, vivid layer
over a blurred, desaturated world. The exact values move with where the fight
leaves the body, so the probe gates on the same-run control.

The WCAG 3:1 figure is a UI guideline (Xbox XAG 102), not a sprite threshold.
The old sky itself is ~1.7:1 and the Waterfront ~1.1:1 in relative luminance;
the silhouette and chroma carry the separation, which is why the probe reports
the ratio but does not pretend it is the whole story. The `Off` plain-blue mode
is the old sky and is not run through the background grade or blur.

Literature this follows:

- Game Developer, [How to Reduce Visual Confusion in Your Game](https://www.gamedeveloper.com/design/how-to-reduce-visual-confusion-in-your-game)
  — the value analysis, DOTA 2's separation of heroes from ground, and the
  warning that contrast everywhere is contrast nowhere.
- Bugnet, [Readable Game Art: Why Clarity Beats Detail](https://bugnet.io/blog/readable-game-art-why-clarity-beats-detail)
  — silhouettes read before colour, value structure separates layers, detail
  belongs where attention goes.
- Art Prof / LibreTexts, atmospheric perspective — distant layers lose
  contrast and saturation and shift toward the sky; foreground keeps the
  hardest edges.
- Xbox Accessibility Guidelines, [XAG 102: Contrast](https://devdocs.xbox.com/build/game-principles/accessibility/xag-deep-dives/xag-102-contrast)
  — contrast ratios and character/platform outlines for low-vision players.
- The [silhouette test](https://github.com/claude-dev-suite/knowledge_base/blob/main/knowledge/gamedev/2d-art/character-design/silhouette-test-walkthrough.md)
  — test the character at game scale against real backgrounds, not on a flat
  transparent sheet.


## Measuring the parallax

`tsx scripts/sky-probe.ts` loads the Waterfront in an online AI room at one and
three screens and checks:

- the manifest and all layers actually loaded (`__skyboxDebug`);
- at least five background layers and three distinct parallax factors;
- the waterfall's frame advances while the fight is still;
- the ambient plan exists, its movers advance, and the stationary people's
  loop frames advance;
- when the camera moves, every layer's shift changed by exactly
  `cameraDelta * factor` (mod the panorama), which is the only proof that the
  depth is real rather than a static painting.

It writes one- and three-screen screenshots to `.playwright-mcp/skybox/` for a
human to judge. The game is the gallery: `?sky=hand` / `?sky=off`.
