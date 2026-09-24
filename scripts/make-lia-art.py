#!/usr/bin/env python3
"""Render Lia from her Blender source and pack the shipped sprite atlas.

    python3 scripts/make-lia-art.py              # render + pack
    python3 scripts/make-lia-art.py --pack-only  # re-pack the last render

The source of truth is `art/lia/lia.blend` (see art/lia/README.md). This
script never edits it: Blender renders every `clip.*` action's keyed frames
(`scripts/blender/lia_render.py`), and this side turns those raw canvases
into what the game loads:

- `public/assets/lia.png`  — the trimmed, packed atlas (right-facing frames
  plus their mirrors for the left-facing clips).
- `public/assets/lia.json` — the cell size, the body height the draw scale is
  computed from, every frame's rect and its offset inside the cell, and the
  clips (frames, fps, loop, drive).
- `public/assets/lia-portrait.png` — the hero shot for the menus and the
  ultimate's card, rendered at 4x the sprite density.

The scale contract (the fix for "the sword gets bigger"): the draw scale is
`PLAYER_HEIGHT / bodyH`, where `bodyH` is the 3m body box in pixels — never
the cell height. The cell is the union of every frame's content, made
symmetric about the body centre, so a longer sword or a raised blade grows
the *cell*, and the fighter is drawn at exactly the same size either way.
"""

import hashlib
import json
import os
import shutil
import subprocess
import sys

import numpy as np
from PIL import Image, ImageOps

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BLEND = os.path.join(ROOT, "art", "lia", "lia.blend")
RENDER = os.path.join(ROOT, "scripts", "blender", "lia_render.py")
RAW = os.path.join(ROOT, "art", "lia", ".render")
OUT_PNG = os.path.join(ROOT, "public", "assets", "lia.png")
OUT_JSON = os.path.join(ROOT, "public", "assets", "lia.json")
OUT_PORTRAIT = os.path.join(ROOT, "public", "assets", "lia-portrait.png")

INK = (24, 16, 34, 255)
ATLAS_MAX_W = 2048
PAD = 1


def render():
    blender = shutil.which("blender")
    if not blender:
        sys.exit("blender not found on PATH — install Blender 4.4+ (5.x tested)")
    if os.path.exists(RAW):
        shutil.rmtree(RAW)
    subprocess.run([blender, "-b", BLEND, "-P", RENDER, "--", RAW], check=True)


def harden(im):
    """No anti-aliasing survives: alpha is 0 or 255, pixel art has no fringe."""
    r, g, b, a = im.split()
    a = a.point(lambda v: 255 if v >= 128 else 0)
    return Image.merge("RGBA", (r, g, b, a))


def ink_outline(im, width=1):
    """The silhouette line, 4-neighbour, `width` px — *selective* outline.

    SNES sprites rarely outline in one flat black: the line takes a dark
    shade of the colour it borders (dark red against the tunic, dark teal
    against the hair), which is what keeps a small sprite from looking like
    a sticker. Each ring pixel is ink mixed with its inner neighbour's colour.
    """
    for _ in range(width):
        px = np.array(im, dtype=np.int32)
        alpha = px[..., 3] > 0
        ring = np.zeros_like(alpha)
        colour = np.zeros(px.shape[:2] + (3,), dtype=np.int32)
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            shifted = np.roll(np.roll(alpha, dy, 0), dx, 1)
            src = np.roll(np.roll(px[..., :3], dy, 0), dx, 1)
            new = shifted & ~alpha & ~ring
            colour[new] = src[new]
            ring |= new
        ink = np.array(INK[:3], dtype=np.int32)
        line = (ink * 0.6 + colour * 0.4 * 0.45).astype(np.int32)
        px[ring, :3] = line[ring]
        px[ring, 3] = 255
        im = Image.fromarray(px.astype(np.uint8), "RGBA")
    return im


def clean_orphans(im):
    """Remove single stray pixels: a pixel unlike all four of its neighbours,
    when those four agree, takes their colour. A render's band edges leave
    these wherever a curve crosses a threshold; a pixel artist never would."""
    px = np.array(im, dtype=np.int32)
    rgb = px[..., :3]
    opaque = px[..., 3] > 0
    n = [np.roll(np.roll(rgb, dy, 0), dx, 1) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))]
    na = [np.roll(np.roll(opaque, dy, 0), dx, 1) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))]
    same = np.all([np.all(n[0] == k, axis=-1) for k in n[1:]], axis=0)
    differs = ~np.any([np.all(rgb == k, axis=-1) for k in n], axis=0)
    fix = opaque & same & differs & np.all(na, axis=0)
    rgb[fix] = n[0][fix]
    px[..., :3] = rgb
    return Image.fromarray(px.astype(np.uint8), "RGBA")


def pack(images):
    """Shelf-pack (tallest first). Returns {index: (x, y)} and the atlas size."""
    order = sorted(range(len(images)), key=lambda i: -images[i].height)
    x = y = shelf_h = 0
    placed = {}
    width = 0
    for i in order:
        im = images[i]
        if x + im.width + PAD > ATLAS_MAX_W:
            x = 0
            y += shelf_h + PAD
            shelf_h = 0
        placed[i] = (x, y)
        x += im.width + PAD
        width = max(width, x)
        shelf_h = max(shelf_h, im.height)
    return placed, (width, y + shelf_h)


