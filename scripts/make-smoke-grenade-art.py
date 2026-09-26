#!/usr/bin/env python3
"""Render Jeffs' smoke grenade tumble from its model and pack the strip.

    python3 scripts/make-smoke-grenade-art.py [--save]

Runs `scripts/blender/smoke_grenade.py` headless (the model and the flip are
there), then stitches the cells into `public/assets/smoke-grenade.png` — one
row of FRAMES x CELL px. `--save` also writes `art/props/smoke-grenade.blend`.
"""

import os
import subprocess
import sys
import tempfile

from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SCRIPT = os.path.join(ROOT, "scripts", "blender", "smoke_grenade.py")
OUT = os.path.join(ROOT, "public", "assets", "smoke-grenade.png")

with tempfile.TemporaryDirectory() as tmp:
    extra = ["--save"] if "--save" in sys.argv else []
    subprocess.run(
        ["blender", "-b", "--factory-startup", "-P", SCRIPT, "--", "--out", tmp, *extra],
        check=True,
        stdout=subprocess.DEVNULL,
    )
    cells = [Image.open(os.path.join(tmp, f)).convert("RGBA") for f in sorted(os.listdir(tmp))]
    w, h = cells[0].size
    strip = Image.new("RGBA", (w * len(cells), h))
    for i, c in enumerate(cells):
        strip.paste(c, (i * w, 0))
    strip.save(OUT)
    # Measured, not eyeballed: every cell must hold the can, none may touch the edge.
    for i, c in enumerate(cells):
        box = c.getchannel("A").getbbox()
        if not box:
            sys.exit(f"cell {i} is empty")
        if box[0] == 0 or box[1] == 0 or box[2] == w or box[3] == h:
            sys.exit(f"cell {i} touches the cell edge: {box}")
    sizes = [c.getchannel("A").getbbox() for c in cells]
    print(f"wrote {OUT}: {len(cells)} x {w}x{h}px; extents {[(b[2]-b[0], b[3]-b[1]) for b in sizes]}")
