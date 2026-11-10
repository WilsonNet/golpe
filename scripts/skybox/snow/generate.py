#!/usr/bin/env python3
"""Frostpeak: a bright alpine panorama with a timed avalanche.

The Snow theme used to be a gradient, two procedural hills and falling dots.
This is the Waterfront/Castle treatment: a 1600x600 panorama split into sky,
far, mid and near layers, plus fixed vignettes (skiers, snowboarders, Sherpas,
summit climbers, a rescue team, campers, a gondola) and a timed avalanche that
runs down the highest face after the match has been playing for a while.

    .venv/bin/python scripts/skybox/snow/generate.py

Every pixel is plotted here; no upscaling, no anti-aliasing and no colour
outside art/skybox/snow/palette.json. Shapes that cross the 1600 px seam are
drawn wrapped so the panorama tiles without a join.
"""

from __future__ import annotations

import hashlib
import json
import math
import random
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

W, H = 1600, 600
ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "public" / "assets" / "skybox" / "snow"
HAND = Path(__file__).resolve().parent
PALETTE = json.loads((ROOT / "art" / "skybox" / "snow" / "palette.json").read_text())
PAL = {h.lower(): tuple(int(h[i : i + 2], 16) for i in (1, 3, 5)) for h in PALETTE["all"]}
assert len(PAL) == len(PALETTE["all"]), "duplicate palette entries"

BAYER8 = np.array(
    [
        [0, 32, 8, 40, 2, 34, 10, 42],
        [48, 16, 56, 24, 50, 18, 58, 26],
        [12, 44, 4, 36, 14, 46, 6, 38],
        [60, 28, 52, 20, 62, 30, 54, 22],
        [3, 35, 11, 43, 1, 33, 9, 41],
        [51, 19, 59, 27, 49, 17, 57, 25],
        [15, 47, 7, 39, 13, 45, 5, 37],
        [63, 31, 55, 23, 61, 29, 53, 21],
    ],
    dtype=np.float32,
) / 64.0

USED: set[str] = set()


def C(hex_colour: str, alpha: int = 255) -> tuple[int, int, int, int]:
    h = hex_colour.lower()
    assert h in PAL, f"colour outside art/skybox/snow/palette.json: {h}"
    USED.add(h)
    r, g, b = PAL[h]
    return (r, g, b, alpha)


def bayer_mask(h: int, w: int, density: float, ox: int = 0, oy: int = 0) -> np.ndarray:
    yy = (np.arange(h, dtype=np.int32) + oy) % 8
    xx = (np.arange(w, dtype=np.int32) + ox) % 8
    return BAYER8[yy[:, None], xx[None, :]] < density


def paste_wrapped(img: Image.Image, patch: Image.Image, x: int, y: int):
    """Alpha-composite a patch, wrapping horizontally and clipping vertically."""
    if patch.width <= 0 or patch.height <= 0:
        return
    x, y = int(x), int(y)
    top = max(0, -y)
    bottom = min(patch.height, H - y)
    if bottom <= top:
        return
    p = patch.crop((0, top, patch.width, bottom))
    yy = y + top
    x0 = x % W
    if x0 + p.width <= W:
        img.alpha_composite(p, (x0, yy))
    else:
        cut = W - x0
        img.alpha_composite(p.crop((0, 0, cut, p.height)), (x0, yy))
        img.alpha_composite(p.crop((cut, 0, p.width, p.height)), (0, yy))


def dither_rect(layer: "Layer", x0, y0, x1, y1, colour, density, phase=0):
    x0, y0, x1, y1 = int(x0), int(y0), int(x1), int(y1)
    if x1 <= x0 or y1 <= y0:
        return
    h, w = y1 - y0, x1 - x0
    arr = np.zeros((h, w, 4), dtype=np.uint8)
    m = bayer_mask(h, w, density, x0 + phase, y0 + phase)
    arr[m] = C(colour)
    paste_wrapped(layer.img, Image.fromarray(arr, "RGBA"), x0, y0)


class Layer:
    def __init__(self, width=W, height=H, fill=None):
        self.w, self.h = width, height
        self.img = Image.new("RGBA", (width, height), fill if fill else (0, 0, 0, 0))
        self.d = ImageDraw.Draw(self.img)

    def _offsets(self, x0, x1):
        offs = [0]
        if x0 < 0:
            offs.append(self.w)
        if x1 >= self.w:
            offs.append(-self.w)
        return offs

    def rect(self, x0, y0, x1, y1, fill):
        for o in self._offsets(x0, x1):
            self.d.rectangle((x0 + o, y0, x1 + o, y1), fill=fill)

    def ellipse(self, x0, y0, x1, y1, fill=None, outline=None, width=1):
        for o in self._offsets(x0, x1):
            self.d.ellipse((x0 + o, y0, x1 + o, y1), fill=fill, outline=outline, width=width)

    def pieslice(self, x0, y0, x1, y1, a0, a1, fill, outline=None, width=1):
        for o in self._offsets(x0, x1):
            self.d.pieslice(
                (x0 + o, y0, x1 + o, y1), a0, a1, fill=fill, outline=outline, width=width
            )

    def arc(self, x0, y0, x1, y1, a0, a1, fill, width=1):
        for o in self._offsets(x0, x1):
            self.d.arc((x0 + o, y0, x1 + o, y1), a0, a1, fill=fill, width=width)

    def line(self, pts, fill, width=1, joint="curve"):
        if isinstance(pts, tuple):
            xs = [pts[0], pts[2]]
        else:
            xs = [p[0] for p in pts]
        x0, x1 = min(xs), max(xs)
        for o in self._offsets(x0, x1):
            if isinstance(pts, tuple):
                box = (pts[0] + o, pts[1], pts[2] + o, pts[3])
                self.d.line(box, fill=fill, width=width, joint=joint)
            else:
                self.d.line([(px + o, py) for px, py in pts], fill=fill, width=width, joint=joint)

    def polygon(self, pts, fill):
        xs = [p[0] for p in pts]
        for o in self._offsets(min(xs), max(xs)):
            self.d.polygon([(x + o, y) for x, y in pts], fill=fill)

    def rrect(self, x0, y0, x1, y1, r, fill, outline=None, width=1):
        for o in self._offsets(x0, x1):
            self.d.rounded_rectangle(
                (x0 + o, y0, x1 + o, y1), radius=r, fill=fill, outline=outline, width=width
            )

    def point(self, x, y, fill):
        if 0 <= y < self.h:
            self.img.putpixel((int(x) % self.w, int(y)), fill)

    def paste(self, patch, x, y):
        paste_wrapped(self.img, patch, x, y)


def dither_circle(layer: Layer, cx, cy, r, colour, density, phase=0):
    yy, xx = np.mgrid[0 : r * 2 + 1, 0 : r * 2 + 1]
    m = ((xx - r) ** 2 + (yy - r) ** 2 <= r * r) & bayer_mask(
        r * 2 + 1, r * 2 + 1, density, cx + phase, cy + phase
    )
    arr = np.zeros((r * 2 + 1, r * 2 + 1, 4), dtype=np.uint8)
    arr[m] = C(colour)
    paste_wrapped(layer.img, Image.fromarray(arr, "RGBA"), cx - r, cy - r)


# ---------------------------------------------------------------------------
# sky


SKY_STOPS = [
    (0.00, "#2f6b98"),
    (0.18, "#3f88ad"),
    (0.38, "#5aa6bd"),
    (0.55, "#78c2c7"),
    (0.70, "#9ad8cd"),
    (0.84, "#c6ebdc"),
    (1.00, "#eaf3df"),
]


