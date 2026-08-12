# The Sprite Workshop

An in-browser atlas slicer and live debug overlay for art that is not ready
for the game — Gemini generations, reference paintings, anything with baked
backgrounds and text labels. It lives in the dev server at
`http://localhost:8084/?slicer=true` and turns a raw board into the game's
own strip format without any art software in between.

```bash
pnpm run dev:herdr          # then open http://localhost:8084/?slicer=true
```

- [The flow](#the-flow)
- [The board folder](#the-board-folder)
- [Slice](#slice)
- [Clips](#clips)
- [Export](#export)
- [Aseprite](#aseprite)
- [Bringing a sheet into the game](#bringing-a-sheet-into-the-game)
- [Why this exists](#why-this-exists)

---

## The flow

1. **Pick a board.** Every image in `unprocessed-sprites/` appears in the
   board list automatically — the dev-only middleware in `vite/config.dev.ts`
   serves the folder and its listing. Drop a file anywhere on the window and
   it is picked up too (that works on any host, even without the middleware).
2. **Hot reload.** The list is polled every two seconds. A board that is
   re-saved on disk reloads itself, so the loop is *edit in Gemini → save →
   look at the workshop* with nothing in between. The slice spec and clips
   survive the reload — they are per-board state in `localStorage`.
3. **Slice.** Carve the board into cells: a uniform grid, or hand-drawn
   rects. Erase a baked background colour with the eyedropper.
4. **Curate.** Trim to content, name clips over the frames, play them on a
   stage at the game's own scale, inspect any frame magnified.
5. **Export.** A clean strip of uniform cells (`<name>.png`) and a small
   atlas JSON (`<name>.atlas.json`).

## The board folder

`unprocessed-sprites/` is a repo folder, deliberately **not** `public/`: it
holds paintings, not shipped assets. The dev middleware serves it at
`/unprocessed/*` and lists it at `/unprocessed/list.json` (polled for hot
reload). A prod build has no middleware — the workshop's file picker and
drag-drop still work.

## Slice

**Grid mode** — for boards that already are a lattice. Set rows/cols; a cell
size of 0 fits the board. Drag pans, the wheel zooms, **fit** recentres.

**Rects mode** — for the labelled collages Gemini and reference boards
actually are. Drag empty space to draw a cell around a pose, drag a cell to
move it, its corner dot resizes it. Click selects; Delete removes. The rect
list below the board is the same thing in numbers.

**Erase colour** — the eyedropper samples the *raw* board (not the erased
copy), and the tolerance slider decides how close a pixel must be. This is
what removes a beige panel or white paper before anything else runs.

**Trim to content** — crops each cell to its opaque pixels, then re-centres
it in a uniform frame (`frame W/H` = 0 auto-sizes to the largest cell plus
margin; fixed sizes match an existing hero's cells, e.g. 168×152). Alignment
is bottom, centre or top. This single toggle drops the panel borders and the
grid lines that sit *between* poses, which is what makes a labelled board
clean.

## Clips

Click frames on the filmstrip (or cells on the board) to select them, add a
clip, and either type the frame list ("0-3, 5, 8" is the game's own
notation) or hit **use selected**. The stage shows the clip at the game's
scale — the dashed cyan box is the fighter's real collider (32×48), and the
sprite is drawn at exactly `48/cellH`, the same scale `assets.ts` uses — so
"does this art fit the collider" is answered here, not on a live match.

## Export

The sheet is a horizontal strip of uniform `cellW × cellH` cells on a
transparent background, numbered by cell index. The JSON carries the cell
size, the source rects, and the clips:

```json
{
  "name": "vanguard",
  "cellW": 96,
  "cellH": 96,
  "frames": [{ "x": 0, "y": 0, "w": 96, "h": 96 }],
  "clips": [{ "name": "run", "frames": [0, 1, 2, 3], "fps": 10, "loop": true }]
}
```

The strip imports directly into Aseprite with **File → Import Sprite Sheet…
(grid `96×96`, top-left, no padding)** — every cell lands as its own frame
with the exact grid the game slices with.

## Aseprite

The workshop prepares; Aseprite curates. Import the exported strip, clean
the Gemini noise frame by frame (the magnifier view shows exactly what the
game will see), then **File → Export Sprite Sheet** back out — a PNG with
*no* padding, plus (optionally) an Aseprite-style JSON if you want a second
opinion on the frame layout. Re-import that PNG into the workshop if the
pixel work changed the frames, or ship it straight: the strip format is the
same on both sides of the trip.

## Bringing a sheet into the game

1. Put `<name>.png` and `<name>.atlas.json` in `public/assets/`.
2. Register the sheet in `src/game/render/assets.ts`:

   ```ts
   const ATLAS_SHEETS: Record<string, { png: string; json: string }> = {
     vanguard: { png: "assets/vanguard.png", json: "assets/vanguard.atlas.json" },
   };
   ```

   `loadAssets` slices the strip by the JSON's cell size into
   `FRAME_SETS["vanguard"]`, and `sheetScale` reads the same cell size — a
   fighter with this sheet is drawn at the right size with nothing else
   touched.
3. Point the hero's clips at the sheet in `ecs/systems.ts` (`HERO_CLIPS`),
   writing the frame runs straight out of the JSON's `clips`.

The atlas JSON is never read at runtime for clips — the per-hero clip table
is code, exactly like every shipped hero's. The JSON is the reference you
copy the numbers from.

## Why this exists

`scripts/make-anands-art.py` proved the shape of the problem: the game's art
is being hand-*composed* from paintings — boards cropped by measured rects,
backgrounds removed by colour, frames normalised to a uniform height. That
pipeline worked once, by hand, for one hero. The workshop makes it visual
and interactive, so the next hero (and the one after) takes minutes instead
of a Python session, and every step — erase, slice, trim, pad, clip,
collider-fit — is checked by eye against the game it is going into.
