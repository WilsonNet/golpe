#!/usr/bin/env python3
"""Side by side: Anands' model renders against her board turnaround.

    python3 scripts/anands-compare.py RENDER_DIR OUT.png

RENDER_DIR holds `front.png`, `side.png`, `back.png` from
`anands_model.compare()` (a 3.3 m ortho frame centred on z = 1.5). Each is
laid beside its reference view at the same scale (3 m = her height), with the
reference silhouette outlined over the render, and the silhouette overlap
(IoU) printed — the number that says the model's shape is hers.
"""

import sys

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

REF = "art/anands/reference"
VIEWS = {"front": "front", "side": "side-a", "back": "back"}
FRAME_M = 3.3  # the compare camera's ortho scale


def main(render_dir, out):
    tiles = []
    for view, ref_name in VIEWS.items():
        r = Image.open(f"{render_dir}/{view}.png").convert("RGBA")
        px = r.width
        per_m = px / FRAME_M
        ref = Image.open(f"{REF}/{ref_name}.png").convert("RGBA")
        h = round(3.0 * per_m)
        ref = ref.resize((round(ref.width * h / ref.height), h), Image.NEAREST)
        # Place the reference on the same frame: feet at z=0, centred.
        ref_f = Image.new("RGBA", (px, px), (0, 0, 0, 0))
        floor = round(px / 2 + 1.5 * per_m)
        ref_f.alpha_composite(ref, ((px - ref.width) // 2, floor - ref.height))
        a = np.asarray(r)[..., 3] > 0
        b = np.asarray(ref_f)[..., 3] > 0
        iou = (a & b).sum() / max(1, (a | b).sum())
        edge = b & ~ndimage.binary_erosion(b)
        over = np.asarray(r).copy()
        over[edge] = (255, 0, 80, 255)
        bg = (60, 64, 72, 255)
        tile = Image.new("RGBA", (px * 2 + 8, px + 24), bg)
        tile.alpha_composite(ref_f, (0, 24))
        tile.alpha_composite(Image.fromarray(over), (px + 8, 24))
        ImageDraw.Draw(tile).text((6, 4), f"{view}: board | model   silhouette IoU {iou:.2f}", fill=(255, 255, 255, 255))
        tiles.append(tile)
        print(f"{view}: IoU {iou:.3f}")
    W = max(t.width for t in tiles)
    sheet = Image.new("RGBA", (W, sum(t.height for t in tiles)), (60, 64, 72, 255))
    y = 0
    for t in tiles:
        sheet.alpha_composite(t, (0, y))
        y += t.height
    sheet.save(out)


if __name__ == "__main__":
    main(*sys.argv[1:3])