def draw_sky() -> Layer:
    layer = Layer()
    yy, xx = np.mgrid[0:H, 0:W]
    stops = np.array([s[0] for s in SKY_STOPS], dtype=np.float32)
    cols = np.array([PAL[c] for _, c in SKY_STOPS], dtype=np.uint8)
    t = (yy / (H - 1)).astype(np.float32)
    pos = np.interp(t, stops, np.arange(len(SKY_STOPS), dtype=np.float32))
    i0 = np.clip(np.floor(pos).astype(np.int32), 0, len(cols) - 1)
    i1 = np.clip(i0 + 1, 0, len(cols) - 1)
    frac = pos - i0
    out = np.where((frac > BAYER8[yy % 8, xx % 8])[..., None], cols[i1], cols[i0])
    for c in SKY_STOPS:
        USED.add(c[1])
    layer.img = Image.fromarray(np.dstack([out, np.full((H, W), 255, np.uint8)]), "RGBA")
    layer.d = ImageDraw.Draw(layer.img)

    sun(layer, 620, 92, 48)
    # a small sun dog, the alpine ice-crystal halo
    dither_circle(layer, 620, 92, 84, "#ffe6a1", 0.10, 3)

    for cx, cy, w, seed in (
        (110, 182, 250, 3),
        (760, 164, 270, 7),
        (1010, 196, 260, 11),
        (1380, 160, 250, 13),
    ):
        cloud(layer, cx, cy, w, seed)

    for x, y in ((420, 140), (436, 132), (451, 146), (1330, 96), (1344, 90)):
        layer.line((x - 3, y, x, y + 2), C("#5a7194"))
        layer.line((x, y + 2, x + 3, y), C("#5a7194"))
    return layer


def sun(layer: Layer, cx, cy, r):
    yy, xx = np.mgrid[0:H, 0:W]
    dist = np.hypot(xx - cx, yy - cy)
    halo = np.clip((r + 58 - dist) / 58.0, 0.0, 1.0) ** 2 * 0.20
    m = (dist > r) & (bayer_mask(H, W, 1.0, 0, 0) < halo)
    arr = np.array(layer.img)
    arr[m, :3] = PAL["#fff3c9"]
    arr[m, 3] = 255
    layer.img = Image.fromarray(arr, "RGBA")
    layer.d = ImageDraw.Draw(layer.img)
    USED.add("#fff3c9")
    layer.ellipse(cx - r, cy - r, cx + r, cy + r, fill=C("#fff3c9"))
    layer.ellipse(cx - r + 5, cy - r + 5, cx + r - 5, cy + r - 5, fill=C("#ffe6a1"))
    layer.ellipse(cx - r + 11, cy - r + 9, cx + r - 13, cy + r - 11, fill=C("#fff3c9"))


