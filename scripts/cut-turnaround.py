#!/usr/bin/env python3
"""Cut a Gemini turnaround board into image-to-3D inputs.

    python3 scripts/cut-turnaround.py unprocessed-sprites/anands-tpose.jpeg art/anands/reference
    python3 scripts/cut-turnaround.py <board> <out> --prefix=apose --mirror-side

`--mirror-side` replaces the fourth view with the second one mirrored: Gemini
often draws both side views facing the same way, and a generator needs one
facing each way. `--prefix` names the files (default `tpose`).

A turnaround board is four views of one character in a row on white (front,
left side, back, right side — see the ai-art-pipeline skill). Tripo's
multi-view wants each view on its own: square, white, the same scale for all
four, and **not pixel art** — pixel-art input comes back as voxel-staircase
geometry. So each view is:

1. found as a run of non-white columns (a T-pose's arms can join two views;
   the four widest runs are the views, left to right);
2. cropped to the tallest view's height band, so every view keeps one scale;
3. padded to a white square, scaled to 1024 px;
4. de-pixelated: a blur about one board pixel wide, then an unsharp mask to
   put the shapes' edges back.

Writes `tpose-{front,side-a,back,side-b}.png` (the raw square crops) and
`tpose-*-smooth.png` (the generator inputs). side-a is the board's second
view (facing screen-left, Tripo's "Left"); side-b the fourth ("Right").
"""

import os
import sys

import numpy as np
from PIL import Image, ImageFilter

NAMES = ("front", "side-a", "back", "side-b")
WHITE = 235  # a pixel with every channel above this is background
SIZE = 1024
MARGIN = 0.06  # of the square, kept white around the tallest view


def main(src, out, prefix="tpose", mirror_side=False):
    im = Image.open(src).convert("RGB")
    a = np.asarray(im)
    ink = (a < WHITE).any(axis=2)
    cols = ink.sum(axis=0) > 2
    runs, start = [], None
    for x, on in enumerate(list(cols) + [False]):
        if on and start is None:
            start = x
        elif not on and start is not None:
            runs.append((start, x))
            start = None
    runs = sorted(sorted(runs, key=lambda r: r[1] - r[0], reverse=True)[:4])
    if len(runs) != 4:
        sys.exit(f"found {len(runs)} views, not 4: {runs}")
    rows = np.where(ink.sum(axis=1) > 2)[0]
    top, bottom = rows[0], rows[-1] + 1
    band = bottom - top
    widest = max(r[1] - r[0] for r in runs)
    side = int(max(band, widest) / (1 - 2 * MARGIN))
    # The board's pixel: the figure is ~96 art pixels tall at any board size.
    board_px = band / 96
    os.makedirs(out, exist_ok=True)
    crops = [im.crop((x0, top, x1, bottom)) for x0, x1 in runs]
    if mirror_side:
        crops[3] = crops[1].transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    for name, (x0, x1), crop in zip(NAMES, runs, crops):
        x1 = x0 + crop.width
        sq = Image.new("RGB", (side, side), (255, 255, 255))
        sq.paste(crop, ((side - (x1 - x0)) // 2, (side - band) // 2))
        sq = sq.resize((SIZE, SIZE), Image.LANCZOS)
        sq.save(os.path.join(out, f"{prefix}-{name}.png"))
        k = board_px * SIZE / side
        smooth = sq.filter(ImageFilter.GaussianBlur(k * 0.6)).filter(
            ImageFilter.UnsharpMask(radius=k * 1.2, percent=120, threshold=2)
        )
        smooth.save(os.path.join(out, f"{prefix}-{name}-smooth.png"))
        print(f"{name}: x {x0}-{x1}, board px {board_px:.1f} -> blur {k * 0.6:.1f}")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    prefix = next((a.split("=", 1)[1] for a in sys.argv if a.startswith("--prefix=")), "tpose")
    main(args[0], args[1], prefix, "--mirror-side" in sys.argv)
