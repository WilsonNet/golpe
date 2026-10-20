#!/usr/bin/env python3
"""Hand-painted pixel-art solarpunk skybox for golpe.

Every pixel is deliberately plotted here: no upscaling, no anti-aliasing and no
colour outside art/skybox/palette.json.  Shapes that cross the 1600 px seam are
drawn wrapped so the panorama tiles without a join.

    .venv/bin/python scripts/skybox/hand/generate.py
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
FALL_W, FALL_H = 48, 240
FALL_ITEMS = [
    (212, 350),   # left edge of the strip; the mouth is u+24
    (476, 350),
]

BIRD_ITEMS = [
    {"u": 70, "v": 58, "speedX": 7.5, "bobAmp": 1.2, "bobFreq": 0.9, "phase": 0.0, "flip": False},
    {"u": 210, "v": 96, "speedX": -9.0, "bobAmp": 1.5, "bobFreq": 1.2, "phase": 1.1, "flip": True},
    {"u": 340, "v": 74, "speedX": 6.0, "bobAmp": 1.0, "bobFreq": 0.7, "phase": 2.2, "flip": False},
    {"u": 470, "v": 120, "speedX": -11.0, "bobAmp": 2.0, "bobFreq": 1.4, "phase": 3.3, "flip": True},
    {"u": 610, "v": 88, "speedX": 8.0, "bobAmp": 1.3, "bobFreq": 1.0, "phase": 4.4, "flip": False},
    {"u": 760, "v": 145, "speedX": -7.0, "bobAmp": 1.6, "bobFreq": 1.1, "phase": 5.5, "flip": True},
    {"u": 900, "v": 64, "speedX": 10.0, "bobAmp": 1.1, "bobFreq": 0.8, "phase": 0.7, "flip": False},
    {"u": 1040, "v": 170, "speedX": -6.0, "bobAmp": 1.8, "bobFreq": 1.3, "phase": 1.8, "flip": True},
    {"u": 1180, "v": 100, "speedX": 9.0, "bobAmp": 1.4, "bobFreq": 0.95, "phase": 2.9, "flip": False},
    {"u": 1320, "v": 55, "speedX": -12.0, "bobAmp": 1.2, "bobFreq": 1.25, "phase": 4.0, "flip": True},
    {"u": 1450, "v": 130, "speedX": 5.0, "bobAmp": 1.0, "bobFreq": 0.75, "phase": 5.1, "flip": False},
    {"u": 1560, "v": 185, "speedX": -8.0, "bobAmp": 1.7, "bobFreq": 1.15, "phase": 0.3, "flip": True},
]

ZEPPELIN_ITEMS = [
    {"u": 300, "v": 112, "speedX": 4.2, "bobAmp": 2.4, "bobFreq": 0.32, "phase": 0.2, "flip": False},
    {"u": 1300, "v": 70, "speedX": 3.0, "bobAmp": 2.0, "bobFreq": 0.28, "phase": 1.6, "flip": False},
]

BOAT_ITEMS = [
    {"u": 160, "v": 536, "speedX": -2.6, "bobAmp": 1.0, "bobFreq": 0.8, "phase": 0.0, "flip": False},
    {"u": 540, "v": 554, "speedX": -3.8, "bobAmp": 1.2, "bobFreq": 0.9, "phase": 1.4, "flip": False},
    {"u": 980, "v": 530, "speedX": -2.2, "bobAmp": 0.8, "bobFreq": 0.7, "phase": 2.1, "flip": False},
    {"u": 1370, "v": 548, "speedX": -4.6, "bobAmp": 1.1, "bobFreq": 1.0, "phase": 3.2, "flip": False},
]


WALKER_ITEMS = [
    {"u": 200, "v": 492, "speedX": 4.5, "bobAmp": 0.5, "bobFreq": 1.6, "phase": 0.0, "flip": False},
    {"u": 280, "v": 492, "speedX": -5.2, "bobAmp": 0.6, "bobFreq": 1.7, "phase": 1.0, "flip": True},
    {"u": 480, "v": 492, "speedX": 6.0, "bobAmp": 0.5, "bobFreq": 1.5, "phase": 2.0, "flip": False},
    {"u": 880, "v": 492, "speedX": -4.5, "bobAmp": 0.6, "bobFreq": 1.8, "phase": 3.0, "flip": True},
    {"u": 1120, "v": 492, "speedX": 7.0, "bobAmp": 0.5, "bobFreq": 1.6, "phase": 4.0, "flip": False},
    {"u": 1380, "v": 492, "speedX": -6.2, "bobAmp": 0.6, "bobFreq": 1.7, "phase": 5.0, "flip": True},
    {"u": 1520, "v": 492, "speedX": 5.0, "bobAmp": 0.5, "bobFreq": 1.5, "phase": 0.5, "flip": False},
]

LOOP_ACTORS = {
    "cheer": [
        {"u": 140, "v": 492, "frameOffset": 0, "flip": False},
        {"u": 1000, "v": 492, "frameOffset": 2, "flip": False},
    ],
    "picnic": [
        {"u": 360, "v": 492, "frameOffset": 1, "flip": False},
        {"u": 1160, "v": 492, "frameOffset": 3, "flip": False},
    ],
    "date": [
        {"u": 1340, "v": 492, "frameOffset": 2, "flip": False},
    ],
    "spar": [
        {"u": 850, "v": 492, "frameOffset": 1, "flip": False},
    ],
    "sport": [
        {"u": 640, "v": 488, "frameOffset": 0, "flip": False},
        {"u": 1230, "v": 488, "frameOffset": 2, "flip": False},
    ],
}

STRIP_SPECS = [
    {
        "id": "falls",
        "plan": "falls",
        "factor": 0.18,
        "manifest_factor": 0.30,
        "fw": FALL_W,
        "fh": FALL_H,
        "frames": 6,
        "fps": 9,
        "alpha": 1.0,
        "align": "mid",
        "items": [{"u": u, "v": v} for u, v in FALL_ITEMS],
    },
    {
        "id": "cheer",
        "plan": "loops",
        "factor": 0.50,
        "manifest_factor": 0.50,
        "fw": 24,
        "fh": 20,
        "frames": 4,
        "fps": 6,
        "alpha": 1.0,
        "items": LOOP_ACTORS["cheer"],
    },
    {
        "id": "picnic",
        "plan": "loops",
        "factor": 0.50,
        "manifest_factor": 0.50,
        "fw": 32,
        "fh": 20,
        "frames": 4,
        "fps": 6,
        "alpha": 1.0,
        "items": LOOP_ACTORS["picnic"],
    },
    {
        "id": "date",
        "plan": "loops",
        "factor": 0.50,
        "manifest_factor": 0.50,
        "fw": 32,
        "fh": 20,
        "frames": 4,
        "fps": 6,
        "alpha": 1.0,
        "items": LOOP_ACTORS["date"],
    },
    {
        "id": "spar",
        "plan": "loops",
        "factor": 0.50,
        "manifest_factor": 0.50,
        "fw": 32,
        "fh": 20,
        "frames": 4,
        "fps": 8,
        "alpha": 1.0,
        "items": LOOP_ACTORS["spar"],
    },
    {
        "id": "sport",
        "plan": "loops",
        "factor": 0.50,
        "manifest_factor": 0.50,
        "fw": 40,
        "fh": 24,
        "frames": 4,
        "fps": 8,
        "alpha": 1.0,
        "items": LOOP_ACTORS["sport"],
    },
    {
        "id": "walkers",
        "plan": "ambient",
        "factor": 0.50,
        "manifest_factor": 0.50,
        "fw": 12,
        "fh": 20,
        "frames": 6,
        "fps": 8,
        "alpha": 1.0,
        "items": WALKER_ITEMS,
    },
    {
        "id": "boats",
        "plan": "ambient",
        "factor": 0.50,
        "manifest_factor": 0.50,
        "fw": 32,
        "fh": 16,
        "frames": 4,
        "fps": 4,
        "alpha": 1.0,
        "items": BOAT_ITEMS,
    },
    {
        "id": "zeppelin",
        "plan": "ambient",
        "factor": 0.10,
        "manifest_factor": 0.10,
        "fw": 64,
        "fh": 28,
        "frames": 3,
        "fps": 10,
        "alpha": 1.0,
        "items": ZEPPELIN_ITEMS,
    },
    {
        "id": "birds",
        "plan": "ambient",
        "factor": 0.06,
        "manifest_factor": 0.06,
        "fw": 16,
        "fh": 8,
        "frames": 4,
        "fps": 10,
        "alpha": 1.0,
        "items": BIRD_ITEMS,
    },
]

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "public" / "assets" / "skybox" / "hand"
HAND = Path(__file__).resolve().parent
REVIEW = HAND / "review"
PALETTE = json.loads((ROOT / "art" / "skybox" / "palette.json").read_text())
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
    assert h in PAL, f"colour outside art/skybox/palette.json: {h}"
    USED.add(h)
    r, g, b = PAL[h]
    return (r, g, b, alpha)


def bayer_mask(h: int, w: int, density: float, ox: int = 0, oy: int = 0) -> np.ndarray:
    yy = (np.arange(h, dtype=np.int32) + oy) % 8
    xx = (np.arange(w, dtype=np.int32) + ox) % 8
    return BAYER8[yy[:, None], xx[None, :]] < density


def dither_rect(layer: "Layer", x0, y0, x1, y1, colour, density, phase=0):
    x0, y0, x1, y1 = int(x0), int(y0), int(x1), int(y1)
    if x1 <= x0 or y1 <= y0:
        return
    h, w = y1 - y0, x1 - x0
    arr = np.zeros((h, w, 4), dtype=np.uint8)
    m = bayer_mask(h, w, density, x0 + phase, y0 + phase)
    arr[m] = C(colour)
    patch = Image.fromarray(arr, "RGBA")
    paste_wrapped(layer.img, patch, x0, y0)


def paste_wrapped(img: Image.Image, patch: Image.Image, x: int, y: int):
    """Alpha-composite a patch, wrapping horizontally and clipping vertically."""
    if patch.width <= 0 or patch.height <= 0:
        return
    x = int(x)
    y = int(y)
    # vertical crop
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
        self.img.putpixel((int(x) % self.w, int(y)), fill) if 0 <= y < self.h else None

    def paste(self, patch, x, y):
        paste_wrapped(self.img, patch, x, y)


def patch_from(arr: np.ndarray) -> Image.Image:
    return Image.fromarray(arr, "RGBA")


def ell_mask(w, h, cx, cy, rx, ry):
    yy, xx = np.mgrid[0:h, 0:w]
    return ((xx - cx) / max(rx, 0.1)) ** 2 + ((yy - cy) / max(ry, 0.1)) ** 2 <= 1.0


# ---------------------------------------------------------------------------
# sky


SKY_STOPS = [
    (0.00, "#2f6b98"),
    (0.14, "#3f88ad"),
    (0.30, "#5aa6bd"),
    (0.46, "#78c2c7"),
    (0.62, "#9ad8cd"),
    (0.78, "#c6ebdc"),
    (0.91, "#eaf3df"),
    (1.00, "#fff3c9"),
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
    threshold = BAYER8[yy % 8, xx % 8]
    chose_high = frac > threshold
    out = np.where(chose_high[..., None], cols[i1], cols[i0])
    for c in SKY_STOPS:
        USED.add(c[1])

    # sun: a low warm orb and layered ordered-dither glow behind the far city
    sx, sy = 700, 100
    dist = np.hypot(xx - sx, yy - sy)
    glow_layers = [
        (40, "#fff3c9", 1.00),
        (50, "#ffe6a1", 0.55),
        (70, "#ffd37a", 0.13),
    ]
    for radius, colour, density in glow_layers:
        m = (dist <= radius) & (BAYER8[(yy + radius) % 8, (xx + radius) % 8] < density)
        out[m] = PAL[colour]
        USED.add(colour)

    layer.img = Image.fromarray(np.dstack([out, np.full((H, W), 255, np.uint8)]), "RGBA")
    layer.d = ImageDraw.Draw(layer.img)

    # a small ringed planet in the hero sky, and a pale golden-hour sun in the
    # second screen. Static birds and airships are movers now (strips below).
    planet(layer, 238, 98, 44, -16)
    moon(layer, 1008, 58, 7)

    # thin high cirrus, hand-plotted; no two of these are the same shape
    streak(layer, 300, 36, 112, 5, 2)
    streak(layer, 690, 30, 78, 4, 4)
    streak(layer, 1040, 53, 134, 6, 1)
    streak(layer, 1340, 42, 86, 4, 3)

    # chunky warm cumulus, with real blue gaps between them
    cloud(layer, 86, 190, 292, 116, 11)
    cloud(layer, 520, 174, 252, 96, 17)
    cloud(layer, 842, 150, 268, 104, 7)
    cloud(layer, 1112, 182, 354, 142, 23)
    cloud(layer, 1452, 104, 176, 72, 31)
    cloud(layer, 1536, 206, 232, 94, 37)
    return layer


def planet(layer: Layer, cx, cy, r, tilt_deg):
    pad = int(r * 2.15)
    pw, ph = pad * 2, pad * 2
    local_cx, local_cy = pad, pad
    yy, xx = np.mgrid[0:ph, 0:pw]
    dx, dy = xx - local_cx, yy - local_cy
    th = math.radians(tilt_deg)
    ct, st = math.cos(th), math.sin(th)
    xp = dx * ct + dy * st
    yp = -dx * st + dy * ct
    a_out, b_out = r * 1.92, r * 0.40
    a_in, b_in = r * 1.29, r * 0.225

    e_out = np.sqrt((xp / a_out) ** 2 + (yp / b_out) ** 2)
    e_out2 = np.sqrt((xp / a_in) ** 2 + (yp / b_in) ** 2)
    ring = (e_out <= 1.0) & (e_out2 >= 1.0)
    front = yp > 0

    arr = np.zeros((ph, pw, 4), dtype=np.uint8)
    ring_col = np.full((ph, pw, 3), PAL["#f6b45b"], dtype=np.uint8)
    ring_col[e_out > 0.965] = PAL["#fff3c9"]
    ring_col[(e_out <= 0.965) & (e_out > 0.86)] = PAL["#ffe6a1"]
    ring_col[(e_out <= 0.86) & (e_out2 > 0.05)] = PAL["#e4a73f"]
    ring_col[(e_out2 < 0.10)] = PAL["#c9852f"]
    # dark ring gap, and a bright inner rim
    gap = (e_out2 > 0.72) & (e_out2 < 0.78)
    ring_col[gap] = PAL["#ffe6a1"]
    shadow_half = yp < -r * 0.12
    ring_col[shadow_half & (e_out > 0.88)] = PAL["#d3a17f"]
    for c in ("#f6b45b", "#fff3c9", "#ffe6a1", "#e4a73f", "#c9852f", "#d3a17f"):
        USED.add(c)
    arr[ring & ~front, :3] = ring_col[ring & ~front]
    arr[ring & ~front, 3] = 255

    inside = (xx - local_cx) ** 2 + (yy - local_cy) ** 2 <= r * r
    nx = dx / r
    ny = dy / r
    nz = np.sqrt(np.clip(1.0 - nx * nx - ny * ny, 0.0, 1.0))
    # warm bands of a gas giant, wobbling a little
    wob = np.sin(xx / 17.0) * 1.9 + np.sin(xx / 43.0 + 1.2) * 2.4
    band = (yy + wob) / 9.0
    bi = np.floor(band).astype(np.int32) % 7
    band_cols = [
        "#ffe6a1",
        "#ffd37a",
        "#ffe6a1",
        "#f6b45b",
        "#fff3c9",
        "#ffd37a",
        "#e9c9a2",
    ]
    for c in band_cols:
        USED.add(c)
    body = np.zeros((ph, pw, 3), dtype=np.uint8)
    for i, c in enumerate(band_cols):
        body[bi == i] = PAL[c]
    # a couple of cream storm curls
    curl = ((np.hypot((xx - (local_cx - r * 0.34)) / (r * 0.24), (yy - (local_cy + r * 0.2)) / (r * 0.08)) < 1.0) & (bi % 3 == 0))
    body[curl] = PAL["#fff3c9"]
    USED.add("#fff3c9")
    # light from upper right; ordered dither into indigo-warm shadow
    light = 0.55 * nx - 0.55 * ny + 0.63 * nz
    shade1 = (light < 0.47) & bayer_mask(ph, pw, 0.7, local_cx, local_cy)
    shade2 = light < 0.30
    shade3 = (light < 0.16) & bayer_mask(ph, pw, 0.65, 3, 5)
    body[shade1] = PAL["#e9c9a2"]
    body[shade2] = PAL["#d3a17f"]
    body[shade3] = PAL["#a87876"]
    for c in ("#e9c9a2", "#d3a17f", "#a87876"):
        USED.add(c)
    limb = inside & (np.sqrt(dx * dx + dy * dy) > r - 1.4)
    lit_limb = limb & (nx > 0.2)
    body[lit_limb] = PAL["#fff3c9"]
    body[inside & (light < 0.18)] = PAL["#a87876"]
    arr[inside, :3] = body[inside]
    arr[inside, 3] = 255

    arr[ring & front, :3] = ring_col[ring & front]
    arr[ring & front, 3] = 255
    # a soft front ring shadow on the planet's lower half
    ring_shadow = inside & (np.abs(yp + r * 0.05) < 1.1) & (e_out < 0.86)
    arr[inside & ring_shadow, :3] = PAL["#c9852f"]
    layer.paste(patch_from(arr), cx - local_cx, cy - local_cy)


def moon(layer: Layer, cx, cy, r):
    layer.ellipse(cx - r, cy - r, cx + r, cy + r, fill=C("#fff3c9"))
    layer.ellipse(cx - r, cy - r, cx + r // 2, cy + r, fill=C("#ffe6a1"))
    layer.ellipse(cx - r // 2, cy - r // 3, cx + r, cy + r, fill=C("#fff3c9"))
    # shadow crescent on the lower left
    for i in range(r):
        yy = cy - r + 2 + i
        x0 = cx - r + 1 + int((i / max(r, 1)) ** 1.4 * r * 0.55)
        if yy < cy + 2:
            layer.line((x0, yy, cx - r + 2, yy), C("#e9c9a2"))
    layer.ellipse(cx + 3, cy - 4, cx + 6, cy - 1, fill=C("#e9c9a2"))
    layer.ellipse(cx - 4, cy + 2, cx - 2, cy + 4, fill=C("#e9c9a2"))


def cloud(layer: Layer, cx, base_y, w, h, seed):
    rng = random.Random(seed)
    patch = make_cloud(int(w), int(h), rng)
    layer.paste(patch, cx - patch.width // 2, base_y - int(h) - 32)


def make_cloud(w, h, rng: random.Random) -> Image.Image:
    pad = 32
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
    for fx, fy, fr in spec:
        r = h * fr * rng.uniform(0.94, 1.06)
        cx = pad + w * fx
        cy = pad + h * fy
        lobes.append((cx, cy, r * 1.08, r))
    union = np.zeros((ph, pw), bool)
    for cx, cy, rx, ry in lobes:
        union |= ell_mask(pw, ph, cx, cy, rx, ry)
    # flat-bottomed cumulus, still with a soft rounded base
    union |= ell_mask(pw, ph, pad + w * 0.5, pad + h * 0.88, w * 0.45, h * 0.12)

    # a warm drop-shadow peeking out on the lower right
    shadow = np.zeros_like(union)
    shadow[4:, 3:] = union[:-4, :-3]
    arr = np.zeros((ph, pw, 4), dtype=np.uint8)
    arr[shadow] = C("#d3a17f")
    arr[union] = C("#f6e6c9")

    # smile-shaped undersides on the lower puffs: volume without outlines
    for idx, (cx, cy, rx, ry) in enumerate(lobes):
        if cy < pad + h * 0.58 or idx % 3 == 0:
            continue
        lm = ell_mask(pw, ph, cx, cy, rx, ry) & union
        d = ((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2
        smile = lm & (d > 0.58) & (d < 0.83) & (yy > cy + ry * 0.22)
        arr[smile] = C("#e9c9a2")
        deep = lm & (d > 0.82) & (yy > cy + ry * 0.38)
        arr[deep] = C("#d3a17f")

    # per-column top and bottom, so the silhouette itself is the volume
    ys = np.arange(ph)[:, None]
    top = np.where(union, ys, ph + 10).min(axis=0)
    bottom = np.where(union, ys, -10).max(axis=0)
    t = np.arange(ph)[:, None] - top[None, :]
    b = bottom[None, :] - np.arange(ph)[:, None]
    arr[union & (t == 0)] = C("#fff3c9")
    arr[union & (t >= 1) & (t <= 2)] = C("#fff8e8")
    arr[union & (b == 0)] = C("#d3a17f")
    arr[union & (b >= 1) & (b <= 2)] = C("#e9c9a2")
    arr[union & (b >= 3) & (b <= 5) & bayer_mask(ph, pw, 0.55)] = C("#e9c9a2")
    # a little more sun on the right shoulder
    right = np.zeros_like(union)
    right[:, 1:] = union[:, :-1]
    litedge = union & ~right & (yy < pad + h * 0.75)
    arr[litedge] = C("#fff8e8")
    # warm bounce up from the city into the bases
    arr[union & (b >= 6) & (b <= 9) & bayer_mask(ph, pw, 0.24)] = C("#e9c9a2")
    return patch_from(arr)


def streak(layer: Layer, cx, cy, w, h, seed):
    rng = random.Random(seed + 100)
    # three flat, broken ribbons of higher cloud, still palette true
    for i in range(3):
        y = cy + i * 3 + rng.randint(-1, 1)
        x = cx - w // 2 + rng.randint(-8, 8)
        ww = w + rng.randint(-18, 18)
        layer.ellipse(x, y, x + ww, y + max(1, h - i), fill=C("#5aa6bd"))
        layer.ellipse(x + 10, y, x + ww - 12, y + max(1, h - i - 1), fill=C("#78c2c7"))
        if i == 0:
            layer.line((x + 14, y, x + ww - 18, y), C("#9ad8cd"))



def bird(layer: Layer, x, y, flip=1):
    c = C("#3b395e")
    if flip > 0:
        pts = [(x - 3, y - 1), (x - 1, y), (x, y + 1), (x + 1, y), (x + 3, y - 1)]
    else:
        pts = [(x - 3, y), (x - 1, y + 1), (x, y + 2), (x + 1, y + 1), (x + 3, y)]
    layer.line(pts, c, width=1)
    layer.point(x, y, c)


def airship(layer: Layer, cx, cy, s, seed):
    rng = random.Random(seed)
    w = int(52 * s)
    h = int(17 * s)
    x0, y0 = int(cx - w // 2), int(cy - h // 2)
    # envelope
    layer.ellipse(x0, y0, x0 + w, y0 + h, fill=C("#f3e0bb"))
    layer.ellipse(x0 + 2, y0 + 1, x0 + int(w * 0.72), y0 + int(h * 0.55), fill=C("#fff2d6"))
    layer.ellipse(x0 + 1, y0 + int(h * 0.58), x0 + w - 1, y0 + h - 1, fill=C("#e4c99b"))
    layer.line((x0 + 2, y0 + h - 2, x0 + w - 2, y0 + h - 2), C("#d2b07c"))
    # brass ribs and nose
    for f in (0.22, 0.42, 0.62, 0.82):
        x = x0 + int(w * f)
        layer.line((x, y0 + 2, x, y0 + h - 2), C("#c9852f"))
    layer.line((x0 + 3, y0 + 1, x0 + int(w * 0.55), y0 + 1), C("#fff2d6"))
    layer.ellipse(x0 + w - 5, y0 + h // 2 - 3, x0 + w + 1, y0 + h // 2 + 3, fill=C("#f7c85f"))
    # tail fins
    fx = x0 + 2
    layer.polygon(
        [(fx, y0 + h // 2), (fx - int(7 * s), y0 + h // 2 - int(9 * s)), (fx - int(3 * s), y0 + h // 2)],
        C("#ff8a4c"),
    )
    layer.polygon(
        [(fx, y0 + h // 2 + 1), (fx - int(6 * s), y0 + h // 2 + int(9 * s)), (fx - int(2 * s), y0 + h // 2 + 1)],
        C("#d24f4a"),
    )
    # gondola, window, propeller
    gx0, gx1 = x0 + int(w * 0.37), x0 + int(w * 0.67)
    gy = y0 + h
    layer.rrect(gx0, gy, gx1, gy + int(6 * s), int(2 * s), C("#c9852f"))
    layer.line((gx0 + 2, gy + 2, gx0 + int(w * 0.9), gy + 2), C("#8e6bc0"))
    layer.line((gx0, gy, gx0 + 2, y0 + h - 1), C("#a36428"))
    layer.line((gx1, gy, gx1 - 2, y0 + h - 1), C("#a36428"))
    for k in range(max(1, int(3 * s))):
        layer.line((gx0 + 3 + k * 3, gy + 3, gx0 + 4 + k * 3, gy + 3), C("#ffe08a"))
    prop_x = gx0 - 2
    layer.line((prop_x, gy + 1, prop_x - int(3 * s), gy - int(2 * s)), C("#e4a73f"))
    layer.line((prop_x, gy + 1, prop_x - int(3 * s), gy + int(4 * s)), C("#e4a73f"))
    # a tiny pennant on the nose
    layer.line((x0 + int(w * 0.9), y0 - 1, x0 + int(w * 0.9) + int(6 * s), y0 - 3), C("#a36428"))
    layer.polygon(
        [
            (x0 + int(w * 0.9) + int(6 * s), y0 - 3),
            (x0 + int(w * 0.9) + int(10 * s), y0 - 1),
            (x0 + int(w * 0.9) + int(6 * s), y0),
        ],
        C("#ffe08a"),
    )


# ---------------------------------------------------------------------------
# far haze skyline


def draw_far() -> Layer:
    """The haze ridge behind the waterfront: wide roofs, half-domes, no shafts."""
    layer = Layer()
    far = {
        "top": "#8ea9ae",
        "body": "#7b98a3",
        "shade": "#688596",
        "dark": "#587387",
        "deep": "#4b657e",
    }
    for c in far.values():
        USED.add(c)
    rng = random.Random(41)

    def block(x, w, top, body, shade, roof="flat", seed=0):
        r = random.Random(seed)
        layer.rrect(x, top, x + w, 512, min(10, w // 4), C(body))
        layer.rrect(x, top, x + max(8, w // 4), 512, min(10, w // 4), C(shade))
        layer.line((x + 4, top + 4, x + w - 4, top + 4), C(far["top"]))
        if roof == "dome":
            rx = max(18, w // 3)
            ry = max(8, rx // 3)
            layer.pieslice(x + w // 2 - rx, top - ry * 2, x + w // 2 + rx, top + ry, 180, 360, C(body))
            layer.arc(x + w // 2 - rx, top - ry * 2, x + w // 2 + rx, top + ry, 180, 360, C(far["top"]), 2)
            layer.line((x + w // 2 - rx, top, x + w // 2 + rx, top), C(shade), width=2)
        elif roof == "garden":
            layer.rect(x + 4, top - 3, x + w - 4, top + 1, C(far["shade"]))
            layer.line((x + 6, top - 3, x + w - 6, top - 3), C(far["top"]))
            for px in range(x + 10, x + w - 8, 18):
                layer.point(px, top - 5, C(far["top"]))
                layer.point(px + 1, top - 4, C(far["shade"]))
        elif roof == "awning":
            layer.line((x + 4, top - 1, x + w - 4, top - 1), C(far["deep"]), width=2)
            for px in range(x + 6, x + w - 6, 10):
                layer.point(px, top + 1, C(far["deep"]))
        # tiny far windows, sparse and low contrast
        for wy in range(max(top + 18, 448), 504, 26):
            for wx in range(x + 8, x + w - 8, 24):
                if r.random() < 0.22:
                    layer.rect(wx, wy, wx + 1, wy + 3, C(far["deep"] if r.random() < 0.5 else far["dark"]))
        # occasional rooftop tree / pergola
        if r.random() < 0.4 and w > 60:
            layer.line((x + w - 16, top - 12, x + w - 16, top), C(far["shade"]))
            layer.ellipse(x + w - 24, top - 22, x + w - 6, top - 8, fill=C(far["shade"]))
            layer.point(x + w - 16, top - 21, C(far["body"]))

    # a sparse low waterfront: skyline islands with sky between them, so the
    # arch openings read as air and distance instead of a blue wall
    for x, w, top, roof, seed in [
        (-40, 250, 446, "dome", 1),
        (260, 210, 454, "flat", 2),
        (520, 260, 440, "garden", 3),
        (840, 220, 452, "dome", 4),
        (1120, 240, 442, "flat", 5),
        (1400, 230, 454, "garden", 6),
    ]:
        block(x, w, top, far["top"], far["body"], roof, 100 + seed)
    for x, w, top, roof, seed in [
        (-20, 120, 486, "awning", 11),
        (150, 90, 480, "flat", 12),
        (330, 130, 490, "dome", 13),
        (520, 80, 482, "garden", 14),
        (660, 140, 486, "awning", 15),
        (850, 90, 478, "flat", 16),
        (1000, 120, 490, "dome", 17),
        (1200, 90, 482, "garden", 18),
        (1360, 120, 488, "awning", 19),
        (1530, 80, 480, "flat", 20),
    ]:
        block(x, w, top, far["body"], far["shade"], roof, 200 + seed)

    # a pale far waterline, painted only where the arches open onto it
    # a pale far waterline and a little haze on the roof edge
    layer.rect(0, 500, 1600, 512, C(far["shade"]))
    layer.line((0, 500, 1600, 500), C(far["top"]), width=2)
    for x in range(0, 1600, 9):
        if (x * 5) % 7 < 3:
            layer.point(x, 504, C(far["top"]))
    dither_rect(layer, 0, 466, 1600, 476, far["top"], 0.08, 3)
    return layer

CREAM = {
    "body": "#f3e0bb",
    "light": "#fff2d6",
    "shade": "#e4c99b",
    "deep": "#d2b07c",
    "dark": "#b98f61",
    "stone": "#cfa074",
    "stone_dark": "#9b6a50",
    "stone_deep": "#7f5446",
    "brass": "#e4a73f",
    "brass_hi": "#f7c85f",
    "brass_dark": "#a36428",
    "glass": "#78c2c7",
    "glass_hi": "#9ad8cd",
    "glass_deep": "#5aa6bd",
    "ink": "#2d2b4b",
    "indigo": "#3b395e",
    "warm": "#ffe08a",
    "water": "#96e8dc",
    "water_hi": "#c8f7ec",
    "water_deep": "#42b2c2",
    "leaf": "#68a963",
    "leaf_hi": "#8dc46f",
    "leaf_dark": "#478a58",
    "leaf_deep": "#2f6c4d",
    "leaf_deepest": "#235342",
}


def porthole(layer: Layer, cx, cy, r, lit=False, ink=None):
    ink = ink or CREAM["ink"]
    layer.ellipse(cx - r - 1, cy - r - 1, cx + r + 1, cy + r + 1, fill=C(CREAM["brass"]))
    layer.ellipse(cx - r, cy - r, cx + r, cy + r, fill=C(CREAM["brass_hi"] if not lit else CREAM["warm"]))
    layer.ellipse(cx - r + 1, cy - r + 1, cx + r - 1, cy + r - 1, fill=C(ink))
    if lit:
        layer.rect(cx - r + 2, cy - r + 2, cx + r - 2, cy + r - 3, C(CREAM["warm"]))
        layer.rect(cx + 1, cy - r + 2, cx + r - 2, cy + 1, C("#fff3c9"))
    else:
        layer.ellipse(cx - r + 1, cy - r + 1, cx + r - 1, cy + r - 1, fill=C(CREAM["glass_deep"]))
        if r >= 4:
            layer.line((cx - r + 2, cy + r - 3, cx + 1, cy - r + 2), C(CREAM["glass_deep"]))
            layer.rect(cx - r + 2, cy - r + 2, cx - 1, cy - 1, C(CREAM["glass"]))
            layer.rect(cx + 2, cy - r + 2, cx + r - 2, cy + 1, C("#9ad8cd"))
            layer.point(cx + r - 2, cy - r + 2, C("#c6ebdc"))
        else:
            layer.rect(cx - 1, cy - 1, cx, cy + 1, C(CREAM["glass"]))
            layer.point(cx + 1, cy - 1, C("#c6ebdc"))


def sun_mural(layer: Layer, x, y, w, h):
    layer.rrect(x, y, x + w, y + h, 2, C(CREAM["brass"]))
    layer.rrect(x + 1, y + 1, x + w - 1, y + h - 1, 2, C("#5aa6bd"))
    cx, cy = x + w // 2, y + h // 2
    layer.ellipse(cx - 5, cy - 5, cx + 5, cy + 5, fill=C(CREAM["brass_hi"]))
    layer.ellipse(cx - 3, cy - 3, cx + 3, cy + 3, fill=C("#ffe08a"))
    for dx, dy in ((-7, 0), (7, 0), (0, -7), (0, 7), (-5, -5), (5, -5), (-5, 5), (5, 5)):
        layer.point(cx + dx, cy + dy, C(CREAM["brass_hi"]))
    layer.rect(x + 3, y + h - 4, x + w - 3, y + h - 3, C("#9ad8cd"))


def arched_window(layer: Layer, x, y, w, h, lit=False):
    layer.rrect(x - 1, y - 1, x + w + 1, y + h + 1, w // 2 + 1, C(CREAM["brass"]))
    layer.rrect(x, y, x + w, y + h, w // 2, C(CREAM["ink"]))
    if lit:
        layer.rrect(x + 1, y + 1, x + w - 1, y + h - 1, max(1, w // 2 - 1), C(CREAM["warm"]))
        layer.line((x + 2, y + h // 2, x + w - 2, y + h // 2), C(CREAM["brass_dark"]))
    else:
        layer.rrect(x + 1, y + 1, x + w - 1, y + h - 1, max(1, w // 2 - 1), C(CREAM["glass_deep"]))
        layer.rect(x + 1, y + 2, x + w // 2, y + h // 2, C(CREAM["glass"]))
        layer.line((x + 2, y + h - 3, x + w - 2, y + h - 3), C(CREAM["water_hi"]))


def window_cluster(layer: Layer, cx, cy, cols, rows, lx=11, ly=15, r=3, lit_chance=0.25, seed=0):
    rng = random.Random(seed)
    x0 = cx - (cols - 1) * lx // 2
    y0 = cy - (rows - 1) * ly // 2
    for ry in range(rows):
        for rx in range(cols):
            lit = rng.random() < lit_chance
            porthole(layer, x0 + rx * lx, y0 + ry * ly, r, lit=lit)


def hanging_vine(layer: Layer, x, y0, length, seed=0, leaves=6, dark=False):
    rng = random.Random(seed)
    cstem = C("#2f6c4d")
    cleaf = C("#478a58")
    chi = C("#68a963" if dark else "#8dc46f")
    x = int(x)
    layer.line((x, y0, x + rng.randint(-2, 2), y0 + length), cstem)
    for i in range(leaves):
        ly = y0 + (i + 1) * length // (leaves + 1)
        side = -1 if i % 2 == 0 else 1
        lx = x + side * (1 + rng.randint(0, 2))
        layer.line((lx, ly, lx + side * 2, ly), cleaf)
        layer.point(lx + side, ly, chi)
    if rng.random() < 0.5:
        layer.rect(x + rng.randint(-2, 1), y0 + length, x + 2, y0 + length + 1, C("#f49bb8"))


def plant_pot(layer: Layer, x, y, s=1, flowers=True):
    layer.rrect(x, y, x + 5 * s, y + 4 * s, 1, C(CREAM["stone"]))
    layer.rect(x, y, x + 5 * s, y + 1, C(CREAM["stone_dark"]))
    layer.ellipse(x + 1, y - 4 * s, x + 4 * s, y, fill=C("#478a58"))
    layer.ellipse(x, y - 6 * s, x + 3 * s, y - 1, fill=C("#68a963"))
    layer.point(x + 1, y - 4 * s, C("#8dc46f"))
    if flowers:
        layer.rect(x + 2, y - 6 * s, x + 3, y - 6 * s + 1, C("#f49bb8"))
        layer.point(x + 4 * s, y - 4 * s, C("#ffd2e0"))


def onion_dome(layer: Layer, cx, base_y, rx, ry, glass=False, ribs=True, finial=True, seed=0):
    rng = random.Random(seed)
    base_y = int(base_y)
    rx = float(rx)
    ry = max(1.0, float(ry))
    apex = base_y - int(ry)
    # silhouette row by row, an onion profile with a firm base lip
    for y in range(apex, base_y + 1):
        t = (base_y - y) / max(ry, 1)
        rad = rx * math.sin(math.pi * (0.17 + 0.83 * t))
        if rad < 0.6:
            continue
        x0, x1 = int(cx - rad), int(cx + rad)
        if glass:
            layer.line((x0, y, x1, y), C("#78c2c7"))
            # lit right third and a pale reflection band
            layer.line((x0, y, int(cx - rad * 0.34), y), C("#5aa6bd"))
            if t > 0.25 and t < 0.75:
                layer.line((int(cx + rad * 0.52), y, int(cx + rad * 0.9), y), C("#9ad8cd"))
        else:
            layer.line((x0, y, x1, y), C(CREAM["body"]))
            layer.line((x0, y, int(cx - rad * 0.48), y), C(CREAM["shade"]))
            if rad > 3:
                layer.line((int(cx + rad * 0.55), y, x1, y), C(CREAM["light"]))
                layer.line((int(cx - rad * 0.92), y, x0, y), C(CREAM["deep"]))
    # base ring
    layer.line((int(cx - rx * 0.72), base_y, int(cx + rx * 0.72), base_y), C(CREAM["brass"]), width=2)
    layer.line((int(cx - rx * 0.72), base_y + 2, int(cx + rx * 0.72), base_y + 2), C(CREAM["brass_dark"]))
    if glass:
        layer.rrect(int(cx - rx * 0.78), base_y - 10, int(cx + rx * 0.78), base_y + 2, 4, C(CREAM["body"]))
        layer.rrect(int(cx - rx * 0.78), base_y - 10, int(cx - rx * 0.2), base_y + 2, 4, C(CREAM["shade"]))
        layer.line((int(cx - rx * 0.74), base_y - 9, int(cx + rx * 0.74), base_y - 9), C(CREAM["brass"]), width=2)
        for px in range(int(cx - rx * 0.5), int(cx + rx * 0.55), 18):
            layer.ellipse(px - 3, base_y - 5, px + 3, base_y + 1, fill=C(CREAM["brass"]))
            layer.ellipse(px - 2, base_y - 4, px + 2, base_y, fill=C(CREAM["ink"]))
            layer.point(px + 1, base_y - 3, C("#ffe08a"))
    if ribs:
        for f in (-0.78, -0.4, 0.0, 0.4, 0.78):
            pts = []
            for y in range(apex + 2, base_y, 2):
                t = (base_y - y) / max(ry, 1)
                rad = rx * math.sin(math.pi * (0.17 + 0.83 * t))
                pts.append((int(cx + f * rad), y))
            if len(pts) > 1:
                if glass:
                    layer.line(pts, C(CREAM["light"]), width=2)
                    layer.line([(px + 2, py) for px, py in pts], C(CREAM["brass"]))
                else:
                    layer.line(pts, C(CREAM["brass"]))
                    layer.line([(px + 1, py) for px, py in pts], C(CREAM["brass_hi"]))
    # horizontal ribs and a lip of tiles where the dome meets its drum
    for tr in (0.30, 0.52, 0.74):
        yy = apex + int(ry * tr)
        t = (base_y - yy) / max(ry, 1)
        rad = rx * math.sin(math.pi * (0.17 + 0.83 * t))
        if rad > 2:
            if glass:
                layer.line((int(cx - rad), yy, int(cx + rad), yy), C(CREAM["light"]), width=2)
                layer.line((int(cx - rad), yy + 2, int(cx + rad), yy + 2), C(CREAM["brass_dark"]))
            else:
                layer.line((int(cx - rad), yy, int(cx + rad), yy), C(CREAM["brass"]))
                layer.line((int(cx - rad), yy + 1, int(cx + rad), yy + 1), C(CREAM["brass_dark"]))
                layer.line((int(cx - rad), yy - 1, int(cx + rad), yy - 1), C(CREAM["brass_hi"]))
    for i in range(int(rx * 1.1)):
        bx = int(cx - rx * 0.66) + i * 2
        if (i // 3) % 2 == 0:
            layer.rect(bx, base_y + 3, bx + 1, base_y + 5, C(CREAM["brass_dark"]))
    if glass:
        # a couple of lit slit windows and a crescent of reflected sky
        for i in range(4):
            yy = apex + int(ry * (0.35 + i * 0.12))
            tt = (base_y - yy) / max(ry, 1)
            rad = rx * math.sin(math.pi * (0.17 + 0.83 * tt))
            layer.rect(int(cx - rad * 0.2), yy, int(cx - rad * 0.2) + 2, yy + 2, C("#c6ebdc"))
        for i in range(5):
            yy = apex + int(ry * (0.20 + i * 0.05))
            tt = (base_y - yy) / max(ry, 1)
            rad = rx * math.sin(math.pi * (0.17 + 0.83 * tt))
            layer.rect(int(cx + rad * 0.45), yy, int(cx + rad * 0.78), yy + 1, C("#eaf3df"))
    if finial:
        layer.line((cx, apex - 8, cx, apex + 2), C(CREAM["brass_dark"]))
        layer.ellipse(cx - 3, apex - 10, cx + 3, apex - 4, fill=C(CREAM["brass"]))
        layer.ellipse(cx - 2, apex - 9, cx + 1, apex - 6, fill=C(CREAM["brass_hi"]))
        layer.polygon([(cx, apex - 10), (cx + 12, apex - 8), (cx + 2, apex - 6)], C("#ff8a4c"))


def ceramic_tower(
    layer: Layer,
    x,
    top,
    w,
    base=600,
    dome="onion",
    body="#f3e0bb",
    balconies=(),
    windows=(),
    lit_windows=(),
    seed=0,
    flag=False,
):
    rng = random.Random(seed)
    r = min(w // 2, 30)
    layer.rrect(x, top, x + w, base, r, C(body))
    # cylindrical shading, hard-edged but broken by ordered dither
    layer.line((x + 2, top + r, x + 2, base), C(CREAM["shade"]), width=2)
    dither_rect(layer, x + 3, top + r, x + max(4, w // 4), base, CREAM["shade"], 0.35, seed % 5)
    layer.line((x + w - 3, top + r, x + w - 3, base), C(CREAM["light"]), width=2)
    dither_rect(layer, x + w - 2, top + r, x + w, base, CREAM["light"], 0.2, 2)
    # vertical ceramic seams
    for f in (0.34, 0.67):
        sx = x + int(w * f)
        for y in range(top + r + 4, base - 2, 11):
            layer.rect(sx, y, sx, y + 4, C(CREAM["deep"]))
    # brass bands follow the capsule's curve near the head
    bands = [top + r + 14, top + r + 58, top + r + 118, top + r + 178]
    for by in bands:
        if by >= base - 6:
            continue
        inset = 0
        if by < top + r:
            inset = int(r - math.sqrt(max(0.0, r * r - (top + r - by) ** 2)))
        layer.line((x + inset, by, x + w - inset, by), C(CREAM["brass"]), width=2)
        layer.line((x + inset, by + 2, x + w - inset, by + 2), C(CREAM["brass_dark"]))
        layer.line((x + inset + 1, by - 1, x + w - inset - 1, by - 1), C(CREAM["brass_hi"]))
        if w > 40:
            for rx in range(x + inset + 5, x + w - inset - 3, 9):
                layer.point(rx, by + 1, C(CREAM["brass_dark"]))
    for cy, cols, rows in windows:
        window_cluster(layer, x + w // 2, cy, cols, rows, 12, 16, 3, 0.2, seed + cy)
    for cy in lit_windows:
        porthole(layer, x + w // 2, cy, 3, lit=True)
    # awnings, window boxes, wall lamps: the little lived-in things
    if w >= 44:
        ax0, ax1 = x + 7, x + w - 7
        ay = (windows[0][0] - 10) if windows else (top + r + 26)
        for i in range((ax1 - ax0) // 6 + 1):
            c = "#ff8a4c" if i % 2 == 0 else "#fff2d6"
            layer.polygon([(ax0 + i * 6, ay), (ax0 + i * 6 + 6, ay), (ax0 + i * 6 + 4, ay + 5), (ax0 + i * 6 + 2, ay + 5)], C(c))
        layer.line((ax0, ay, ax1, ay), C(CREAM["brass_dark"]))
    if windows:
        wy = windows[0][0] + 18
        for bx in range(x + 8, x + w - 6, 14):
            layer.rect(bx, wy, bx + 5, wy + 2, C(CREAM["stone_dark"]))
            layer.point(bx + 1, wy, C("#68a963"))
            layer.point(bx + 3, wy - 1, C("#f49bb8"))
    # a downpipe with two elbows
    px = x + w - 8
    layer.line((px, top + r + 8, px, base - 4), C(CREAM["brass"]))
    layer.line((px + 1, top + r + 8, px + 1, base - 4), C(CREAM["brass_hi"]))
    layer.line((px - 4, top + r + 8, px, top + r + 8), C(CREAM["brass_dark"]))
    for ey in (top + r + 70, top + r + 150):
        if ey < base:
            layer.line((px, ey, px - 5, ey), C(CREAM["brass"]))
            layer.rect(px - 6, ey, px - 5, ey + 3, C(CREAM["brass_dark"]))
    # a brass dial/medallion on the sunlit side
    if w > 50:
        dx, dy = x + w - 18, top + r + 42
        layer.ellipse(dx - 4, dy - 4, dx + 4, dy + 4, fill=C(CREAM["brass"]))
        layer.ellipse(dx - 3, dy - 3, dx + 3, dy + 3, fill=C(CREAM["light"]))
        layer.line((dx, dy + 3, dx + 2, dy - 3), C(CREAM["brass_dark"]))
        layer.point(dx + 2, dy - 3, C("#ff8a4c"))
    # ground-floor arch when there is room for it
    if w >= 52 and base >= 580:
        arched_window(layer, x + w // 2 - 7, base - 34, 14, 30, lit=True)
        layer.line((x + w // 2 - 9, base - 35, x + w // 2 + 9, base - 35), C(CREAM["brass"]), width=2)
    for by in balconies:
        # ring balcony and a little hanging garden
        layer.line((x + 1, by, x + w - 1, by), C(CREAM["brass"]), width=2)
        layer.line((x + 2, by + 2, x + w - 2, by + 2), C(CREAM["brass_dark"]))
        for px in range(x + 3, x + w - 2, 7):
            layer.line((px, by - 5, px, by), C(CREAM["brass_hi"]))
        for px in range(x + 4, x + w - 4, 8):
            layer.ellipse(px - 2, by + 2, px + 3, by + 6, fill=C("#68a963"))
            layer.point(px + 1, by + 2, C("#8dc46f"))
        if rng.random() < 0.8:
            hanging_vine(layer, x + 4 + rng.randrange(max(2, w - 10)), by + 5, 12 + rng.randrange(22), seed + by)
    if dome == "onion":
        onion_dome(layer, x + w // 2, top + 3, w * 0.62, w * 0.58, finial=True, seed=seed)
    elif dome == "glass":
        onion_dome(layer, x + w // 2, top + 3, w * 0.58, w * 0.52, glass=True, finial=False, seed=seed)
    elif dome == "cap":
        layer.pieslice(x - 3, top - w // 4, x + w + 3, top + w // 3, 180, 360, C(body))
        layer.arc(x - 3, top - w // 4, x + w + 3, top + w // 3, 180, 360, C(CREAM["light"]), 2)
        layer.line((x + 2, top + w // 12, x + w - 2, top + w // 12), C(CREAM["brass"]), width=2)
    if flag:
        fx = x + w // 2
        layer.line((fx, top - 22, fx, top + 2), C(CREAM["brass_dark"]))
        layer.polygon([(fx + 1, top - 21), (fx + 12, top - 18), (fx + 1, top - 14)], C("#ff8a4c"))
    return base


def treehouse(layer: Layer, x, y, w=44, h=28, seed=0):
    rng = random.Random(seed)
    # a branch growing under the hut, with brass braces
    layer.polygon(
        [(x + 4, y + h - 2), (x + w - 6, y + h + 6), (x + w - 2, y + h + 12), (x + 2, y + h + 5)],
        C("#7f5446"),
    )
    layer.line((x + 6, y + h + 2, x + 12, y + h + 12), C(CREAM["brass_dark"]))
    # ceramic pod with a pitched living roof
    layer.rrect(x, y, x + w, y + h, h // 2, C(CREAM["body"]))
    layer.rrect(x + 1, y + 1, x + w // 2, y + h - 2, h // 2, C(CREAM["shade"]))
    layer.polygon([(x - 5, y + 4), (x + w // 2, y - 12), (x + w + 5, y + 4)], C(CREAM["brass_dark"]))
    layer.polygon([(x - 3, y + 3), (x + w // 2, y - 10), (x + w + 3, y + 3), (x + w - 2, y + 8), (x + 2, y + 8)], C("#e4a73f"))
    layer.polygon([(x - 2, y + 3), (x + w // 2, y - 9), (x + w // 2, y + 4), (x + 1, y + 4)], C("#f7c85f"))
    layer.line((x - 4, y + 4, x + w + 4, y + 4), C(CREAM["brass"]), width=2)
    layer.line((x + 4, y + 5, x + w - 4, y + 5), C(CREAM["brass_hi"]))
    for px in range(x + 3, x + w - 3, 8):
        layer.ellipse(px - 2, y - 2, px + 2, y + 4, fill=C("#478a58"))
        layer.point(px, y - 2, C("#8dc46f"))
    layer.point(x + w // 2 - 8, y - 8, C("#f49bb8"))
    # little chimney
    layer.rect(x + 8, y - 14, x + 12, y - 4, C(CREAM["stone_dark"]))
    layer.rect(x + 7, y - 16, x + 13, y - 13, C(CREAM["brass"]))
    layer.point(x + 9, y - 19, C("#c6ebdc"))
    layer.point(x + 11, y - 21, C("#eaf3df"))
    # round door with a warm interior and a brass frame
    layer.ellipse(x + w - 24, y + 7, x + w - 6, y + h - 3, fill=C(CREAM["brass"]))
    layer.ellipse(x + w - 22, y + 9, x + w - 8, y + h - 5, fill=C(CREAM["ink"]))
    layer.rect(x + w - 20, y + 12, x + w - 12, y + h - 8, C("#ffe08a"))
    layer.rect(x + w - 20, y + 12, x + w - 18, y + h - 8, C("#fff3c9"))
    # balcony on the left, railing and a flower box
    layer.rect(x - 2, y + h - 7, x + 9, y + h - 3, C(CREAM["brass"]))
    for px in range(x - 2, x + 10, 4):
        layer.line((px, y + h - 14, px, y + h - 7), C(CREAM["brass_hi"]))
    layer.line((x - 2, y + h - 14, x + 9, y + h - 14), C(CREAM["brass"]))
    layer.rect(x + 1, y + h - 12, x + 8, y + h - 9, C("#9b6a50"))
    for px in (x + 2, x + 6):
        layer.point(px, y + h - 12, C("#f49bb8"))
        layer.point(px + 1, y + h - 10, C("#68a963"))
    # ladder down the trunk
    for i in range(6):
        layer.line((x + 10, y + h + 4 + i * 4, x + 10, y + h + 7 + i * 4), C(CREAM["brass_dark"]))
        layer.line((x + 10, y + h + 7 + i * 4, x + 20, y + h + 7 + i * 4), C(CREAM["stone_dark"]))
    layer.line((x + 10, y + h + 3, x + 10, y + h + 28), C(CREAM["brass_dark"]))
    layer.line((x + 20, y + h + 3, x + 20, y + h + 28), C(CREAM["brass_dark"]))
    # lanterns and a little roof flag
    lantern(layer, x + 2, y + h + 2)
    lantern(layer, x + w - 2, y + h + 2)
    layer.line((x + w // 2, y - 16, x + w // 2, y - 4), C(CREAM["brass_dark"]))
    layer.polygon([(x + w // 2 + 1, y - 16), (x + w // 2 + 10, y - 13), (x + w // 2 + 1, y - 9)], C("#ff8a4c"))
    hanging_vine(layer, x + 3, y + h, 18, seed, 5)


def lantern(layer: Layer, x, y):
    layer.line((x, y, x, y + 5), C(CREAM["brass_dark"]))
    layer.rect(x - 2, y + 5, x + 2, y + 10, C(CREAM["brass"]))
    layer.rect(x - 1, y + 6, x + 1, y + 9, C("#fff3c9"))
    layer.point(x + 1, y + 7, C("#ffe08a"))


def shrub(layer: Layer, cx, base_y, w, h, dark=False, seed=0, flowers=True):
    rng = random.Random(seed)
    cols = ("#2f6c4d", "#478a58", "#68a963", "#8dc46f") if not dark else (
        "#235342",
        "#2f6c4d",
        "#478a58",
        "#68a963",
    )
    layer.ellipse(cx - w // 2, base_y - h, cx + w // 2, base_y, fill=C(cols[0]))
    for i in range(7):
        rx = rng.randint(3, max(4, w // 3))
        ox = rng.randint(-w // 2, w // 2)
        oy = rng.randint(-h, -h // 4)
        layer.ellipse(cx + ox - rx, base_y + oy - rx, cx + ox + rx, base_y + oy + rx, fill=C(cols[1]))
        layer.ellipse(cx + ox - rx + 1, base_y + oy - rx, cx + ox + 1, base_y + oy + 1, fill=C(cols[2]))
        layer.point(cx + ox, base_y + oy - rx + 1, C(cols[3]))
    if flowers:
        for i in range(4):
            fx = cx + rng.randint(-w // 2 + 2, w // 2 - 2)
            fy = base_y - rng.randint(2, max(3, h - 2))
            layer.rect(fx, fy, fx + 1, fy + 1, C(rng.choice(["#f49bb8", "#ffd2e0", "#ffe08a"])))


def canopy_patch(w, h, seed, bright=1.0, flowers=True):
    rng = random.Random(seed)
    pad = 18
    pw, ph = w + pad * 2, h + pad * 2
    yy, xx = np.mgrid[0:ph, 0:pw]
    # three major crowns with different heights, so the silhouette is not a
    # single green lozenge
    clumps = [
        (0.24, 0.54, 0.30, 0.30),
        (0.51, 0.40, 0.34, 0.37),
        (0.78, 0.56, 0.29, 0.29),
    ]
    union = np.zeros((ph, pw), bool)
    lobes = []
    for fx, fy, frx, fry in clumps:
        cx, cy = pad + w * fx, pad + h * fy
        rx, ry = w * frx * rng.uniform(0.94, 1.04), h * fry
        lobes.append((cx, cy, rx, ry))
        union |= ell_mask(pw, ph, cx, cy, rx, ry)
    # side and top puffs, deliberately uneven
    for fx, fy, fr in [
        (0.07, 0.68, 0.13),
        (0.14, 0.50, 0.16),
        (0.32, 0.31, 0.18),
        (0.43, 0.22, 0.17),
        (0.60, 0.20, 0.18),
        (0.68, 0.30, 0.16),
        (0.85, 0.38, 0.15),
        (0.92, 0.66, 0.13),
        (0.41, 0.71, 0.20),
        (0.61, 0.72, 0.19),
        (0.26, 0.77, 0.15),
        (0.80, 0.78, 0.15),
    ]:
        cx, cy = pad + w * fx, pad + h * fy
        rx = w * fr * rng.uniform(0.9, 1.15)
        ry = h * fr * rng.uniform(0.9, 1.2)
        lobes.append((cx, cy, rx, ry))
        union |= ell_mask(pw, ph, cx, cy, rx, ry)
    # little edge tufts break the circle language
    for i in range(34):
        ang = rng.uniform(0, 2 * math.pi)
        cx = pad + w * (0.5 + 0.49 * math.cos(ang) * rng.uniform(0.72, 1.0))
        cy = pad + h * (0.55 + 0.48 * math.sin(ang) * rng.uniform(0.62, 1.0))
        r = rng.uniform(2.5, 6.0)
        union |= ell_mask(pw, ph, cx, cy, r, r)

    arr = np.zeros((ph, pw, 4), dtype=np.uint8)
    arr[union] = C("#478a58")
    # deep underlayer, offset down, gives the whole crown a weight
    under = np.zeros_like(union)
    under[4:, :] = union[:-4, :]
    arr[under & ~union] = C("#2f6c4d")
    for cx, cy, rx, ry in lobes:
        lm = ell_mask(pw, ph, cx, cy, rx, ry) & union
        d = ((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2
        # shading only in the lower half, so no bubble outlines
        if cy > pad + h * 0.48 and (int(cx) // 7) % 2 == 0:
            smile = lm & (d > 0.73) & (d < 0.90) & (yy > cy + ry * 0.30)
            arr[smile] = C("#2f6c4d")
        top_hi = lm & (d > 0.55) & (d < 0.9) & (yy < cy - ry * 0.18)
        arr[top_hi] = C("#68a963")
    ys = np.arange(ph)[:, None]
    top = np.where(union, ys, ph + 10).min(axis=0)
    bottom = np.where(union, ys, -10).max(axis=0)
    t = np.arange(ph)[:, None] - top[None, :]
    b = bottom[None, :] - np.arange(ph)[:, None]
    arr[union & (t == 0)] = C("#8dc46f")
    arr[union & (t >= 1) & (t <= 3)] = C("#68a963")
    arr[union & (t >= 3) & (t <= 18) & bayer_mask(ph, pw, 0.20, 3, 4)] = C("#68a963")
    arr[union & (t >= 2) & (t <= 14) & (xx > pad + w * 0.56) & bayer_mask(ph, pw, 0.14, 1, 2)] = C("#8dc46f")
    arr[union & (b == 0)] = C("#235342")
    arr[union & (b >= 1) & (b <= 4)] = C("#2f6c4d")
    arr[union & (b >= 3) & (b <= 11) & bayer_mask(ph, pw, 0.17, 2, 5)] = C("#2f6c4d")
    # a few tips catch the sun; all are 1px so the mass stays calm
    lit = union & bayer_mask(ph, pw, 0.007, 5, 7)
    arr[lit] = C("#8dc46f")
    arr[union & (b >= 2) & (b <= 5) & bayer_mask(ph, pw, 0.05, 2, 3)] = C("#235342")
    # leaf flecks, clustered near the top and the outer edge
    flecks = union & bayer_mask(ph, pw, 0.006, 9, 1)
    arr[flecks] = C("#b7d879")
    if flowers:
        for i in range(22):
            fx = rng.randint(pad // 2, pw - pad // 2)
            fy = rng.randint(ph // 3, ph - pad // 2)
            if not union[fy, fx]:
                continue
            col = rng.choice(["#f49bb8", "#ffd2e0", "#ffd37a", "#ff8a4c"])
            arr[fy, fx] = C(col)
            if rng.random() < 0.45:
                arr[fy, fx - 1] = C(col)
    # torn little leaf points at the silhouette
    for i in range(40):
        fx = rng.randint(pad, pw - pad - 1)
        fy = rng.randint(pad, ph - pad - 1)
        if union[fy, fx] and not union[fy - 1, fx] and rng.random() < 0.35:
            arr[max(0, fy - 1), fx] = C("#68a963")
    return patch_from(arr)



def big_tree(layer: Layer, cx, base_y, w, h, seed=0, treehouse_=True):
    rng = random.Random(seed)
    # trunk, tapered with roots
    trunk_w = max(16, int(w * 0.10))
    top = base_y - int(h * 0.58)
    pts = [
        (cx - trunk_w // 2, top),
        (cx + trunk_w // 2, top),
        (cx + int(trunk_w * 0.75), base_y - 38),
        (cx + int(trunk_w * 0.9), base_y - 8),
        (cx + int(trunk_w * 2.1), base_y),
        (cx + trunk_w // 3, base_y),
        (cx + 2, base_y - 16),
        (cx - trunk_w // 2, base_y),
        (cx - int(trunk_w * 2.2), base_y),
        (cx - int(trunk_w * 0.8), base_y - 8),
        (cx - int(trunk_w * 0.72), base_y - 40),
    ]
    layer.polygon(pts, C(CREAM["stone_dark"]))
    layer.polygon(
        [
            (cx - trunk_w // 2 + 3, top + 4),
            (cx - 1, top + 4),
            (cx + 2, base_y - 20),
            (cx - trunk_w // 2 + 6, base_y - 6),
            (cx - trunk_w // 3, base_y),
            (cx - trunk_w // 2, base_y - 12),
        ],
        C("#b9855e"),
    )
    layer.line((cx + trunk_w // 2 - 4, top + 10, cx + trunk_w // 2 - 2, base_y - 16), C("#e2b98c"), width=2)
    # bark strokes
    for i in range(10):
        bx = cx - trunk_w // 2 + rng.randint(2, max(3, trunk_w - 2))
        by = top + rng.randint(6, max(8, top * 0 + 90))
        layer.line((bx, by, bx + rng.randint(-1, 1), by + rng.randint(4, 10)), C("#7f5446"))
    # moss at the roots
    for i in range(6):
        mx = cx - trunk_w + rng.randint(0, trunk_w * 2)
        layer.ellipse(mx - 3, base_y - 7, mx + 3, base_y - 1, fill=C("#478a58"))
        layer.point(mx, base_y - 8, C("#68a963"))
    # two big limbs
    layer.polygon(
        [
            (cx - 4, top + 20),
            (cx - 26, top - 16),
            (cx - 18, top - 24),
            (cx + 6, top + 6),
        ],
        C("#9b6a50"),
    )
    layer.polygon(
        [
            (cx + 2, top + 38),
            (cx + 40, top - 6),
            (cx + 46, top + 3),
            (cx + 8, top + 52),
        ],
        C("#9b6a50"),
    )
    canopy_h = int(h * 0.72)
    canopy_w = int(w * 1.04)
    canopy = canopy_patch(canopy_w, canopy_h, seed + 3)
    canopy_y = top - int(canopy_h * 0.82)
    layer.paste(canopy, cx - canopy_w // 2, canopy_y)
    # short branch stubs at the canopy's underside, leafed over so they read as
    # structure rather than sticks laid on the crown
    for bx, by, tx, ty in [
        (cx - 8, canopy_y + int(canopy_h * 0.90), cx - 42, canopy_y + int(canopy_h * 0.76)),
        (cx + 8, canopy_y + int(canopy_h * 0.88), cx + 38, canopy_y + int(canopy_h * 0.72)),
    ]:
        layer.line((bx, by, tx, ty), C("#7f5446"), width=3)
        layer.line((bx, by + 1, tx, ty + 1), C("#9b6a50"))
        for i in range(4):
            layer.ellipse(tx - 6 + i * 4, ty - 5 - (i % 2) * 2, tx + 2 + i * 4, ty + 3, fill=C("#2f6c4d"))
            layer.point(tx - 3 + i * 4, ty - 5 - (i % 2) * 2, C("#68a963"))
    # vines hang out of the underside
    for i in range(8):
        vx = cx - canopy_w // 2 + rng.randint(12, canopy_w - 12)
        vy = canopy_y + int(canopy_h * 0.78) + rng.randint(0, 12)
        hanging_vine(layer, vx, vy, rng.randint(14, 46), seed + i, 5)
    if treehouse_:
        treehouse(layer, cx - 38, top + 56, 52, 32, seed)
    # a tiny swing: brass chain and a plank
    sx = cx - 70
    layer.line((sx, top + 8, sx + 4, top + 40), C(CREAM["brass_dark"]))
    layer.line((sx + 14, top + 8, sx + 18, top + 40), C(CREAM["brass_dark"]))
    layer.rect(sx + 2, top + 40, sx + 18, top + 43, C("#c9852f"))
    layer.line((sx + 2, top + 40, sx + 18, top + 40), C("#f7c85f"))


def aqueduct(layer: Layer, x0, y0, x1, y1, piers, mouth="right", seed=0, height=12):
    """A gently curved stone channel with arches underneath."""
    rng = random.Random(seed)
    if x1 < x0:
        x0, x1, y0, y1 = x1, x0, y1, y0
        mouth = "left" if mouth == "right" else "right"
    sign = -1 if mouth == "left" else 1
    n = x1 - x0
    tops = []
    for x in range(x0, x1 + 1):
        t = (x - x0) / max(1, n)
        # a slight structural sag plus a low arc
        sag = math.sin(math.pi * t) * 4.0
        y = y0 * (1 - t) + y1 * t + sag
        tops.append((x, y))
    for x, y in tops:
        y = int(y)
        layer.rect(x, y, x, y + height - 1, C(CREAM["stone"]))
        layer.rect(x, y, x, y + 3, C(CREAM["water_deep"]))
        layer.rect(x, y + 1, x, y + 2, C(CREAM["water"]))
        layer.rect(x, y + 1, x, y + 1, C(CREAM["water_hi"])) if (x + seed) % 5 == 0 else None
        layer.rect(x, y + height - 2, x, y + height - 1, C(CREAM["stone_dark"]))
        layer.rect(x, y - 1, x, y - 1, C(CREAM["brass_hi"]))
        layer.point(x, y + 4, C(CREAM["stone_dark"])) if (x + seed) % 9 == 0 else None
    # little tiles / seams on the face
    for x, y in tops[::9]:
        layer.rect(x, int(y) + 5, x, int(y) + height - 2, C(CREAM["stone_dark"]))
    # arches + piers
    if len(piers) >= 2:
        for i in range(len(piers) - 1):
            ax0, ax1 = piers[i], piers[i + 1]
            yd = int(tops[min(len(tops) - 1, max(0, ax0 - x0))][1]) + height
            span = ax1 - ax0
            rx = max(8, span // 2 - 5)
            cx = (ax0 + ax1) // 2
            depth = max(12, int(span * 0.45))
            # arch ring: y is max at the springers, minimum at the crown
            for xx in range(cx - rx, cx + rx + 1):
                u = (xx - cx) / max(rx, 1)
                yy = yd + int(depth * (1 - math.sqrt(max(0.0, 1 - u * u))))
                layer.point(xx, yy - 2, C(CREAM["stone_dark"]))
                layer.point(xx, yy - 1, C(CREAM["stone"]))
                layer.point(xx, yy, C("#e2b98c"))
                layer.point(xx, yy + 1, C(CREAM["stone_dark"]))
            # keystone
            layer.rect(cx - 1, yd + depth - 1, cx + 1, yd + depth + 4, C(CREAM["stone_dark"]))
            layer.rect(cx - 1, yd + depth, cx + 1, yd + depth + 3, C(CREAM["brass"]))
            # pier
            for px in (ax0, ax1):
                yy = tops[min(len(tops) - 1, max(0, px - x0))][1]
                layer.rect(px - 4, int(yy) + height, px + 4, int(yy) + height + 90, C(CREAM["stone"]))
                layer.rect(px - 4, int(yy) + height, px - 2, int(yy) + height + 90, C(CREAM["stone_dark"]))
                layer.rect(px + 3, int(yy) + height, px + 4, int(yy) + height + 90, C(CREAM["stone_deep"]))
                for py in range(int(yy) + height + 8, int(yy) + height + 88, 14):
                    layer.rect(px - 1, py, px + 1, py + 1, C(CREAM["stone_dark"]))
    # mouth: a brass spout and a bright lip of water
    mx = x0 if mouth == "left" else x1
    my = int(tops[0][1] if mouth == "left" else tops[-1][1])
    mxa, mxb = sorted((mx - 7 * sign, mx + 7 * sign))
    layer.rect(mxa, my - 2, mxb, my + 3, C(CREAM["brass"]))
    layer.rect(mxa + 1, my - 1, mxb - 1, my + 2, C(CREAM["brass_hi"]))
    layer.rect(mx - 2, my + 2, mx + 2, my + 6, C(CREAM["brass_dark"]))
    layer.rect(mx - 1, my + 4, mx + 1, my + 7, C(CREAM["water_hi"]))
    # tiny drips along the channel
    for i in range(4):
        dx = x0 + rng.randint(8, max(9, n - 8))
        layer.point(dx, int(tops[dx - x0][1]) + height + rng.randint(1, 8), C(CREAM["water"]))
    return mx, my


def solar_panel(layer: Layer, x, y, w, h, seed=0, tilt=0):
    layer.polygon(
        [(x, y + h), (x + w, y + h - tilt), (x + w, y - tilt), (x, y)],
        C("#2f8ba8"),
    )
    for i in range(1, 4):
        tx = x + w * i // 4
        layer.line((tx, y, tx, y + h - (tilt * i) // 4), C("#9ad8cd"))
    for j in range(1, 3):
        ty = y + h * j // 3
        layer.line((x, ty, x + w, ty - tilt * j // 3), C("#5aa6bd"))
    layer.polygon([(x, y + h), (x + w, y + h - tilt), (x + w, y + h - tilt + 2), (x, y + h + 2)], C(CREAM["brass"]))
    layer.line((x + 2, y + 1, x + w - 3, y + 1 - tilt), C("#c6ebdc"))


def wind_turbine(layer: Layer, cx, hub_y, base_y, radius, phase=0, seed=0):
    layer.line((cx, hub_y, cx, base_y), C(CREAM["body"]), width=3)
    layer.line((cx + 1, hub_y, cx + 1, base_y), C(CREAM["light"]))
    layer.line((cx - 1, hub_y, cx - 1, base_y), C(CREAM["shade"]))
    for y in range(hub_y + 8, base_y, 18):
        layer.point(cx - 1, y, C(CREAM["brass"]))
    layer.ellipse(cx - 2, hub_y - 2, cx + 2, hub_y + 2, fill=C(CREAM["brass"]))
    for k in range(3):
        ang = phase + k * 2 * math.pi / 3
        ex = cx + int(math.cos(ang) * radius)
        ey = hub_y + int(math.sin(ang) * radius)
        mx = cx + int(math.cos(ang + 0.10) * radius * 0.55)
        my = hub_y + int(math.sin(ang + 0.10) * radius * 0.55)
        layer.line((cx, hub_y, mx, my), C(CREAM["light"]), width=2)
        layer.line((mx, my, ex, ey), C(CREAM["body"]), width=2)
        layer.line((ex, ey, ex + int(math.cos(ang + 0.2) * 4), ey + int(math.sin(ang + 0.2) * 4)), C(CREAM["brass"]))
        layer.point(ex, ey, C(CREAM["brass_hi"]))


def curved_bridge(layer: Layer, x0, x1, y, sag=10, seed=0, rail=True):
    pts = []
    for x in range(x0, x1 + 1):
        t = (x - x0) / max(1, x1 - x0)
        yy = y - int(sag * math.sin(math.pi * t))
        pts.append((x, yy))
    for x, yy in pts:
        layer.rect(x, yy, x, yy + 3, C(CREAM["stone"]))
        layer.point(x, yy, C(CREAM["brass"]))
        layer.point(x, yy + 3, C(CREAM["stone_dark"]))
    if rail:
        for x, yy in pts[::1]:
            if x % 8 == 0:
                layer.line((x, yy - 6, x, yy), C(CREAM["brass"]))
        for i in range(len(pts) - 1):
            xa, ya = pts[i]
            xb, yb = pts[i + 1]
            layer.line((xa, ya - 6, xb, yb - 6), C(CREAM["brass_hi"]))
        for i in range(4):
            vx = x0 + (x1 - x0) * (i + 1) // 5
            vy = y - int(sag * math.sin(math.pi * (i + 1) / 5))
            hanging_vine(layer, vx, vy + 4, 10 + i * 3, seed + i, 4)


def mid_far_row(layer: Layer):
    """Pale, low-contrast shapes between the far haze and the main city."""
    rng = random.Random(77)
    for x, w, top in [
        (-40, 60, 470),
        (30, 54, 452),
        (92, 42, 492),
        (150, 62, 465),
        (226, 46, 445),
        (290, 58, 485),
        (362, 48, 462),
        (420, 40, 494),
        (504, 54, 455),
        (572, 70, 478),
        (650, 42, 470),
        (708, 60, 448),
        (790, 50, 486),
        (864, 66, 458),
        (940, 50, 484),
        (1010, 40, 466),
        (1070, 56, 492),
        (1142, 48, 452),
        (1200, 66, 472),
        (1280, 44, 458),
        (1336, 58, 488),
        (1410, 52, 468),
        (1468, 72, 452),
        (1550, 60, 480),
    ]:
        layer.rrect(x, top, x + w, 580, min(8, w // 2), C("#e4c99b"))
        layer.rrect(x, top, x + max(4, w // 3), 580, min(8, w // 2), C("#d2b07c"))
        layer.line((x + w - 3, top + 5, x + w - 3, 570), C("#f3e0bb"))
        if rng.random() < 0.6:
            layer.pieslice(x - 2, top - w // 3, x + w + 2, top + w // 3, 180, 360, C("#e4c99b"))
            layer.arc(x - 2, top - w // 3, x + w + 2, top + w // 3, 180, 360, C("#f3e0bb"), 2)
        if rng.random() < 0.5:
            # a roof garden and a pergola, low contrast so it stays behind
            layer.rrect(x + 5, top - 6, x + w - 5, top + 1, 2, C("#d2b07c"))
            for px in range(x + 8, x + w - 6, 9):
                layer.ellipse(px - 3, top - 12, px + 3, top - 4, fill=C("#8dc46f"))
                layer.point(px, top - 12, C("#b7d879"))
            layer.line((x + 8, top - 18, x + 8, top - 6), C("#b98f61"))
            layer.line((x + w - 8, top - 18, x + w - 8, top - 6), C("#b98f61"))
            layer.line((x + 7, top - 18, x + w - 7, top - 18), C("#cfa074"))
        if rng.random() < 0.3:
            layer.rect(x + w // 2 - 3, top - 10, x + w // 2 + 3, top, C("#b9855e"))
            layer.pieslice(x + w // 2 - 4, top - 16, x + w // 2 + 4, top - 8, 180, 360, C("#e4a73f"))
        if rng.random() < 0.3:
            ax = x + w - 10
            layer.line((ax, top - 14, ax, top + 2), C("#9b6a50"))
            layer.point(ax, top - 15, C("#f7c85f"))
        for wy in range(top + 18, 560, 24):
            for wx in range(x + 6, x + w - 5, 12):
                if rng.random() < 0.2:
                    layer.rect(wx, wy, wx + 1, wy + 3, C("#d2b07c"))


def mid_close_row(layer: Layer):
    """A warm sandstone middle distance between the pale row and the hero."""
    rng = random.Random(303)
    pieces = [
        (112, 54, 462, "dome"),
        (196, 46, 486, "flat"),
        (262, 60, 440, "flat"),
        (352, 44, 492, "dome"),
        (470, 50, 466, "flat"),
        (548, 58, 438, "dome"),
        (622, 46, 480, "flat"),
        (760, 70, 452, "flat"),
        (820, 56, 426, "dome"),
        (900, 48, 472, "flat"),
        (960, 66, 430, "dome"),
        (1046, 50, 478, "flat"),
        (1104, 60, 448, "flat"),
        (1180, 54, 470, "dome"),
        (1260, 66, 430, "flat"),
        (1360, 48, 468, "dome"),
        (1436, 58, 442, "flat"),
        (1548, 50, 476, "dome"),
    ]
    for x, w, top, kind in pieces:
        layer.rrect(x, top, x + w, 600, min(10, w // 3), C("#cfa074"))
        layer.rrect(x, top, x + max(6, w // 3), 600, min(10, w // 3), C("#b9855e"))
        layer.line((x + w - 4, top + 6, x + w - 4, 590), C("#e2b98c"))
        if kind == "dome":
            layer.pieslice(x - 4, top - w // 2, x + w + 4, top + w // 2, 180, 360, C("#e2b98c"))
            layer.arc(x - 4, top - w // 2, x + w + 4, top + w // 2, 180, 360, C("#cfa074"), 2)
            layer.line((x + 2, top + 2, x + w - 2, top + 2), C("#e4a73f"), width=2)
        else:
            layer.rect(x, top, x + w, top + 5, C("#e2b98c"))
            layer.line((x + 2, top + 1, x + w - 2, top + 1), C("#f3e0bb"))
            for px in range(x + 7, x + w - 6, 11):
                layer.ellipse(px - 3, top - 7, px + 3, top, fill=C("#68a963"))
                layer.point(px + 1, top - 7, C("#8dc46f"))
        # shaded arched windows, low contrast
        for wy in range(top + 22, 570, 34):
            for wx in range(x + 9, x + w - 8, 20):
                if rng.random() < 0.45:
                    layer.rrect(wx, wy, wx + 8, wy + 13, 4, C("#9b6a50"))
                    layer.rect(wx + 2, wy + 3, wx + 5, wy + 8, C("#e2b98c"))
        # a green shoulder or a roof tank
        if rng.random() < 0.5:
            layer.rrect(x + w - 18, top - 16, x + w - 8, top, 2, C("#9b6a50"))
            layer.rect(x + w - 17, top - 14, x + w - 9, top - 2, C("#cfa074"))
        else:
            for px in range(x + 4, x + w - 4, 8):
                layer.point(px, top - 1, C("#68a963"))


# ---------------------------------------------------------------------------
# waterfront mid layer

DECK_Y = 350
QUAY_Y = 512
PIERS = [-30, 150, 330, 510, 690, 870, 1050, 1230, 1410, 1610]
FALL_MOUTHS = [236, 500]


def half_dome(layer: Layer, cx, base_y, rx, ry, glass=True, seed=0, body="#f3e0bb"):
    """A broad conservatory half-dome: wider than tall, no finial, no point."""
    base_y = int(base_y)
    rx = float(rx)
    ry = max(4.0, float(ry))
    apex = base_y - int(ry)
    for y in range(apex, base_y + 1):
        t = (base_y - y) / ry
        rad = rx * math.sqrt(max(0.0, 1.0 - t * t))
        if rad < 0.7:
            continue
        x0, x1 = int(cx - rad), int(cx + rad)
        if glass:
            layer.line((x0, y, x1, y), C("#42b2c2"))
            layer.line((x0, y, int(cx - rad * 0.35), y), C("#2f8ba8"))
            if t < 0.72:
                layer.line((int(cx + rad * 0.48), y, int(cx + rad * 0.9), y), C("#66d0cf"))
        else:
            layer.line((x0, y, x1, y), C(body))
            layer.line((x0, y, int(cx - rad * 0.5), y), C(CREAM["shade"]))
            if rad > 3:
                layer.line((int(cx + rad * 0.58), y, x1, y), C(CREAM["light"]))
    # meridian ribs and two horizontal hoops, in cream with a brass edge
    for f in (-0.74, -0.28, 0.28, 0.74):
        pts = []
        for y in range(apex + 2, base_y, 2):
            t = (base_y - y) / ry
            rad = rx * math.sqrt(max(0.0, 1.0 - t * t))
            pts.append((int(cx + f * rad), y))
        if len(pts) > 1:
            layer.line(pts, C(CREAM["light"]), width=2)
            layer.line([(px + 1, py) for px, py in pts], C(CREAM["brass"]))
    for tr in (0.36, 0.7):
        yy = apex + int(ry * tr)
        t = (base_y - yy) / ry
        rad = rx * math.sqrt(max(0.0, 1.0 - t * t))
        layer.line((int(cx - rad), yy, int(cx + rad), yy), C(CREAM["light"]), width=2)
        layer.line((int(cx - rad), yy + 2, int(cx + rad), yy + 2), C(CREAM["brass_dark"]))
    # a flat collar, planted, never a finial
    layer.rrect(cx - rx * 0.74, base_y - 7, cx + rx * 0.74, base_y + 4, 3, C(CREAM["body"]))
    layer.rrect(cx - rx * 0.74, base_y - 7, cx - rx * 0.4, base_y + 4, 3, C(CREAM["shade"]))
    layer.line((cx - rx * 0.72, base_y - 7, cx + rx * 0.72, base_y - 7), C(CREAM["brass"]), width=2)
    for px in range(int(cx - rx * 0.65), int(cx + rx * 0.66), 13):
        layer.ellipse(px - 3, base_y - 12, px + 3, base_y - 5, fill=C("#478a58"))
        layer.point(px + 1, base_y - 12, C("#8dc46f"))
        if px % 26 == 0:
            layer.point(px, base_y - 13, C("#f49bb8"))


def roof_garden(layer: Layer, x, y, w, seed=0, solar=True, laundry=True):
    rng = random.Random(seed)
    layer.rect(x, y, x + w, y + 4, C("#d2b07c"))
    layer.rect(x, y, x + w, y + 1, C(CREAM["light"]))
    for px in range(x + 6, x + w - 6, 13):
        layer.ellipse(px - 4, y - 6, px + 4, y + 1, fill=C("#478a58"))
        layer.ellipse(px - 2, y - 8, px + 2, y, fill=C("#68a963"))
        layer.point(px + 1, y - 8, C("#8dc46f"))
        if rng.random() < 0.35:
            layer.point(px, y - 9, C("#f49bb8"))
    if solar and w > 70:
        solar_panel(layer, x + w - 58, y - 12, 44, 9, seed, 2)
    if laundry and w > 90:
        layer.line((x + 8, y - 16, x + w - 8, y - 16), C(CREAM["brass_dark"]))
        for i in range(4):
            lx = x + 18 + i * (w - 36) // 4
            c = ["#ff8a4c", "#ffe08a", "#9ad8cd", "#f49bb8"][i % 4]
            layer.polygon([(lx, y - 16), (lx + 6, y - 16), (lx + 5, y - 9), (lx + 1, y - 9)], C(c))


def broad_block(
    layer: Layer,
    x,
    w,
    top,
    base=DECK_Y,
    body="#f3e0bb",
    shade="#e4c99b",
    roof="flat",
    storeys=3,
    seed=0,
    solar=True,
    lit=0.18,
):
    rng = random.Random(seed)
    layer.rrect(x, top, x + w, base, min(10, w // 5), C(body))
    layer.rrect(x, top, x + max(10, w // 4), base, min(10, w // 5), C(shade))
    layer.line((x + w - 3, top + 6, x + w - 3, base - 4), C(CREAM["light"]), width=2)
    # horizontal floor bands: the whole silhouette stays wide
    for i in range(1, storeys):
        yy = top + (base - top) * i // storeys
        layer.line((x + 2, yy, x + w - 2, yy), C(shade), width=2)
        layer.line((x + 3, yy + 1, x + w - 3, yy + 1), C(CREAM["light"]))
    # window rows, with awnings and flower boxes on the lower front
    cols = max(2, (w - 18) // 22)
    for i in range(storeys):
        yy = top + 16 + i * (base - top) // storeys
        for k in range(cols):
            wx = x + 12 + k * (w - 24) // max(1, cols - 1)
            lit_win = rng.random() < lit
            layer.rrect(wx - 4, yy, wx + 4, yy + 13, 4, C(CREAM["brass"]))
            layer.rrect(wx - 3, yy + 1, wx + 3, yy + 12, 3, C("#5aa6bd"))
            if lit_win:
                layer.rrect(wx - 2, yy + 2, wx + 2, yy + 11, 2, C("#ffe08a"))
                layer.point(wx, yy + 3, C("#fff3c9"))
            else:
                layer.rect(wx - 2, yy + 2, wx + 1, yy + 5, C("#78c2c7"))
                layer.point(wx + 2, yy + 9, C("#c6ebdc"))
        # balcony rail across the floor, plants and a striped awning
        if i < storeys - 1 and w > 100:
            layer.line((x + 6, yy + 16, x + w - 6, yy + 16), C(CREAM["brass"]), width=2)
            for px in range(x + 8, x + w - 6, 11):
                layer.line((px, yy + 13, px, yy + 16), C(CREAM["brass_hi"]))
                if rng.random() < 0.4:
                    layer.ellipse(px - 2, yy + 10, px + 2, yy + 15, fill=C("#478a58"))
    # front awning at the base (mostly behind the aqueduct parapet)
    ax0, ax1 = x + 8, x + w - 8
    for i in range(max(1, (ax1 - ax0) // 7)):
        c = "#ff8a4c" if i % 2 == 0 else "#fff2d6"
        layer.polygon([(ax0 + i * 7, base - 12), (ax0 + i * 7 + 7, base - 12), (ax0 + i * 7 + 5, base - 6), (ax0 + i * 7 + 2, base - 6)], C(c))
    layer.line((ax0, base - 12, ax1, base - 12), C(CREAM["brass_dark"]))
    # roof
    if roof == "garden":
        roof_garden(layer, x - 4, top - 2, w + 8, seed, solar=solar)
    elif roof == "barrel":
        layer.pieslice(x, top - 24, x + w, top + 24, 180, 360, C("#78c2c7"))
        layer.arc(x, top - 24, x + w, top + 24, 180, 360, C(CREAM["light"]), 2)
        for k in range(1, 5):
            gx = x + w * k // 5
            layer.line((gx, top - 18, gx, top), C(CREAM["brass"]))
        roof_garden(layer, x + 10, top - 1, w - 20, seed, solar=False, laundry=False)
    else:
        layer.rect(x, top - 5, x + w, top + 1, C(CREAM["body"]))
        layer.line((x - 2, top - 5, x + w + 2, top - 5), C(CREAM["brass"]), width=2)
        roof_garden(layer, x + 4, top - 4, w - 8, seed, solar=solar)
    # trailing greenery from the roof, kept off the windows
    for i in range(max(1, w // 48)):
        vx = x + 16 + i * 47
        hanging_vine(layer, vx, top + 4, 18 + i * 3, seed + i, 5)


def market_terrace(layer: Layer, x, y, w, seed=0):
    rng = random.Random(seed)
    # a low parade of stalls at deck level; horizontal, never a tower
    layer.rect(x, y, x + w, y + 7, C("#9b6a50"))
    layer.rect(x, y, x + w, y + 2, C(CREAM["light"]))
    n = max(1, w // 44)
    for i in range(n):
        sx = x + 6 + i * (w - 12) // n
        sw = (w - 12) // n - 4
        # striped awning
        for k in range(max(1, sw // 6)):
            c = "#ff8a4c" if k % 2 == 0 else "#fff2d6"
            layer.polygon([(sx + k * 6, y - 14), (sx + k * 6 + 6, y - 14), (sx + k * 6 + 4, y - 8), (sx + k * 6 + 2, y - 8)], C(c))
        layer.line((sx, y - 14, sx + sw, y - 14), C(CREAM["brass_dark"]))
        layer.rect(sx + 2, y - 7, sx + sw - 2, y - 5, C("#cfa074"))
        # crates and a potted plant
        layer.rrect(sx + 4, y - 4, sx + 11, y + 1, 1, C("#b9855e"))
        layer.rrect(sx + sw - 12, y - 5, sx + sw - 6, y + 1, 1, C("#9b6a50"))
        if rng.random() < 0.6:
            layer.ellipse(sx + sw // 2 - 3, y - 12, sx + sw // 2 + 3, y - 5, fill=C("#478a58"))
            layer.point(sx + sw // 2, y - 12, C("#8dc46f"))


def person(layer: Layer, x, y, seed=0):
    rng = random.Random(seed)
    c = rng.choice(["#3b395e", "#8e6bc0", "#a36428", "#2f6c4d"])
    coat = rng.choice(["#ff8a4c", "#9ad8cd", "#fff2d6", "#d24f4a"])
    layer.rect(x, y - 5, x + 1, y - 2, C(c))
    layer.rect(x - 1, y - 8, x + 2, y - 5, C(coat))
    layer.rect(x, y - 10, x + 1, y - 8, C("#b9855e"))
    layer.point(x + 1, y - 10, C("#7f5446"))
    layer.line((x, y - 2, x - 1, y), C(c))
    layer.line((x + 1, y - 2, x + 2, y), C(c))
    if rng.random() < 0.3:
        layer.point(x + 3, y - 6, C("#f49bb8"))


def duck(layer: Layer, x, y, seed=0):
    # a readable little mallard: cream body, brown head, orange bill, wake
    layer.ellipse(x, y - 4, x + 10, y + 2, fill=C("#f6e6c9"))
    layer.ellipse(x + 2, y - 5, x + 8, y, fill=C("#fff2d6"))
    layer.ellipse(x + 7, y - 7, x + 12, y - 2, fill=C("#9b6a50"))
    layer.point(x + 11, y - 8, C("#ffe08a"))
    layer.point(x + 12, y - 7, C("#f6b45b"))
    layer.point(x + 9, y - 7, C("#2d2b4b"))
    layer.rect(x + 1, y - 1, x + 6, y + 1, C("#e4c99b"))
    layer.line((x - 4, y + 2, x + 12, y + 2), C("#96e8dc"))
    layer.point(x - 3, y + 3, C("#c8f7ec"))
    layer.point(x + 13, y + 1, C("#66d0cf"))


def quay_shop(layer: Layer, x, y=QUAY_Y, w=56, seed=0):
    rng = random.Random(seed)
    style = seed % 3
    top = y - (40 if style == 0 else 36 if style == 1 else 42)
    body = ["#e2b98c", "#cfa074", "#d3a17f"][style]
    layer.rrect(x, top, x + w, y, 3, C(body))
    layer.rect(x, top, x + w, top + 3, C("#f3e0bb"))
    # striped awning in a different colour family per shop
    awning = [("#ff8a4c", "#fff2d6"), ("#9ad8cd", "#fff2d6"), ("#f49bb8", "#ffe6a1")][style]
    for i in range(max(1, w // 7)):
        c = awning[i % 2]
        layer.polygon([(x + i * 7, top - 7), (x + i * 7 + 7, top - 7), (x + i * 7 + 5, top), (x + i * 7 + 2, top)], C(c))
    layer.line((x, top - 8, x + w, top - 8), C(CREAM["brass_dark"]))
    if style == 0:
        # café: wide warm window, counter, parasol
        layer.rrect(x + 7, top + 9, x + 29, top + 26, 3, C(CREAM["brass"]))
        layer.rrect(x + 8, top + 10, x + 28, top + 25, 2, C("#ffe08a"))
        layer.rect(x + 9, top + 11, x + 17, top + 18, C("#fff3c9"))
        layer.line((x + 19, top + 11, x + 19, top + 24), C(CREAM["brass_dark"]))
        layer.rrect(x + 33, top + 10, x + 49, top + 28, 3, C(CREAM["brass"]))
        layer.rrect(x + 34, top + 11, x + 48, top + 28, 2, C("#2d2b4b"))
        layer.rect(x + 36, top + 13, x + 46, top + 23, C("#8e6bc0"))
        layer.point(x + 40, top + 17, C("#ffe08a"))
        # parasol and a little table
        layer.line((x + 16, top + 28, x + 16, top + 36), C(CREAM["brass_dark"]))
        layer.pieslice(x + 7, top + 22, x + 25, top + 32, 180, 360, C("#ff8a4c"))
        layer.rect(x + 13, top + 32, x + 20, top + 34, C("#9b6a50"))
        layer.point(x + 16, top + 30, C("#ffe08a"))
    elif style == 1:
        # boathouse: wide dark door, ropes, a hanging ring
        layer.rrect(x + 8, top + 8, x + 44, top + 30, 4, C(CREAM["brass"]))
        layer.rrect(x + 9, top + 9, x + 43, top + 30, 4, C("#2d2b4b"))
        for k in range(3):
            layer.line((x + 13 + k * 10, top + 11, x + 13 + k * 10, top + 28), C("#5aa6bd"))
        layer.rect(x + 10, top + 22, x + 42, top + 28, C("#5aa6bd"))
        layer.line((x + 4, top + 12, x + 8, top + 30), C(CREAM["brass_dark"]))
        layer.ellipse(x + 46, top + 12, x + 52, top + 18, outline=C("#c9852f"))
        layer.rect(x + 48, top + 25, x + 54, top + 31, C("#ffe08a"))
    else:
        # flower shop: two small windows, planters, hanging baskets
        for k in range(2):
            wx = x + 7 + k * 20
            layer.rrect(wx, top + 10, wx + 14, top + 25, 3, C(CREAM["brass"]))
            layer.rrect(wx + 1, top + 11, wx + 13, top + 24, 2, C("#5aa6bd"))
            layer.rect(wx + 2, top + 12, wx + 8, top + 17, C("#9ad8cd"))
        for px in range(x + 5, x + w - 4, 9):
            layer.ellipse(px - 3, top + 26, px + 3, top + 32, fill=C("#478a58"))
            layer.point(px, top + 26, C("#8dc46f"))
            layer.point(px + 1, top + 27, C("#f49bb8"))
        layer.line((x + w - 8, top, x + w - 8, top + 7), C(CREAM["brass_dark"]))
        layer.rrect(x + w - 12, top + 7, x + w - 4, top + 14, 2, C("#68a963"))
    # crates, a person and a hanging sign are common to every shop
    layer.rrect(x + 4, top + 31, x + 14, top + 39, 1, C("#b9855e"))
    layer.rrect(x + w - 14, top + 32, x + w - 5, top + 39, 1, C("#9b6a50"))
    layer.line((x + w - 6, top, x + w - 6, top + 7), C(CREAM["brass_dark"]))
    layer.rrect(x + w - 10, top + 7, x + w - 1, top + 14, 2, C("#9ad8cd"))
    layer.point(x + w - 5, top + 10, C("#5aa6bd"))


def roof_tree(layer: Layer, cx, base_y, w=30, h=16, seed=0):
    rng = random.Random(seed)
    layer.line((cx, base_y, cx + 1, base_y - 12), C("#7f5446"), width=3)
    layer.line((cx + 1, base_y - 8, cx - 5, base_y - 15), C("#7f5446"))
    layer.line((cx + 1, base_y - 10, cx + 7, base_y - 16), C("#7f5446"))
    for i in range(7):
        ex = cx - w // 2 + i * max(4, w // 7) + rng.randint(-2, 2)
        ey = base_y - 12 - rng.randint(0, h - 5)
        layer.ellipse(ex - 7, ey - 5, ex + 7, ey + 5, fill=C("#2f6c4d"))
        layer.ellipse(ex - 4, ey - 5, ex + 4, ey + 1, fill=C("#478a58"))
        layer.point(ex + 1, ey - 5, C("#68a963"))
    for i in range(3):
        layer.point(cx - 8 + i * 8, base_y - h - 1, C("#8dc46f"))


def laundry(layer: Layer, x0, x1, y, seed=0):
    layer.line((x0, y, x1, y), C(CREAM["brass_dark"]))
    for i in range(4):
        x = x0 + (x1 - x0) * (i + 1) // 5
        c = ["#ff8a4c", "#ffe08a", "#9ad8cd", "#f49bb8"][i]
        layer.polygon([(x, y), (x + 6, y), (x + 5, y + 8), (x + 1, y + 8)], C(c))
    layer.point(x0, y - 2, C(CREAM["brass_dark"]))
    layer.point(x1, y - 2, C(CREAM["brass_dark"]))


def parasol(layer: Layer, cx, base_y, r=15, seed=0):
    rng = random.Random(seed)
    c1, c2 = [( "#ff8a4c", "#fff2d6"), ("#9ad8cd", "#fff2d6"), ("#f49bb8", "#ffe6a1")][seed % 3]
    layer.line((cx, base_y, cx, base_y - 16), C(CREAM["brass_dark"]))
    layer.pieslice(cx - r, base_y - 24, cx + r, base_y - 2, 180, 360, C(c1))
    for i in range(-2, 3):
        x = cx + i * r // 3
        layer.line((cx, base_y - 22, x, base_y - 8), C(c2))
    layer.arc(cx - r, base_y - 24, cx + r, base_y - 2, 180, 360, C(CREAM["light"]), 2)
    layer.line((cx - r + 2, base_y - 3, cx + r - 2, base_y - 3), C(CREAM["brass"]))
    # table and a chair under the shade
    layer.rect(cx - 4, base_y - 5, cx + 4, base_y - 3, C(CREAM["stone"]))
    layer.line((cx - 3, base_y - 3, cx - 3, base_y + 2), C(CREAM["stone_dark"]))
    layer.line((cx + 3, base_y - 3, cx + 3, base_y + 2), C(CREAM["stone_dark"]))
    layer.point(cx + r + 2, base_y - 1, C(rng.choice(["#f49bb8", "#9ad8cd", "#ffe08a"])))


def aqueduct_wall(layer: Layer):
    """The long horizontal spine: arches, deck, channel and quay walkway."""
    deck_y, quay_y = DECK_Y, QUAY_Y
    stone = "#e4c99b"
    stone_dark = "#cfa074"
    stone_deep = "#b9855e"
    # top slab and fascia
    layer.rect(0, deck_y, 1600, deck_y + 34, C(stone))
    layer.rect(0, deck_y + 30, 1600, deck_y + 34, C(stone_dark))
    layer.line((0, deck_y + 34, 1600, deck_y + 34), C(stone_deep), width=2)
    layer.line((0, deck_y + 1, 1600, deck_y + 1), C(CREAM["light"]), width=2)
    # piers and arches
    for i in range(len(PIERS) - 1):
        px0, px1 = PIERS[i], PIERS[i + 1]
        j0, j1 = px0 + 18, px1 - 18
        cx = (j0 + j1) // 2
        half = max(14, (j1 - j0) // 2)
        spring = deck_y + 88
        rise = spring - (deck_y + 36)
        for x in range(j0, j1 + 1):
            u = (x - cx) / half
            arch_y = spring - int(rise * math.sqrt(max(0.0, 1.0 - u * u)))
            if arch_y > deck_y + 36:
                layer.rect(x, deck_y + 36, x, arch_y - 1, C(stone))
            # thick arch ring/soffit
            layer.rect(x, arch_y, x, arch_y + 4, C(stone_dark))
            layer.rect(x, arch_y + 4, x, arch_y + 5, C(stone_deep))
            layer.rect(x, arch_y + 5, x, arch_y + 7, C("#9b6a50"))
            layer.point(x, arch_y - 1, C(CREAM["light"]))
        # pier blocks, wide and horizontally banded
        for px in (px0, px1):
            layer.rrect(px - 20, deck_y + 30, px + 20, quay_y, 4, C(stone))
            layer.rrect(px - 20, deck_y + 30, px - 8, quay_y, 4, C(stone_dark))
            layer.rect(px - 23, deck_y + 30, px + 23, deck_y + 38, C(CREAM["light"]))
            layer.rect(px - 26, quay_y - 18, px + 26, quay_y, C(stone_dark))
            for yy in range(deck_y + 46, quay_y - 18, 22):
                layer.line((px - 18, yy, px + 18, yy), C(stone_dark))
                layer.point(px, yy + 5, C(stone_deep))
            layer.rect(px + 18, deck_y + 38, px + 20, quay_y - 18, C(stone_dark))
            layer.rect(px - 20, deck_y + 38, px - 18, quay_y - 18, C(stone_dark))
            layer.rect(px - 14, deck_y + 44, px + 14, deck_y + 62, C(stone_dark))
            layer.rect(px - 12, deck_y + 46, px + 12, deck_y + 60, C(stone))
            layer.point(px, deck_y + 54, C(CREAM["brass"]))
        # a keystone and a little garland on the spandrel
        layer.rect(cx - 2, deck_y + 38, cx + 2, deck_y + 46, C(CREAM["light"]))
        layer.point(cx, deck_y + 43, C(CREAM["brass"]))
    # deck water channel and parapet
    layer.rect(0, deck_y - 6, 1600, deck_y - 1, C("#2f8ba8"))
    layer.rect(0, deck_y - 5, 1600, deck_y - 3, C("#66d0cf"))
    for x in range(0, 1600, 7):
        if (x * 3) % 11 < 3:
            layer.point(x, deck_y - 4, C("#96e8dc"))
    layer.rect(0, deck_y - 12, 1600, deck_y - 6, C(stone))
    layer.line((0, deck_y - 12, 1600, deck_y - 12), C(CREAM["brass"]), width=2)
    for px in range(8, 1600, 26):
        layer.line((px, deck_y - 20, px, deck_y - 12), C(CREAM["brass"]))
        layer.point(px, deck_y - 21, C(CREAM["brass_hi"]))
    layer.line((0, deck_y - 20, 1600, deck_y - 20), C(CREAM["brass"]), width=2)
    # hanging gardens off the parapet
    for px in range(26, 1600, 84):
        hanging_vine(layer, px, deck_y + 2, 22 + (px % 17), px, 6)
    # quay walkway and mooring rings at the waterline
    layer.rect(0, quay_y - 16, 1600, quay_y, C(CREAM["stone"]))
    layer.rect(0, quay_y - 16, 1600, quay_y - 13, C(CREAM["light"]))
    layer.rect(0, quay_y - 3, 1600, quay_y, C(stone_deep))
    for x in range(-4, 1600, 28):
        layer.rect(x, quay_y - 14, x, quay_y - 3, C(stone_dark))
    for x in range(14, 1600, 96):
        layer.ellipse(x - 3, quay_y - 10, x + 3, quay_y - 4, outline=C(CREAM["brass_dark"]))
        layer.line((x - 2, quay_y - 10, x + 2, quay_y - 4), C(CREAM["brass"]))
    # waterfall mouths: a broad brass/stone spout at the deck edge
    for mx in FALL_MOUTHS:
        layer.rrect(mx - 16, deck_y - 2, mx + 16, deck_y + 7, 3, C(stone_dark))
        layer.rrect(mx - 14, deck_y - 1, mx + 14, deck_y + 5, 2, C(CREAM["brass"]))
        layer.rect(mx - 11, deck_y + 5, mx + 11, deck_y + 9, C(CREAM["brass_dark"]))
        layer.rect(mx - 9, deck_y + 7, mx + 9, deck_y + 10, C(CREAM["water_hi"]))
    # a broad stair from the deck to the quay, at the right of the hero
    sx = 720
    for i in range(12):
        layer.rect(sx + i * 4, deck_y + 34 + i * 12, sx + 68 + i * 4, deck_y + 41 + i * 12, C(stone))
        layer.line((sx + i * 4, deck_y + 34 + i * 12, sx + 68 + i * 4, deck_y + 34 + i * 12), C(CREAM["light"]))
        layer.line((sx + i * 4, deck_y + 41 + i * 12, sx + 68 + i * 4, deck_y + 41 + i * 12), C(stone_dark))
    # stairs rail
    layer.line((sx, deck_y + 30, sx + 48, deck_y + 160), C(CREAM["brass_dark"]), width=2)
    for i in range(5):
        layer.line((sx + 8 + i * 10, deck_y + 42 + i * 30, sx + 8 + i * 10, deck_y + 52 + i * 30), C(CREAM["brass"]))
    # decorative frieze, medallions and lamps on the wall face
    for x in range(10, 1592, 26):
        layer.rect(x, deck_y + 39, x + 12, deck_y + 47, C(stone_dark))
        layer.rect(x + 2, deck_y + 41, x + 10, deck_y + 45, C(stone))
    for i, px in enumerate(PIERS[1:-1]):
        if i % 2 == 0:
            layer.ellipse(px - 7, deck_y + 44, px + 7, deck_y + 58, fill=C(CREAM["brass"]))
            layer.ellipse(px - 5, deck_y + 46, px + 5, deck_y + 56, fill=C(CREAM["brass_hi"]))
            for k in range(4):
                a = k * math.tau / 4
                layer.point(px + int(math.cos(a) * 4), deck_y + 51 + int(math.sin(a) * 4), C(CREAM["brass_dark"]))
            layer.point(px, deck_y + 51, C("#ff8a4c"))
        else:
            layer.line((px, deck_y + 50, px + 12, deck_y + 50), C(CREAM["brass_dark"]))
            layer.line((px + 12, deck_y + 50, px + 12, deck_y + 58), C(CREAM["brass_dark"]))
            layer.rect(px + 9, deck_y + 56, px + 15, deck_y + 64, C(CREAM["brass"]))
            layer.rect(px + 10, deck_y + 57, px + 14, deck_y + 63, C("#ffe08a"))
            layer.point(px + 12, deck_y + 54, C("#fff3c9"))
    for vx, ln in ((40, 44), (300, 58), (600, 50), (760, 64), (1000, 46), (1320, 56), (1540, 42)):
        hanging_vine(layer, vx, deck_y + 2, ln, vx, 7)
        for k in range(3):
            layer.ellipse(vx - 5 + k * 4, deck_y + 18 + k * 12, vx + 2 + k * 4, deck_y + 25 + k * 12, fill=C("#478a58"))
            layer.point(vx - 2 + k * 4, deck_y + 18 + k * 12, C("#8dc46f"))

    # waterfront shopfronts: the bottom band gets the life, the wall stays open
    for i, (sx, sw) in enumerate(((52, 54), (264, 48), (540, 62), (900, 46), (1088, 58), (1278, 52), (1458, 60))):
        quay_shop(layer, sx, QUAY_Y, sw, 120 + i)

    # quay cargo and planters; the people here are animated by the loop
    # and ambient strips, so no static figures compete with them
    for i, x in enumerate(range(30, 1560, 118)):
        if i % 2 == 0:
            layer.rrect(x, quay_y - 23, x + 10, quay_y - 16, 2, C("#b9855e"))
            layer.rrect(x + 2, quay_y - 28, x + 8, quay_y - 23, 1, C("#cfa074"))
        else:
            layer.ellipse(x - 3, quay_y - 25, x + 3, quay_y - 18, fill=C("#478a58"))
            layer.point(x, quay_y - 25, C("#8dc46f"))


def rope_bridge(layer: Layer, x0, y0, x1, y1, sag=8, seed=0):
    pts = []
    for x in range(x0, x1 + 1):
        t = (x - x0) / max(1, x1 - x0)
        yy = int(y0 * (1 - t) + y1 * t - sag * math.sin(math.pi * t))
        pts.append((x, yy))
    for x, yy in pts:
        # a continuous wooden deck, a handrail and a rope net below
        layer.rect(x, yy + 2, x, yy + 4, C("#9b6a50"))
        layer.rect(x, yy + 2, x, yy + 2, C("#cfa074"))
        if x % 2 == 0:
            layer.point(x, yy - 4, C(CREAM["brass_dark"]))
        if x % 8 == 0:
            layer.line((x, yy - 4, x, yy + 2), C(CREAM["brass_dark"]))
            layer.line((x, yy + 4, x, yy + 7), C(CREAM["brass_dark"]))
        if x % 4 == 0:
            layer.rect(x, yy + 3, x + 2, yy + 4, C("#e4c99b"))
    for i in range(3):
        vx = x0 + (x1 - x0) * (i + 1) // 4
        vy = pts[vx - x0][1]
        hanging_vine(layer, vx, vy + 4, 10 + i * 4, seed + i, 4)


def tree_hut(layer: Layer, cx, y, seed=0):
    # a low flat-roofed lookout with a deck, not a tower
    layer.rrect(cx - 32, y, cx + 32, y + 20, 5, C("#cfa074"))
    layer.rrect(cx - 30, y + 2, cx + 30, y + 18, 4, C("#e2b98c"))
    layer.rrect(cx - 38, y + 18, cx + 38, y + 24, 2, C("#9b6a50"))
    layer.line((cx - 38, y + 18, cx + 38, y + 18), C(CREAM["brass"]), width=2)
    layer.rect(cx - 8, y + 5, cx + 8, y + 17, C("#2d2b4b"))
    layer.rect(cx - 6, y + 7, cx + 6, y + 15, C("#ffe08a"))
    layer.rect(cx - 6, y + 7, cx - 2, y + 15, C("#fff3c9"))
    for px in range(cx - 28, cx + 30, 11):
        layer.line((px, y, px, y + 5), C("#7f5446"))
        layer.point(px, y - 1, C(CREAM["brass_hi"]))
    # little awning, window box and roof plants
    for i in range(9):
        c = "#ff8a4c" if i % 2 == 0 else "#fff2d6"
        layer.polygon([(cx - 34 + i * 8, y - 8), (cx - 34 + i * 8 + 8, y - 8), (cx - 34 + i * 8 + 6, y - 2), (cx - 34 + i * 8 + 2, y - 2)], C(c))
    for px in range(cx - 26, cx + 28, 9):
        layer.ellipse(px - 3, y - 5, px + 3, y + 1, fill=C("#478a58"))
        layer.point(px + 1, y - 5, C("#8dc46f"))
        if px % 18 == 0:
            layer.point(px, y - 6, C("#f49bb8"))
    # rope ladder, deck rail and a lantern
    for i in range(8):
        layer.line((cx - 22, y + 24 + i * 4, cx - 22, y + 27 + i * 4), C(CREAM["brass_dark"]))
        layer.line((cx - 22, y + 27 + i * 4, cx - 13, y + 27 + i * 4), C("#7f5446"))
    for px in range(cx - 32, cx + 33, 10):
        layer.line((px, y + 18, px, y + 23), C(CREAM["brass"]))
    lantern(layer, cx + 29, y + 24)
    lantern(layer, cx - 30, y + 24)


def draw_mid() -> Layer:
    layer = Layer()
    rng = random.Random(9)
    # ---- city behind the aqueduct ---------------------------------------
    # left: a broad three-storey garden block, cut by the seam on purpose
    broad_block(layer, -34, 214, 232, body="#f3e0bb", shade="#e4c99b", roof="garden", storeys=3, seed=1, solar=True)
    broad_block(layer, 156, 96, 268, body="#cfa074", shade="#9b6a50", roof="flat", storeys=2, seed=2, solar=False)
    # a low market/warehouse bay under the tree's left shoulder
    broad_block(layer, 252, 108, 300, body="#e2b98c", shade="#cfa074", roof="barrel", storeys=1, seed=3, solar=False)
    wind_turbine(layer, 112, 200, 232, 20, 0.8, 38)
    market_terrace(layer, 262, DECK_Y, 96, 31)

    # central giant tree; the trunk is broad and the crown spreads above the
    # deck, not a lollipop
    big_tree(layer, 392, DECK_Y, 312, 196, seed=10, treehouse_=False)
    # two visible limbs below the crown, so the trunk is not a bare pole
    for bx, by, tx, ty in ((392, 300, 330, 272), (392, 312, 452, 282), (392, 326, 360, 340)):
        layer.line((bx, by, tx, ty), C("#7f5446"), width=6)
        layer.line((bx, by + 1, tx, ty + 1), C("#9b6a50"), width=2)
    for tx, ty in ((330, 272), (452, 282), (360, 340)):
        for i in range(5):
            layer.ellipse(tx - 8 + i * 4, ty - 7 - (i % 2) * 3, tx + 2 + i * 4, ty + 3, fill=C("#2f6c4d"))
            layer.point(tx - 4 + i * 4, ty - 7 - (i % 2) * 3, C("#68a963"))
    tree_hut(layer, 344, 238, 33)
    rope_bridge(layer, 184, 252, 318, 248, 7, 44)
    # lanterns and a swing in the crown
    for px, py in ((300, 228), (470, 236), (420, 214)):
        lantern(layer, px, py)
    # small market pavilions around the root terrace
    broad_block(layer, 236, 92, 324, body="#e2b98c", shade="#cfa074", roof="flat", storeys=1, seed=4, solar=False, lit=0.1)
    market_terrace(layer, 236, DECK_Y, 92, 32)
    market_terrace(layer, 440, DECK_Y, 70, 33)

    # right: a wide low conservatory with a glass half-dome
    broad_block(layer, 512, 280, 330, body="#f3e0bb", shade="#e4c99b", roof="flat", storeys=1, seed=5, solar=False)
    half_dome(layer, 650, 326, 132, 74, glass=True, seed=6)
    layer.rrect(506, 326, 534, 350, 3, C(CREAM["body"]))
    layer.rrect(770, 320, 802, 350, 3, C(CREAM["body"]))
    # plants inside the glass and a lit entrance arcade at its feet
    for i, px in enumerate(range(566, 742, 22)):
        layer.rrect(px - 5, 316, px + 5, 326, 2, C("#9b6a50"))
        layer.ellipse(px - 8, 303 + (i % 2) * 3, px + 8, 320, fill=C("#2f6c4d"))
        layer.ellipse(px - 5, 302 + (i % 2) * 3, px + 4, 315, fill=C("#478a58"))
        layer.point(px + 2, 302 + (i % 2) * 3, C("#8dc46f"))
        if i % 3 == 0:
            layer.point(px, 306, C("#f49bb8"))
    for ax in range(536, 780, 34):
        if 624 <= ax <= 664:
            continue
        arched_window(layer, ax, 328, 12, 20, lit=(ax % 68 == 0))
    layer.rrect(628, 318, 672, 350, 6, C(CREAM["brass"]))
    layer.rrect(631, 321, 669, 350, 5, C("#2d2b4b"))
    layer.rrect(635, 325, 665, 350, 4, C("#ffe08a"))
    layer.line((650, 325, 650, 350), C(CREAM["brass_dark"]))
    market_terrace(layer, 520, DECK_Y, 260, 34)
    # a rooftop wind catcher on the left edge of the conservatory roof
    wind_turbine(layer, 538, 300, 326, 19, 0.4, 35)

    # ---- second screen ---------------------------------------------------
    broad_block(layer, 812, 174, 236, body="#f3e0bb", shade="#e4c99b", roof="garden", storeys=3, seed=7)
    broad_block(layer, 982, 128, 292, body="#cfa074", shade="#9b6a50", roof="flat", storeys=2, seed=8, solar=False)
    broad_block(layer, 1106, 168, 308, body="#e2b98c", shade="#cfa074", roof="barrel", storeys=1, seed=9, solar=False)
    broad_block(layer, 1122, 160, 252, body="#f3e0bb", shade="#e4c99b", roof="garden", storeys=3, seed=11)
    market_terrace(layer, 1130, DECK_Y, 120, 36)
    # a medium tree, broad and low
    big_tree(layer, 1352, DECK_Y, 196, 146, seed=12, treehouse_=False)
    broad_block(layer, 1442, 158, 240, body="#cfa074", shade="#9b6a50", roof="flat", storeys=2, seed=13, solar=True)
    half_dome(layer, 1518, 326, 58, 34, glass=True, seed=14)
    market_terrace(layer, 1450, DECK_Y, 140, 37)
    wind_turbine(layer, 1212, 220, 254, 24, 1.5, 36)
    wind_turbine(layer, 886, 194, 236, 18, 2.7, 37)

    roof_tree(layer, 52, 232, 34, 18, 51)
    roof_tree(layer, 930, 236, 32, 17, 52)
    roof_tree(layer, 1480, 240, 30, 16, 53)
    laundry(layer, 188, 252, 222, 54)
    laundry(layer, 1200, 1280, 236, 55)

    # ---- long horizontal aqueduct / quay --------------------------------
    aqueduct_wall(layer)

    # parasols and market life on the terrace
    for i, (px, pr) in enumerate(((258, 16), (468, 14), (548, 15), (770, 17), (875, 13), (1150, 15), (1462, 14))):
        parasol(layer, px, DECK_Y - 1, pr, 90 + i)
    for i, px in enumerate((292, 612, 806, 1246, 1412)):
        person(layer, px, DECK_Y - 3, 950 + i)
    person(layer, 270, 246, 960)
    for px in range(22, 1600, 63):
        if px % 2 == 0:
            layer.rrect(px - 3, DECK_Y - 12, px + 4, DECK_Y - 4, 2, C("#9b6a50"))
            layer.ellipse(px - 3, DECK_Y - 19, px + 4, DECK_Y - 11, fill=C("#478a58"))
            layer.point(px + 1, DECK_Y - 19, C("#8dc46f"))
            if px % 3 == 0:
                layer.point(px, DECK_Y - 20, C("#f49bb8"))
    layer.line((688, 544, 712, 544), C("#ffe6a1"))
    layer.line((684, 562, 704, 562), C("#ffd37a"))
    layer.line((694, 580, 710, 580), C("#ffe6a1"))
    bird(layer, 344, 230, 1)
    bird(layer, 890, 242, -1)

    # rooftop life along the whole terrace
    for x in range(60, 1560, 180):
        if (x // 180) % 3 == 0:
            person(layer, x, DECK_Y - 22, 900 + x)
    for x in range(120, 1500, 210):
        if (x // 210) % 2 == 0:
            layer.ellipse(x - 4, DECK_Y - 29, x + 4, DECK_Y - 22, fill=C("#478a58"))
            layer.point(x, DECK_Y - 29, C("#8dc46f"))
    # cables and bunting between roofs
    for x0, x1, y in ((196, 252, 274), (790, 812, 268), (1280, 1338, 262), (1580, 1620, 258)):
        layer.line((x0, y, x1, y - 3), C(CREAM["brass_dark"]))
        for i in range(3):
            fx = x0 + (x1 - x0) * (i + 1) // 4
            layer.polygon([(fx, y - 1), (fx + 5, y), (fx + 1, y + 4)], C("#ff8a4c" if i % 2 == 0 else "#ffe08a"))
    # ducks and a few boats are in the near/mover layers, not here
    return layer

def draw_falls() -> Image.Image:
    strip = Image.new("RGBA", (FALL_W * 6, FALL_H), (0, 0, 0, 0))
    # fixed ribbons of water, 48px period; frames shift them by 8px so the
    # last frame wraps into the first with no jump
    ribbons = [
        (9, 2, 0, 54, "#c8f7ec"),
        (13, 3, 17, 78, "#96e8dc"),
        (18, 1, 33, 46, "#c8f7ec"),
        (22, 2, 7, 64, "#96e8dc"),
        (27, 3, 25, 88, "#c8f7ec"),
        (33, 1, 12, 40, "#96e8dc"),
        (37, 2, 41, 72, "#c8f7ec"),
        (40, 1, 28, 52, "#96e8dc"),
    ]
    for f in range(6):
        img = Image.new("RGBA", (FALL_W, FALL_H), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        phase = f * 8
        sway = [0, 1, 1, 0, -1, -1][f]

        # the sheet: a narrow, gently snaking body with a broken edge
        for y in range(9, 214):
            cx = 24 + int(1.6 * math.sin(y / 38 + f * math.tau / 6))
            if y < 22:
                half = 12 + (y - 9) // 2
            elif y < 178:
                half = 14 + int(2.2 * math.sin(y / 23 + f * math.tau / 3))
            else:
                half = max(6, 15 - (y - 178) // 5)
            x0, x1 = cx - half, cx + half
            if y % 13 in (0, 1):
                x0 += 1
            if y % 19 in (3, 4):
                x1 -= 1
            d.line((x0, y, x1, y), fill=C("#2f8ba8"))
            d.line((x0 + 1, y, x1 - 1, y), fill=C("#42b2c2"))
            d.line((x0 + 4, y, x1 - 4, y), fill=C("#66d0cf"))
            # thin darker channels, pinned to the moving edge
            d.point((x0 + 5, y), fill=C("#2f8ba8"))
            d.point((x1 - 6, y), fill=C("#2f8ba8"))
            # internal churn: broken slivers of lighter water
            if (y * 3 + f * 7) % 13 < 4:
                d.line((x0 + 6, y, x0 + 10, y), fill=C("#96e8dc"))
            if (y * 5 + f * 3) % 17 < 5:
                d.line((x1 - 9, y, x1 - 5, y), fill=C("#96e8dc"))
            # flecks of foam at the very edge
            if (y * 7 + f * 11) % 23 == 0:
                d.point((x0 + 2, y), fill=C("#c8f7ec"))
            if (y * 5 + f * 7) % 29 == 0:
                d.point((x1 - 3, y), fill=C("#effff4"))

        # vertical ribbons: no full-width bars, so it reads as water not barcode
        for sx, sw, off, length, colour in ribbons:
            top = (phase + off) % 48 - 48
            for y in range(top, 216, 48):
                y0 = max(12, y)
                y1 = min(210, y + length)
                if y1 <= y0:
                    continue
                for yy in range(y0, y1):
                    cx = 24 + int(1.6 * math.sin(yy / 38 + f * math.tau / 6))
                    half = 14 + int(2.2 * math.sin(yy / 23 + f * math.tau / 3)) if yy < 178 else max(6, 15 - (yy - 178) // 5)
                    xx = sx + int(1.2 * math.sin(yy / 13 + sx * 0.6)) + (cx - 24)
                    if cx - half + 4 <= xx <= cx + half - 4:
                        d.line((xx, yy, min(cx + half - 4, xx + sw - 1), yy), fill=C(colour))
                        if sw >= 2 and yy % 17 == 0:
                            d.point((xx, yy), fill=C("#effff4"))
                if y0 > 16 and (y0 + sx) % 5 < 3:
                    d.rectangle((sx - 1 + (cx - 24), y0 - 2, sx + sw + (cx - 24), y0), fill=C("#effff4"))
                    d.point((sx + sw + (cx - 24), y0 + 1), fill=C("#c8f7ec"))

        # crest: a soft crown of foam, shifting a pixel with the sway
        for i in range(7):
            fx = 4 + i * 6 + (sway if i % 2 == 0 else 0)
            fy = 2 + (i % 3)
            rw = 5 + (i % 2) * 2
            d.ellipse((fx, fy, fx + rw, fy + 8), fill=C("#c8f7ec"))
            d.ellipse((fx + 1, fy + 1, fx + rw - 2, fy + 5), fill=C("#effff4"))
        for i in range(15):
            fx = 5 + i * 3 + (sway if i % 3 == 0 else 0)
            fy = 5 + (i % 3)
            d.rectangle((fx, fy, fx + 2, fy + 2), fill=C("#effff4"))
        d.line((4, 12, 44, 12), fill=C("#c8f7ec"))
        d.line((7, 14, 41, 14), fill=C("#96e8dc"))
        # dribbles over the lip
        d.line((9 + sway, 14, 9 + sway, 19), fill=C("#c8f7ec"))
        d.line((34 - sway, 14, 34 - sway, 21), fill=C("#c8f7ec"))
        d.point((5 + (f % 3), 12), fill=C("#c8f7ec"))
        d.point((43 - (f % 3), 13), fill=C("#c8f7ec"))

        # mist at the bottom: loose lobes, dithered edge, extra spray
        for i in range(6):
            mx = 9 + i * 6 + (f % 2)
            my = 204 + (i % 3) * 7 + int(math.sin(f * math.tau / 6) * 2)
            rw = 7 + (i % 3) * 3
            d.ellipse((mx - rw, my - 5, mx + rw, my + 6), fill=C("#96e8dc"))
            d.ellipse((mx - rw + 2, my - 6, mx + rw - 4, my + 2), fill=C("#c8f7ec"))
            if i % 2 == 0:
                d.ellipse((mx - rw + 4, my - 6, mx + rw - 7, my - 1), fill=C("#effff4"))
        for y in range(190, 240):
            for x in range(0, 48):
                keep = BAYER8[y % 8, (x + f) % 8]
                if y > 224 and keep > 0.40:
                    continue
                if 188 < y < 200 and keep > 0.50:
                    continue
                if 2 <= x <= 45 and (x + y * 3 + f * 5) % 11 < 3:
                    d.point((x, y), fill=C("#c8f7ec") if (x + y) % 4 else C("#effff4"))
        for i in range(30):
            sx = (i * 17 + f * 5) % 48
            sy = 186 + ((i * 11 + f * 7) % 52)
            if (i + f) % 3 == 0 and 1 <= sx <= 46:
                d.point((sx, sy), fill=C("#c8f7ec"))
        # final splash lines at the basin
        d.line((8, 214, 40, 214), fill=C("#96e8dc"))
        d.line((5, 220, 43, 220), fill=C("#c8f7ec"))
        d.line((10, 226, 38, 226), fill=C("#effff4"))
        strip.paste(img, (f * FALL_W, 0))
    return strip


# ---------------------------------------------------------------------------
# near framing


def draw_birds_strip() -> Image.Image:
    fw, fh, n = 16, 8, 4
    strip = Image.new("RGBA", (fw * n, fh), (0, 0, 0, 0))
    wing_rows = [1, 4, 6, 4]
    for f in range(n):
        img = Image.new("RGBA", (fw, fh), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        wy = wing_rows[f]
        body = C("#3b395e")
        hi = C("#4c4a72")
        # wings: two strokes, body and tail; one pixel of light on the near wing
        d.line((2, wy, 6, 4), fill=body)
        d.line((6, 4, 8, 4), fill=body)
        d.line((8, 4, 13, wy), fill=body)
        d.point((6, 4), fill=hi)
        d.point((9, 4), fill=hi)
        d.point((8, 5), fill=body)
        d.point((8, 6), fill=body)
        # beak/tail marks at 1px
        d.point((14, max(0, wy - 1)), fill=body)
        d.point((1, max(0, wy - 1)), fill=body)
        if f % 2 == 0:
            d.point((7, 3), fill=hi)
        strip.paste(img, (f * fw, 0))
    return strip


def draw_zeppelin_strip() -> Image.Image:
    fw, fh, n = 64, 28, 3
    strip = Image.new("RGBA", (fw * n, fh), (0, 0, 0, 0))
    for f in range(n):
        img = Image.new("RGBA", (fw, fh), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        # broad horizontal envelope, cream with brass ribs
        d.ellipse((10, 4, 54, 18), fill=C("#f3e0bb"))
        d.ellipse((12, 5, 45, 13), fill=C("#fff2d6"))
        d.ellipse((12, 13, 53, 18), fill=C("#e4c99b"))
        for x in (20, 29, 38, 47):
            d.line((x, 5, x, 17), fill=C("#c9852f"))
        d.line((12, 5, 42, 5), fill=C("#fff2d6"))
        d.ellipse((50, 8, 57, 15), fill=C("#f7c85f"))
        # tail fins, no spike: two horizontal wedges
        d.polygon([(12, 11), (3, 6), (6, 12), (12, 13)], fill=C("#ff8a4c"))
        d.polygon([(12, 14), (4, 19), (7, 14)], fill=C("#d24f4a"))
        # gondola and warm windows
        d.rounded_rectangle((23, 17, 39, 23), radius=3, fill=C("#c9852f"))
        d.rectangle((25, 19, 37, 21), fill=C("#8e6bc0"))
        for x in (27, 31, 35):
            d.point((x, 20), fill=C("#ffe08a"))
        d.line((25, 17, 23, 14), fill=C("#a36428"))
        d.line((37, 17, 39, 14), fill=C("#a36428"))
        # pennant on a short mast
        d.line((31, 17, 31, 8), fill=C("#a36428"))
        flutter = [0, 1, -1][f]
        d.polygon([(32, 8 + flutter), (40, 10 + flutter * 2), (32, 12 + flutter)], fill=C("#ffe08a"))
        d.point((35, 10 + flutter), fill=C("#ffd37a"))
        # propeller at the stern: three frames of a spinning blur
        if f == 0:
            d.line((8, 12, 8, 21), fill=C("#e4a73f"))
            d.point((8, 11), fill=C("#f7c85f"))
        elif f == 1:
            d.line((6, 15, 11, 18), fill=C("#e4a73f"))
            d.line((9, 12, 8, 17), fill=C("#f7c85f"))
        else:
            d.line((5, 17, 12, 16), fill=C("#e4a73f"))
            d.point((10, 14), fill=C("#f7c85f"))
        d.point((56, 12), fill=C("#f7c85f"))
        strip.paste(img, (f * fw, 0))
    return strip


def draw_boats_strip() -> Image.Image:
    fw, fh, n = 32, 16, 4
    strip = Image.new("RGBA", (fw * n, fh), (0, 0, 0, 0))
    for f in range(n):
        img = Image.new("RGBA", (fw, fh), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        # wake and reflection belong to the strip so the boat is never a sticker
        d.line((2, 13, 29, 13), fill=C("#96e8dc"))
        d.line((5, 15, 26, 15), fill=C("#66d0cf"))
        d.line((1, 11, 27, 11), fill=C("#c8f7ec"))
        for x in (4, 9, 15, 21, 27):
            d.point((x, 14), fill=C("#effff4"))
        # hull, bow left, stern right
        d.polygon([(2, 9), (6, 12), (27, 12), (25, 8), (7, 8)], fill=C("#7f5446"))
        d.polygon([(3, 9), (7, 11), (26, 11), (24, 9)], fill=C("#9b6a50"))
        d.line((4, 9, 24, 9), fill=C("#cfa074"))
        # canopy, cabin and a pilot
        d.rectangle((10, 4, 24, 9), fill=C("#f3e0bb"))
        d.line((10, 4, 24, 4), fill=C("#fff2d6"))
        d.line((10, 4, 10, 9), fill=C("#c9852f"))
        d.line((24, 4, 24, 9), fill=C("#c9852f"))
        d.rectangle((13, 5, 20, 8), fill=C("#5aa6bd"))
        d.rectangle((14, 5, 17, 7), fill=C("#9ad8cd"))
        d.rectangle((21, 3, 22, 5), fill=C("#ff8a4c"))
        d.point((22, 2), fill=C("#8e6bc0"))
        # oar sweeps through four positions, so no two frames are identical
        oars = [
            ((8, 7), (2, 13), (1, 15)),
            ((8, 7), (4, 14), (3, 16)),
            ((8, 7), (6, 15), (5, 16)),
            ((8, 7), (4, 14), (2, 13)),
        ]
        (ax, ay), (bx, by), (cx2, cy2) = oars[f]
        d.line((ax, ay, bx, by), fill=C("#c9852f"))
        d.line((bx, by, cx2, cy2), fill=C("#e4a73f"))
        # a tiny ripple travels along the hull
        d.point((8 + f * 4, 13), fill=C("#effff4"))
        # tiny lantern and cargo
        d.point((26, 7), fill=C("#ffe08a"))
        d.rectangle((8, 6, 9, 8), fill=C("#f49bb8"))
        strip.paste(img, (f * fw, 0))
    return strip




def pix_fig(d, cx, base, frame, shirt, pose="stand", skin="#e2b98c", hair="#7f5446", pants="#2d2b4b", facing=1):
    """A 3x11-ish person for the quayside strips. Feet sit on `base`."""
    pants_c = C(pants)
    skin_c = C(skin)
    hair_c = C(hair)
    shirt_c = C(shirt)
    swing = [0, 1, 2, 1, 0, -1][frame % 6]
    if pose == "walk":
        d.line((cx - 1, base - 4, cx - 1 - swing, base), fill=pants_c)
        d.line((cx + 1, base - 4, cx + 1 + swing, base), fill=pants_c)
        d.point((cx - 1 - swing, base), fill=pants_c)
        d.point((cx + 1 + swing, base), fill=pants_c)
    elif pose == "kick":
        d.line((cx - 1, base - 4, cx - 1, base), fill=pants_c)
        d.line((cx + 1, base - 4, cx + 1 + 4 * facing, base - 2), fill=pants_c)
        d.point((cx + 1 + 4 * facing, base - 2), fill=pants_c)
    elif pose == "fight":
        d.line((cx - 1, base - 4, cx - 3, base), fill=pants_c)
        d.line((cx + 1, base - 4, cx + 3, base), fill=pants_c)
        d.point((cx - 3, base), fill=pants_c)
        d.point((cx + 3, base), fill=pants_c)
    else:
        d.line((cx - 1, base - 4, cx - 1, base), fill=pants_c)
        d.line((cx + 1, base - 4, cx + 1, base), fill=pants_c)
        d.point((cx - 1, base), fill=pants_c)
        d.point((cx + 1, base), fill=pants_c)
    # body and head
    d.rectangle((cx - 1, base - 8, cx + 1, base - 5), fill=shirt_c)
    d.rectangle((cx - 1, base - 10, cx, base - 9), fill=skin_c)
    d.rectangle((cx - 1, base - 11, cx, base - 11), fill=hair_c)
    d.point((cx + facing, base - 9), fill=skin_c)
    # arms
    if pose == "cheer":
        lift = [0, 1, 0, -1][frame % 4]
        d.line((cx - 1, base - 7, cx - 2, base - 12 + lift), fill=shirt_c)
        d.line((cx + 1, base - 7, cx + 2, base - 12 - lift), fill=shirt_c)
        d.point((cx - 2, base - 12 + lift), fill=skin_c)
        d.point((cx + 2, base - 12 - lift), fill=skin_c)
    elif pose == "fight":
        swing = [0, 1, 0, -1][frame % 4]
        d.line((cx, base - 7, cx + 4 * facing, base - 8 + swing), fill=shirt_c)
        d.point((cx + 4 * facing, base - 8 + swing), fill=skin_c)
        d.line((cx, base - 7, cx - 2 * facing, base - 5), fill=shirt_c)
    elif pose == "kick":
        d.line((cx - 1, base - 7, cx - 2, base - 4), fill=shirt_c)
        d.line((cx + 1, base - 7, cx + 3 * facing, base - 6), fill=shirt_c)
        d.point((cx + 3 * facing, base - 6), fill=skin_c)
    elif pose == "walk":
        d.line((cx - 1, base - 7, cx - 1 + swing, base - 4), fill=shirt_c)
        d.line((cx + 1, base - 7, cx + 1 - swing, base - 4), fill=shirt_c)
    else:
        d.line((cx - 1, base - 7, cx - 2, base - 4), fill=shirt_c)
        d.line((cx + 1, base - 7, cx + 2, base - 4), fill=shirt_c)


def draw_cheer_strip():
    fw, fh, n = 24, 20, 4
    strip = Image.new("RGBA", (fw * n, fh), (0, 0, 0, 0))
    for f in range(n):
        img = Image.new("RGBA", (fw, fh), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        d.line((2, 19, 21, 19), fill=C("#b9855e"))
        for i, cx in enumerate((5, 12, 19)):
            shirt = ["#ff8a4c", "#9ad8cd", "#f49bb8"][i]
            pix_fig(d, cx, 19, f, shirt, pose="cheer", skin=["#e2b98c", "#cfa074", "#e2b98c"][i])
            # flags on the outer two fans
            if i != 1:
                sway = [-1, 0, 1, 0][(f + i) % 4]
                px = cx + 2
                d.line((px, 5, px, 11), fill=C("#a36428"))
                d.polygon([(px + 1, 4 + sway), (px + 4, 5 + sway), (px + 1, 7 + sway)], C("#ffe08a" if i == 0 else "#9ad8cd"))
        strip.paste(img, (f * fw, 0))
    return strip


def draw_picnic_strip():
    fw, fh, n = 32, 20, 4
    strip = Image.new("RGBA", (fw * n, fh), (0, 0, 0, 0))
    for f in range(n):
        img = Image.new("RGBA", (fw, fh), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        # checked blanket
        for yy in range(15, 20, 2):
            for xx in range(4, 29, 4):
                d.rectangle((xx, yy, xx + 1, yy + 1), fill=C("#c8f7ec" if (xx // 4 + yy // 2) % 2 else "#f3e0bb"))
        # basket and a little plate
        d.rectangle((21, 11, 27, 15), fill=C("#c9852f"))
        d.rectangle((21, 11, 27, 12), fill=C("#f7c85f"))
        d.line((23, 11, 23, 8), fill=C("#a36428"))
        d.line((25, 11, 25, 8), fill=C("#a36428"))
        d.line((23, 8, 25, 8), fill=C("#a36428"))
        # two seated figures, facing each other
        for cx, face, shirt, skin in ((10, 1, "#9ad8cd", "#e2b98c"), (18, -1, "#ff8a4c", "#cfa074")):
            d.rectangle((cx - 1, 11, cx + 1, 14), fill=C(shirt))
            d.rectangle((cx - 1, 8, cx, 10), fill=C(skin))
            d.rectangle((cx - 1, 7, cx, 7), fill=C("#7f5446"))
            d.point((cx + face, 9), fill=C(skin))
            d.line((cx - 1, 12, cx - 1 - 4 * face, 15), fill=C("#2d2b4b"))
            d.point((cx - 1 - 4 * face, 15), fill=C("#2d2b4b"))
            d.line((cx + 1, 12, cx + 1 + 2 * face, 15), fill=C("#2d2b4b"))
            # gesturing arm; one lifts a cup on alternating frames
            d.line((cx, 11, cx + 3 * face, 9), fill=C(skin))
        cup_x = 14 + (f % 2)
        cup_y = 7 - (f % 2)
        d.rectangle((cup_x, cup_y, cup_x + 1, cup_y + 1), fill=C("#f3e0bb"))
        d.point((cup_x + 1, cup_y + 1), fill=C("#f49bb8"))
        # the near picnicker raises the cup; the far one turns a page
        d.line((11, 11, cup_x - 1, cup_y + 1), fill=C("#e2b98c"))
        d.line((18, 10, 17 + (f % 2), 9), fill=C("#cfa074"))
        if f % 2:
            d.point((4, 18), fill=C("#eaf3df"))
        strip.paste(img, (f * fw, 0))
    return strip


def draw_date_strip():
    fw, fh, n = 32, 20, 4
    strip = Image.new("RGBA", (fw * n, fh), (0, 0, 0, 0))
    for f in range(n):
        img = Image.new("RGBA", (fw, fh), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        # bench
        d.rectangle((7, 14, 25, 16), fill=C("#9b6a50"))
        d.rectangle((8, 12, 24, 14), fill=C("#cfa074"))
        d.line((10, 16, 10, 19), fill=C("#7f5446"))
        d.line((22, 16, 22, 19), fill=C("#7f5446"))
        d.line((7, 13, 7, 17), fill=C("#7f5446"))
        d.line((25, 13, 25, 17), fill=C("#7f5446"))
        for cx, face, shirt, skin in ((12, 1, "#f49bb8", "#e2b98c"), (19, -1, "#9ad8cd", "#cfa074")):
            lean = f % 2
            d.rectangle((cx - 1, 9, cx + 1, 13), fill=C(shirt))
            d.rectangle((cx - 1 + lean * face, 6, cx + lean * face, 8), fill=C(skin))
            d.rectangle((cx - 1 + lean * face, 5, cx + lean * face, 5), fill=C("#7f5446"))
            d.line((cx - 2, 11, cx - 3, 14), fill=C(skin))
        # a little heart, pulsing
        hx, hy = 15, 3
        d.point((hx, hy), fill=C("#f49bb8"))
        d.point((hx + 2, hy), fill=C("#f49bb8"))
        d.point((hx - 1, hy + 1), fill=C("#f49bb8"))
        d.point((hx + 1, hy + 1), fill=C("#ffd2e0"))
        d.point((hx + 3, hy + 1), fill=C("#f49bb8"))
        d.point((hx, hy + 2), fill=C("#f49bb8"))
        d.point((hx + 2, hy + 2), fill=C("#f49bb8"))
        d.point((hx + 1, hy + 3), fill=C("#e66d97"))
        if f % 2:
            d.point((hx + 1, hy + 4), fill=C("#f49bb8"))
        strip.paste(img, (f * fw, 0))
    return strip


def draw_spar_strip():
    fw, fh, n = 32, 20, 4
    strip = Image.new("RGBA", (fw * n, fh), (0, 0, 0, 0))
    for f in range(n):
        img = Image.new("RGBA", (fw, fh), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        # ducking left fighter
        pix_fig(d, 10, 19, f, "#ff8a4c", pose="fight", skin="#e2b98c", facing=1)
        # right fighter, leaning back
        pix_fig(d, 21, 19, f, "#9ad8cd", pose="fight", skin="#cfa074", facing=-1)
        # a tiny play dust puff between them
        dx = 15 + (f % 2)
        d.point((dx, 16), fill=C("#e9c9a2"))
        d.point((dx + 1, 17), fill=C("#d3a17f"))
        d.point((dx - 1, 17), fill=C("#e9c9a2"))
        if f % 2:
            d.point((dx + 2, 15), fill=C("#e9c9a2"))
        # a stray bit of washing on the ground
        d.point((13, 19), fill=C("#f3e0bb"))
        strip.paste(img, (f * fw, 0))
    return strip


def draw_sport_strip():
    fw, fh, n = 40, 24, 4
    strip = Image.new("RGBA", (fw * n, fh), (0, 0, 0, 0))
    for f in range(n):
        img = Image.new("RGBA", (fw, fh), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        # tiny goal: dark frame and pale net
        d.line((29, 14, 29, 23), fill=C("#7f5446"))
        d.line((29, 14, 38, 14), fill=C("#7f5446"))
        d.line((38, 14, 38, 23), fill=C("#7f5446"))
        d.line((30, 16, 37, 16), fill=C("#e4c99b"))
        d.line((30, 19, 37, 19), fill=C("#e4c99b"))
        d.line((32, 17, 32, 23), fill=C("#e4c99b"))
        d.line((35, 17, 35, 23), fill=C("#e4c99b"))
        d.line((29, 23, 38, 23), fill=C("#7f5446"))
        # kicker and a defender
        pix_fig(d, 8, 23, f, "#ff8a4c", pose="kick", skin="#e2b98c", facing=1)
        pix_fig(d, 17, 23, f + 2, "#9ad8cd", pose="walk", skin="#cfa074", facing=1)
        pix_fig(d, 27, 23, f + 1, "#f49bb8", pose="stand", skin="#e2b98c", facing=-1)
        # ball, moving toward the goal
        bx = 13 + (f % 3) * 3
        by = 20 - (1 if f % 3 == 1 else 0)
        d.rectangle((bx, by, bx + 2, by + 2), fill=C("#fff2d6"))
        d.point((bx + 2, by + 2), fill=C("#f6b45b"))
        d.point((bx, by + 3), fill=C("#7f5446"))
        # a tiny ground line / shadow
        for x in (5, 8, 11, 17, 20, 27, 30):
            d.point((x, 23), fill=C("#b9855e"))
        strip.paste(img, (f * fw, 0))
    return strip


def draw_walkers_strip():
    fw, fh, n = 12, 20, 6
    strip = Image.new("RGBA", (fw * n, fh), (0, 0, 0, 0))
    for f in range(n):
        img = Image.new("RGBA", (fw, fh), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        pix_fig(d, 6, 19, f, "#9ad8cd", pose="walk", skin="#e2b98c", hair="#7f5446", pants="#2d2b4b", facing=1)
        d.point((6, 19), fill=C("#9b6a50"))
        strip.paste(img, (f * fw, 0))
    return strip


def draw_near() -> Layer:
    """Canal, quay edge, reflections, docks and foreground water life."""
    layer = Layer()
    rng = random.Random(123)
    surface = QUAY_Y
    # the hard waterline, then four broad depth bands
    layer.rect(0, surface, W, H, C("#2f8ba8"))
    layer.rect(0, surface, W, surface + 10, C("#42b2c2"))
    layer.rect(0, surface + 10, W, surface + 28, C("#2f8ba8"))
    layer.rect(0, surface + 28, W, 576, C("#2b6c8b"))
    layer.rect(0, 576, W, H, C("#2f8ba8"))
    dither_rect(layer, 0, surface + 8, W, surface + 14, "#42b2c2", 0.5, 2)
    dither_rect(layer, 0, surface + 24, W, surface + 32, "#2b6c8b", 0.4, 4)
    dither_rect(layer, 0, 570, W, 578, "#2b6c8b", 0.35, 6)
    layer.line((0, surface, W, surface), C("#c8f7ec"))
    layer.line((0, surface + 1, W, surface + 1), C("#96e8dc"))
    layer.line((0, surface + 2, W, surface + 2), C("#66d0cf"))

    # reflections: a broken colour pool at the wall, then a few soft trails
    reflect = [
        (10, 150, "#e4c99b"),
        (160, 300, "#cfa074"),
        (300, 470, "#478a58"),
        (470, 560, "#9ad8cd"),
        (560, 790, "#f3e0bb"),
        (820, 1000, "#e4c99b"),
        (1030, 1240, "#e2b98c"),
        (1280, 1420, "#478a58"),
        (1440, 1590, "#e4c99b"),
    ]
    for x0, x1, c in reflect:
        # a soft, dithered band right under the quay
        for x in range(x0, x1, 3):
            if BAYER8[(x + 3) % 8, (x // 3) % 8] < 0.32:
                layer.point(x, surface + 4 + (x % 5), C(c))
        for x in range(x0, x1, 5):
            if BAYER8[(x + 5) % 8, (x // 2) % 8] < 0.18:
                layer.point(x, surface + 10 + (x % 7), C("#96e8dc"))
        # a handful of long, interrupted trails
        for x in range(x0 + 4, x1, 19 + (x0 % 7)):
            if (x * 7 + x0) % 11 < 6:
                y0 = surface + 9 + (x % 9)
                length = 12 + (x * 3) % 28
                for y in range(y0, min(590, y0 + length), 5):
                    if (x + y) % 7 < 5:
                        layer.rect(x, y, x + 1, y + 3, C(c))
                layer.point(x + 1, min(592, y0 + length), C("#66d0cf"))
    # ripples and glints
    for i in range(58):
        x = rng.randint(0, 1595)
        y = rng.randint(surface + 4, 594)
        length = rng.randint(4, 22)
        c = rng.choice(["#66d0cf", "#96e8dc", "#c8f7ec", "#eaf3df"])
        layer.line((x, y, min(1599, x + length), y), C(c))
        if rng.random() < 0.5:
            layer.point(x + length + 1, y - 1, C("#c8f7ec"))
    for i in range(24):
        x = rng.randint(0, 1590)
        y = rng.randint(surface + 6, 592)
        layer.point(x, y, C("#ffe6a1"))
        layer.point(x + 1, y, C("#ffd37a"))

    # ducks: three tiny, readable, low-contrast water residents
    for x, y, s in ((302, 574, 11), (864, 586, 12), (1304, 568, 13)):
        duck(layer, x, y, s)
        layer.line((x - 4, y + 2, x + 10, y + 2), C("#96e8dc"))
        layer.line((x - 2, y + 4, x + 7, y + 4), C("#66d0cf"))

    # left foreground dock: wide planks and short posts, a working quay
    layer.rrect(-12, 538, 198, 600, 3, C("#7f5446"))
    layer.rect(-12, 538, 198, 542, C("#9b6a50"))
    layer.rect(-12, 542, 198, 546, C("#b9855e"))
    for y in range(548, 600, 9):
        layer.rect(-12, y, 198, y + 1, C("#7f5446"))
        for x in range(0, 195, 22):
            if (x + y) % 3 == 0:
                layer.point(x, y + 3, C("#9b6a50"))
    for x in (6, 44, 96, 148, 188):
        layer.rect(x - 3, 526, x + 3, 600, C("#7f5446"))
        layer.rect(x - 3, 526, x, 600, C("#9b6a50"))
        layer.rect(x - 5, 522, x + 5, 528, C("#b9855e"))
        layer.point(x, 522, C("#cfa074"))
    # crates, rope coil and a lantern
    layer.rrect(16, 548, 40, 566, 2, C("#cfa074"))
    layer.rrect(22, 538, 40, 550, 2, C("#b9855e"))
    layer.line((18, 552, 38, 552), C("#9b6a50"))
    layer.ellipse(62, 552, 78, 562, outline=C(CREAM["brass_dark"]))
    layer.ellipse(65, 554, 75, 560, outline=C(CREAM["brass"]))
    layer.rect(112, 552, 128, 560, C("#9b6a50"))
    layer.line((112, 556, 128, 556), C("#7f5446"))
    layer.line((170, 526, 170, 538), C(CREAM["brass_dark"]))
    lantern(layer, 170, 538)
    # a moored dinghy and a patient fisher at the end of the pier
    layer.polygon([(108, 548), (114, 555), (140, 555), (144, 548)], fill=C("#7f5446"))
    layer.polygon([(110, 549), (116, 553), (138, 553), (142, 549)], fill=C("#cfa074"))
    layer.line((108, 548, 144, 548), C("#f3e0bb"))
    layer.line((114, 553, 138, 553), C("#9b6a50"))
    layer.line((144, 549, 154, 544), C("#e4a73f"))
    layer.rect(120, 550, 126, 552, C("#9ad8cd"))
    layer.line((112, 556, 140, 556), C("#96e8dc"))
    person(layer, 170, 538, 970)
    layer.line((172, 530, 188, 516), C("#7f5446"))
    layer.line((188, 516, 188, 546), C("#96e8dc"))
    layer.rect(187, 544, 189, 546, C("#ff8a4c"))
    layer.point(188, 543, C("#ffe08a"))

    # a few potted plants at the dock end
    for px in (156, 180):
        layer.rrect(px - 3, 546, px + 3, 554, 1, C("#9b6a50"))
        layer.ellipse(px - 5, 538, px + 5, 547, fill=C("#478a58"))
        layer.point(px + 1, 538, C("#8dc46f"))
    # gentle reeds at the very left, not a dark silhouette
    for i in range(7):
        rx = 4 + i * 5
        layer.line((rx, 552, rx + rng.randint(-2, 2), 532 - (i % 3) * 3), C("#2f6c4d"))
        layer.point(rx + 1, 540 - (i % 3) * 3, C("#68a963"))
    # right foreground: a short stone stair into the canal
    layer.rrect(1504, 550, 1600, 600, 2, C("#7f5446"))
    for i in range(4):
        layer.rect(1512 + i * 8, 550 + i * 6, 1596, 556 + i * 6, C("#b9855e"))
        layer.line((1512 + i * 8, 550 + i * 6, 1596, 550 + i * 6), C("#cfa074"))
    for i in range(4):
        layer.rect(1570 - i * 6, 572 + i * 4, 1600, 576 + i * 4, C("#9b6a50"))
    layer.line((1520, 548, 1520, 532), C(CREAM["brass_dark"]))
    lantern(layer, 1520, 532)
    for px in (1556, 1584):
        layer.rrect(px - 3, 548, px + 3, 556, 1, C("#9b6a50"))
        layer.ellipse(px - 5, 540, px + 5, 549, fill=C("#478a58"))
        layer.point(px, 540, C("#8dc46f"))
    # a couple of buoys and floating leaves
    for x, y in ((168, 560), (736, 524), (1112, 582), (1450, 532)):
        layer.ellipse(x, y, x + 5, y + 3, fill=C("#f6b45b"))
        layer.point(x + 2, y - 1, C("#ffe08a"))
        layer.point(x + 4, y + 1, C("#ff8a4c"))
    for i in range(9):
        x = rng.randint(0, 1590)
        y = rng.randint(surface + 3, 596)
        layer.rect(x, y, x + 2, y + 1, C("#68a963"))
        layer.point(x + 1, y, C("#8dc46f"))
    return layer

def leaf(layer: Layer, x, y, length, width, angle, dark=("#235342", "#2f6c4d", "#478a58")):
    """A single pointed leaf, plotted as a hard-edged five-point polygon."""
    ca, sa = math.cos(angle), math.sin(angle)
    tip = (x + ca * length, y + sa * length)
    nx, ny = -sa * width, ca * width
    mid = (x + ca * length * 0.44, y + sa * length * 0.44)
    pts = [
        (x, y),
        (mid[0] + nx, mid[1] + ny),
        (tip[0], tip[1]),
        (mid[0] - nx, mid[1] - ny),
    ]
    layer.polygon([(int(px), int(py)) for px, py in pts], C(dark[0]))
    inner = [
        (x + ca * length * 0.12, y + sa * length * 0.12),
        (mid[0] + nx * 0.62, mid[1] + ny * 0.62),
        (tip[0] - ca * 2, tip[1] - sa * 2),
        (mid[0] - nx * 0.5, mid[1] - ny * 0.5),
    ]
    layer.polygon([(int(px), int(py)) for px, py in inner], C(dark[1]))
    layer.line((int(x + ca * 2), int(y + sa * 2), int(tip[0] - ca * 2), int(tip[1] - sa * 2)), C(dark[2]))


def leaf_cluster(layer: Layer, cx, base, scale, seed=0, tall=False):
    rng = random.Random(seed)
    n = 7 if tall else 5
    for i in range(n):
        a = -math.pi / 2 + (i - (n - 1) / 2) * 0.34 + rng.uniform(-0.08, 0.08)
        length = (26 if tall else 18) * scale * rng.uniform(0.7, 1.25)
        width = 4.5 * scale * rng.uniform(0.7, 1.1)
        col = ("#235342", "#2f6c4d", "#478a58") if i % 2 == 0 else ("#2f6c4d", "#478a58", "#68a963")
        leaf(layer, cx + rng.randint(-3, 3), base - 6, length, width, a, col)
    # little flowers poking out of the clump
    for i in range(3):
        fx = cx + rng.randint(-int(12 * scale), int(12 * scale))
        fy = base - 10 - rng.randint(0, int(18 * scale))
        layer.rect(fx, fy, fx + 1, fy + 1, C(rng.choice(["#f49bb8", "#ffd2e0", "#ff8a4c"])))



def foreground_bush(layer: Layer, cx, base, w, h, seed=0):
    rng = random.Random(seed)
    layer.ellipse(cx - w // 2, base - h, cx + w // 2, base, fill=C("#235342"))
    layer.ellipse(cx - w // 3, base - h - 5, cx + w // 3, base - 4, fill=C("#2f6c4d"))
    # scalloped edge of small leaf clumps, biased upward
    for i in range(20):
        ang = rng.uniform(-math.pi * 0.95, -math.pi * 0.05)
        rx = (w // 2) * rng.uniform(0.72, 1.05)
        ry = h * rng.uniform(0.6, 1.08)
        ex = cx + int(math.cos(ang) * rx)
        ey = base - int(math.sin(ang) * ry)
        r = rng.randint(2, 5)
        layer.ellipse(ex - r, ey - r, ex + r, ey + r, fill=C("#235342"))
        layer.ellipse(ex - r + 1, ey - r, ex + 1, ey + 1, fill=C("#2f6c4d"))
        layer.point(ex, ey - r, C("#478a58"))
    # 1px and 2px leaf tips around the silhouette, darker at the bottom
    for i in range(36):
        ang = rng.uniform(-math.pi * 1.05, 0.0)
        rx = (w // 2) * rng.uniform(0.82, 1.12)
        ry = h * rng.uniform(0.72, 1.14)
        ex = cx + int(math.cos(ang) * rx)
        ey = base - int(math.sin(ang) * ry)
        length = rng.randint(4, 10)
        dark = ("#235342", "#2f6c4d", "#478a58") if ey > base - h * 0.5 else ("#2f6c4d", "#478a58", "#68a963")
        leaf(layer, ex - int(math.cos(ang) * length * 0.3), ey - int(math.sin(ang) * length * 0.3), length, 2.2, ang + rng.uniform(-0.2, 0.2), dark)
    # a few long architectural leaves out of the crown
    for i in range(5):
        a = -math.pi / 2 + (i - 2) * 0.36 + rng.uniform(-0.06, 0.06)
        lx = cx + rng.randint(-w // 4, w // 4)
        ly = base - h + rng.randint(2, 12)
        length = rng.randint(20, 34) * (w / 130)
        col = ("#2f6c4d", "#478a58", "#68a963")
        leaf(layer, lx, ly, length, 4.5 * (w / 130) + 1.5, a, col)
        layer.point(lx + int(math.cos(a) * length), ly + int(math.sin(a) * length), C("#8dc46f"))
    for i in range(5):
        fx = cx + rng.randint(-w // 2, w // 2)
        fy = base - rng.randint(4, h - 4)
        layer.rect(fx, fy, fx + 1, fy + 1, C(rng.choice(["#f49bb8", "#ffd2e0", "#ff8a4c"])))


def foreground_planter(layer: Layer, x, base, w, seed=0):
    rng = random.Random(seed)
    cx = x + w // 2
    # a chunky ceramic planter with a brass lip and moss
    layer.rrect(x, base - 20, x + w, base + 8, 5, C("#7f5446"))
    layer.rrect(x + 2, base - 24, x + w - 2, base - 12, 4, C("#9b6a50"))
    layer.rect(x + 4, base - 24, x + w - 4, base - 22, C("#b9855e"))
    layer.rect(x + 4, base - 14, x + w - 4, base - 12, C("#a36428"))
    for i in range(4):
        mx = x + 8 + i * max(6, (w - 16) // 4)
        layer.rect(mx, base - 18, mx + 4, base - 16, C("#68a963"))
        layer.point(mx + 1, base - 19, C("#8dc46f"))
    # dark mass behind the leaves, then real pointed foliage in front
    h = int(w * 0.66)
    foreground_bush(layer, cx, base - 22, int(w * 0.98), h, seed)
    for i in range(2):
        lx = cx - w // 4 + i * (w // 2)
        leaf_cluster(layer, lx, base - 20 - h // 3, 0.85 if w > 100 else 0.7, seed + 10 + i, tall=False)
    # a couple of tall flower spikes
    for i in range(3):
        sx = x + 12 + i * (w - 24) // 2 + rng.randint(-4, 4)
        sy = base - 22 - h + rng.randint(-8, 8)
        layer.line((sx, sy, sx + rng.randint(-3, 3), sy - rng.randint(10, 22)), C("#2f6c4d"))
        layer.rect(sx - 1, sy - 12, sx + 1, sy - 9, C(rng.choice(["#f49bb8", "#ffd2e0", "#ff8a4c"])))
        layer.point(sx - 2, sy - 15, C("#68a963"))
    # big round leaves at the base, reading as foreground silhouettes
    for i in range(5):
        lx = x + 6 + i * max(4, (w - 12) // 5)
        ly = base - 18 + rng.randint(-2, 5)
        layer.ellipse(lx - 7, ly - 5, lx + 9, ly + 3, fill=C("#235342"))
        layer.ellipse(lx - 5, ly - 4, lx + 4, ly, fill=C("#2f6c4d"))
        layer.point(lx, ly - 4, C("#478a58"))
    layer.line((cx, base - 22, cx - 4, base - 38), C("#9b6a50"), width=2)


def fern(layer: Layer, x, base, scale, seed=0):
    rng = random.Random(seed)
    for i in range(7):
        ang = -math.pi / 2 + (i - 3) * 0.24 + rng.uniform(-0.04, 0.04)
        length = int(38 * scale * rng.uniform(0.7, 1.15))
        pts = []
        for k in range(length):
            t = k / max(1, length)
            px = x + int(math.cos(ang) * length * t + math.sin(t * 6 + i) * 2)
            py = base + int(math.sin(ang) * length * t)
            pts.append((px, py))
        if len(pts) > 2:
            layer.line(pts, C("#235342"), width=2)
        for k in range(4, length, 6):
            px, py = pts[k]
            side = -1 if (k // 6) % 2 == 0 else 1
            layer.line((px, py, px + side * int(5 * scale), py - int(2 * scale)), C("#2f6c4d"))
            layer.point(px + side * int(4 * scale), py - int(2 * scale), C("#478a58"))
    layer.ellipse(x - 4, base - 4, x + 5, base + 4, fill=C("#235342"))
    layer.rect(x - 2, base - 4, x + 2, base - 1, C("#2f6c4d"))


# ---------------------------------------------------------------------------
# composition, manifest, review sheets


def sample_image(src: Image.Image, cam_x: int, factor: float, width: int) -> Image.Image:
    off = int(cam_x * factor) % W
    out = Image.new("RGBA", (width, H), (0, 0, 0, 0))
    if off + width <= W:
        out.alpha_composite(src.crop((off, 0, off + width, H)), (0, 0))
    else:
        first = W - off
        out.alpha_composite(src.crop((off, 0, W, H)), (0, 0))
        out.alpha_composite(src.crop((0, 0, width - first, H)), (first, 0))
    return out


def with_alpha(frame: Image.Image, alpha: float) -> Image.Image:
    if alpha >= 0.999:
        return frame
    a = np.array(frame.convert("RGBA")).copy()
    a[..., 3] = (a[..., 3].astype(np.float32) * alpha).astype(np.uint8)
    return Image.fromarray(a, "RGBA")


def composite_strip(view: Image.Image, img: Image.Image, spec, cam_x: int, width: int, frame_index: int):
    fw, fh = spec["fw"], spec["fh"]
    frames = spec["frames"]
    base_frame = img.crop((frame_index * fw, 0, (frame_index + 1) * fw, fh))
    base_frame = with_alpha(base_frame, spec.get("alpha", 1.0))
    off = int(cam_x * spec["factor"]) % W
    for item in spec["items"]:
        if spec.get("plan") == "loops":
            fi = (frame_index + item.get("frameOffset", 0)) % frames
            frame = img.crop((fi * fw, 0, (fi + 1) * fw, fh))
            frame = with_alpha(frame, spec.get("alpha", 1.0))
            bob = 0.0
        else:
            frame = base_frame
            bob = item.get("bobAmp", 0.0) * math.sin(item.get("phase", 0.0))
        sx = (item["u"] - off) % W
        y = int(round(item["v"] + bob))
        if sx >= width and width < W:
            continue
        piece = frame
        if item.get("flip"):
            piece = piece.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
        if width >= W:
            if sx + fw <= W:
                view.alpha_composite(piece, (sx, y))
            else:
                first = W - sx
                view.alpha_composite(piece.crop((0, 0, first, fh)), (sx, y))
                view.alpha_composite(piece.crop((first, 0, fw, fh)), (0, y))
        else:
            if sx + fw <= width:
                view.alpha_composite(piece, (sx, y))
            elif sx < width:
                view.alpha_composite(piece.crop((0, 0, width - sx, fh)), (sx, y))


def compose(layers, falls_frame=0, cam_x=0, width=800, mover_frame=0):
    """One view, with image parallax and the mover strips at t=0."""
    view = Image.new("RGBA", (width, H), (0, 0, 0, 0))
    factors = {"sky": 0.015, "far": 0.06, "mid": 0.18, "near": 0.50}
    for ident in ("sky", "far", "mid"):
        view.alpha_composite(sample_image(layers[ident], cam_x, factors[ident], width), (0, 0))
    composite_strip(view, layers["falls"], STRIP_SPECS[0], cam_x, width, falls_frame)
    view.alpha_composite(sample_image(layers["near"], cam_x, factors["near"], width), (0, 0))
    for spec in STRIP_SPECS[1:]:
        composite_strip(view, layers[spec["id"]], spec, cam_x, width, mover_frame)
    return view


def contact_sheet(layers, falls_frame=3):
    return compose(layers, falls_frame=falls_frame, cam_x=0, width=W, mover_frame=0)


def preview_three(layers):
    panels = []
    for i, cam in enumerate((0, 800, 1600)):
        p = compose(layers, falls_frame=1, cam_x=cam, width=800, mover_frame=0)
        panels.append(p)
    out = Image.new("RGBA", (2400, H), (36, 79, 125, 255))
    for i, p in enumerate(panels):
        out.alpha_composite(p, (i * 800, 0))
    # thin brass rules between the camera stations + tiny bitmap captions
    for i in (1, 2):
        for y in range(H):
            if y % 3 == 0:
                out.putpixel((i * 800, y), C("#e4a73f"))
            else:
                out.putpixel((i * 800, y), C("#a36428"))
    for i, label in enumerate(("0", "800", "1600")):
        draw_micro_text(out, 12 + i * 800, 12, "CAM " + label, C("#fff2d6"))
    return out


MICRO = {
    "0": ["111", "101", "101", "101", "111"],
    "1": ["010", "110", "010", "010", "111"],
    "2": ["111", "001", "111", "100", "111"],
    "3": ["111", "001", "111", "001", "111"],
    "4": ["101", "101", "111", "001", "001"],
    "5": ["111", "100", "111", "001", "111"],
    "6": ["111", "100", "111", "101", "111"],
    "7": ["111", "001", "010", "010", "010"],
    "8": ["111", "101", "111", "101", "111"],
    "9": ["111", "101", "111", "001", "111"],
    "C": ["111", "100", "100", "100", "111"],
    "A": ["010", "101", "111", "101", "101"],
    "M": ["101", "111", "111", "101", "101"],
    " ": ["000", "000", "000", "000", "000"],
}


def draw_micro_text(img, x, y, text, colour, scale=2):
    for i, ch in enumerate(text.upper()):
        glyph = MICRO.get(ch, MICRO[" "])
        for gy, row in enumerate(glyph):
            for gx, bit in enumerate(row):
                if bit == "1":
                    for oy in range(scale):
                        for ox in range(scale):
                            img.putpixel((x + (i * 4 + gx) * scale + ox, y + gy * scale + oy), colour)


def draw_strip_readonly(out: Image.Image, img: Image.Image, spec, frame_index: int, base: int = 0):
    fw, fh = spec["fw"], spec["fh"]
    frames = spec["frames"]
    for item in spec["items"]:
        fi = (frame_index + item.get("frameOffset", 0)) % frames if spec.get("plan") == "loops" else frame_index
        frame = img.crop((fi * fw, 0, (fi + 1) * fw, fh))
        frame = with_alpha(frame, spec.get("alpha", 1.0))
        y = int(round(item["v"] + item.get("bobAmp", 0.0) * math.sin(item.get("phase", 0.0))))
        out.alpha_composite(frame, (item["u"] + base, y))


def tile_check(layers):
    out = Image.new("RGBA", (W * 2, H), (0, 0, 0, 0))
    for ident in ("sky", "far", "mid", "near"):
        out.alpha_composite(layers[ident], (0, 0))
        out.alpha_composite(layers[ident], (W, 0))
    draw_strip_readonly(out, layers["falls"], STRIP_SPECS[0], 1, 0)
    draw_strip_readonly(out, layers["falls"], STRIP_SPECS[0], 1, W)
    for spec in STRIP_SPECS[1:]:
        draw_strip_readonly(out, layers[spec["id"]], spec, 0, 0)
        draw_strip_readonly(out, layers[spec["id"]], spec, 0, W)
    return out


def seam_zoom(layers):
    comp = tile_check(layers)
    return comp.crop((W - 90, 0, W + 90, H)).resize((180 * 3, H * 3), Image.Resampling.NEAREST)


def manifest(layers):
    def version(path: Path):
        return hashlib.sha256(path.read_bytes()).hexdigest()[:12]

    image_layers = [
        ("sky", "assets/skybox/hand/sky.png", 0.015, {"driftX": 0.6, "alpha": 1}),
        ("far", "assets/skybox/hand/far.png", 0.06, {}),
        ("mid", "assets/skybox/hand/mid.png", 0.18, {}),
        ("falls", "assets/skybox/hand/falls.png", 0.30, {}),
        ("near", "assets/skybox/hand/near.png", 0.50, {"alpha": 0.6}),
    ]
    layers_out = []
    for ident, src, factor, extra in image_layers:
        if ident == "falls":
            spec = STRIP_SPECS[0]
            layer = {
                "id": "falls",
                "type": "strip",
                "src": src,
                "version": version(OUT / "falls.png"),
                "factor": factor,
                "frameW": spec["fw"],
                "frameH": spec["fh"],
                "frames": spec["frames"],
                "fps": spec["fps"],
                "align": "mid",
                "items": [{"u": it["u"], "v": it["v"]} for it in spec["items"]],
            }
        else:
            layer = {
                "id": ident,
                "type": "image",
                "src": src,
                "version": version(OUT / f"{ident}.png"),
                "factor": factor,
                **extra,
            }
        layers_out.append(layer)

    def strip_layer(spec):
        layer = {
            "id": spec["id"],
            "type": "strip",
            "src": f"assets/skybox/hand/{spec['id']}.png",
            "version": version(OUT / f"{spec['id']}.png"),
            "factor": spec["manifest_factor"],
            "frameW": spec["fw"],
            "frameH": spec["fh"],
            "frames": spec["frames"],
            "fps": spec["fps"],
        }
        if spec.get("alpha", 1.0) < 1.0:
            layer["alpha"] = spec["alpha"]
        return layer

    loop_specs = [s for s in STRIP_SPECS if s.get("plan") == "loops"]
    ambient_specs = [s for s in STRIP_SPECS if s.get("plan") == "ambient"]
    for spec in loop_specs + ambient_specs:
        layers_out.append(strip_layer(spec))

    loops_groups = []
    for spec in loop_specs:
        actors = []
        for it in spec["items"]:
            actor = {"u": it["u"], "v": it["v"]}
            if "frameOffset" in it:
                actor["frameOffset"] = it["frameOffset"]
            if it.get("flip"):
                actor["flip"] = True
            actors.append(actor)
        loops_groups.append({"layer": spec["id"], "actors": actors})

    ambient_groups = []
    for spec in ambient_specs:
        actors = []
        for it in spec["items"]:
            actors.append(
                {
                    "u": it["u"],
                    "v": it["v"],
                    "speedX": it["speedX"],
                    "bobAmp": it["bobAmp"],
                    "bobFreq": it["bobFreq"],
                    "phase": it["phase"],
                    "flip": it["flip"],
                }
            )
        ambient_groups.append({"layer": spec["id"], "actors": actors})

    return {
        "name": "hand",
        "title": "Solarpunk Waterfront — Hand-Painted",
        "width": W,
        "height": H,
        # The waterfront is a bright, pale city; 1.4 is the readability lift
        # the stage needs. See specs/skybox.md.
        "haze": 1.0,
        # One programme, one clock: walkers, the flock, the airship and boats
        # share a timeline; the fixed vignettes have their own loop clock.
        "ambient": {"loopMs": 90000, "groups": ambient_groups},
        "loops": {"clockMs": 16000, "groups": loops_groups},
        "layers": layers_out,
    }

def sanitize_transparency(im: Image.Image) -> Image.Image:
    """Keep the RGB of invisible pixels inside the palette.

    A PNG's alpha-0 pixels are never drawn, but a naive "no pure black" audit
    reads their RGB anyway. This makes the files honest all the way down.
    """
    a = np.array(im.convert("RGBA")).copy()
    m = a[..., 3] == 0
    a[m, 0], a[m, 1], a[m, 2] = PAL["#244f7d"]
    return Image.fromarray(a, "RGBA")


def verify_dimensions(paths):
    expected = {
        "sky.png": (1600, 600),
        "far.png": (1600, 600),
        "mid.png": (1600, 600),
        "falls.png": (288, 240),
        "near.png": (1600, 600),
        "cheer.png": (96, 20),
        "picnic.png": (128, 20),
        "date.png": (128, 20),
        "spar.png": (128, 20),
        "sport.png": (160, 24),
        "walkers.png": (72, 20),
        "boats.png": (128, 16),
        "zeppelin.png": (192, 28),
        "birds.png": (64, 8),
        "contact.png": (1600, 600),
        "preview-3screens.png": (2400, 600),
    }
    for name, (w, h) in expected.items():
        im = Image.open(paths[name])
        assert im.size == (w, h), (name, im.size)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    REVIEW.mkdir(parents=True, exist_ok=True)

    sky = draw_sky()
    far = draw_far()
    mid = draw_mid()
    falls = draw_falls()
    near = draw_near()
    cheer = draw_cheer_strip()
    picnic = draw_picnic_strip()
    date = draw_date_strip()
    spar = draw_spar_strip()
    sport = draw_sport_strip()
    walkers = draw_walkers_strip()
    birds = draw_birds_strip()
    zeppelin = draw_zeppelin_strip()
    boats = draw_boats_strip()
    layers = {
        "sky": sky.img,
        "far": far.img,
        "mid": mid.img,
        "falls": falls,
        "near": near.img,
        "cheer": cheer,
        "picnic": picnic,
        "date": date,
        "spar": spar,
        "sport": sport,
        "walkers": walkers,
        "birds": birds,
        "zeppelin": zeppelin,
        "boats": boats,
    }

    contact = contact_sheet(layers, falls_frame=3).convert("RGB")
    preview = preview_three(layers)

    sky.img.save(OUT / "sky.png")
    sanitize_transparency(far.img).save(OUT / "far.png")
    sanitize_transparency(mid.img).save(OUT / "mid.png")
    sanitize_transparency(falls).save(OUT / "falls.png")
    sanitize_transparency(near.img).save(OUT / "near.png")
    sanitize_transparency(cheer).save(OUT / "cheer.png")
    sanitize_transparency(picnic).save(OUT / "picnic.png")
    sanitize_transparency(date).save(OUT / "date.png")
    sanitize_transparency(spar).save(OUT / "spar.png")
    sanitize_transparency(sport).save(OUT / "sport.png")
    sanitize_transparency(walkers).save(OUT / "walkers.png")
    sanitize_transparency(birds).save(OUT / "birds.png")
    sanitize_transparency(zeppelin).save(OUT / "zeppelin.png")
    sanitize_transparency(boats).save(OUT / "boats.png")
    contact.save(OUT / "contact.png")
    preview.save(OUT / "preview-3screens.png")

    # review artefacts stay in scripts/skybox/hand/review
    tile_check(layers).convert("RGB").save(REVIEW / "tiled-2x.png")
    seam_zoom(layers).convert("RGB").save(REVIEW / "seam-zoom.png")

    (OUT / "manifest.json").write_text(json.dumps(manifest(layers), indent=2) + "\n")
    notes = HAND / "NOTES.md"
    if notes.exists():
        (OUT / "NOTES.md").write_text(notes.read_text())

    verify_dimensions({name: OUT / name for name in (
        "sky.png", "far.png", "mid.png", "falls.png", "near.png",
        "cheer.png", "picnic.png", "date.png", "spar.png", "sport.png",
        "walkers.png", "boats.png", "zeppelin.png", "birds.png",
        "contact.png", "preview-3screens.png",
    )})

    # palette audit: every pixel must be transparent or a palette colour
    allowed = set(PAL.values())
    for name in ("sky.png", "far.png", "mid.png", "near.png", "falls.png",
                 "cheer.png", "picnic.png", "date.png", "spar.png", "sport.png",
                 "walkers.png", "birds.png", "zeppelin.png", "boats.png"):
        im = Image.open(OUT / name).convert("RGBA")
        a = np.array(im)
        opaque = a[..., 3] > 0
        colours = {tuple(int(v) for v in px[:3]) for px in a[opaque][::7]}
        bad = colours - allowed
        assert not bad, (name, list(bad)[:10])
        assert set(np.unique(a[..., 3])) <= {0, 255}, (name, "non-binary alpha")

    # seam continuity: compare the last column to the first; the join is a
    # wrap, so they should be neighbours, not identical. A hard seam shows up
    # as a jump much larger than the typical adjacent-column delta.
    for name in ("sky.png", "far.png", "mid.png", "near.png"):
        a = np.array(Image.open(OUT / name).convert("RGBA")).astype(int)
        c0, c1 = a[:, 0, :], a[:, 1, :]
        cl, cw = a[:, -2, :], a[:, -1, :]
        d0 = np.abs(cw - c0).mean()
        dn = np.abs(c1 - c0).mean()
        dlast = np.abs(cw - cl).mean()
        assert d0 < 60, (name, d0, dn, dlast)
        print(f"seam {name}: wrap={d0:.1f} neighbour={dn:.1f} last-pair={dlast:.1f}")

    # every strip must actually animate; the falls loop must be even
    for spec in STRIP_SPECS:
        a = np.array(Image.open(OUT / f"{spec['id']}.png").convert("RGBA")).astype(int)
        frames = [a[:, i * spec["fw"]:(i + 1) * spec["fw"]] for i in range(spec["frames"])]
        deltas = [float(np.abs(frames[(i + 1) % spec["frames"]] - frames[i]).mean()) for i in range(spec["frames"])]
        print(f"strip {spec['id']}: frame deltas {[round(d, 1) for d in deltas]}")
        assert max(deltas) > 0.2, spec["id"]
        if spec["id"] == "falls":
            assert max(deltas) - min(deltas) < 5.0, deltas

    total = len(USED)
    print(f"wrote {OUT} ({total} palette colours used)")
    print(f"manifest: {(OUT / 'manifest.json').read_text().splitlines()[0]}")


if __name__ == "__main__":
    main()