def cloud(layer: Layer, cx, base_y, w, seed):
    rng = random.Random(seed)
    pad = 34
    h = int(w * 0.34)
    pw, ph = w + pad * 2, h + pad * 2
    yy, xx = np.mgrid[0:ph, 0:pw]
    spec = [
        (0.08, 0.70, 0.17),
        (0.20, 0.52, 0.25),
        (0.37, 0.38, 0.30),
        (0.55, 0.32, 0.31),
        (0.72, 0.42, 0.28),
        (0.88, 0.61, 0.22),
        (0.50, 0.60, 0.29),
        (0.31, 0.72, 0.24),
        (0.68, 0.71, 0.24),
        (0.94, 0.76, 0.15),
        (0.04, 0.79, 0.13),
    ]
    lobes = []
    union = np.zeros((ph, pw), bool)
    for fx, fy, fr in spec:
        r = h * fr * rng.uniform(0.94, 1.06)
        lcx = pad + w * fx
        lcy = pad + h * fy
        rx, ry = r * 1.08, r
        lobes.append((lcx, lcy, rx, ry))
        union |= ((xx - lcx) / max(rx, 0.1)) ** 2 + ((yy - lcy) / max(ry, 0.1)) ** 2 <= 1.0
    union |= ((xx - (pad + w * 0.5)) / (w * 0.45)) ** 2 + (
        (yy - (pad + h * 0.88)) / (h * 0.12)
    ) ** 2 <= 1.0

    arr = np.zeros((ph, pw, 4), dtype=np.uint8)
    arr[union] = C("#f4f8ff")
    shadow = np.zeros_like(union)
    shadow[4:, 3:] = union[:-4, :-3]
    arr[shadow & ~union] = C("#b4c7dc")
    # the underside stays blue-grey; the top is sunlit
    ys = np.arange(ph)[:, None]
    top = np.where(union, ys, ph + 10).min(axis=0)
    bottom = np.where(union, ys, -10).max(axis=0)
    t = np.arange(ph)[:, None] - top[None, :]
    b = bottom[None, :] - np.arange(ph)[:, None]
    arr[union & (t == 0)] = C("#e8f0fb")
    arr[union & (b == 0)] = C("#b4c7dc")
    arr[union & (b >= 1) & (b <= 3)] = C("#d2dfec")
    arr[union & (b >= 4) & (b <= 10) & bayer_mask(ph, pw, 0.35)] = C("#b4c7dc")
    layer.paste(Image.fromarray(arr, "RGBA"), cx - pw // 2, base_y - ph)


# ---------------------------------------------------------------------------
# far peaks


def peak(layer: Layer, cx, base, w, h, snow_line=0.34, seed=0):
    rng = random.Random(seed)
    top = base - h
    left, right = cx - w // 2, cx + w // 2
    # a jagged silhouette: three teeth on the way up and one shoulder on the way down
    ridge = [
        (left, base),
        (cx - int(w * 0.38), top + int(h * 0.16)),
        (cx - int(w * 0.18), top + int(h * 0.05)),
        (cx, top),
        (cx + int(w * 0.16), top + int(h * 0.12)),
        (cx + int(w * 0.34), top + int(h * 0.23)),
        (right, base),
    ]
    layer.polygon(ridge, C("#7b93b8"))
    layer.polygon(
        [(left, base), (cx - int(w * 0.38), top + int(h * 0.16)), (cx - int(w * 0.1), top + int(h * 0.22)), (cx - int(w * 0.2), base)],
        C("#5a7194"),
    )
    layer.polygon(
        [(cx, top), (cx + int(w * 0.16), top + int(h * 0.12)), (cx + int(w * 0.06), top + int(h * 0.36)), (cx - int(w * 0.12), top + int(h * 0.3))],
        C("#96aecb"),
    )
    # snow cap: follow the ridge down to the snow line, with a torn lower edge
    cap = max(1, int(h * snow_line))
    snow = ridge[:]
    layer.polygon(
        [
            (left, base),
            (cx - int(w * 0.38), top + int(h * 0.16)),
            (cx - int(w * 0.18), top + int(h * 0.05)),
            (cx, top),
            (cx + int(w * 0.16), top + int(h * 0.12)),
            (cx + int(w * 0.34), top + int(h * 0.23)),
            (right, base),
        ],
        C("#f4f8ff"),
    ) if False else None
    # lay the cap as a polygon clipped by a jagged snow line
    layer.polygon(
        [
            (cx - int(w * 0.30), top + cap),
            (cx - int(w * 0.18), top + int(h * 0.05)),
            (cx, top),
            (cx + int(w * 0.16), top + int(h * 0.12)),
            (cx + int(w * 0.26), top + cap - 8),
            (cx + int(w * 0.14), top + cap + 4),
            (cx + int(w * 0.02), top + cap - 6),
            (cx - int(w * 0.10), top + cap + 6),
        ],
        C("#f4f8ff"),
    )
    layer.polygon(
        [
            (cx - int(w * 0.30), top + cap),
            (cx - int(w * 0.18), top + int(h * 0.05)),
            (cx, top),
            (cx - int(w * 0.08), top + cap + 4),
        ],
        C("#e8f0fb"),
    )
    # rock bands and ice gullies on the exposed faces
    for i in range(6):
        yy = top + cap + rng.randint(16, max(20, h // 2))
        half = int((w / 2) * (yy - top) / h)
        x0 = cx - half + rng.randint(0, max(1, half // 3))
        layer.line((x0, yy, x0 + rng.randint(10, 34), yy + rng.randint(4, 14)), C("#6b7088"))
    for x in (cx - int(w * 0.22), cx - int(w * 0.08), cx + int(w * 0.18)):
        layer.line((x, top + cap + 8, x - 4, base - 20), C("#96aecb"))
    return top


def chalet(layer: Layer, x, y, w, h, wall="#7f5a45", roof="#f4f8ff"):
    layer.rect(x, y, x + w, y + h, C(wall))
    layer.rect(x, y, x + max(3, w // 4), y + h, C("#553a32"))
    layer.polygon([(x - 6, y + 4), (x + w // 2, y - h // 2), (x + w + 6, y + 4)], C(roof))
    layer.polygon([(x - 4, y + 4), (x + w // 2, y - h // 2 + 4), (x + w - 2, y + 4)], C("#e8f0fb"))
    layer.line((x - 6, y + 4, x + w + 6, y + 4), C("#96aecb"))
    for wx in range(x + 5, x + w - 5, 12):
        layer.rect(wx, y + 8, wx + 6, y + 14, C("#f7c85f"))
        layer.point(wx + 1, y + 9, C("#fff3c9"))
    layer.rect(x + w - 8, y - h // 2 - 6, x + w - 4, y - h // 2, C("#565b73"))
    layer.point(x + w - 6, y - h // 2 - 8, C("#e8f0fb"))


def draw_far() -> Layer:
    layer = Layer()
    layer.rect(0, 470, W, H, C("#7b93b8"))
    # side ranges, with a jagged snow line instead of one triangle each
    peak(layer, 90, 500, 380, 210, 0.40, 2)
    peak(layer, 280, 500, 300, 150, 0.42, 3)
    peak(layer, 760, 500, 420, 240, 0.38, 4)
    peak(layer, 1000, 500, 300, 190, 0.40, 5)
    peak(layer, 1300, 500, 420, 260, 0.36, 6)
    peak(layer, 1520, 500, 300, 170, 0.42, 7)
    # the high summit the climbers stand on
    top = peak(layer, 470, 490, 460, 380, 0.30, 11)
    # the avalanche chute on the summit's right face: dark rock and two snow
    # banks, so the timed plume has a place to fall out of
    layer.polygon([(540, 150), (612, 150), (690, 360), (654, 436), (580, 284)], C("#565b73"))
    layer.polygon([(540, 150), (560, 168), (604, 316), (580, 284)], C("#6b7088"))
    layer.polygon([(528, 150), (540, 150), (580, 284), (554, 310)], C("#f4f8ff"))
    layer.polygon([(612, 150), (626, 150), (676, 350), (654, 436)], C("#e8f0fb"))
    for x, y in ((570, 190), (592, 236), (614, 286), (636, 334)):
        layer.line((x, y, x + 12, y + 18), C("#43475e"))
    # a ridge of broken rock and snow across the summit's shoulders
    for x, y, w in ((300, 260, 52), (360, 214, 64), (560, 230, 58), (620, 286, 46)):
        layer.polygon([(x, y + 18), (x + w // 2, y), (x + w, y + 18)], C("#6b7088"))
        layer.polygon([(x + 6, y + 18), (x + w // 2, y + 2), (x + w - 6, y + 18)], C("#f4f8ff"))
    layer.rect(0, 488, W, 512, C("#e8f0fb"))
    layer.line((0, 488, W, 488), C("#f4f8ff"), width=2)
    # a distant village on a shelf, with warm windows and steep snow roofs
    for x, y, w, h in (
        (930, 360, 50, 34),
        (988, 372, 38, 28),
        (1030, 352, 64, 42),
        (1100, 368, 36, 26),
        (1140, 358, 54, 38),
    ):
        chalet(layer, x, y, w, h, "#565b73", "#f4f8ff")
    # a pale valley floor and a frozen stream
    layer.rect(0, 500, W, 520, C("#d2dfec"))
    for x in range(0, W, 40):
        layer.point(x, 506, C("#f4f8ff"))
    # the top cable station, and a pylon on the far ridge
    layer.rect(1120, 300, 1180, 336, C("#6b4a3e"))
    layer.polygon([(1114, 300), (1150, 276), (1186, 300)], C("#f4f8ff"))
    layer.line((1150, 276, 1150, 340), C("#3f2b26"))
    layer.line((1150, 276, 1150, 260), C("#43475e"), width=2)
    return layer


def pine(layer: Layer, cx, base_y, h, dark=False):
    body = "#2f6c4d" if not dark else "#235342"
    light = "#478a58" if not dark else "#2f6c4d"
    layer.line((cx, base_y, cx, base_y - h), C("#553a32"), width=2)
    for tier in range(3):
        tw = (h / 2.2) * (1 - tier * 0.22)
        ty = base_y - (h / 3) * tier
        layer.polygon([(cx - tw / 2, ty), (cx, ty - h / 2.2), (cx + tw / 2, ty)], C(body))
        layer.polygon([(cx - tw / 2 + 2, ty - 2), (cx, ty - h / 2.2 + 2), (cx, ty - 2)], C(light))
    layer.polygon(
        [
            (cx - 4, base_y - h / 1.5 + 4),
            (cx, base_y - h / 1.5 - h / 2.2 + 20),
            (cx + 4, base_y - h / 1.5 + 4),
        ],
        C("#f4f8ff"),
    )


def slalom_gate(layer: Layer, x, y, colour):
    layer.line((x, y, x, y - 24), C("#6b4a3e"))
    layer.line((x + 28, y, x + 28, y - 24), C("#6b4a3e"))
    layer.polygon([(x, y - 24), (x + 12, y - 20), (x, y - 14)], C(colour))
    layer.polygon([(x + 28, y - 24), (x + 16, y - 20), (x + 28, y - 14)], C(colour))


def static_skier(layer: Layer, x, y, jacket, flip=False):
    s = -1 if flip else 1
    layer.line((x - 6, y, x + 5, y - 2), C("#3b395e"), width=2)
    layer.rect(x - 1, y - 9, x + 3, y - 2, C(jacket))
    layer.ellipse(x, y - 13, x + 4, y - 9, fill=C("#f2c9a0"))
    layer.rect(x - 1, y - 14, x + 5, y - 12, C("#f4f8ff"))
    layer.line((x + 3, y - 8, x + 8 * s, y - 3), C("#96aecb"))
    layer.line((x, y - 8, x - 5 * s, y - 3), C("#96aecb"))




def static_person(layer: Layer, x, y, jacket):
    layer.rect(x, y - 8, x + 3, y - 2, C(jacket))
    layer.ellipse(x, y - 11, x + 3, y - 8, fill=C("#f2c9a0"))
    layer.rect(x, y - 12, x + 3, y - 10, C("#2d2b4b"))
    layer.rect(x, y - 2, x + 1, y, C("#2d2b4b"))
    layer.rect(x + 2, y - 2, x + 3, y, C("#2d2b4b"))


def ski_track(layer: Layer, pts, colour="#b4c7dc"):
    for i in range(len(pts) - 1):
        layer.line((pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]), C(colour), width=2)
    for i in range(0, len(pts) - 1, 4):
        x0, y0 = pts[i]
        x1, y1 = pts[i + 1]
        layer.line((x0 + 2, y0, x1 + 2, y1), C("#f4f8ff"))


def cable_tower(layer: Layer, x, top, base):
    layer.line((x, top, x, base), C("#565b73"), width=4)
    layer.line((x - 10, top + 16, x + 10, top + 16), C("#6b7088"), width=3)
    layer.line((x - 7, top + 44, x + 7, top + 44), C("#6b7088"), width=3)
    layer.line((x - 10, top + 16, x, top), C("#6b7088"), width=2)
    layer.line((x + 10, top + 16, x, top), C("#6b7088"), width=2)
    layer.rect(x - 12, top + 4, x + 12, top + 10, C("#43475e"))
    for i in range(4):
        layer.point(x - 8 + i * 5, top + 7, C("#96aecb"))


def draw_mid() -> Layer:
    layer = Layer()
    # the bowl: a broad snow slope with a lit piste winding down it
    layer.rect(0, 300, W, 600, C("#d2dfec"))
    layer.polygon([(0, 300), (1600, 390), (1600, 600), (0, 600)], C("#e8f0fb"))
    layer.polygon([(0, 300), (760, 342), (760, 600), (0, 600)], C("#f4f8ff"))
    piste = [
        (60, 340),
        (330, 360),
        (500, 402),
        (610, 470),
        (668, 545),
        (650, 600),
        (350, 600),
        (306, 520),
        (270, 450),
        (190, 392),
        (80, 365),
    ]
    layer.polygon(piste, C("#f4f8ff"))
    layer.line([(60, 340), (330, 360), (500, 402), (610, 470), (668, 545), (650, 600)], C("#b4c7dc"), width=3)
    layer.line([(80, 365), (190, 392), (270, 450), (306, 520), (350, 600)], C("#b4c7dc"), width=3)
    for i, (x, y) in enumerate(((150, 380), (300, 420), (430, 460), (540, 520), (600, 570))):
        layer.ellipse(x - 18 - i * 2, y - 3, x + 18 + i * 2, y + 3, fill=C("#e8f0fb"))
        layer.point(x, y, C("#f4f8ff"))
    # a cross-slope ridge, so the bowl has a second plane
    layer.polygon([(0, 452), (420, 470), (760, 500), (760, 512), (0, 474)], C("#e8f0fb"))
    layer.line((0, 474, 760, 512), C("#b4c7dc"), width=2)
    # rock outcrops with caps, kept out of the piste
    for x, y, w, h in (
        (40, 500, 86, 38),
        (270, 548, 72, 26),
        (740, 520, 94, 32),
        (930, 500, 110, 40),
        (1180, 540, 96, 34),
        (1400, 510, 84, 30),
    ):
        layer.polygon([(x, y + h), (x + w // 2, y), (x + w, y + h)], C("#6b7088"))
        layer.polygon([(x + w // 4, y + h), (x + w // 2, y + 5), (x + w // 2, y + h)], C("#565b73"))
        layer.polygon(
            [(x + w // 2 - 12, y + 8), (x + w // 2, y), (x + w // 2 + 14, y + 12)],
            C("#f4f8ff"),
        )
    # pine belts on the lower slopes and the edges
    for x, h in (
        (18, 78), (52, 62), (86, 94), (150, 54), (710, 60), (900, 80), (950, 56),
        (1010, 92), (1250, 72), (1300, 54), (1490, 82), (1550, 64),
    ):
        pine(layer, x, 566, h, dark=(x // 100) % 2 == 0)
    # the base lodge: two chalets, terrace, flags and a ski rack
    chalet(layer, 54, 470, 108, 76, "#7f5a45", "#f4f8ff")
    chalet(layer, 168, 500, 78, 52, "#6b4a3e", "#e8f0fb")
    layer.rect(62, 548, 248, 568, C("#7f5a45"))
    layer.line((62, 548, 248, 548), C("#f4f8ff"))
    for x in (76, 108, 140, 172, 204):
        layer.rect(x, 552, x + 10, 568, C("#553a32"))
        layer.point(x + 5, 555, C("#ffe08a"))
    for x, c1, c2 in ((86, "#d24f4a", "#f4f8ff"), (130, "#4c7fc0", "#f4f8ff")):
        layer.line((x, 524, x, 548), C("#6b4a3e"))
        layer.pieslice(x - 12, 512, x + 12, 530, 180, 360, C(c1))
        layer.pieslice(x - 10, 514, x + 10, 528, 180, 360, C(c2))
        layer.line((x - 10, 528, x + 10, 528), C("#6b4a3e"))
    for x in (216, 228, 240):
        layer.line((x, 534, x, 568), C("#6b4a3e"))
    layer.line((216, 544, 240, 544), C("#96aecb"))
    layer.line((250, 450, 250, 566), C("#6b4a3e"), width=2)
    layer.polygon([(250, 450), (282, 458), (250, 468)], C("#d24f4a"))
    # rescue hut with a red cross, a snowmobile and a red route marker
    chalet(layer, 642, 466, 88, 78, "#6b4a3e", "#f4f8ff")
    layer.rect(672, 500, 700, 544, C("#f4f8ff"))
    layer.rect(682, 488, 690, 556, C("#d24f4a"))
    layer.rect(660, 518, 712, 526, C("#d24f4a"))
    layer.rect(624, 544, 676, 564, C("#3f2b26"))
    layer.rect(628, 536, 672, 546, C("#4c4a72"))
    layer.ellipse(630, 558, 644, 572, fill=C("#22213a"))
    layer.ellipse(656, 558, 670, 572, fill=C("#22213a"))
    layer.line((668, 544, 688, 530), C("#96aecb"))
    layer.line((740, 480, 740, 566), C("#6b4a3e"), width=2)
    layer.polygon([(740, 480), (768, 488), (740, 498)], C("#d24f4a"))
    # camp: three tents, a big fire, a lantern and a clothes line
    for x, w, h, colour in ((510, 44, 32, "#d24f4a"), (548, 36, 26, "#4c7fc0"), (578, 30, 22, "#d24f4a")):
        layer.polygon([(x, 552), (x + w // 2, 552 - h), (x + w, 552)], C(colour))
        layer.polygon([(x + 3, 552), (x + w // 2, 552 - h + 3), (x + w // 2, 552)], C("#2d2b4b"))
        layer.line((x + w // 2, 552 - h, x + w // 2, 552 - h - 7), C("#3f2b26"))
        layer.polygon([(x + w // 2, 552 - h - 7), (x + w // 2 + 6, 552 - h - 4), (x + w // 2, 552 - h - 1)], C("#f7c85f"))
    dither_circle(layer, 492, 552, 26, "#f26a4f", 0.16, 3)
    dither_circle(layer, 492, 552, 14, "#ffe08a", 0.20, 1)
    layer.line((482, 554, 502, 550), C("#553a32"), width=2)
    layer.line((482, 550, 502, 554), C("#6b4a3e"), width=2)
    layer.ellipse(486, 542, 498, 554, fill=C("#f26a4f"))
    layer.rect(491, 542, 494, 550, C("#ffe08a"))
    layer.point(492, 540, C("#fff3c9"))
    for x in (510, 538):
        layer.line((x, 508, x, 520), C("#6b4a3e"))
    layer.line((504, 508, 544, 508), C("#96aecb"))
    # snowpark: a big kicker, a rail, and blue/red markers
    layer.polygon([(350, 566), (430, 500), (448, 566)], C("#f4f8ff"))
    layer.polygon([(356, 566), (430, 506), (436, 566)], C("#d2dfec"))
    layer.line((430, 500, 448, 566), C("#96aecb"))
    layer.line((350, 566, 430, 500), C("#b4c7dc"))
    layer.rect(428, 500, 446, 506, C("#7f5a45"))
    layer.line((806, 540, 884, 540), C("#6b4a3e"), width=4)
    for x in (810, 880):
        layer.line((x, 540, x, 566), C("#6b4a3e"))
    for x, c in ((356, "#4c7fc0"), (488, "#d24f4a"), (802, "#4c7fc0"), (890, "#d24f4a")):
        layer.line((x, 512, x, 566), C("#6b4a3e"))
        layer.polygon([(x, 512), (x + 12, 516), (x, 524)], C(c))
    # cable car: two pylons, the cable and the mid station
    cable_tower(layer, 560, 220, 548)
    cable_tower(layer, 900, 200, 520)
    cable_tower(layer, 1240, 216, 540)
    layer.line((520, 258, 1280, 238), C("#43475e"), width=1)
    layer.line((520, 260, 1280, 240), C("#96aecb"), width=1)
    layer.rect(872, 456, 936, 492, C("#6b4a3e"))
    layer.polygon([(866, 456), (904, 432), (942, 456)], C("#f4f8ff"))
    layer.rect(884, 466, 924, 480, C("#f7c85f"))
    # slalom gates down the piste
    slalom_gate(layer, 190, 440, "#d24f4a")
    slalom_gate(layer, 300, 490, "#4c7fc0")
    slalom_gate(layer, 470, 420, "#d24f4a")
    slalom_gate(layer, 610, 470, "#4c7fc0")
    slalom_gate(layer, 700, 540, "#d24f4a")
    # a second hamlet and a small park on the far side of the bowl, so the
    # panorama reads when a wider map scrolls past the hero crop
    chalet(layer, 1004, 488, 84, 62, "#6b4a3e", "#f4f8ff")
    chalet(layer, 1088, 508, 64, 44, "#7f5a45", "#e8f0fb")
    for x in (1014, 1042, 1100):
        layer.rect(x, 536, x + 8, 548, C("#f7c85f"))
    layer.line((1160, 480, 1160, 566), C("#6b4a3e"), width=2)
    layer.polygon([(1160, 480), (1188, 488), (1160, 498)], C("#4c7fc0"))
    layer.polygon([(1200, 566), (1260, 516), (1276, 566)], C("#f4f8ff"))
    layer.line((1260, 516, 1276, 566), C("#96aecb"))
    layer.rect(1258, 516, 1274, 522, C("#7f5a45"))
    for x, c in ((1194, "#4c7fc0"), (1282, "#d24f4a")):
        layer.line((x, 528, x, 566), C("#6b4a3e"))
        layer.polygon([(x, 528), (x + 12, 532), (x, 540)], C(c))
    slalom_gate(layer, 920, 500, "#d24f4a")
    slalom_gate(layer, 1320, 520, "#4c7fc0")
    # a ridge line and wind ripples: the bowl is a surface, not a paper wedge
    layer.line([(0, 424), (180, 430), (360, 442), (540, 456), (760, 474), (980, 492), (1600, 540)], C("#b4c7dc"), width=2)
    for x, y, w in ((60, 438, 34), (160, 448, 28), (420, 470, 40), (560, 486, 30), (900, 512, 44), (1120, 530, 36), (1340, 544, 30)):
        layer.arc(x, y - 3, x + w, y + 3, 200, 340, C("#e8f0fb"), 1)
        layer.point(x + w // 2, y - 3, C("#f4f8ff"))
    # a ski school and spectators around the lodge terrace
    for i, x in enumerate((260, 276, 292, 308, 324)):
        static_skier(layer, x, 500 + (i % 2) * 4, "#d24f4a" if i % 2 == 0 else "#4c7fc0", flip=i % 2 == 0)
    for i, x in enumerate((64, 82, 100, 118, 136, 154)):
        static_person(layer, x, 548, ("#d24f4a", "#4c7fc0", "#f7c85f", "#8e6bc0")[i % 4])
    for i, x in enumerate((980, 996, 1012)):
        static_skier(layer, x, 528 + (i % 2) * 3, "#d24f4a" if i % 2 == 0 else "#4c7fc0", flip=i % 2 == 1)
    # a race start banner, a piste sign and a lift hut: saturated landmarks
    for x0, x1, y0, y1, c in ((138, 238, 338, 352, "#d24f4a"), (138, 238, 352, 362, "#f4f8ff")):
        layer.polygon([(x0, y0), (x1, y1 - 4), (x1, y1 + 4), (x0, y0 + 8)], C(c))
    layer.line((138, 338, 138, 404), C("#6b4a3e"), width=2)
    layer.line((238, 348, 238, 414), C("#6b4a3e"), width=2)
    layer.line((250, 470, 250, 548), C("#6b4a3e"), width=3)
    layer.rect(242, 470, 304, 496, C("#7f5a45"))
    layer.rect(246, 474, 300, 492, C("#f4f8ff"))
    layer.line((258, 482, 270, 474), C("#4c7fc0"), width=2)
    layer.line((258, 482, 270, 490), C("#4c7fc0"), width=2)
    layer.line((258, 482, 246, 482), C("#4c7fc0"), width=2)
    layer.line((258, 482, 282, 482), C("#4c7fc0"), width=2)
    layer.line((264, 476, 264, 488), C("#4c7fc0"), width=2)
    layer.rect(522, 452, 596, 490, C("#6b4a3e"))
    layer.polygon([(516, 452), (559, 432), (602, 452)], C("#d24f4a"))
    layer.rect(534, 462, 584, 480, C("#f7c85f"))
    # a flat ski-school shelf, a wide kicker and its landing
    layer.polygon([(236, 500), (344, 500), (352, 512), (228, 512)], C("#f4f8ff"))
    layer.line((228, 512, 352, 512), C("#b4c7dc"), width=2)
    layer.rect(228, 512, 352, 516, C("#e8f0fb"))
    layer.polygon([(360, 566), (460, 486), (484, 566)], C("#f4f8ff"))
    layer.polygon([(366, 566), (460, 492), (470, 566)], C("#d2dfec"))
    layer.line((460, 486, 484, 566), C("#96aecb"))
    layer.line((360, 566, 460, 486), C("#b4c7dc"))
    layer.rect(458, 486, 484, 494, C("#7f5a45"))
    # a packed traverse from the lodge to the rescue hut
    layer.rect(200, 546, 720, 550, C("#e8f0fb"))
    layer.line((200, 546, 720, 546), C("#f4f8ff"))
    layer.line((200, 550, 720, 550), C("#b4c7dc"))
    # more skiers on the piste, so the bowl is not a solo run
    for x, y, c, flip in ((430, 452, "#4c7fc0", False), (560, 500, "#d24f4a", True), (660, 546, "#4c7fc0", False)):
        static_skier(layer, x, y, c, flip=flip)
    # sunlight and shadow bands across the snow
    dither_rect(layer, 780, 320, 1600, 470, "#fff3c9", 0.06, 3)
    dither_rect(layer, 0, 430, 760, 520, "#b4c7dc", 0.08, 5)
    for x0, y0, x1, y1 in ((100, 390, 210, 392), (300, 420, 430, 422), (520, 470, 650, 472)):
        layer.line((x0, y0, x1, y1), C("#fff3c9"))
    # ski tracks and snow drifts
    for pts in (
        [(140, 372), (240, 420), (330, 486), (370, 560)],
        [(420, 400), (500, 462), (540, 530), (560, 590)],
        [(680, 470), (730, 520), (760, 580)],
    ):
        ski_track(layer, pts)
    for x in range(20, W, 90):
        layer.ellipse(x, 560, x + 56, 572, fill=C("#d2dfec"))
        layer.ellipse(x + 8, 556, x + 44, 564, fill=C("#f4f8ff"))
    return layer


def draw_near() -> Layer:
    layer = Layer()
    # a foreground snowbank with a blue shadow; the arena floor covers the rest
    layer.rect(0, 552, W, 600, C("#d2dfec"))
    layer.rect(0, 552, W, 556, C("#f4f8ff"))
    layer.polygon([(0, 560), (1600, 556), (1600, 600), (0, 600)], C("#b4c7dc"))
    layer.polygon([(0, 564), (1600, 560), (1600, 570), (0, 574)], C("#e8f0fb"))
    for x in range(0, W, 64):
        layer.ellipse(x - 10, 550, x + 52, 568, fill=C("#e8f0fb"))
        layer.point(x + 12, 552, C("#f4f8ff"))
    for x, h in ((26, 78), (104, 58), (1470, 68), (1540, 86)):
        pine(layer, x, 556, h, dark=True)
    # a wooden fence on the left, a rescue marker on the right
    for x in range(200, 420, 34):
        layer.line((x, 544, x, 574), C("#6b4a3e"), width=3)
    layer.line((200, 550, 420, 550), C("#7f5a45"))
    layer.line((200, 562, 420, 562), C("#553a32"))
    layer.line((1430, 544, 1430, 580), C("#6b4a3e"), width=3)
    layer.rect(1422, 532, 1438, 548, C("#d24f4a"))
    layer.rect(1428, 524, 1432, 556, C("#f4f8ff"))
    layer.rect(1412, 536, 1448, 540, C("#f4f8ff"))
    return layer


# ---------------------------------------------------------------------------
# strips


def strip(w: int, h: int, frames: int) -> Image.Image:
    return Image.new("RGBA", (w * frames, h), (0, 0, 0, 0))



def draw_slope_skier_strip() -> Image.Image:
    """A skier that carries its own patch of piste.

    The strip is marked `filtered` in the manifest, so the runtime keeps it in
    the background container: it gets the same blur, desaturation and darkening
    as the painted slope. The opaque snow base under the skis is what makes it
    read as part of the surface instead of a sprite flying over it.
    """
    fw, fh, n = 36, 44, 6
    out = strip(fw, fh, n)
    for f in range(n):
        img = Image.new("RGBA", (fw, fh), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        lean = [-2, -1, 0, 2, 1, 0][f]
        pole = [0, 2, 4, 2, 0, -2][f]
        # the piste patch: same #f4f8ff as the run, a shadow at the front
        d.ellipse((1, 34, 35, 42), fill=C("#f4f8ff"))
        d.ellipse((4, 36, 30, 42), fill=C("#e8f0fb"))
        d.ellipse((8, 37, 26, 41), fill=C("#f4f8ff"))
        d.line((1, 42, 35, 42), C("#b4c7dc"))
        d.line((0, 40, 10, 42), C("#b4c7dc"))
        # skis, parallel to the fall line
        x = 18 + lean
        d.line((x - 13, 37, x + 10, 40), C("#3b395e"), width=2)
        d.line((x - 11, 34, x + 10, 37), C("#4c7fc0"), width=2)
        # legs, jacket, head
        d.polygon([(x - 2, 23), (x + 4, 22), (x + 6, 35), (x - 1, 35)], C("#2f5f9e"))
        d.polygon([(x - 4, 16), (x + 6, 15), (x + 8, 26), (x - 3, 26)], C("#d24f4a"))
        d.ellipse((x - 3, 8, x + 5, 17), fill=C("#f2c9a0"))
        d.rectangle((x - 3, 6, x + 6, 10), fill=C("#f4f8ff"))
        # arms and poles
        d.line((x + 5, 20, x + 13 + pole, 31), C("#96aecb"))
        d.line((x - 3, 20, x - 10 + pole, 31), C("#96aecb"))
        # spray kicked by the carve
        for i in range(4):
            d.point((x + 7 + i * 2, 35 - i % 2), C("#f4f8ff"))
        out.paste(img, (f * fw, 0))
    return out


def draw_boarder_strip() -> Image.Image:
    fw, fh, n = 52, 44, 6
    out = strip(fw, fh, n)
    lift = [0, -6, -14, -13, -6, 0]
    spin = [0, 20, 55, 100, 140, 0]
    for f in range(n):
        img = Image.new("RGBA", (fw, fh), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        cx, cy = 26, 31 + lift[f]
        if f in (1, 2, 3):
            for i in range(6):
                d.point((10 + i * 5, 38 - i), C("#f4f8ff"))
        # body, head, arms
        d.rectangle((cx - 5, cy - 12, cx + 5, cy + 3), fill=C("#f26a4f"))
        d.rectangle((cx - 4, cy - 22, cx + 4, cy - 12), fill=C("#f2c9a0"))
        d.rectangle((cx - 5, cy - 25, cx + 5, cy - 21), fill=C("#4c7fc0"))
        d.line((cx - 6, cy - 7, cx + 9, cy - 17), C("#f26a4f"), width=3)
        d.line((cx + 6, cy - 5, cx - 9, cy - 15), C("#f26a4f"), width=3)
        # the board rotates under the feet
        ang = math.radians(spin[f])
        bx, by = math.cos(ang) * 14, math.sin(ang) * 5
        d.line((cx - bx, cy + 3 - by, cx + bx, cy + 3 + by), C("#d24f4a"), width=5)
        d.line((cx - bx + 3, cy + 1 - by, cx + bx - 3, cy + 1 + by), C("#f7c85f"))
        out.paste(img, (f * fw, 0))
    return out

def draw_sherpa_strip() -> Image.Image:
    fw, fh, n = 54, 28, 4
    out = strip(fw, fh, n)
    for f in range(n):
        img = Image.new("RGBA", (fw, fh), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        for i, x in enumerate((6, 22, 38)):
            step = 3 if (f + i) % 2 == 0 else -3
            d.rectangle((x, 18, x + 3, 27), fill=C("#3f2b26"))
            d.rectangle((x - 1, 10, x + 5, 18), fill=C("#d24f4a" if i % 2 == 0 else "#4c7fc0"))
            d.ellipse((x, 5, x + 5, 11), fill=C("#f2c9a0"))
            d.rectangle((x - 1, 3, x + 6, 6), fill=C("#2d2b4b"))
            # the load: a pack above the shoulders
            d.rectangle((x - 5, 6, x + 1, 16), fill=C("#6b4a3e"))
            d.rectangle((x - 4, 5, x + 1, 15), fill=C("#7f5a45"))
            d.line((x - 4, 10, x + 1, 10), C("#553a32"))
            d.line((x + 2, 18, x + 7 + step, 27), C("#3f2b26"))
            # ice axe on the pack
            d.line((x - 4, 4, x - 2, 12), C("#96aecb"))
        # the lead porter plants a route flag
        d.line((50, 5, 50, 27), C("#6b4a3e"))
        d.polygon([(50, 5), (50, 6), (54, 7)], C("#f7c85f"))
        out.paste(img, (f * fw, 0))
    return out

def draw_climber_strip() -> Image.Image:
    fw, fh, n = 48, 36, 4
    out = strip(fw, fh, n)
    for f in range(n):
        img = Image.new("RGBA", (fw, fh), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        # two climbers in bright shells; one plants the summit flag
        for x, colour in ((6, "#d24f4a"), (20, "#4c7fc0")):
            d.rectangle((x, 28, x + 4, 35), fill=C("#2d2b4b"))
            d.rectangle((x - 2, 17, x + 7, 28), fill=C(colour))
            d.ellipse((x, 10, x + 7, 18), fill=C("#f2c9a0"))
            d.rectangle((x - 2, 7, x + 8, 11), fill=C("#f4f8ff"))
            d.line((x + 6, 20, x + 13, 11), C("#96aecb"))
            d.line((x + 6, 21, x + 11, 29), C("#3f2b26"))
        # ice axes
        d.line((36, 28, 42, 12), C("#96aecb"))
        d.line((37, 27, 43, 11), C("#f4f8ff"))
        # summit flag, waving
        d.line((41, 10, 41, 33), C("#553a32"))
        wave = 4 if f % 2 == 0 else 7
        d.polygon([(41, 10), (41 + wave, 11), (41, 17)], C("#f7c85f"))
        d.polygon([(41, 17), (41 + wave - 1, 18), (41, 23)], C("#d24f4a"))
        out.paste(img, (f * fw, 0))
    return out

def draw_rescue_strip() -> Image.Image:
    fw, fh, n = 54, 30, 4
    out = strip(fw, fh, n)
    for f in range(n):
        img = Image.new("RGBA", (fw, fh), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        # two medics carrying a stretcher
        for x, colour in ((4, "#d24f4a"), (38, "#4c7fc0")):
            d.rectangle((x, 19, x + 4, 29), fill=C("#2d2b4b"))
            d.rectangle((x - 1, 10, x + 6, 19), fill=C(colour))
            d.ellipse((x, 4, x + 6, 11), fill=C("#f2c9a0"))
            d.rectangle((x - 1, 2, x + 7, 5), fill=C("#f4f8ff"))
        # stretcher, patient and red cross
        d.rectangle((16, 14, 38, 21), fill=C("#7f5a45"))
        d.rectangle((18, 11, 36, 15), fill=C("#f4f8ff"))
        d.rectangle((25, 9, 29, 16), fill=C("#d24f4a"))
        d.rectangle((22, 12, 32, 13), fill=C("#d24f4a"))
        d.line((4, 14, 16, 18), C("#96aecb"))
        d.line((38, 18, 50, 14), C("#96aecb"))
        # rescue dog at the front
        d.ellipse((44, 22, 52, 28), fill=C("#6b4a3e"))
        d.ellipse((50, 20, 54, 25), fill=C("#7f5a45"))
        d.point((52, 22), C("#22213a"))
        d.line((45, 28, 45, 30), C("#3f2b26"))
        d.line((50, 28, 50, 30), C("#3f2b26"))
        out.paste(img, (f * fw, 0))
    return out

def draw_camper_strip() -> Image.Image:
    fw, fh, n = 48, 28, 4
    out = strip(fw, fh, n)
    for f in range(n):
        img = Image.new("RGBA", (fw, fh), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        # two people on a log, one raising a mug
        for x, colour in ((7, "#4c7fc0"), (29, "#d24f4a")):
            d.rectangle((x - 1, 11, x + 6, 20), fill=C(colour))
            d.ellipse((x, 4, x + 7, 12), fill=C("#f2c9a0"))
            d.rectangle((x - 1, 2, x + 8, 5), fill=C("#2d2b4b"))
            d.rectangle((x - 2, 20, x + 8, 24), fill=C("#6b4a3e"))
        arm = 4 if f % 2 == 0 else 1
        d.line((36, 13, 41, 7 - arm), C("#f2c9a0"), width=2)
        d.rectangle((40, 4 - arm, 44, 8 - arm), fill=C("#f4f8ff"))
        # a bigger fire
        d.ellipse((17, 16, 29, 26), fill=C("#d24f4a"))
        d.ellipse((19, 13, 27, 22), fill=C("#f26a4f"))
        d.ellipse((21, 11, 25, 18), fill=C("#ffe08a"))
        d.point((23, 10), C("#fff3c9"))
        d.line((16, 26, 30, 26), C("#7f5a45"))
        out.paste(img, (f * fw, 0))
    return out

def draw_gondola_strip() -> Image.Image:
    fw, fh, n = 40, 28, 4
    out = strip(fw, fh, n)
    sway = [-1, 0, 1, 0]
    for f in range(n):
        img = Image.new("RGBA", (fw, fh), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        x = 20 + sway[f]
        # the grip and hanger
        d.line((x - 5, 0, x + 5, 0), C("#43475e"), width=3)
        d.line((x, 0, x, 8), C("#565b73"), width=2)
        # the chair: two seated people, skis hanging under it
        d.rounded_rectangle((x - 12, 8, x + 12, 22), 3, fill=C("#4c4a72"))
        d.rectangle((x - 12, 8, x + 12, 11), fill=C("#3b395e"))
        for px, colour in ((x - 6, "#d24f4a"), (x + 4, "#4c7fc0")):
            d.rectangle((px - 2, 12, px + 3, 21), fill=C(colour))
            d.ellipse((px - 2, 7, px + 3, 13), fill=C("#f2c9a0"))
            d.rectangle((px - 2, 5, px + 4, 8), fill=C("#f4f8ff"))
        d.line((x - 9, 22, x - 7, 27), C("#96aecb"), width=2)
        d.line((x + 7, 22, x + 9, 27), C("#96aecb"), width=2)
        d.line((x - 12, 22, x + 12, 22), C("#96aecb"))
        out.paste(img, (f * fw, 0))
    return out

def draw_helicopter_strip() -> Image.Image:
    fw, fh, n = 96, 48, 4
    out = strip(fw, fh, n)
    for f in range(n):
        img = Image.new("RGBA", (fw, fh), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        # tail boom, fin and tail rotor (the helicopter faces right)
        d.rectangle((12, 24, 38, 30), fill=C("#f4f8ff"))
        d.rectangle((12, 27, 38, 30), fill=C("#d24f4a"))
        d.polygon([(6, 12), (18, 12), (18, 32), (6, 26)], C("#d24f4a"))
        d.polygon([(9, 15), (16, 15), (16, 24), (9, 21)], C("#f4f8ff"))
        for k in range(4):
            yy = 10 + k * 4 + (f % 2)
            d.line((2, yy, 10, yy + 3), C("#565b73"))
        # fuselage: white top, red belly, glass cockpit at the nose
        d.rounded_rectangle((30, 16, 80, 40), 10, fill=C("#f4f8ff"))
        d.rounded_rectangle((30, 28, 80, 40), 8, fill=C("#d24f4a"))
        d.rounded_rectangle((66, 18, 84, 34), 6, fill=C("#9ad8cd"))
        d.rectangle((69, 20, 80, 27), fill=C("#f4f8ff"))
        d.line((71, 20, 71, 33), C("#5aa6bd"))
        # side window and rescue cross
        d.rounded_rectangle((48, 20, 60, 31), 4, fill=C("#9ad8cd"))
        d.rectangle((52, 22, 56, 29), fill=C("#f4f8ff"))
        d.rectangle((35, 22, 45, 32), fill=C("#f4f8ff"))
        d.rectangle((39, 20, 41, 34), fill=C("#d24f4a"))
        d.rectangle((35, 25, 45, 27), fill=C("#d24f4a"))
        # main rotor: mast, hub and blades that sweep across the frames
        d.line((55, 8, 55, 17), C("#565b73"), width=3)
        d.ellipse((51, 6, 59, 14), fill=C("#3b395e"))
        for k in range(4):
            x0 = 12 + k * 20 + (f % 2)
            d.line((x0, 5, x0 + 18, 7), C("#96aecb"))
            d.line((x0 + 4, 3, x0 + 20, 6), C("#565b73"))
        # skids and struts
        d.line((38, 40, 38, 45), C("#565b73"), width=2)
        d.line((72, 38, 72, 45), C("#565b73"), width=2)
        d.line((34, 45, 80, 45), C("#565b73"), width=3)
        d.line((38, 45, 48, 42), C("#565b73"))
        d.line((70, 45, 60, 42), C("#565b73"))
        # navigation lights
        d.point((84, 26), C("#ffe08a"))
        d.point((7, 13), C("#d24f4a"))
        out.paste(img, (f * fw, 0))
    return out

def draw_avalanche_strip() -> Image.Image:
    fw, fh, n = 128, 128, 6
    out = strip(fw, fh, n)
    for f in range(n):
        img = Image.new("RGBA", (fw, fh), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        # a rolling plume that starts in the chute and spreads down the face
        spread = 18 + f * 10
        top = 4 + f * 3
        bottom = 44 + f * 13
        d.ellipse((64 - spread, top, 64 + spread, bottom), fill=C("#e8f0fb"))
        d.ellipse((64 - spread + 5, top + 5, 64 + spread - 5, bottom - 5), fill=C("#f4f8ff"))
        for i in range(8 + f):
            r = 6 + (i % 3) * 4 + f
            x = 64 + math.sin(i * 2.3 + f) * spread * 0.8
            y = top + (i + 1) * (bottom - top) / (9 + f)
            d.ellipse((x - r, y - r, x + r, y + r), fill=C("#f4f8ff" if i % 2 else "#e8f0fb"))
        # dark rock teeth poking through the snow
        for x, y in ((38, 62), (82, 54), (58, 86), (96, 78)):
            d.polygon([(x, y + 10), (x + 5, y), (x + 10, y + 10)], C("#6b7088"))
        # the front of the slide and its spray
        d.ellipse((20, 90 + f * 2, 108, 122), fill=C("#e8f0fb"))
        d.ellipse((28, 95 + f * 2, 100, 120), fill=C("#f4f8ff"))
        for i in range(12):
            d.point((8 + i * 10, 116 + (i % 3)), C("#f4f8ff"))
            d.point((14 + i * 9, 108 + (i % 2)), C("#e8f0fb"))
        out.paste(img, (f * fw, 0))
    return out

LOOPS = {
    "clockMs": 14000,
    "groups": [
        {
            "layer": "slope-skiers",
            "actors": [
                {"u": 135, "v": 350, "frameOffset": 0, "scale": 0.85, "depth": 2},
                {"u": 282, "v": 390, "frameOffset": 1, "scale": 1.0, "depth": 1},
                {"u": 382, "v": 408, "frameOffset": 2, "scale": 1.0, "depth": 1},
                {"u": 480, "v": 422, "frameOffset": 3, "scale": 1.1, "depth": 1},
                {"u": 540, "v": 454, "frameOffset": 4, "scale": 1.1, "depth": 0},
                {"u": 628, "v": 495, "frameOffset": 5, "scale": 1.2, "depth": 0},
                {"u": 700, "v": 476, "frameOffset": 2, "scale": 1.1, "depth": 0},
                {"u": 882, "v": 458, "frameOffset": 4, "scale": 1.0, "depth": 1},
            ],
        },
        {
            "layer": "boarders",
            "actors": [
                {"u": 365, "v": 404, "frameOffset": 0, "scale": 1.0, "depth": 1},
                {"u": 788, "v": 420, "frameOffset": 3},
            ],
        },
        {
            "layer": "sherpas",
            "actors": [{"u": 260, "v": 518, "frameOffset": 0, "scale": 1.0, "depth": 0}],
        },
        {
            "layer": "climbers",
            "actors": [{"u": 450, "v": 87, "frameOffset": 0, "scale": 0.8, "depth": 2}],
        },
        {
            "layer": "rescue",
            "actors": [{"u": 630, "v": 516, "frameOffset": 1, "scale": 1.0, "depth": 0}],
        },
        {
            "layer": "campers",
            "actors": [{"u": 460, "v": 518, "frameOffset": 2, "scale": 1.0, "depth": 0}],
        },
        {
            "layer": "gondola",
            "actors": [
                {"u": 560, "v": 258, "frameOffset": 0, "depth": 1},
                {"u": 820, "v": 247, "frameOffset": 1, "depth": 1},
                {"u": 1080, "v": 241, "frameOffset": 2, "depth": 1},
            ],
        },
    ],
}

AMBIENT = {
    "loopMs": 140000,
    "groups": [
        {
            "layer": "helicopter",
            "actors": [
                {"u": 300, "v": 82, "speedX": 9.0, "bobAmp": 2.2, "bobFreq": 0.35, "phase": 0.0, "depth": 2},
                {"u": 1180, "v": 62, "speedX": 7.0, "bobAmp": 1.8, "bobFreq": 0.30, "phase": 2.2, "depth": 2},
                {"u": 930, "v": 172, "speedX": 3.5, "bobAmp": 1.2, "bobFreq": 0.22, "phase": 4.1, "depth": 1},
            ],
        },
    ],
}

TIMED = {
    "events": [
        {
            "id": "avalanche",
            "layer": "avalanche",
            "u": 540,
            "v": 140,
            "firstMs": 40000,
            "repeatMs": 75000,
            "durationMs": 9000,
        }
    ]
}


def hash12(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:12]


def manifest() -> dict:
    layers = [
        {
            "id": "sky",
            "type": "image",
            "src": "assets/skybox/snow/sky.png",
            "version": hash12(OUT / "sky.png"),
            "factor": 0.015,
            "driftX": 0.6,
            "alpha": 1,
        },
        {
            "id": "far",
            "type": "image",
            "src": "assets/skybox/snow/far.png",
            "version": hash12(OUT / "far.png"),
            "factor": 0.06,
        },
        {
            "id": "mid",
            "type": "image",
            "src": "assets/skybox/snow/mid.png",
            "version": hash12(OUT / "mid.png"),
            "factor": 0.18,
        },
        {
            "id": "slope-skiers",
            "type": "strip",
            "src": "assets/skybox/snow/slope-skiers.png",
            "version": hash12(OUT / "slope-skiers.png"),
            "factor": 0.3,
            "align": "mid",
            "filtered": True,
            "frameW": 36,
            "frameH": 44,
            "frames": 6,
            "fps": 7,
        },
        {
            "id": "near",
            "type": "image",
            "src": "assets/skybox/snow/near.png",
            "version": hash12(OUT / "near.png"),
            "factor": 0.5,
            "alpha": 0.55,
        },
        {
            "id": "boarders",
            "type": "strip",
            "src": "assets/skybox/snow/boarders.png",
            "version": hash12(OUT / "boarders.png"),
            "factor": 0.3,
            "align": "mid",
            "frameW": 52,
            "frameH": 44,
            "frames": 6,
            "fps": 8,
        },
        {
            "id": "sherpas",
            "type": "strip",
            "src": "assets/skybox/snow/sherpas.png",
            "version": hash12(OUT / "sherpas.png"),
            "factor": 0.3,
            "align": "mid",
            "frameW": 54,
            "frameH": 28,
            "frames": 4,
            "fps": 5,
        },
        {
            "id": "climbers",
            "type": "strip",
            "src": "assets/skybox/snow/climbers.png",
            "version": hash12(OUT / "climbers.png"),
            "factor": 0.12,
            "align": "far",
            "frameW": 48,
            "frameH": 36,
            "frames": 4,
            "fps": 4,
        },
        {
            "id": "rescue",
            "type": "strip",
            "src": "assets/skybox/snow/rescue.png",
            "version": hash12(OUT / "rescue.png"),
            "factor": 0.3,
            "align": "mid",
            "frameW": 54,
            "frameH": 30,
            "frames": 4,
            "fps": 5,
        },
        {
            "id": "campers",
            "type": "strip",
            "src": "assets/skybox/snow/campers.png",
            "version": hash12(OUT / "campers.png"),
            "factor": 0.3,
            "align": "mid",
            "frameW": 48,
            "frameH": 28,
            "frames": 4,
            "fps": 4,
        },
        {
            "id": "gondola",
            "type": "strip",
            "src": "assets/skybox/snow/gondola.png",
            "version": hash12(OUT / "gondola.png"),
            "factor": 0.18,
            "frameW": 40,
            "frameH": 26,
            "frames": 4,
            "fps": 4,
        },
        {
            "id": "helicopter",
            "type": "strip",
            "src": "assets/skybox/snow/helicopter.png",
            "version": hash12(OUT / "helicopter.png"),
            "factor": 0.05,
            "frameW": 96,
            "frameH": 48,
            "frames": 4,
            "fps": 12,
        },
        {
            "id": "avalanche",
            "type": "strip",
            "src": "assets/skybox/snow/avalanche.png",
            "version": hash12(OUT / "avalanche.png"),
            "factor": 0.12,
            "align": "far",
            "frameW": 128,
            "frameH": 128,
            "frames": 6,
            "fps": 3,
        },
    ]
    return {
        "name": "snow",
        "title": "Frostpeak — Alpine Noon",
        "width": W,
        "height": H,
        "haze": 0.9,
        "ambient": AMBIENT,
        "loops": LOOPS,
        "timed": TIMED,
        "layers": layers,
    }


def frame_of(strip_img: Image.Image, fw: int, fh: int, index: int) -> Image.Image:
    return strip_img.crop((index * fw, 0, (index + 1) * fw, fh))


def write_contact(images: dict[str, Image.Image], man: dict):
    contact = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    for name in ("sky", "far", "mid", "near"):
        contact.alpha_composite(images[name])
    for group in man["loops"]["groups"]:
        strip_img = images[group["layer"]]
        layer = next(l for l in man["layers"] if l["id"] == group["layer"])
        for actor in group["actors"]:
            frame = frame_of(strip_img, layer["frameW"], layer["frameH"], actor["frameOffset"])
            contact.alpha_composite(frame, (actor["u"], actor["v"]))
    for group in man["ambient"]["groups"]:
        strip_img = images[group["layer"]]
        layer = next(l for l in man["layers"] if l["id"] == group["layer"])
        for actor in group["actors"]:
            frame = frame_of(strip_img, layer["frameW"], layer["frameH"], 0)
            contact.alpha_composite(frame, (actor["u"], actor["v"]))
    event = man["timed"]["events"][0]
    strip_img = images[event["layer"]]
    layer = next(l for l in man["layers"] if l["id"] == event["layer"])
    frame = frame_of(strip_img, layer["frameW"], layer["frameH"], 2)
    contact.alpha_composite(frame, (event["u"], event["v"]))
    contact.convert("RGB").save(OUT / "contact.png")
    preview = Image.new("RGB", (W * 2, H), (0, 0, 0))
    preview.paste(contact.convert("RGB"), (0, 0))
    preview.paste(contact.convert("RGB"), (W, 0))
    preview.save(OUT / "preview-3screens.png")


def draw_all() -> dict[str, Image.Image]:
    return {
        "sky": draw_sky().img,
        "far": draw_far().img,
        "mid": draw_mid().img,
        "near": draw_near().img,
        "slope-skiers": draw_slope_skier_strip(),
        "boarders": draw_boarder_strip(),
        "sherpas": draw_sherpa_strip(),
        "climbers": draw_climber_strip(),
        "rescue": draw_rescue_strip(),
        "campers": draw_camper_strip(),
        "gondola": draw_gondola_strip(),
        "helicopter": draw_helicopter_strip(),
        "avalanche": draw_avalanche_strip(),
    }


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    images = draw_all()
    for name, image in images.items():
        image.save(OUT / f"{name}.png")
    man = manifest()
    (OUT / "manifest.json").write_text(json.dumps(man, indent="\t") + "\n")
    write_contact(images, man)
    notes = HAND / "NOTES.md"
    if notes.exists():
        (OUT / "NOTES.md").write_text(notes.read_text())
    unused = sorted(set(PAL) - USED)
    if unused:
        print("unused palette colours:", ", ".join(unused))
    print(f"wrote {len(images)} PNGs + manifest.json + contact.png to {OUT}")


if __name__ == "__main__":
    main()
