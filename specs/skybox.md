# Skybox

The backdrop behind the arena is a **parallax skybox**: two independently
authored panoramas, each split into layers that follow a fraction of the
camera's scroll. It is presentation only. Nothing in `src/game/simulation/`
knows it exists, and `?sky=` never changes a tick.

## The candidates

| URL | Pipeline | Look |
|---|---|---|
| `?sky=stage` (default) | Pillow/numpy, purpose-built | the calm Smash-style waterfront: one focal tree + aqueduct + low conservatory, a waterline, one ambient plan |
| `?sky=hand` | Pillow/numpy | the earlier, busier hand-painted waterfront/city study |
| `?sky=voxel` | Three.js, tens of thousands of instanced voxels | the earlier, denser voxel city |
| `?sky=off` | the original gradient | the readability fallback |

The **Stage** candidate is the one built to the brief. The other two are kept as
comparison studies: the same runtime, the same manifest contract, but denser
compositions that the playtest found too packed. A new candidate is a folder
under `public/assets/skybox/<name>/` and a line in `SKY_VARIANTS`.

The **Options** dialog (root menu and Esc menu) writes the same choice to
`localStorage` and applies it from the next match. A `?sky=` in the URL chooses
the candidate when the page loads, so a shared link and a probe can pin one;
the menu's launch serializer does not carry the parameter, which is what lets a
player's stored choice take over again.

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
| `near` | 0.50 | rooftop gardens and framing foliage |

- **A waterfall follows the layer it falls out of.** An `align` on the strip
  resolves its factor through that layer; a strip with its own factor peels
  away from its own aqueduct as soon as the camera moves.
- **No vertical parallax in a match.** The world is exactly one screen tall,
  so the camera never moves vertically; the backdrop stays anchored to the
  arena's floor. The Move list's preview camera does move vertically, and the
  backdrop follows it world-anchored.
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
  stalls, laundry lines, rows of windows or tiny people directly behind the
  fight.
- **Low-contrast, desaturated background; saturated platform surfaces.** The
  dark green ledges are the only high-contrast surfaces in the band.
- **A clear water/horizon line**, kept clear of the platform edges.
- **Sparse ambient motion**, not a hive: one flock, one airship, a couple of
  boats, some water glints.

## One ambient plan

Every moving background actor lives in a single manifest `ambient` plan:

```json
"ambient": {
  "loopMs": 90000,
  "groups": [
    { "layer": "birds", "actors": [ ... ] },
    { "layer": "zeppelin", "actors": [ ... ] },
    { "layer": "boats", "actors": [ ... ] }
  ]
}
```

The runtime samples all groups from the **same elapsed clock**; `loopMs` is the
intended length of the programme. The panorama wrap is the continuous loop —
do not force a reset that teleports a bird whose speed does not divide the
panorama. The flock, the airship and the boats are composed rather than four
independent widgets. The strip layer supplies frames, fps and parallax; the
plan supplies the actors' positions, travel speed, bob and phase. A waterfall
has no speed and is not part of the plan; if a candidate has no plan, the
runtime falls back to the strip's own items for compatibility.

## Readability contract

The middle band (y 150-470) is where fighters, nameplates and the dark green
platforms live. The art keeps it hazy; the Stage puts detail in large edge
masses and the waterline, never behind the fight. The earlier studies spend
their contrast at the frame's edges too, because that is where the eye can
afford it.

The first painted pass failed the playtest for a measurable reason: the city
put the fighter in the same **value** band. At the spawn, the flat old sky had
a body/background ΔL* of ~32; the city had ~11. The hue was different, which
is why a colour screenshot looked fine, but a grayscale squint lost the body.
That is the classic value failure Game Developer's value analysis describes.

The fix is three layers of the same principle:

1. **Atmospheric perspective.** A pale `screen` haze rises from 3% at y=130 to
   46% at the floor. Screen blend lifts the darks more than the lights, so it
   compresses the background's value range and pushes it toward the sky's
   value without touching the fighter or the platforms, which are drawn above
   it. The hand candidate has a darker city and uses `"haze": 1.3`.
2. **A detail budget.** The near layer's dark foliage sat exactly in the
   fighter's band, and it is faded to `"alpha": 0.2`. It still frames the
   bottom faintly; the pale mid city carries the silhouette. Detail that
   competes with a body is noise, not richness.
3. **An outline.** The actors layer gets a 1px deep-indigo `OutlineFilter`
   (2px at DPR 2). The hero sheets already ink their own silhouette, but they
   are rendered at 2x and drawn at half size, so on a 1x display that line can
   land between pixels. The filter restores the edge that the silhouette test
   asks for. It is presentation only and never touches the wire.

A dark top scrim (0..130) is the one place the background is darkened: it is
behind the HUD, not behind the fight.

### Measuring it

`tsx scripts/readability-probe.ts` renders the same frame twice through
`renderer.extract` — once with the fighter sprites, once without — and uses
the difference as the body mask and the without-frame as the background the
body covers. It measures:

| Metric | What it answers |
|---|---|
| `valueContrast` (ΔL*) | Does the body occupy a different lightness band? |
| `silhouetteContrast` (ΔE) | Is the outside edge visible? |
| `silhouetteCoverage` | What fraction of the outline clears ΔE 20? |
| `backgroundDetail` | Is the combat band quiet enough? |
| `contrastRatio` | The WCAG-style luminance ratio, reported for comparison |

The gates are **relative to the flat-sky control** measured in the same run,
not invented absolute numbers: an outline is crisp at DPR 2 and soft at DPR 1,
so a fixed ΔE threshold would fail the very sky the game shipped with. Both
candidates must match or beat the control on value separation, silhouette and
outline coverage. In a representative run the control measures ΔL* 36.1, core
silhouette ΔE 67.7, coverage 99%, luminance ratio 2.41; **stage 44.6 / 71.0 /
98% / 3.03**; voxel 42.0 / 72.9 / 99% / 2.84; hand 38.5 / 68.5 / 98% / 2.62.
The Stage candidate is the first one to clear the 3:1 large-element contrast
figure, not merely match the old sky. The exact values move a little with where
the FIGHT leaves the body, so the probe gates on the same-run control rather
than a frozen number. The outer edge is reported separately: it is the soft
anti-aliased skirt of the sprite, and the solid ink line one pixel in is the
number that matches what a player sees. A DPR 2 spot check agrees: voxel ΔL*
44.2 vs the flat sky's 38.3, core ΔE 33.2 vs 32.3. Spot checks on Jeffs, Anands
and Ibiriki at the same spawn: ΔL* 51 / 49 / 43, luminance ratio 4.4 / 4.2 /
3.2, all above their own flat-sky controls.

The WCAG 3:1 figure is a UI guideline (Xbox XAG 102), not a sprite threshold —
the old sky itself is ~2.4:1 — so the report keeps it visible rather than
pretending it is the gate.

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

`tsx scripts/sky-probe.ts` loads each candidate in an online AI room at one and
three screens and checks:

- the manifest and all layers actually loaded (`__skyboxDebug`);
- five layers and at least three distinct parallax factors;
- the waterfall's frame advances while the fight is still;
- when the camera moves, every layer's shift changed by exactly
  `cameraDelta * factor` (mod the panorama), which is the only proof that the
  depth is real rather than a static painting.

It writes one- and three-screen screenshots to `.playwright-mcp/skybox/` for a
human to judge. The game is the gallery: `?sky=voxel` / `?sky=hand`.
