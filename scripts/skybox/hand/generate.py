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
    (280, 356),   # left edge of the strip, top of the fall; mouth is u+24
    (970, 310),
    (1416, 292),
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
    (0.00, "#244f7d"),
    (0.10, "#2f6b98"),
    (0.23, "#3f88ad"),
    (0.36, "#5aa6bd"),
    (0.50, "#78c2c7"),
    (0.64, "#9ad8cd"),
    (0.78, "#c6ebdc"),
    (0.92, "#eaf3df"),
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
    sx, sy = 1168, 344
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

    # thin high cirrus, hand-plotted, a lighter blue than the sky behind it
    for cx, cy, length, thick in [
        (182, 42, 70, 2),
        (205, 49, 42, 1),
        (1012, 31, 92, 2),
        (1048, 37, 48, 1),
        (1320, 62, 64, 2),
        (420, 74, 34, 1),
    ]:
        layer.rrect(cx, cy, cx + length, cy + thick, thick, C("#78c2c7"))
        layer.rrect(cx + 8, cy - 2, cx + length - 9, cy, 1, C("#9ad8cd"))

    planet(layer, 452, 150, 91, -17)
    moon(layer, 1316, 70, 12)
    moon(layer, 872, 52, 5)

    # thin high cirrus, hand-plotted; no two of these are the same shape
    streak(layer, 286, 38, 112, 5, 2)
    streak(layer, 648, 32, 68, 4, 4)
    streak(layer, 1004, 57, 134, 6, 1)
    streak(layer, 1336, 44, 86, 4, 3)

    # chunky warm cumulus, with real blue gaps between them
    cloud(layer, 184, 181, 326, 132, 11)
    cloud(layer, 714, 160, 272, 104, 17)
    cloud(layer, 624, 84, 126, 54, 7)
    cloud(layer, 1088, 154, 354, 142, 23)
    cloud(layer, 1446, 100, 172, 72, 31)
    cloud(layer, 1532, 202, 232, 94, 37)

    airship(layer, 704, 208, 1.0, 3)
    airship(layer, 1086, 147, 1.15, 9)
    airship(layer, 300, 252, 0.55, 2)
    airship(layer, 1542, 238, 0.7, 7)

    for bx, by, n, s, flip in [
        (214, 128, 7, 1, 1),
        (256, 108, 4, 1, -1),
        (530, 74, 3, 1, 1),
        (932, 92, 6, 1, -1),
        (1370, 164, 4, 1, 1),
        (1180, 243, 3, 1, -1),
    ]:
        for i in range(n):
            bx2 = bx + i * 11 + (i % 3) * 4
            by2 = by + (i % 2) * 7 + (i // 3) * 4
            bird(layer, bx2, by2, flip if i % 2 == 0 else -flip)
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
    layer = Layer()
    rng = random.Random(41)
    far = {
        "top": "#8ea9ae",
        "body": "#7b98a3",
        "shade": "#688596",
        "dark": "#587387",
        "deep": "#4b657e",
    }
    for c in far.values():
        USED.add(c)

    # the back row: softer, larger masses that read as a city two ridges away
    for x, w, top, kind in [
        (-70, 130, 402, "dome"),
        (40, 90, 428, "cap"),
        (150, 110, 376, "dome"),
        (300, 80, 414, "cap"),
        (520, 120, 392, "dome"),
        (660, 90, 352, "spire"),
        (780, 130, 406, "cap"),
        (980, 100, 374, "dome"),
        (1120, 120, 398, "cap"),
        (1280, 100, 360, "spire"),
        (1430, 120, 404, "dome"),
        (1560, 100, 380, "cap"),
    ]:
        if kind == "dome":
            layer.rrect(x, top + 20, x + w, 520, 10, C(far["top"]))
            layer.pieslice(x - 10, top - w // 3, x + w + 10, top + w // 3, 180, 360, C(far["top"]))
            layer.arc(x - 10, top - w // 3, x + w + 10, top + w // 3, 180, 360, C(far["top"]), 2)
        elif kind == "spire":
            layer.polygon([(x + w // 2, top - 44), (x + w, 520), (x, 520)], C(far["top"]))
            layer.polygon([(x + w // 2, top - 44), (x + w // 2 + 6, 520), (x, 520)], C(far["shade"]))
        else:
            layer.rrect(x, top, x + w, 520, min(12, w // 3), C(far["top"]))
        layer.line((x + 4, 512, x + w - 4, 512), C(far["shade"]))

    def f_tower(x, w, top, style="cap", seed=0):
        r = random.Random(seed)
        base = 560
        body = C(far["body"])
        if style == "needle":
            layer.polygon([(x, base), (x + w, base), (x + w * 0.62, top + 18), (x + w * 0.42, top)], body)
            layer.line((x + w * 0.44, top + 22, x + w * 0.44, base - 8), C(far["shade"]), width=2)
            layer.line((x + w * 0.6, top + 24, x + w * 0.6, base - 8), C(far["top"]), width=1)
            layer.line((x + w * 0.44, top + 22, x + w * 0.55, top - 10), C(far["dark"]))
        else:
            rad = w // 2 if style in ("cap", "dome") else min(4, w // 3)
            layer.rrect(x, top, x + w, base, rad, body)
            layer.rrect(x + 1, top + 2, x + int(w * 0.3), base, rad, C(far["shade"]))
            layer.line((x + w - 3, top + max(8, rad), x + w - 3, base - 2), C(far["top"]), width=2)
            if style == "dome":
                layer.pieslice(x - 3, top - w // 3, x + w + 3, top + w // 3, 180, 360, C(far["shade"]))
                layer.arc(x - 3, top - w // 3, x + w + 3, top + w // 3, 180, 360, C(far["top"]), 2)
            elif style == "spire":
                layer.polygon(
                    [(x + w * 0.5, top - 30), (x + w * 0.5 + 4, top + 2), (x + w * 0.5 - 4, top + 2)],
                    C(far["dark"]),
                )
        # haze-broken window rows, only in the low band
        if top > 360:
            for wy in range(top + 26, 470, 19):
                for wx in range(x + 8, x + w - 5, 15):
                    if r.random() < 0.30:
                        layer.rect(wx, wy, wx + 2, wy + 4, C(far["deep"] if r.random() < 0.3 else far["dark"]))
        # little rooftop antenna
        if r.random() < 0.35:
            ax = x + w // 2
            layer.line((ax, top - 8, ax, top + 2), C(far["dark"]))
            layer.point(ax, top - 9, C(far["top"]))

    # distant block cluster, kept pale and mostly low
    for x, w, top, style, s in [
        (-30, 74, 420, "cap", 1),
        (52, 46, 452, "cap", 2),
        (104, 58, 382, "dome", 3),
        (168, 26, 346, "needle", 4),
        (202, 54, 430, "cap", 5),
        (258, 42, 393, "dome", 6),
        (306, 36, 358, "needle", 7),
        (350, 66, 411, "cap", 8),
        (424, 34, 376, "spire", 9),
        (468, 62, 402, "dome", 10),
        (540, 48, 435, "cap", 11),
        (596, 70, 384, "cap", 12),
        (674, 30, 356, "spire", 13),
        (712, 58, 423, "dome", 14),
        (778, 84, 390, "cap", 15),
        (872, 42, 365, "needle", 16),
        (922, 64, 414, "dome", 17),
        (996, 38, 348, "spire", 18),
        (1040, 72, 398, "cap", 19),
        (1120, 54, 429, "dome", 20),
        (1182, 34, 372, "needle", 21),
        (1224, 70, 407, "cap", 22),
        (1304, 44, 389, "dome", 23),
        (1356, 52, 434, "cap", 24),
        (1416, 36, 356, "spire", 25),
        (1460, 78, 401, "dome", 26),
        (1546, 62, 372, "needle", 27),
    ]:
        f_tower(x, w, top, style, 100 + s)

    # small roof gardens and antennae keep the haze from becoming a blockout
    for x, y, s in [(134, 378, 3), (382, 414, 2), (620, 388, 3), (1082, 350, 2), (1364, 392, 3), (1522, 376, 2)]:
        for i in range(4):
            layer.ellipse(x + i * 4 - 3, y - 4 - (i % 2), x + i * 4 + 3, y + 1, fill=C(far["body"]))
            layer.point(x + i * 4, y - 4 - (i % 2), C(far["top"]))
        layer.line((x + 6, y + 1, x + 6, y + 8), C(far["shade"]))

    # a distant viaduct, pale, with three arches, a soft horizontal counterpoint.
    x0, x1, yy = 760, 1060, 462
    layer.rect(x0, yy, x1, yy + 7, C(far["body"]))
    layer.line((x0, yy, x1, yy), C(far["top"]), width=1)
    for ax in range(x0 + 18, x1 - 10, 62):
        layer.line((ax, yy + 7, ax, yy + 62), C(far["shade"]), width=6)
        layer.line((ax + 1, yy + 7, ax + 1, yy + 40), C(far["top"]))
    # haze layers: tiny dither bands that pull the base of the city back
    dither_rect(layer, 0, 474, 1600, 492, far["top"], 0.16, 4)
    dither_rect(layer, 0, 492, 1600, 512, far["shade"], 0.10, 2)
    return layer


# ---------------------------------------------------------------------------
# mid city


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


def draw_mid() -> Layer:
    layer = Layer()
    rng = random.Random(9)
    mid_far_row(layer)
    mid_close_row(layer)

    # --- hero view -------------------------------------------------------
    # a low turret crosses the seam, so the wrap is a deliberate overlap
    ceramic_tower(
        layer,
        -30,
        438,
        48,
        dome="cap",
        balconies=(512,),
        windows=((500, 1, 1),),
        seed=100,
    )

    # the tall left tower, fully inside the hero crop now
    ceramic_tower(
        layer,
        8,
        278,
        92,
        dome="onion",
        balconies=(364, 442, 526),
        windows=((338, 2, 2), (416, 2, 2), (566, 2, 1)),
        lit_windows=(510,),
        seed=1,
        flag=True,
    )

    # a glazed stairwell up the sunlit side of the tower
    layer.rrect(68, 318, 82, 438, 6, C("#5aa6bd"))
    layer.rrect(70, 320, 80, 436, 5, C("#78c2c7"))
    for gy in range(328, 436, 13):
        layer.line((69, gy, 81, gy), C(CREAM["light"]))
        layer.point(73, gy - 4, C("#c6ebdc"))
    layer.line((67, 318, 67, 438), C(CREAM["brass"]), width=2)
    layer.line((83, 318, 83, 438), C(CREAM["brass"]), width=2)
    # the tall tower gets a real front door and a sun mosaic
    arched_window(layer, 34, 374, 18, 34, lit=True)
    layer.line((30, 408, 56, 408), C(CREAM["brass"]), width=2)
    for px in (32, 40, 48):
        layer.ellipse(px - 2, 404, px + 2, 409, fill=C("#478a58"))
        layer.point(px, 404, C("#8dc46f"))
    sun_mural(layer, 26, 464, 28, 24)

    # low glasshouse on the left
    greenhouse(layer, 76, 470, 112, 118, seed=2)

    # the long aqueduct: its source is the left tower, and its mouth feeds the
    # hero waterfall. Three open arches make it read as a structure, not a bar.
    mx, my = aqueduct(layer, 100, 374, 304, 356, [116, 176, 240, 298], mouth="right", seed=4)
    assert (mx, my) == (304, 356), (mx, my)
    # a low anchor turret under the channel
    ceramic_tower(
        layer,
        232,
        438,
        48,
        dome="flat",
        balconies=(498,),
        windows=((488, 1, 1),),
        lit_windows=(552,),
        seed=3,
    )
    wind_turbine(layer, 252, 472, 520, 26, 0.35, 31)

    # central conservatory
    conservatory(layer, 416, seed=5)

    # a big glazed bay on the left of the twin capsules
    arched_window(layer, 522, 454, 18, 34, lit=False)
    layer.line((518, 452, 544, 452), C(CREAM["brass"]), width=2)
    for px in (520, 528, 540):
        layer.ellipse(px - 2, 446, px + 2, 451, fill=C("#478a58"))
        layer.point(px, 446, C("#8dc46f"))

    # twin capsule homes between the conservatory and the big tree
    ceramic_tower(
        layer,
        512,
        424,
        58,
        dome="cap",
        balconies=(474, 548),
        windows=((506, 2, 1), (548, 2, 1)),
        lit_windows=(586,),
        seed=6,
    )
    ceramic_tower(
        layer,
        568,
        452,
        48,
        dome="flat",
        balconies=(516,),
        windows=((548, 1, 1),),
        seed=7,
    )
    solar_panel(layer, 574, 438, 36, 10, seed=8, tilt=4)
    curved_bridge(layer, 500, 590, 424, 7, 9)

    # giant tree, the right-hand landmark
    big_tree(layer, 704, 590, 260, 310, seed=10)
    # a low root-side pavilion and a pool
    layer.rrect(752, 548, 816, 592, 8, C(CREAM["stone"]))
    layer.rrect(756, 550, 812, 588, 6, C(CREAM["stone_dark"]))
    layer.rect(758, 554, 810, 560, C(CREAM["water"]))
    for i in range(8):
        layer.point(762 + i * 6, 557, C(CREAM["water_hi"]))
    layer.ellipse(766, 568, 774, 574, fill=C("#478a58"))
    layer.point(770, 568, C("#f49bb8"))

    # --- second screen ---------------------------------------------------
    # needle tower with a halo ring
    needle_tower(layer, 886, 292, seed=12)
    # long aqueduct and the second fall
    layer.rrect(940, 402, 1004, 596, 8, C(CREAM["stone"]))
    layer.rrect(944, 406, 1000, 590, 6, C(CREAM["shade"]))
    for wy in range(432, 560, 26):
        porthole(layer, 972, wy, 4, lit=(wy == 484))
    # -- clean span over the stadium shoulder
    mx2, my2 = aqueduct(layer, 914, 336, 994, 310, [924, 958, 990], mouth="right", seed=14)
    assert (mx2, my2) == (994, 310), (mx2, my2)

    # stadium / botanical arcade
    stadium(layer, 1044, seed=15)
    solar_roof(layer, 1128, 470, 118, seed=16)
    wind_turbine(layer, 1164, 356, 470, 29, 1.1, 32)
    wind_turbine(layer, 1212, 402, 486, 21, 2.5, 33)

    # smaller tree with an open treehouse balcony
    big_tree(layer, 1304, 590, 204, 240, seed=17, treehouse_=False)
    hanging_balcony(layer, 1286, 430, 54, seed=18)

    # aqueduct and the third fall from the observatory
    ceramic_tower(
        layer,
        1502,
        300,
        76,
        dome="onion",
        balconies=(382, 468, 548),
        windows=((436, 2, 2), (520, 2, 1)),
        lit_windows=(574,),
        seed=19,
        flag=True,
    )
    mx3, my3 = aqueduct(layer, 1440, 292, 1502, 314, [1446, 1470, 1500], mouth="left", seed=20)
    assert (mx3, my3) == (1440, 292), (mx3, my3)
    sun_mural(layer, 1518, 410, 26, 22)
    arched_window(layer, 1524, 466, 16, 30, lit=False)

    # low foreground rooftops across the bottom, with gardens and solar kit
    bottom_rooftops(layer, rng)
    mid_extras(layer, rng)

    # vines and laundry between the towers: the lived-in layer
    for vx, vy, ln, seed in [
        (76, 368, 34, 23),
        (150, 390, 26, 24),
        (330, 430, 30, 25),
        (520, 500, 24, 26),
        (604, 454, 20, 27),
        (860, 386, 34, 28),
        (930, 404, 26, 29),
        (1090, 420, 30, 30),
        (1240, 402, 24, 31),
        (1380, 384, 32, 32),
        (1550, 352, 26, 33),
    ]:
        hanging_vine(layer, vx, vy, ln, seed, 6)

    laundry_line(layer, 342, 404, 402, 396, 34)
    laundry_line(layer, 1100, 414, 1156, 404, 35)
    return layer


def greenhouse(layer: Layer, x, y, w, h, seed=0):
    # stone stem and glass onion
    layer.rrect(x + 10, y + h - 32, x + w - 10, y + h, 6, C(CREAM["stone"]))
    for i in range(6):
        layer.rect(x + 16 + i * 14, y + h - 26, x + 19 + i * 14, y + h - 4, C(CREAM["stone_dark"]))
    onion_dome(layer, x + w // 2, y + h - 30, w * 0.46, h * 0.72, glass=True, finial=False, seed=seed)
    # an open door and a brass rail
    layer.rrect(x + w // 2 - 7, y + h - 28, x + w // 2 + 7, y + h, 5, C(CREAM["ink"]))
    layer.rect(x + w // 2 - 5, y + h - 24, x + w // 2 + 5, y + h, C("#ffe08a"))
    layer.line((x + w // 2, y + h - 24, x + w // 2, y + h), C(CREAM["brass_dark"]))
    # planter on top and vines
    layer.rrect(x + 20, y + 4, x + w - 20, y + 12, 3, C(CREAM["stone_dark"]))
    for px in range(x + 24, x + w - 22, 8):
        layer.ellipse(px - 2, y - 2, px + 2, y + 6, fill=C("#478a58"))
        layer.point(px, y - 2, C("#8dc46f"))
    hanging_vine(layer, x + 22, y + h - 30, 28, seed + 1, 6)
    hanging_vine(layer, x + w - 22, y + h - 38, 24, seed + 2, 5)


def conservatory(layer: Layer, cx, seed=0):
    # tiered drum
    layer.rrect(cx - 88, 512, cx + 88, 600, 12, C(CREAM["stone"]))
    layer.rrect(cx - 88, 512, cx - 58, 600, 12, C(CREAM["stone_dark"]))
    layer.line((cx - 84, 520, cx + 84, 520), C(CREAM["brass"]), width=2)
    layer.rrect(cx - 100, 478, cx + 100, 536, 14, C(CREAM["body"]))
    layer.rrect(cx - 96, 480, cx - 58, 532, 12, C(CREAM["shade"]))
    layer.line((cx - 96, 486, cx + 96, 486), C(CREAM["brass"]), width=2)
    # arches around the drum
    for ax in range(cx - 72, cx + 73, 28):
        arched_window(layer, ax - 6, 542, 12, 26, lit=(ax % 56 == 0))
    # the big glass onion
    onion_dome(layer, cx, 486, 82, 176, glass=True, finial=True, seed=seed)
    # a great rose window on the equator of the dome
    layer.ellipse(cx - 27, 390, cx + 27, 424, fill=C(CREAM["brass"]))
    layer.ellipse(cx - 25, 392, cx + 25, 422, fill=C(CREAM["brass_hi"]))
    layer.ellipse(cx - 22, 395, cx + 22, 419, fill=C("#5aa6bd"))
    layer.ellipse(cx - 19, 397, cx + 19, 414, fill=C("#78c2c7"))
    for dx, dy in ((0, -21), (0, 21), (-24, 0), (24, 0)):
        layer.point(cx + dx, 407 + dy, C("#c6ebdc"))
    for k in range(8):
        a = k * math.tau / 8
        layer.line((cx, 407, cx + int(math.cos(a) * 19), 407 + int(math.sin(a) * 17)), C(CREAM["brass_dark"]))
    layer.ellipse(cx - 3, 404, cx + 3, 410, fill=C(CREAM["brass"]))
    layer.point(cx, 406, C(CREAM["brass_hi"]))
    layer.line((cx - 20, 405, cx - 5, 398), C("#c6ebdc"))
    layer.line((cx - 20, 409, cx - 3, 402), C("#9ad8cd"))
    for dx in (-15, -6, 6, 15):
        layer.point(cx + dx, 395, C(CREAM["brass_dark"]))
        layer.point(cx + dx, 419, C(CREAM["brass_dark"]))
    # a ring of hanging gardens under the dome
    for ax in range(cx - 66, cx + 67, 16):
        layer.ellipse(ax - 4, 488, ax + 4, 496, fill=C("#478a58"))
        layer.point(ax + 1, 488, C("#8dc46f"))
        if ax % 32 == 0:
            layer.rect(ax - 1, 496, ax, 498, C("#f49bb8"))
    # banners on the drum, a clock rosette, and lamp niches
    for i, bx in enumerate((cx - 58, cx - 20, cx + 20, cx + 58)):
        layer.line((bx, 492, bx, 506), C(CREAM["brass_dark"]))
        c = "#ff8a4c" if i % 2 == 0 else "#9ad8cd"
        layer.polygon([(bx + 1, 493), (bx + 9, 496), (bx + 1, 503)], C(c))
    for dx in (cx - 48, cx + 48):
        layer.ellipse(dx - 5, 540, dx + 5, 550, fill=C(CREAM["brass"]))
        layer.ellipse(dx - 4, 541, dx + 4, 549, fill=C(CREAM["light"]))
        layer.line((dx, 547, dx + 2, 542), C(CREAM["brass_dark"]))
        layer.point(dx + 2, 542, C("#ff8a4c"))
    for lx in (cx - 78, cx + 78):
        layer.rect(lx - 2, 524, lx + 2, 530, C(CREAM["brass"]))
        layer.rect(lx - 1, 525, lx + 1, 529, C("#ffe08a"))
    # a flying buttress on each side, thin and graphic
    for s in (-1, 1):
        pts = [
            (cx + s * 78, 470),
            (cx + s * 112, 500),
            (cx + s * 118, 548),
            (cx + s * 114, 548),
            (cx + s * 106, 506),
            (cx + s * 76, 478),
        ]
        layer.polygon(pts, C(CREAM["stone"]))
        layer.line(pts[:3], C(CREAM["stone_dark"]))
    # rooftop finial light and a small pennant
    layer.ellipse(cx - 3, 284, cx + 3, 290, fill=C(CREAM["brass_hi"]))
    # an entry stair and a brass door
    layer.rrect(cx - 16, 552, cx + 16, 600, 6, C(CREAM["stone_dark"]))
    layer.rrect(cx - 11, 556, cx + 11, 600, 5, C(CREAM["ink"]))
    layer.rect(cx - 8, 560, cx + 8, 600, C("#ffe08a"))
    layer.line((cx, 560, cx, 600), C(CREAM["brass_dark"]))
    for yy in range(566, 598, 8):
        layer.line((cx - 8, yy, cx + 8, yy), C(CREAM["brass"]))
    # steps
    for i in range(3):
        layer.rect(cx - 22 - i * 4, 594 + i * 2, cx + 22 + i * 4, 596 + i * 2, C(CREAM["stone"]))
    layer.ellipse(cx - 1, 292, cx + 1, 294, fill=C("#fff3c9"))


def needle_tower(layer: Layer, cx, top, seed=0):
    # a garden observatory on a tapered ivory needle
    layer.rrect(cx - 48, 520, cx + 48, 600, 10, C(CREAM["stone"]))
    layer.rrect(cx - 44, 524, cx + 44, 596, 8, C(CREAM["body"]))
    layer.rrect(cx - 42, 526, cx - 20, 592, 8, C(CREAM["shade"]))
    arched_window(layer, cx - 9, 556, 18, 40, lit=True)
    layer.rrect(cx - 14, 550, cx + 14, 556, 3, C(CREAM["brass"]))
    for px in (cx - 34, cx + 24):
        porthole(layer, px, 546, 4, lit=False)
    # tapered shaft
    layer.polygon(
        [(cx - 32, 526), (cx + 32, 526), (cx + 18, top + 36), (cx - 18, top + 36)],
        C(CREAM["body"]),
    )
    layer.polygon(
        [(cx - 32, 526), (cx - 8, 526), (cx - 7, top + 40), (cx - 18, top + 40)],
        C(CREAM["shade"]),
    )
    layer.line((cx + 12, top + 40, cx + 26, 524), C(CREAM["light"]), width=2)
    for y in range(top + 56, 520, 34):
        inset = 18 + (y - top) * 14 // 230
        layer.line((cx - inset, y, cx + inset, y), C(CREAM["brass"]), width=2)
        layer.line((cx - inset, y + 2, cx + inset, y + 2), C(CREAM["brass_dark"]))
        layer.line((cx - inset + 1, y - 1, cx + inset - 1, y - 1), C(CREAM["brass_hi"]))
    for y, cols in ((380, 2), (430, 3), (482, 3)):
        window_cluster(layer, cx, y, cols, 1, 13, 12, 3, 0.25, seed + y)
    # side balcony boxes with trailing plants
    for y in (404, 458, 508):
        inset = 18 + (y - top) * 14 // 230
        layer.line((cx - inset - 4, y + 5, cx + inset + 4, y + 5), C(CREAM["brass"]), width=2)
        for px in (cx - inset + 2, cx - 4, cx + inset - 8):
            layer.ellipse(px - 3, y + 6, px + 3, y + 11, fill=C("#478a58"))
            layer.point(px, y + 6, C("#8dc46f"))
        hanging_vine(layer, cx - inset, y + 11, 18, seed + y, 5)
    # observation deck, glass crown and the great brass halo
    layer.rrect(cx - 42, top + 8, cx + 42, top + 34, 10, C(CREAM["body"]))
    layer.rect(cx - 40, top + 20, cx + 40, top + 24, C(CREAM["brass"]))
    for px in range(cx - 34, cx + 36, 11):
        layer.rect(px, top + 12, px + 6, top + 19, C("#5aa6bd"))
        layer.point(px + 2, top + 12, C("#c6ebdc"))
    onion_dome(layer, cx, top + 18, 30, 42, glass=True, finial=True, seed=seed + 2)
    layer.ellipse(cx - 67, top + 16, cx + 67, top + 44, outline=C(CREAM["brass"]), width=4)
    layer.arc(cx - 67, top + 16, cx + 67, top + 44, 200, 340, C(CREAM["brass_hi"]), 1)
    layer.arc(cx - 67, top + 16, cx + 67, top + 44, 20, 160, C(CREAM["brass_dark"]), 2)
    for px in (cx - 58, cx - 30, cx + 28, cx + 56):
        layer.rrect(px - 5, top + 36, px + 5, top + 49, 4, C(CREAM["body"]))
        layer.ellipse(px - 3, top + 32, px + 3, top + 39, fill=C("#478a58"))
        layer.point(px + 1, top + 32, C("#8dc46f"))
        if px % 2 == 0:
            layer.point(px, top + 31, C("#f49bb8"))
        hanging_vine(layer, px, top + 49, 22, seed + px, 5)
    # pennants and roof lights
    for px in (cx - 30, cx + 30):
        layer.line((px, top + 6, px, top + 22), C(CREAM["brass_dark"]))
        layer.polygon([(px + 1, top + 7), (px + 9, top + 10), (px + 1, top + 14)], C("#ff8a4c" if px < cx else "#ffe08a"))
    # a stair spiralling down the shaft
    for i in range(6):
        sy = 476 + i * 8
        layer.rect(cx - 22 + (i % 2) * 3, sy, cx + 4 + (i % 2) * 3, sy + 2, C(CREAM["stone_dark"]))
        layer.point(cx + 5 + (i % 2) * 3, sy, C(CREAM["brass"]))



def rope_bridge(layer: Layer, x0, y0, x1, y1, sag=8, seed=0):
    rng = random.Random(seed)
    pts = []
    for x in range(x0, x1 + 1):
        t = (x - x0) / max(1, x1 - x0)
        yy = int(y0 * (1 - t) + y1 * t - sag * math.sin(math.pi * t))
        pts.append((x, yy))
    for x, yy in pts:
        layer.point(x, yy, C(CREAM["brass_dark"]))
        layer.point(x, yy + 6, C(CREAM["brass_dark"]))
        if x % 6 == 0:
            layer.line((x, yy, x, yy + 6), C(CREAM["brass"]))
        if x % 4 == 0:
            layer.rect(x, yy + 2, x + 3, yy + 3, C(CREAM["stone_dark"]))
    for i in range(3):
        vx = x0 + (x1 - x0) * (i + 1) // 4
        vy = pts[vx - x0][1]
        hanging_vine(layer, vx, vy + 4, 12 + i * 4, seed + i, 4)


def parasol(layer: Layer, cx, base_y, r=15, seed=0):
    layer.line((cx, base_y, cx, base_y - 14), C(CREAM["brass_dark"]))
    layer.pieslice(cx - r, base_y - 22, cx + r, base_y - 4, 180, 360, C("#ff8a4c"))
    for i in range(-2, 3):
        x = cx + i * r // 3
        layer.line((cx, base_y - 20, x, base_y - 8), C("#ffe08a" if i % 2 else "#fff2d6"))
    layer.arc(cx - r, base_y - 22, cx + r, base_y - 4, 180, 360, C(CREAM["light"]), 2)
    layer.line((cx - r + 2, base_y - 5, cx + r - 2, base_y - 5), C(CREAM["brass"]))
    # a tiny table and a chair
    layer.rect(cx - 5, base_y - 5, cx + 5, base_y - 3, C(CREAM["stone"]))
    layer.line((cx - 4, base_y - 3, cx - 4, base_y + 2), C(CREAM["stone_dark"]))
    layer.line((cx + 4, base_y - 3, cx + 4, base_y + 2), C(CREAM["stone_dark"]))
    layer.point(cx + 8, base_y - 1, C("#f49bb8"))


def side_pod(layer: Layer, x, y, seed=0):
    layer.rrect(x, y, x + 26, y + 20, 8, C(CREAM["body"]))
    layer.rrect(x + 1, y + 1, x + 10, y + 19, 8, C(CREAM["shade"]))
    layer.ellipse(x + 11, y + 5, x + 22, y + 16, fill=C(CREAM["brass"]))
    layer.ellipse(x + 12, y + 6, x + 21, y + 15, fill=C(CREAM["ink"]))
    layer.rect(x + 14, y + 8, x + 18, y + 13, C("#ffe08a"))
    layer.rrect(x + 5, y + 20, x + 21, y + 25, 2, C(CREAM["stone_dark"]))
    for px in (x + 7, x + 12, x + 17):
        layer.ellipse(px - 2, y + 17, px + 2, y + 21, fill=C("#478a58"))
    hanging_vine(layer, x + 4, y + 25, 16, seed, 4)


def telescope_dome(layer: Layer, cx, base_y=600, seed=0):
    layer.rrect(cx - 32, 500, cx + 32, base_y, 10, C(CREAM["stone"]))
    layer.rrect(cx - 28, 504, cx + 28, 596, 8, C(CREAM["body"]))
    layer.rrect(cx - 26, 506, cx - 8, 592, 6, C(CREAM["shade"]))
    for y in (526, 560, 586):
        window_cluster(layer, cx, y, 2, 1, 14, 12, 3, 0.5, seed + y)
    layer.ellipse(cx - 34, 464, cx + 34, 516, fill=C(CREAM["body"]))
    layer.pieslice(cx - 30, 456, cx + 30, 512, 180, 360, C("#78c2c7"))
    layer.arc(cx - 30, 456, cx + 30, 512, 180, 360, C(CREAM["light"]), 2)
    for f in (-0.62, -0.28, 0.1, 0.46, 0.78):
        layer.line((cx, 466, cx + int(28 * f), 500), C(CREAM["light"]))
    layer.line((int(cx - 29), 500, int(cx + 29), 500), C(CREAM["brass"]), width=3)
    # telescope barrel, aiming up and left at the sky
    layer.line((cx + 4, 470, cx - 34, 436), C(CREAM["brass_dark"]), width=7)
    layer.line((cx + 2, 468, cx - 33, 435), C(CREAM["brass"]), width=5)
    layer.line((cx + 1, 467, cx - 32, 434), C(CREAM["brass_hi"]), width=2)
    layer.ellipse(cx - 41, 428, cx - 29, 441, fill=C(CREAM["brass_dark"]))
    layer.ellipse(cx - 39, 430, cx - 31, 439, fill=C("#9ad8cd"))
    layer.ellipse(cx + 1, 466, cx + 8, 474, fill=C(CREAM["brass"]))
    # little tripod and railing
    layer.line((cx - 10, 472, cx - 16, 494), C(CREAM["brass_dark"]))
    layer.line((cx + 10, 472, cx + 16, 494), C(CREAM["brass_dark"]))
    for px in range(cx - 28, cx + 29, 9):
        layer.point(px, 496, C(CREAM["brass_hi"]))
    curve_planter(layer, cx - 30, 470, 8, seed)


def curve_planter(layer: Layer, x, y, w, seed=0):
    layer.rrect(x, y, x + w * 4, y + 4, 2, C(CREAM["stone_dark"]))
    for i in range(3):
        px = x + 3 + i * 8
        layer.ellipse(px - 2, y - 4, px + 2, y + 1, fill=C("#478a58"))
        layer.point(px, y - 4, C("#8dc46f"))


def conservatory_terrace(layer: Layer, cx):
    # the grand entrance and terrace, drawn after the rooftops so the hero
    # landmark keeps its feet
    layer.rrect(cx - 78, 548, cx + 78, 600, 6, C(CREAM["stone"]))
    layer.rrect(cx - 74, 548, cx + 74, 560, 6, C(CREAM["body"]))
    layer.line((cx - 74, 549, cx + 74, 549), C(CREAM["brass"]), width=2)
    # three arches, lit from inside
    arched_window(layer, cx - 40, 522, 18, 32, lit=True)
    arched_window(layer, cx + 22, 522, 18, 32, lit=True)
    layer.rrect(cx - 15, 516, cx + 15, 560, 8, C(CREAM["brass"]))
    layer.rrect(cx - 12, 519, cx + 12, 560, 7, C(CREAM["ink"]))
    layer.rrect(cx - 9, 523, cx + 9, 560, 6, C("#ffe08a"))
    layer.line((cx, 523, cx, 560), C(CREAM["brass_dark"]))
    layer.line((cx - 9, 536, cx + 9, 536), C(CREAM["brass"]))
    # sunburst over the door
    layer.ellipse(cx - 8, 498, cx + 8, 514, fill=C(CREAM["brass"]))
    layer.ellipse(cx - 6, 500, cx + 6, 512, fill=C(CREAM["brass_hi"]))
    for dx, dy in ((-11, 0), (11, 0), (0, -11), (0, 11), (-8, -8), (8, -8), (-8, 8), (8, 8)):
        layer.point(cx + dx, 506 + dy, C(CREAM["brass_hi"]))
    # steps and balustrade
    for i in range(3):
        layer.rect(cx - 28 - i * 4, 588 + i * 4, cx + 28 + i * 4, 590 + i * 4, C(CREAM["stone"]))
    for px in range(cx - 70, cx + 71, 12):
        layer.line((px, 556, px, 568), C(CREAM["brass"]))
        layer.point(px, 555, C("#ffe08a"))
    layer.line((cx - 70, 558, cx + 70, 558), C(CREAM["brass"]), width=2)
    # potted trees flanking the stair
    for px in (cx - 62, cx + 62):
        layer.rrect(px - 7, 558, px + 7, 574, 3, C(CREAM["stone_dark"]))
        layer.ellipse(px - 12, 534, px + 12, 560, fill=C("#478a58"))
        layer.ellipse(px - 6, 528, px + 8, 552, fill=C("#68a963"))
        layer.point(px + 2, 530, C("#8dc46f"))
        layer.point(px - 1, 536, C("#f49bb8"))
    # a fountain at the foot of the steps
    layer.ellipse(cx - 16, 570, cx + 16, 588, fill=C(CREAM["stone_dark"]))
    layer.ellipse(cx - 13, 572, cx + 13, 583, fill=C("#42b2c2"))
    layer.ellipse(cx - 8, 566, cx + 8, 576, fill=C(CREAM["stone"]))
    layer.ellipse(cx - 6, 568, cx + 6, 574, fill=C("#66d0cf"))
    layer.rect(cx - 1, 560, cx + 1, 570, C(CREAM["brass"]))
    layer.point(cx, 558, C("#c8f7ec"))
    for i in range(3):
        layer.point(cx - 10 - i * 3, 584 - i, C("#96e8dc"))
        layer.point(cx + 10 + i * 3, 584 - i, C("#96e8dc"))


def mid_extras(layer: Layer, rng: random.Random):
    conservatory_terrace(layer, 416)
    # side capsules that make the towers feel assembled, not extruded
    side_pod(layer, 94, 486, 61)
    side_pod(layer, 1572, 500, 62)
    # moss and vines on the long aqueduct's piers
    for vx, vy, ln, sd in [(120, 412, 20, 72), (180, 402, 28, 73), (244, 398, 24, 74), (292, 390, 18, 75)]:
        hanging_vine(layer, vx, vy, ln, sd, 5, dark=True)

    # the rope bridge from the twin towers to the treehouse
    rope_bridge(layer, 606, 432, 668, 446, 7, 63)
    # pergola on the mid tower roof
    for px in (556, 600):
        layer.line((px, 420, px, 444), C(CREAM["brass_dark"]))
    layer.line((552, 420, 604, 420), C(CREAM["brass"]), width=2)
    for px in range(556, 604, 7):
        layer.ellipse(px - 3, 414, px + 3, 421, fill=C("#478a58"))
        layer.point(px + 1, 414, C("#8dc46f"))
    hanging_vine(layer, 560, 422, 20, 64, 5)
    # market awnings and parasols on the low roofs
    for cx, base, r, seed in [
        (274, 544, 15, 65),
        (566, 542, 12, 66),
        (884, 548, 14, 67),
        (1136, 548, 16, 68),
        (1188, 542, 12, 69),
        (1462, 544, 14, 70),
    ]:
        parasol(layer, cx, base, r, seed)
    # a telescope dome in the gap before the right tower
    telescope_dome(layer, 1382, 600, 71)
    # bunting between the conservatory and the twin towers
    for i in range(5):
        x = 500 + i * 14
        y = 476 + (i % 2) * 3
        layer.polygon([(x, y), (x + 8, y + 1), (x + 2, y + 6)], C("#ff8a4c" if i % 2 else "#ffe08a"))
    layer.line((500, 474, 584, 476), C(CREAM["brass_dark"]))
    # birds perched on architecture, not just in the sky
    bird(layer, 690, 454, 1)
    bird(layer, 158, 374, -1)
    bird(layer, 920, 330, 1)

    # a little cat on the low roofline (3 px of personality)
    layer.rect(1218, 548, 1221, 551, C("#ff8a4c"))
    layer.rect(1218, 546, 1219, 548, C("#ff8a4c"))
    layer.point(1220, 546, C("#ff8a4c"))
    layer.line((1221, 550, 1224, 547), C("#ff8a4c"))
    # potted plants and crates in alleys
    for x, y in [(250, 566), (284, 566), (632, 570), (900, 570), (1160, 566), (1436, 568)]:
        layer.rrect(x, y, x + 9, y + 10, 2, C(CREAM["stone_dark"]))
        layer.rrect(x + 1, y - 5, x + 8, y + 2, 3, C("#478a58"))
        layer.point(x + 4, y - 6, C("#8dc46f"))
        layer.point(x + 6, y - 5, C("#f49bb8"))


def stadium(layer: Layer, cx, seed=0):
    # a long glass arcade with a botanical dome
    layer.rrect(cx - 72, 492, cx + 72, 596, 10, C(CREAM["stone"]))
    layer.rrect(cx - 66, 462, cx + 66, 520, 10, C(CREAM["body"]))
    for ax in range(cx - 54, cx + 55, 22):
        arched_window(layer, ax - 6, 478, 12, 22, lit=(ax % 44 == 0))
    onion_dome(layer, cx, 462, 62, 92, glass=True, finial=False, seed=seed)
    for px in range(cx - 50, cx + 51, 12):
        layer.ellipse(px - 3, 456, px + 3, 462, fill=C("#478a58"))
        layer.point(px, 456, C("#8dc46f"))
    # pennant poles
    for px in (cx - 60, cx + 58):
        layer.line((px, 404, px, 454), C(CREAM["brass_dark"]))
        layer.polygon([(px + 1, 406), (px + 10, 409), (px + 1, 413)], C("#ffe08a" if px < cx else "#ff8a4c"))


def solar_roof(layer: Layer, x, y, w, seed=0):
    layer.rrect(x, y, x + w, 596, 8, C(CREAM["stone"]))
    layer.rrect(x + 4, y + 4, x + w - 4, 590, 6, C(CREAM["shade"]))
    for wx in range(x + 10, x + w - 8, 18):
        porthole(layer, wx, y + 26, 3, lit=False)
    for i in range(3):
        solar_panel(layer, x + 8 + i * 36, y - 12, 30, 12, seed + i, 3)
    layer.rrect(x + 8, y - 4, x + w - 8, y + 2, 2, C(CREAM["brass"]))
    # a little stair down to the street
    for i in range(5):
        layer.rect(x + w - 20 - i * 3, 550 + i * 5, x + w - 6, 552 + i * 5, C(CREAM["stone"]))


def hanging_balcony(layer: Layer, x, y, w, seed=0):
    layer.rrect(x, y, x + w, y + 8, 3, C(CREAM["stone"]))
    layer.line((x + 2, y + 8, x + w - 2, y + 8), C(CREAM["stone_dark"]), width=2)
    for px in range(x + 4, x + w - 3, 7):
        layer.line((px, y - 6, px, y), C(CREAM["brass"]))
    for px in range(x + 5, x + w - 3, 8):
        layer.ellipse(px - 3, y - 8, px + 3, y + 1, fill=C("#478a58"))
        layer.point(px + 1, y - 8, C("#8dc46f"))
    hanging_vine(layer, x + 8, y + 8, 24, seed, 6)
    hanging_vine(layer, x + w - 12, y + 8, 18, seed + 1, 4)
    if w > 46:
        lantern(layer, x + w - 4, y - 12)


def laundry_line(layer: Layer, x0, y0, x1, y1, seed=0):
    rng = random.Random(seed)
    layer.line((x0, y0, x1, y1), C(CREAM["brass_dark"]))
    n = 5
    for i in range(n):
        t = (i + 0.6) / (n + 0.4)
        x = int(x0 + (x1 - x0) * t)
        y = int(y0 + (y1 - y0) * t)
        w = rng.randint(4, 7)
        h = rng.randint(5, 8)
        c = rng.choice(["#ff8a4c", "#ffe08a", "#9ad8cd", "#f49bb8", "#c6ebdc"])
        layer.polygon([(x, y), (x + w, y), (x + w - 1, y + h), (x + 1, y + h)], C(c))
        layer.point(x, y, C(CREAM["brass_dark"]))


def bottom_rooftops(layer: Layer, rng: random.Random):
    # A dense but low foreground rank of roofs.  Everything above y=540 stays
    # pale; the darkest shapes are kept in the bottom 40 px.
    x = -20
    while x < 1620:
        w = rng.randint(56, 130)
        top = rng.randint(528, 566)
        if rng.random() < 0.5:
            layer.rrect(x, top, x + w, 600, rng.randint(3, 9), C(CREAM["stone"]))
            layer.rrect(x, top, x + w, 600, 3, C(CREAM["stone"]))
            layer.rect(x, top, x + w, top + 4, C(CREAM["stone_dark"]))
            layer.line((x + 4, top + 1, x + w - 4, top + 1), C("#e2b98c"))
            # windows
            for wx in range(x + 12, x + w - 10, 24):
                if rng.random() < 0.6:
                    arched_window(layer, wx, top + 18, 8, 16, lit=rng.random() < 0.4)
        else:
            # a garden roof or a water tank
            layer.rrect(x, top, x + w, 600, 6, C(CREAM["body"]))
            layer.rect(x, top, x + w, top + 3, C(CREAM["brass"]))
            for px in range(x + 8, x + w - 6, 11):
                shrub(layer, px, top + 1, 14, 12, seed=rng.randint(0, 99), flowers=rng.random() < 0.4)
            if rng.random() < 0.5:
                tx = x + w - 24
                layer.rect(tx, top - 26, tx + 14, top + 4, C(CREAM["stone_dark"]))
                layer.rect(tx + 2, top - 24, tx + 12, top + 2, C(CREAM["stone"]))
                layer.rect(tx, top - 28, tx + 14, top - 24, C("#9b6a50"))
                layer.line((tx + 3, top - 2, tx + 3, top + 2), C(CREAM["stone_dark"]))
        # solar panels and turbine platforms here and there
        if rng.random() < 0.32 and w > 76:
            solar_panel(layer, x + w // 2 - 16, top - 12, 32, 10, rng.randint(0, 99), 3)
        if rng.random() < 0.2 and w > 90:
            wind_turbine(layer, x + w - 22, top - 30, top + 2, 15, rng.random() * 6, rng.randint(0, 99))
        x += w + rng.randint(-8, 8)
    # cables, awnings, market cloth: 1 px details for the bottom band
    for i in range(14):
        cx = rng.randint(20, 1580)
        cy = rng.randint(556, 590)
        layer.line((cx, cy, cx + rng.randint(10, 30), cy - rng.randint(0, 6)), C(CREAM["brass_dark"]))
        for k in range(3):
            layer.rect(cx + 4 + k * 7, cy + 1, cx + 9 + k * 7, cy + 4, C(rng.choice(["#ff8a4c", "#ffe08a", "#9ad8cd"])))
    for i in range(18):
        x0 = rng.randint(0, 1560)
        y0 = rng.randint(548, 570)
        layer.ellipse(x0, y0, x0 + rng.randint(4, 9), y0 + rng.randint(4, 10), fill=C(rng.choice(["#2f6c4d", "#478a58"])))
        layer.point(x0 + 2, y0, C("#68a963"))


# ---------------------------------------------------------------------------
# falls strip


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


def draw_near() -> Layer:
    layer = Layer()
    rng = random.Random(123)
    # A real foreground parapet rather than a flat stripe: three shallow
    # terraces, a garden pool, and dense foliage only at the screen edges.
    layer.rrect(-10, 584, 1610, 600, 0, C("#7f5446"))
    layer.rect(-10, 584, 1610, 588, C("#9b6a50"))
    layer.rect(-10, 580, 1610, 584, C("#b9855e"))
    layer.rect(-10, 576, 1610, 580, C("#cfa074"))
    layer.rect(-10, 596, 1610, 600, C("#2f6c4d"))

    # stone joints and moss on the parapet
    for x in range(-4, 1604, 18):
        layer.rect(x, 584, x, 595, C("#7f5446"))
        if (x * 7) % 11 < 4:
            layer.point(x + 3, 580, C("#68a963"))
            layer.point(x + 4, 579, C("#8dc46f"))
    for x in range(0, 1600, 9):
        layer.rect(x, 591, x + 3, 592, C("#7f5446"))
        layer.point(x + 1, 590, C("#9b6a50"))
    # shallow trefoil niches along the parapet face, with moss and tiny flowers
    for x in range(18, 1580, 46):
        layer.rrect(x, 586, x + 24, 600, 8, C("#7f5446"))
        layer.rrect(x + 3, 588, x + 21, 600, 6, C("#9b6a50"))
        layer.point(x + 12, 588, C("#b9855e"))
        if x % 92 == 18:
            layer.rect(x + 8, 590, x + 15, 591, C("#68a963"))
            layer.point(x + 10, 589, C("#8dc46f"))
        else:
            layer.point(x + 11, 592, C("#e4a73f"))

    # a shallow reflecting pool, low enough to keep the conservatory's
    # entrance and the falls' landing visible
    layer.ellipse(292, 570, 486, 610, fill=C("#7f5446"))
    layer.ellipse(296, 572, 482, 606, fill=C("#9b6a50"))
    layer.ellipse(300, 574, 478, 602, fill=C("#2f8ba8"))
    layer.ellipse(304, 577, 474, 598, fill=C("#42b2c2"))
    layer.ellipse(310, 580, 468, 592, fill=C("#66d0cf"))
    layer.line((316, 580, 462, 580), C("#96e8dc"))
    for i in range(9):
        lx = 318 + i * 17
        layer.ellipse(lx - 4, 584, lx + 5, 590, fill=C("#478a58"))
        layer.point(lx + 1, 584, C("#68a963"))
        if i % 3 == 0:
            layer.rect(lx + 2, 582, lx + 4, 583, C("#ffd2e0"))
    # koi and a little fountain jet
    layer.rect(356, 585, 359, 586, C("#ff8a4c"))
    layer.point(360, 584, C("#ff8a4c"))
    layer.rect(424, 582, 427, 583, C("#ffd37a"))
    layer.line((386, 588, 386, 566), C("#c8f7ec"))
    layer.line((385, 578, 381, 574), C("#c8f7ec"))
    layer.line((387, 578, 391, 574), C("#c8f7ec"))
    for px in (300, 430, 460):
        layer.line((px, 578, px - 1, 552), C("#2f6c4d"))
        for k in range(3):
            layer.line((px - 1, 558 + k * 7, px - 5, 555 + k * 7), C("#478a58"))
        layer.point(px - 2, 550, C("#f49bb8"))

    # brass rail and hanging lanterns over the right-hand garden
    for px in range(500, 708, 16):
        layer.line((px, 548, px, 586), C("#a36428"))
        layer.line((px + 1, 548, px + 1, 586), C("#e4a73f"))
        layer.point(px, 547, C("#ffe08a"))
    layer.line((500, 550, 708, 550), C("#e4a73f"), width=2)
    layer.line((500, 548, 708, 548), C("#ffe08a"))
    for lx in (536, 620, 690):
        lantern(layer, lx, 558)

    # a tiny water garden, a favourite foreground detail
    layer.rrect(720, 570, 796, 598, 4, C("#7f5446"))
    layer.rect(724, 574, 792, 594, C("#2f8ba8"))
    layer.rect(726, 576, 790, 580, C("#42b2c2"))
    for i in range(5):
        layer.ellipse(730 + i * 12, 582, 738 + i * 12, 588, fill=C("#478a58"))
        layer.point(733 + i * 12, 582, C("#68a963"))
        if i == 2:
            layer.rect(744, 580, 746, 581, C("#ffd2e0"))

    # hero left: a big planter and a cloudy bush
    foreground_planter(layer, 8, 592, 142, seed=1)
    foreground_planter(layer, 744, 598, 118, seed=2)
    # second screen framing
    foreground_planter(layer, 980, 600, 96, seed=3)
    foreground_planter(layer, 1466, 594, 158, seed=4)
    foreground_planter(layer, 1584, 598, 96, seed=5)

    # edges of the frame: tall, dark, leafy; the middle stays low
    for x, base, scale, seed in [
        (54, 578, 1.5, 11),
        (108, 586, 1.0, 12),
        (804, 582, 1.2, 13),
        (884, 590, 0.8, 14),
        (1512, 586, 1.35, 15),
        (1578, 592, 1.0, 16),
    ]:
        fern(layer, x, base, scale, seed)
    lantern(layer, 130, 536)
    lantern(layer, 770, 544)
    lantern(layer, 1538, 548)

    # hanging vine curtains from the parapet, short so they never reach the
    # play band.
    for i in range(22):
        x = rng.randint(0, 1599)
        y = 548 + rng.randint(0, 14)
        hanging_vine(layer, x, y, rng.randint(8, 26), 400 + i, 4)
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


def compose(layers, falls_frame=0, cam_x=0, width=800, panel_offset=0):
    """Draw one 800px view with the contract's parallax factors."""
    factors = {"sky": 0.015, "far": 0.06, "mid": 0.18, "falls": 0.18, "near": 0.50}
    view = Image.new("RGBA", (width, H), (0, 0, 0, 0))
    for ident in ("sky", "far", "mid"):
        src = layers[ident]
        off = int(cam_x * factors[ident]) % W
        # sample a wrapped strip
        if off + width <= W:
            part = src.crop((off, 0, off + width, H))
        else:
            part = Image.new("RGBA", (width, H))
            part.alpha_composite(src.crop((off, 0, W, H)), (0, 0))
            part.alpha_composite(src.crop((0, 0, width - (W - off), H)), (W - off, 0))
        view.alpha_composite(part, (0, 0))
        if ident == "mid":
            # waterfall sprites sit on the mid layer's clock
            off_f = int(cam_x * factors["falls"]) % W
            strip = layers["falls"]
            for u, v in FALL_ITEMS:
                sx = (u - off_f) % W
                if sx < width:
                    frame = strip.crop((falls_frame * FALL_W, 0, (falls_frame + 1) * FALL_W, FALL_H))
                    if sx + FALL_W > width:
                        view.alpha_composite(frame.crop((0, 0, width - sx, FALL_H)), (sx, v))
                        view.alpha_composite(frame.crop((width - sx, 0, FALL_W, FALL_H)), (0, v))
                    else:
                        view.alpha_composite(frame, (sx, v))
    off = int(cam_x * factors["near"]) % W
    if off + width <= W:
        part = layers["near"].crop((off, 0, off + width, H))
    else:
        part = Image.new("RGBA", (width, H))
        part.alpha_composite(layers["near"].crop((off, 0, W, H)), (0, 0))
        part.alpha_composite(layers["near"].crop((0, 0, width - (W - off), H)), (W - off, 0))
    view.alpha_composite(part, (0, 0))
    return view


def contact_sheet(layers, falls_frame=3):
    return compose(layers, falls_frame=falls_frame, cam_x=0, width=W)


def preview_three(layers):
    panels = []
    for i, cam in enumerate((0, 800, 1600)):
        p = compose(layers, falls_frame=1, cam_x=cam, width=800)
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


def tile_check(layers):
    out = Image.new("RGBA", (W * 2, H), (0, 0, 0, 0))
    out.alpha_composite(layers["sky"], (0, 0))
    out.alpha_composite(layers["sky"], (W, 0))
    for ident in ("far", "mid", "near"):
        out.alpha_composite(layers[ident], (0, 0))
        out.alpha_composite(layers[ident], (W, 0))
    frame = layers["falls"].crop((FALL_W, 0, 2 * FALL_W, FALL_H))
    for u, v in FALL_ITEMS:
        out.alpha_composite(frame, (u, v))
        out.alpha_composite(frame, (u + W, v))
    return out


def seam_zoom(layers):
    # one 3x composite seam crop, nearest-neighbour
    comp = Image.new("RGBA", (3200, H), (0, 0, 0, 0))
    comp.alpha_composite(layers["sky"], (0, 0))
    comp.alpha_composite(layers["sky"], (W, 0))
    for ident in ("far", "mid", "near"):
        comp.alpha_composite(layers[ident], (0, 0))
        comp.alpha_composite(layers[ident], (W, 0))
    frame = layers["falls"].crop((FALL_W, 0, 2 * FALL_W, FALL_H))
    for u, v in FALL_ITEMS:
        comp.alpha_composite(frame, (u, v))
        comp.alpha_composite(frame, (u + W, v))
    return comp.crop((W - 90, 0, W + 90, H)).resize((180 * 3, H * 3), Image.Resampling.NEAREST)


def manifest(layers):
    def version(path: Path):
        return hashlib.sha256(path.read_bytes()).hexdigest()[:12]

    sky_v = version(OUT / "sky.png")
    far_v = version(OUT / "far.png")
    mid_v = version(OUT / "mid.png")
    falls_v = version(OUT / "falls.png")
    near_v = version(OUT / "near.png")
    return {
        "name": "hand",
        "title": "Solarpunk Noon — Hand-Painted",
        "width": W,
        "height": H,
        # The hand city is darker behind the spawn than the voxel one, so it
        # needs a slightly stronger atmospheric lift to match the flat sky's
        # value separation. See specs/skybox.md and scripts/readability-probe.ts.
        "haze": 1.3,
        "layers": [
            {
                "id": "sky",
                "type": "image",
                "src": "assets/skybox/hand/sky.png",
                "version": sky_v,
                "factor": 0.015,
                "driftX": 0.6,
                "alpha": 1,
            },
            {
                "id": "far",
                "type": "image",
                "src": "assets/skybox/hand/far.png",
                "version": far_v,
                "factor": 0.06,
            },
            {
                "id": "mid",
                "type": "image",
                "src": "assets/skybox/hand/mid.png",
                "version": mid_v,
                "factor": 0.18,
            },
            {
                "id": "falls",
                "type": "strip",
                "src": "assets/skybox/hand/falls.png",
                "version": falls_v,
                "factor": 0.30,
                "frameW": FALL_W,
                "frameH": FALL_H,
                "frames": 6,
                "fps": 9,
                "align": "mid",
                "items": [{"u": u, "v": v} for u, v in FALL_ITEMS],
            },
            {
                "id": "near",
                "type": "image",
                "src": "assets/skybox/hand/near.png",
                "version": near_v,
                "factor": 0.50,
                # The near foliage is the closest thing to the floor and would
                # otherwise sit in the fighter's value band at full strength.
                # 20% keeps the framing and lets the pale mid city carry the
                # silhouette. This is a readability constant, not a mood.
                "alpha": 0.2,
            },
        ],
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
        "contact.png": (1600, 600),
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
    layers = {"sky": sky.img, "far": far.img, "mid": mid.img, "falls": falls, "near": near.img}

    contact = contact_sheet(layers, falls_frame=3).convert("RGB")
    preview = preview_three(layers)

    sky.img.save(OUT / "sky.png")
    sanitize_transparency(far.img).save(OUT / "far.png")
    sanitize_transparency(mid.img).save(OUT / "mid.png")
    sanitize_transparency(falls).save(OUT / "falls.png")
    sanitize_transparency(near.img).save(OUT / "near.png")
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
        "sky.png", "far.png", "mid.png", "falls.png", "near.png", "contact.png"
    )})

    # palette audit: every pixel must be transparent or a palette colour
    allowed = set(PAL.values())
    for name in ("sky.png", "far.png", "mid.png", "near.png"):
        im = Image.open(OUT / name).convert("RGBA")
        a = np.array(im)
        opaque = a[..., 3] > 0
        colours = {tuple(int(v) for v in px[:3]) for px in a[opaque][::7]}
        bad = colours - allowed
        assert not bad, (name, list(bad)[:10])
    strip = Image.open(OUT / "falls.png").convert("RGBA")
    a = np.array(strip)
    opaque = a[..., 3] > 0
    bad = {tuple(int(v) for v in px[:3]) for px in a[opaque][::5]} - allowed
    assert not bad, ("falls", list(bad)[:10])

    # seam continuity: compare the last column to the first; the join is a
    # wrap, so they should be neighbours, not identical.  A hard seam shows up
    # as a jump much larger than the typical adjacent-column delta.
    for name in ("sky.png", "far.png", "mid.png", "near.png"):
        a = np.array(Image.open(OUT / name).convert("RGBA")).astype(int)
        c0 = a[:, 0, :]
        c1 = a[:, 1, :]
        cl = a[:, -2, :]
        cw = a[:, -1, :]
        d0 = np.abs(cw - c0).mean()
        dn = np.abs(c1 - c0).mean()
        dlast = np.abs(cw - cl).mean()
        assert d0 < 60, (name, d0, dn, dlast)
        print(f"seam {name}: wrap={d0:.1f} neighbour={dn:.1f} last-pair={dlast:.1f}")

    total = len(USED)
    print(f"wrote {OUT} ({total} palette colours used)")
    print(f"manifest: {(OUT / 'manifest.json').read_text().splitlines()[0]}")


if __name__ == "__main__":
    main()