def portrait(manifest):
    clip = next((c for c in manifest["clips"] if c["right"] == "portrait"), None)
    if not clip:
        return
    im = harden(Image.open(os.path.join(RAW, clip["files"][0])).convert("RGBA"))
    im = ink_outline(im, 2)
    x0, y0, x1, y1 = im.getbbox()
    h = (y1 - y0) + 16
    w = h * 2 // 3
    cx = (x0 + x1) // 2
    box = (cx - w // 2, y0 - 8, cx - w // 2 + w, y0 - 8 + h)
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    out.alpha_composite(im.crop(box))
    out = out.resize((256, 384), Image.LANCZOS)
    out.save(OUT_PORTRAIT, optimize=True)
    print(f"wrote {os.path.relpath(OUT_PORTRAIT, ROOT)}")


def measure(frames, clips, centre, body_h):
    """The scale contract, measured on the render — fail loudly if it broke.

    Standing frames must put the feet on the body box's floor line (the
    collider's bottom) and fill it to within a few pixels of its height: an
    edit in Blender that moved the rig, the camera or the model's scale shows
    up here as a number, not as a fighter that floats or shrinks in-game.
    """
    floor = centre + body_h // 2
    problems = []
    for c in clips:
        if c["right"] not in ("right-idle", "gun-hold", "block"):
            continue
        # A banded (aim) clip is measured at its level band only: a rifle
        # raised overhead is not the top of her head.
        files = c["files"]
        if c.get("bands"):
            per = len(files) // c["bands"]
            files = files[per * (c["bands"] // 2) : per * (c["bands"] // 2) + 1]
        for f in files:
            a = frames[f].split()[3]
            # The body only: the column under the body centre, ±1m, so a
            # sword poking below the feet does not count as a foot.
            box = a.crop((centre - 32, 0, centre + 32, a.height)).getbbox()
            if not box:
                problems.append(f"{f}: empty frame")
                continue
            top, bottom = box[1], box[3]
            height = bottom - top
            print(f"  measure {c['right']:<11} feet y={bottom} (floor {floor}) height={height}px (body {body_h})")
            if abs(bottom - floor) > 3:
                problems.append(f"{f}: feet at y={bottom}, the collider floor is y={floor}")
            if not (body_h - 16 <= height <= body_h + 4):
                problems.append(f"{f}: figure is {height}px tall, the body box is {body_h}px")
    if problems:
        sys.exit("scale contract broken:\n  " + "\n  ".join(problems))


def main():
    if "--pack-only" not in sys.argv:
        render()
    with open(os.path.join(RAW, "manifest.json")) as fh:
        manifest = json.load(fh)
    canvas = manifest["canvas"]
    centre = canvas // 2

    # 1. Load every game frame, harden, ink.
    clips = [c for c in manifest["clips"] if c["right"] != "portrait"]
    frames = {}
    for c in clips:
        for f in c["files"]:
            im = harden(Image.open(os.path.join(RAW, f)).convert("RGBA"))
            frames[f] = ink_outline(clean_orphans(im), 1)

    # 2. The cell: every frame's content, symmetric about the body centre.
    half_w = half_h = 0
    for im in frames.values():
        bb = im.getbbox()
        if not bb:
            continue
        x0, y0, x1, y1 = bb
        half_w = max(half_w, centre - x0, x1 - centre)
        half_h = max(half_h, centre - y0, y1 - centre)
    cell_w, cell_h = half_w * 2, half_h * 2
    ox0, oy0 = centre - half_w, centre - half_h

    # 3. Trim, mirror, dedupe.
    images = []
    rects = []  # (image index, ox, oy) per atlas frame
    by_hash = {}

    def add(im_cell):
        bb = im_cell.getbbox() or (0, 0, 1, 1)
        trimmed = im_cell.crop(bb)
        key = hashlib.sha1(trimmed.tobytes() + bytes(str(bb), "ascii")).hexdigest()
        if key in by_hash:
            return by_hash[key]
        images.append(trimmed)
        rects.append((len(images) - 1, bb[0], bb[1]))
        by_hash[key] = len(rects) - 1
        return by_hash[key]

    out_clips = {}
    for c in clips:
        right, left = [], []
        for f in c["files"]:
            cell = frames[f].crop((ox0, oy0, ox0 + cell_w, oy0 + cell_h))
            right.append(add(cell))
            if c["left"]:
                left.append(add(ImageOps.mirror(cell)))
        meta = {"fps": c["fps"], "loop": c["loop"]}
        if c["drive"]:
            meta["drive"] = c["drive"]
        if c.get("bands"):
            meta["bands"] = c["bands"]
        out_clips[c["right"]] = {"frames": right, **meta}
        if c["left"]:
            out_clips[c["left"]] = {"frames": left, **meta}

    measure(frames, clips, centre, manifest["bodyH"])
    placed, size = pack(images)
    atlas = Image.new("RGBA", size, (0, 0, 0, 0))
    for i, im in enumerate(images):
        atlas.alpha_composite(im, placed[i])
    atlas.save(OUT_PNG, optimize=True)

    out = {
        "name": "lia",
        "source": "art/lia/lia.blend — regenerate with scripts/make-lia-art.py",
        "cellW": cell_w,
        "cellH": cell_h,
        "bodyH": manifest["bodyH"],
        "frames": [
            {"x": placed[i][0], "y": placed[i][1], "w": images[i].width, "h": images[i].height, "ox": ox, "oy": oy}
            for (i, ox, oy) in rects
        ],
        "clips": out_clips,
    }
    with open(OUT_JSON, "w") as fh:
        json.dump(out, fh, separators=(",", ":"))
    print(
        f"wrote {os.path.relpath(OUT_PNG, ROOT)} {size[0]}x{size[1]}, {len(rects)} frames, "
        f"cell {cell_w}x{cell_h}, {len(out_clips)} clips"
    )
    portrait(manifest)


main()
