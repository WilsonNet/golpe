#!/usr/bin/env python3
"""A dusk siege at the Castle Keep: a layered pixel-art skybox.

The Castle theme used to be three procedural Graphics silhouettes. This is the
same treatment the Waterfront gets: a 1600x600 panorama split into sky, far,
mid and near layers, plus fixed vignettes (banners, the princess, the
trebuchet, the wall fight, archers, torches) and ambient crows. The runtime's
manifest contract is what keeps the layers separate and the parallax honest.

    .venv/bin/python scripts/skybox/castle/generate.py

Every pixel is plotted here; no upscaling, no anti-aliasing and no colour
outside art/skybox/castle/palette.json. Shapes that cross the 1600 px seam are
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
OUT = ROOT / "public" / "assets" / "skybox" / "castle"
HAND = Path(__file__).resolve().parent
PALETTE = json.loads((ROOT / "art" / "skybox" / "castle" / "palette.json").read_text())
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
    assert h in PAL, f"colour outside art/skybox/castle/palette.json: {h}"
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


# ---------------------------------------------------------------------------
# shared stone language


def crenel(layer: Layer, x0, x1, top, merlon=22, gap=20, h=14, fill=None):
    fill = fill or C("#5b4d73")
    x = x0
    while x < x1:
        layer.rect(x, top - h, x + merlon, top, fill)
        x += merlon + gap


def wall_block(layer: Layer, x0, y0, x1, y1, body="#5b4d73", light="#7d6d94", dark="#4c4064", deep="#302945"):
    layer.rect(x0, y0, x1, y1, C(body))
    layer.rect(x0, y0, x1, y0 + 3, C(light))
    layer.rect(x0, y1 - 4, x1, y1, C(deep))
    for row, y in enumerate(range(y0 + 12, y1 - 4, 18)):
        layer.line((x0, y, x1, y), C(dark))
        off = 0 if row % 2 == 0 else 10
        for x in range(x0 + off, x1, 24):
            layer.line((x, y, x, min(y + 17, y1 - 5)), C(dark))
            if (x + row) % 3 == 0:
                layer.point(x + 4, y + 7, C(light))
    # moss at the foot of the wall
    for x in range(x0 + 8, x1, 37):
        if (x // 37) % 3 == 0:
            layer.ellipse(x - 3, y1 - 8, x + 4, y1 - 2, fill=C("#478a58"))
            layer.point(x + 1, y1 - 8, C("#2f6c4d"))


def tower(
    layer: Layer,
    x: int,
    w: int,
    top: int,
    base: int = 600,
    roof="cone",
    body="#5b4d73",
    light="#7d6d94",
    dark="#4c4064",
    deep="#302945",
    merlon_fill=None,
    banner_colour="#a83a55",
    banner_inner=None,
):
    wall_block(layer, x, top, x + w, base, body, light, dark, deep)
    # cylindrical/edge shading
    layer.rect(x, top + 4, x + max(4, w // 4), base, C(dark))
    layer.rect(x + w - 4, top + 4, x + w, base, C(light))
    for y in range(top + 22, base - 6, 34):
        for sx in range(x + 6, x + w - 4, 18):
            layer.rect(sx, y, sx + 2, y + 8, C("#221c35"))
            if (sx + y) % 5 == 0:
                layer.point(sx + 1, y + 1, C("#f6b45b"))
    if roof == "cone":
        apex = top - 42
        layer.polygon([(x - 8, top), (x + w // 2, apex), (x + w + 8, top)], C(dark))
        layer.polygon([(x - 4, top - 2), (x + w // 2, apex + 2), (x + w // 2, top - 2)], C(body))
        for i in range(5):
            y = apex + 6 + i * 8
            half = int((w / 2 + 8) * (y - apex) / 42)
            layer.line((x + w // 2 - half, y, x + w // 2 + half, y), C(deep))
        layer.line((x + w // 2, apex, x + w // 2, top), C(light))
        layer.polygon([(x + w // 2, apex - 4), (x + w // 2 + 4, apex + 2), (x + w // 2, apex + 8)], C("#e4a73f"))
    else:
        crenel(layer, x - 2, x + w + 2, top, 18, 14, 12, C(merlon_fill or body))
        layer.rect(x - 2, top - 12, x + w + 2, top - 8, C(deep))
    # a hanging banner on the face
    if w >= 44:
        banner(layer, x + w // 2 - 8, top + 26, 16, 42, banner_colour, banner_inner)


def arched_window(layer: Layer, x, y, w, h, lit=False, frame="#3e3454"):
    # stone surround and a shallow recess
    layer.rrect(x - 2, y - 2, x + w + 2, y + h + 2, max(2, w // 2), C(frame))
    layer.rrect(x - 1, y - 1, x + w + 1, y + h + 1, max(2, w // 2), C("#7d6d94"))
    if lit:
        layer.rrect(x, y, x + w, y + h, max(1, w // 2), C("#f6b45b"))
        layer.rrect(x + 1, y + 2, x + w - 1, y + h - 1, max(1, w // 2 - 1), C("#ffd37a"))
        layer.rect(x + 2, y + 3, x + w - 2, y + h // 2, C("#fff3c9"))
        layer.line((x + w // 2, y + 1, x + w // 2, y + h - 1), C("#c9852f"))
        layer.line((x + 1, y + h // 2, x + w - 1, y + h // 2), C("#c9852f"))
    else:
        layer.rrect(x, y, x + w, y + h, max(1, w // 2), C("#2a2340"))
        layer.rect(x + 2, y + 2, x + w - 3, y + h // 2, C("#3e3454"))
        layer.point(x + w - 3, y + 3, C("#b9b6cc"))


def banner(layer: Layer, x, y, w, h, colour, inner=None):
    inner = inner or "#d24f4a"
    layer.line((x - 3, y - 4, x + w + 3, y - 4), C("#7f5a45"))
    layer.polygon(
        [(x, y), (x + w, y), (x + w, y + h - 6), (x + w // 2, y + h), (x, y + h - 6)],
        C(colour),
    )
    layer.polygon(
        [(x + 2, y + 2), (x + w // 2, y + 2), (x + w // 2, y + h - 5), (x + 2, y + h - 7)],
        C(inner),
    )
    layer.line((x + w // 2, y + 4, x + w // 2, y + h - 8), C("#f7c85f"))
    layer.ellipse(x + w // 2 - 3, y + 10, x + w // 2 + 3, y + 16, fill=C("#f7c85f"))
    layer.rect(x + w // 2 - 1, y + 12, x + w // 2 + 1, y + 14, C("#7d2b44"))


def tent(layer: Layer, x, y, w, h, colour):
    layer.polygon([(x, y), (x + w // 2, y - h), (x + w, y)], C(colour))
    layer.polygon([(x + 2, y), (x + w // 2, y - h + 3), (x + w // 2, y)], C("#7d2b44"))
    layer.line((x + w // 2, y - h, x + w // 2, y - h - 10), C("#3f2b26"))
    layer.polygon([(x + w // 2, y - h - 10), (x + w // 2 + 8, y - h - 7), (x + w // 2, y - h - 4)], C("#e4a73f"))
    layer.polygon([(x + w // 2 - 5, y), (x + w // 2 + 5, y), (x + w // 2 + 4, y - 10), (x + w // 2 - 4, y - 10)], C("#2a2340"))


def campfire(layer: Layer, x, y):
    layer.line((x - 6, y, x + 6, y - 3), C("#553a32"), width=2)
    layer.line((x - 6, y - 3, x + 6, y), C("#6b4a3e"), width=2)
    layer.ellipse(x - 4, y - 10, x + 4, y - 1, fill=C("#f26a4f"))
    layer.ellipse(x - 2, y - 12, x + 2, y - 3, fill=C("#ff8a4c"))
    layer.rect(x - 1, y - 12, x + 1, y - 6, C("#ffe08a"))
    layer.point(x, y - 14, C("#fff3c9"))


def soldier(layer: Layer, x, y, cloak="#8e6bc0", spear=False, flip=False):
    s = -1 if flip else 1
    layer.rect(x, y - 4, x + 1, y - 2, C("#2a2340"))
    layer.rect(x - 1, y - 7, x + 2, y - 4, C(cloak))
    layer.rect(x, y - 9, x + 1, y - 7, C("#f2c9a0"))
    layer.point(x + 1 if s > 0 else x - 1, y - 8, C("#2a2340"))
    if spear:
        sx = x + 4 * s
        layer.line((sx, y - 18, sx, y - 3), C("#7f5a45"))
        layer.polygon([(sx - 1, y - 18), (sx + 1, y - 18), (sx, y - 22)], C("#b9b6cc"))


def dither_circle(layer: Layer, cx, cy, r, colour, density, phase=0):
    yy, xx = np.mgrid[0 : r * 2 + 1, 0 : r * 2 + 1]
    m = ((xx - r) ** 2 + (yy - r) ** 2 <= r * r) & bayer_mask(r * 2 + 1, r * 2 + 1, density, cx + phase, cy + phase)
    arr = np.zeros((r * 2 + 1, r * 2 + 1, 4), dtype=np.uint8)
    arr[m] = C(colour)
    paste_wrapped(layer.img, Image.fromarray(arr, "RGBA"), cx - r, cy - r)


def ladder(layer: Layer, x, y0, y1, lean=8):
    layer.line((x, y1, x + lean, y0), C("#6b4a3e"))
    layer.line((x + 7, y1, x + 7 + lean, y0), C("#553a32"))
    for i in range(6):
        yy = y1 - (y1 - y0) * (i + 1) // 7
        xx = x + (y0 - yy) * lean // max(1, y1 - y0)
        layer.line((xx, yy, xx + 7, yy), C("#7f5a45"))


# ---------------------------------------------------------------------------
# sky


SKY_STOPS = [
    (0.00, "#191733"),
    (0.16, "#232045"),
    (0.34, "#302a55"),
    (0.48, "#453764"),
    (0.59, "#5f4370"),
    (0.70, "#845674"),
    (0.80, "#b06f7c"),
    (0.90, "#d98c78"),
    (1.00, "#f2b98a"),
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
    out = np.where((frac > threshold)[..., None], cols[i1], cols[i0])
    for c in SKY_STOPS:
        USED.add(c[1])
    layer.img = Image.fromarray(np.dstack([out, np.full((H, W), 255, np.uint8)]), "RGBA")
    layer.d = ImageDraw.Draw(layer.img)

    # a cold moon with a dithered halo, low in the second screen
    moon(layer, 1048, 96, 48)
    # a small ringed planet, the one piece of sky whimsy this world shares
    # with the Waterfront
    planet(layer, 250, 86, 18, 18)

    rng = random.Random(19)
    for _ in range(150):
        x = rng.randrange(0, W)
        y = rng.randrange(0, 330)
        if (x - 1048) ** 2 + (y - 96) ** 2 < 76**2:
            continue
        bright = rng.random()
        col = "#fff3c9" if bright > 0.86 else "#ffe6a1" if bright > 0.55 else "#b9b6cc"
        layer.point(x, y, C(col))
        if bright > 0.94:
            layer.point(x + 1, y, C("#ffe6a1"))

    # thin high cloud, lit rose from below
    for cx, cy, w, seed in ((180, 208, 240, 3), (610, 166, 300, 7), (1010, 226, 210, 11), (1440, 184, 260, 13)):
        high_cloud(layer, cx, cy, w, seed)

    # a distant flock already in the sky; the crows strip repeats it in motion
    for x, y in ((420, 140), (436, 132), (451, 146), (1330, 96), (1344, 90)):
        layer.line((x - 3, y, x, y + 2), C("#b9b6cc"))
        layer.line((x, y + 2, x + 3, y), C("#b9b6cc"))
    return layer


def moon(layer: Layer, cx, cy, r):
    yy, xx = np.mgrid[0:H, 0:W]
    dist = np.hypot(xx - cx, yy - cy)
    halo = np.clip((r + 62 - dist) / 62.0, 0.0, 1.0) ** 2 * 0.34
    m = (dist > r) & (bayer_mask(H, W, 1.0, 0, 0) < halo)
    arr = np.array(layer.img)
    arr[m, :3] = PAL["#d3b79a"]
    arr[m, 3] = 255
    inner = np.clip((r + 30 - dist) / 30.0, 0.0, 1.0) ** 2 * 0.38
    m = (dist > r) & (bayer_mask(H, W, 1.0, 0, 0) < inner)
    arr[m, :3] = PAL["#ffe6a1"]
    arr[m, 3] = 255
    layer.img = Image.fromarray(arr, "RGBA")
    layer.d = ImageDraw.Draw(layer.img)
    USED.update(("#d3b79a", "#ffe6a1"))
    layer.ellipse(cx - r, cy - r, cx + r, cy + r, fill=C("#fff3c9"))
    layer.ellipse(cx - r + 4, cy - r + 4, cx + r - 4, cy + r - 4, fill=C("#ffe6a1"))
    layer.ellipse(cx - r + 10, cy - r + 8, cx + r - 12, cy + r - 10, fill=C("#fff3c9"))
    # cold craters, kept to the shadowed limb
    for ox, oy, rx, ry in ((-18, -12, 9, 6), (12, 8, 12, 8), (-6, 22, 6, 5), (24, -16, 5, 4)):
        layer.ellipse(cx + ox - rx, cy + oy - ry, cx + ox + rx, cy + oy + ry, fill=C("#f6d6a8"))
        layer.ellipse(cx + ox - rx + 2, cy + oy - ry + 2, cx + ox + rx - 3, cy + oy + ry - 2, fill=C("#d3b79a"))
    layer.arc(cx - r, cy - r, cx + r, cy + r, 30, 150, C("#fff3c9"), 2)


def planet(layer: Layer, cx, cy, r, tilt_deg):
    pad = int(r * 2.1)
    pw = ph = pad * 2
    yy, xx = np.mgrid[0:ph, 0:pw]
    dx, dy = xx - pad, yy - pad
    th = math.radians(tilt_deg)
    ct, st = math.cos(th), math.sin(th)
    xp = dx * ct + dy * st
    yp = -dx * st + dy * ct
    a_out, b_out = r * 1.9, r * 0.35
    a_in, b_in = r * 1.25, r * 0.18
    e_out = np.sqrt((xp / a_out) ** 2 + (yp / b_out) ** 2)
    e_in = np.sqrt((xp / a_in) ** 2 + (yp / b_in) ** 2)
    ring = (e_out <= 1.0) & (e_in >= 1.0)
    arr = np.zeros((ph, pw, 4), dtype=np.uint8)
    arr[ring] = C("#e4a73f")
    arr[ring & (e_out > 0.82)] = C("#f7c85f")
    inside = dx * dx + dy * dy <= r * r
    arr[inside] = C("#b06f7c")
    arr[inside & (dx < 0)] = C("#845674")
    arr[inside & (dy < -r * 0.25)] = C("#d98c78")
    layer.paste(Image.fromarray(arr, "RGBA"), cx - pad, cy - pad)


def high_cloud(layer: Layer, cx, cy, w, seed):
    rng = random.Random(seed)
    for i in range(4):
        x0 = cx - w // 2 + rng.randint(-12, 12)
        x1 = x0 + w + rng.randint(-30, 30)
        y = cy + i * 4 + rng.randint(-2, 2)
        layer.ellipse(x0, y, x1, y + 4, fill=C("#5f4370"))
        layer.ellipse(x0 + 8, y - 1, x1 - 10, y + 2, fill=C("#845674"))
        if i == 0:
            layer.rect(x0 + 20, y - 1, x1 - 24, y, C("#b06f7c"))


# ---------------------------------------------------------------------------
# far haze


def draw_far() -> Layer:
    layer = Layer()
    rng = random.Random(41)
    far = {
        "body": "#4a3f63",
        "light": "#65557f",
        "dark": "#3e3454",
        "deep": "#302945",
    }
    for c in far.values():
        USED.add(c)
    # a long ridge, then mountains behind the keep
    layer.rect(0, 470, W, H, C(far["body"]))
    for x in range(-220, W + 240, 210):
        w = 300 + rng.randrange(180)
        h = 96 + rng.randrange(86)
        layer.ellipse(x - w // 2, 480 - h, x + w // 2, 520, fill=C(far["dark"]))
        layer.ellipse(x - w // 3, 480 - h + 12, x + w // 3, 510, fill=C(far["body"]))
        layer.line((x, 480 - h + 8, x - w // 5, 480 - h // 3), C(far["light"]))
    # a distant castle town on the left and a watchtower on the right
    town(layer, 250, 190, far)
    town(layer, 1040, 160, far)
    keep(layer, 1496, 214, far, lit=0.24)
    # pale mist where the ridge meets the nearer wall
    dither_rect(layer, 0, 448, W, 482, far["light"], 0.18, 2)
    return layer


def town(layer: Layer, cx, spread, far):
    rng = random.Random(cx)
    for i in range(7):
        x = cx + rng.randint(-spread, spread)
        w = rng.randint(18, 42)
        top = rng.randint(360, 440)
        layer.rect(x, top, x + w, 500, C(far["body"]))
        layer.rect(x, top, x + max(3, w // 4), 500, C(far["dark"]))
        layer.polygon([(x - 4, top), (x + w // 2, top - rng.randint(16, 38)), (x + w + 4, top)], C(far["dark"]))
        for wy in range(top + 10, 480, 26):
            for wx in range(x + 5, x + w - 4, 14):
                if rng.random() < 0.16:
                    layer.rect(wx, wy, wx + 1, wy + 3, C("#f6b45b"))
    # a low bridge across the valley
    for i in range(6):
        x = cx - 150 + i * 52
        layer.arc(x, 430, x + 50, 486, 180, 360, C(far["dark"]), 3)
    layer.rect(cx - 160, 426, cx + 170, 432, C(far["body"]))
    layer.line((cx - 160, 426, cx + 170, 426), C(far["light"]))


def keep(layer: Layer, cx, top, far, lit=0.2):
    rng = random.Random(cx + 7)
    layer.rect(cx - 54, top, cx + 54, 500, C(far["body"]))
    layer.rect(cx - 54, top, cx - 34, 500, C(far["dark"]))
    layer.rect(cx + 34, top, cx + 54, 500, C(far["light"]))
    for bx in range(cx - 60, cx + 60, 16):
        layer.rect(bx, top - 12, bx + 9, top, C(far["dark"]))
    layer.rect(cx - 10, top - 46, cx + 10, top, C(far["body"]))
    layer.polygon([(cx - 16, top - 46), (cx, top - 86), (cx + 16, top - 46)], C(far["dark"]))
    layer.line((cx, top - 85, cx, top - 100), C(far["dark"]))
    for wy in range(top + 18, 480, 28):
        for wx in range(cx - 44, cx + 44, 20):
            if rng.random() < lit:
                layer.rect(wx, wy, wx + 2, wy + 4, C("#f6b45b"))


# ---------------------------------------------------------------------------
# the keep and the siege


def draw_mid() -> Layer:
    layer = Layer()
    stone = "#66567d"
    light = "#8a7aa1"
    dark = "#54476b"
    deep = "#302945"

    # ---- curtain walls ----------------------------------------------------
    wall_block(layer, -40, 404, W + 40, 600, stone, light, dark, deep)
    crenel(layer, -40, W + 40, 404, 22, 20, 14, C(stone))
    layer.rect(-40, 390, W + 40, 396, C(deep))

    # towers along the wall
    tower(layer, 88, 76, 312, 600, "cone", stone, light, dark, deep)
    tower(layer, 424, 64, 352, 600, "flat", stone, light, dark, deep, banner_colour="#4c4a72", banner_inner="#6e54a8")
    tower(layer, 948, 68, 342, 600, "flat", stone, light, dark, deep)
    tower(layer, 1112, 78, 306, 600, "cone", stone, light, dark, deep, banner_colour="#3b395e", banner_inner="#8e6bc0")
    tower(layer, 1420, 66, 366, 600, "flat", stone, light, dark, deep, banner_colour="#4c4a72", banner_inner="#8e6bc0")

    # ---- the main keep ----------------------------------------------------
    # broad body behind the gatehouse
    wall_block(layer, 548, 140, 832, 600, stone, light, dark, deep)
    crenel(layer, 548, 832, 140, 20, 18, 12, C(stone))
    # buttresses
    for x in (520, 840):
        wall_block(layer, x, 210, x + 20, 600, dark, stone, deep, deep)
    # the central tower and its spire
    tower(layer, 632, 96, 72, 220, "cone", stone, light, dark, deep)
    # the princess's window: the one warm room in the whole keep, with a
    # dithered halo so the eye finds it before any other window
    dither_rect(layer, 660, 206, 724, 282, "#f6b45b", 0.10, 3)
    arched_window(layer, 672, 216, 40, 56, lit=True)
    layer.rrect(675, 218, 709, 270, 18, C("#c9852f"))
    layer.rect(676, 219, 708, 232, C("#f6b45b"))
    layer.rect(676, 232, 708, 235, C("#ffd37a"))
    layer.rect(675, 266, 709, 270, C("#7d2b44"))
    layer.rect(664, 272, 720, 280, C(light))
    layer.rect(664, 280, 720, 288, C(deep))
    for x in range(666, 720, 8):
        layer.line((x, 280, x, 288), C(deep))
    for x in range(666, 722, 9):
        layer.line((x, 272, x, 280), C("#f7c85f"))
    # two long banners on the keep flanks, the one saturated colour that
    # balances the big pale stone mass
    banner(layer, 552, 168, 22, 116, "#4c4a72", "#8e6bc0")
    banner(layer, 806, 168, 22, 116, "#a83a55", "#d24f4a")
    # rows of tall windows; most are dark, a few warm
    rng = random.Random(127)
    for row, y in enumerate((178, 300, 348)):
        for x in range(570, 812, 30):
            if 670 <= x <= 710:
                continue
            arched_window(layer, x, y, 14, 24, lit=rng.random() < (0.18 if row == 0 else 0.28))
    # a huge gatehouse in front of the keep
    tower(layer, 586, 52, 312, 600, "flat", stone, light, dark, deep)
    tower(layer, 742, 52, 312, 600, "flat", stone, light, dark, deep)
    wall_block(layer, 636, 348, 744, 600, stone, light, dark, deep)
    # gate opening
    layer.pieslice(642, 462, 738, 566, 180, 360, C("#221c35"))
    layer.rect(642, 514, 738, 600, C("#221c35"))
    # warm torchlight inside
    layer.pieslice(656, 486, 724, 554, 180, 360, C("#7d2b44"))
    layer.rect(656, 520, 724, 600, C("#7d2b44"))
    layer.rect(664, 528, 716, 600, C("#2a2340"))
    # portcullis
    for x in range(650, 734, 8):
        layer.line((x, 490, x, 600), C("#6a6880"))
    for y in range(500, 600, 12):
        layer.line((644, y, 736, y), C("#6a6880"))
    # drawbridge, lowered
    layer.rect(652, 588, 728, 600, C("#6b4a3e"))
    layer.rect(652, 588, 728, 591, C("#7f5a45"))
    for x in range(656, 728, 9):
        layer.line((x, 592, x, 600), C("#3f2b26"))
    # banner over the gate
    banner(layer, 666, 380, 48, 72, "#a83a55")

    # ---- second screen: a smaller keep and the siege tower ----------------
    tower(layer, 1240, 60, 340, 600, "flat", stone, light, dark, deep)
    tower(layer, 1320, 76, 258, 600, "cone", stone, light, dark, deep, banner_colour="#3b395e", banner_inner="#8e6bc0")
    wall_block(layer, 1180, 404, 1460, 600, stone, light, dark, deep)
    crenel(layer, 1180, 1460, 404, 20, 18, 12, C(stone))
    arched_window(layer, 1310, 300, 16, 26, lit=True)
    arched_window(layer, 1350, 300, 16, 26, lit=False)

    # ---- the camp outside the wall --------------------------------------
    # The terrace line is y 556: the near parapet starts there, so the camp
    # sits above the foreground band and is not swallowed by it. The
    # trebuchet, the wall fight and the archers are loop strips on top.
    for x, y, w, h, colour in (
        (170, 556, 82, 54, "#7d2b44"),
        (282, 556, 70, 44, "#4c4a72"),
        (370, 556, 60, 38, "#7d2b44"),
        (1000, 556, 74, 46, "#4c4a72"),
    ):
        tent(layer, x, y, w, h, colour)
    for fx in (262, 1030, 1460):
        dither_circle(layer, fx, 546, 24, "#ff8a4c", 0.14, 5)
        dither_circle(layer, fx, 548, 14, "#ffe08a", 0.18, 2)
    campfire(layer, 262, 552)
    campfire(layer, 1030, 552)
    campfire(layer, 1460, 552)
    # a supply wagon
    layer.rect(396, 538, 434, 556, C("#553a32"))
    layer.rect(400, 532, 430, 540, C("#6b4a3e"))
    layer.ellipse(402, 552, 412, 562, fill=C("#2a2340"))
    layer.ellipse(420, 552, 430, 562, fill=C("#2a2340"))
    layer.line((436, 540, 448, 532), C("#7f5a45"))
    # siege tower: a timber box on wheels with a plank to the wall
    wall_block(layer, 862, 428, 926, 568, "#6b4a3e", "#7f5a45", "#553a32", "#3f2b26")
    for y in range(438, 568, 14):
        layer.line((862, y, 926, y), C("#3f2b26"))
    layer.ellipse(868, 556, 886, 574, fill=C("#2a2340"))
    layer.ellipse(902, 556, 920, 574, fill=C("#2a2340"))
    layer.rect(862, 422, 926, 430, C("#7f5a45"))
    layer.polygon([(862, 422), (894, 402), (926, 422)], C("#3f2b26"))
    layer.line((894, 402, 894, 380), C("#7f5a45"))
    layer.polygon([(894, 380), (906, 384), (894, 390)], C("#d24f4a"))
    # plank from the tower to the battlement
    layer.rect(910, 424, 962, 430, C("#7f5a45"))
    layer.line((910, 424, 962, 424), C("#6b4a3e"))
    # a breach where the siege tower is working, with the sky showing through
    layer.polygon(
        [(1006, 404), (1032, 426), (1022, 462), (1042, 492), (1018, 520), (1026, 556), (992, 556), (1000, 520), (980, 488), (996, 458)],
        C("#221c35"),
    )
    for x, y in ((1000, 404), (1018, 386), (1034, 410), (1048, 398)):
        layer.polygon([(x, 404), (x + 10, 378 + (x % 9)), (x + 20, 404)], C(stone))
    for x, y in ((986, 552), (1006, 546), (1024, 550), (1040, 544)):
        layer.ellipse(x - 4, y - 3, x + 4, y + 3, fill=C("#4c4064"))
        layer.point(x + 1, y - 4, C("#7d6d94"))
    dither_circle(layer, 1026, 548, 26, "#ff8a4c", 0.15, 4)
    campfire(layer, 1026, 552)
    for i in range(5):
        r = 9 + i * 6
        dither_rect(layer, 1026 - r, 500 - i * 18 - r, 1026 + r, 500 - i * 18 + r, "#3e3454", 0.2 - i * 0.03, i)
    # a covered battering ram at the gate, so the siege reads at the focal point
    layer.polygon([(648, 520), (700, 500), (752, 520), (752, 556), (648, 556)], C("#553a32"))
    layer.polygon([(654, 520), (700, 504), (746, 520), (746, 526), (654, 526)], C("#6b4a3e"))
    layer.line((664, 542, 736, 542), C("#3f2b26"), width=5)
    layer.line((664, 542, 736, 542), C("#7f5a45"), width=2)
    layer.polygon([(736, 534), (748, 542), (736, 550)], C("#8d8aa8"))
    for x in (662, 680, 718, 736):
        layer.ellipse(x - 3, 552, x + 3, 558, fill=C("#2a2340"))
    for x in (670, 692, 714):
        soldier(layer, x, 552, "#4c4a72")
    # ladders
    ladder(layer, 470, 396, 556, 22)
    ladder(layer, 836, 396, 556, -20)
    # warm glows under the wall torches, so the masonry catches light
    for x in (300, 560, 880, 1230):
        dither_circle(layer, x + 5, 394, 20, "#ff8a4c", 0.18, 3)
        dither_circle(layer, x + 5, 394, 10, "#ffe08a", 0.22, 1)
    # static soldiers on the wall and around the camp
    for x in (406, 900, 1084, 1248, 1452):
        soldier(layer, x, 396, "#4c4a72", spear=True)
    for x, cloak in ((196, "#8e6bc0"), (316, "#7d2b44"), (500, "#4c4a72"), (780, "#7d2b44"), (980, "#8e6bc0")):
        soldier(layer, x, 556, cloak, spear=True)
    # spears along the camp, so the siege reads before the strips animate
    for x in (230, 344, 522, 960, 1150, 1490):
        layer.line((x, 516, x + 8, 544), C("#7f5a45"))
        layer.polygon([(x + 7, 516), (x + 10, 520), (x + 4, 522)], C("#b9b6cc"))
    # smoke over the fires
    for x, y in ((262, 498), (1030, 498), (1460, 498)):
        for i in range(4):
            r = 8 + i * 5
            dither_rect(layer, x - r, y - i * 16 - r, x + r, y - i * 16 + r, "#3e3454", 0.22 - i * 0.04, x)
    # moss and rubble at the foot
    for x in range(20, W, 54):
        if (x // 54) % 3 == 0:
            layer.ellipse(x - 4, 554, x + 5, 560, fill=C("#2f6c4d"))
    return layer


def draw_near() -> Layer:
    layer = Layer()
    # The foreground parapet starts at 556, the terrace line the camp sits on.
    # Only its merlons show above the arena floor; the rest is a dark frame.
    layer.rect(0, 556, W, 600, C("#2a2340"))
    layer.rect(0, 556, W, 560, C("#3e3454"))
    crenel(layer, 0, W, 568, 24, 18, 14, C("#302945"))
    for x in range(0, W, 36):
        layer.line((x, 572, x, 600), C("#221c35"))
    for x in range(18, W, 72):
        layer.point(x, 578, C("#4c4064"))
    # torch brackets on the near wall, with the flame strip above them
    for x in (150, 1448):
        layer.rect(x - 2, 538, x + 2, 560, C("#553a32"))
        layer.line((x - 6, 546, x + 6, 542), C("#7f5a45"))
        layer.rect(x - 4, 542, x + 4, 548, C("#3f2b26"))
    # a broken merlon and rubble, so the wall is a place and not a stripe
    layer.rect(686, 556, 722, 568, C("#221c35"))
    for x, y in ((682, 566), (698, 562), (718, 564)):
        layer.ellipse(x - 3, y - 2, x + 3, y + 2, fill=C("#302945"))
    return layer


# ---------------------------------------------------------------------------
# strips: living vignettes


def strip(w: int, h: int, frames: int) -> Image.Image:
    return Image.new("RGBA", (w * frames, h), (0, 0, 0, 0))


def draw_flag_strip() -> Image.Image:
    fw, fh, n = 32, 24, 4
    out = strip(fw, fh, n)
    shapes = [
        [(5, 4), (29, 2), (27, 9), (19, 11), (29, 16), (5, 18)],
        [(5, 4), (29, 6), (26, 11), (18, 12), (28, 17), (5, 18)],
        [(5, 4), (28, 2), (29, 9), (21, 12), (30, 18), (5, 17)],
        [(5, 5), (29, 4), (27, 12), (19, 13), (29, 18), (5, 17)],
    ]
    for f in range(n):
        img = Image.new("RGBA", (fw, fh), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        d.rectangle((2, 0, 3, fh - 1), fill=C("#553a32"))
        d.rectangle((2, 0, 2, fh - 1), fill=C("#7f5a45"))
        d.ellipse((0, -1, 5, 4), fill=C("#e4a73f"))
        d.polygon(shapes[f], fill=C("#a83a55"))
        d.line((shapes[f][0], shapes[f][1], shapes[f][2], shapes[f][3]), fill=C("#c94d6a"))
        d.line((9, 10, 25, 10), fill=C("#f7c85f"))
        d.ellipse((13, 7, 20, 14), fill=C("#f7c85f"))
        d.rectangle((16, 9, 17, 12), fill=C("#7d2b44"))
        out.paste(img, (f * fw, 0))
    return out

def draw_princess_strip() -> Image.Image:
    fw, fh, n = 24, 34, 4
    out = strip(fw, fh, n)
    ink = C("#2d2b4b")
    for f in range(n):
        img = Image.new("RGBA", (fw, fh), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        # a dark outline first, then the warm fills: the figure has to read
        # against a lamplit window at 1x, not just in the contact sheet
        d.polygon([(4, 33), (7, 18), (17, 18), (20, 33)], fill=ink)
        d.rectangle((7, 13, 17, 19), fill=ink)
        d.ellipse((7, 3, 17, 14), fill=ink)
        d.polygon([(5, 32), (8, 19), (16, 19), (19, 32)], fill=C("#c94d6a"))
        d.rectangle((8, 18, 16, 20), fill=C("#7d2b44"))
        d.rectangle((8, 13, 16, 19), fill=C("#a83a55"))
        d.rectangle((9, 9, 15, 14), fill=C("#c94d6a"))
        d.ellipse((8, 4, 16, 12), fill=C("#f2c9a0"))
        d.ellipse((7, 2, 17, 9), fill=C("#3b395e"))
        d.rectangle((8, 3, 16, 6), fill=C("#3b395e"))
        d.rectangle((9, 9, 15, 11), fill=C("#d9a77f"))
        d.point((10, 8), ink)
        d.point((14, 8), ink)
        d.point((12, 10), C("#d9a77f"))
        d.rectangle((9, 1, 15, 2), fill=C("#f7c85f"))
        d.point((9, 0), C("#ffe08a"))
        d.point((12, 0), C("#ffe08a"))
        d.point((15, 0), C("#ffe08a"))
        # the waving arm: shoulder at (15, 15), hand moves per frame
        hand_x = [20, 22, 22, 20][f]
        hand_y = [9, 5, 3, 8][f]
        d.line((15, 15, hand_x, hand_y), fill=ink, width=4)
        d.line((15, 15, hand_x, hand_y), fill=C("#f2c9a0"), width=2)
        d.ellipse((hand_x - 2, hand_y - 2, hand_x + 2, hand_y + 2), fill=C("#f2c9a0"))
        # window mullions in front of her, so the opening still reads as glass
        d.rectangle((1, 17, 22, 18), fill=C("#3e3454"))
        d.rectangle((11, 17, 12, 33), fill=C("#3e3454"))
        out.paste(img, (f * fw, 0))
    return out

def draw_trebuchet_strip() -> Image.Image:
    fw, fh, n = 72, 52, 4
    out = strip(fw, fh, n)
    angles = [-0.45, 0.05, 1.12, 0.35]
    for f in range(n):
        img = Image.new("RGBA", (fw, fh), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        # base and wheels
        d.line((8, 44, 26, 30), fill=C("#553a32"), width=4)
        d.line((64, 44, 46, 30), fill=C("#553a32"), width=4)
        d.line((16, 46, 56, 46), fill=C("#3f2b26"), width=4)
        d.ellipse((8, 40, 24, 56), fill=C("#2a2340"))
        d.ellipse((48, 40, 64, 56), fill=C("#2a2340"))
        d.ellipse((12, 44, 20, 52), fill=C("#6b4a3e"))
        d.ellipse((52, 44, 60, 52), fill=C("#6b4a3e"))
        # pivot and arm
        px, py = 36, 30
        a = angles[f]
        sx, sy = math.cos(a + math.pi) * 15, math.sin(a + math.pi) * 15
        ex, ey = math.cos(a) * 32, math.sin(a) * 32
        d.line((px + sx, py + sy, px + ex, py + ey), fill=C("#7f5a45"), width=5)
        d.line((px + sx, py + sy, px + ex, py + ey), fill=C("#553a32"), width=1)
        # counterweight
        d.rectangle((px + sx - 6, py + sy - 6, px + sx + 6, py + sy + 6), fill=C("#4c4a72"))
        d.rectangle((px + sx - 5, py + sy - 5, px + sx + 2, py + sy + 1), fill=C("#6e54a8"))
        # sling and stone
        hx, hy = px + ex, py + ey
        d.line((hx, hy, hx + 5, hy + 11), fill=C("#3f2b26"))
        d.ellipse((hx + 1, hy + 9, hx + 9, hy + 17), fill=C("#b9b6cc"))
        if f >= 2:
            d.point((hx + 10, hy + 3), C("#ff8a4c"))
        out.paste(img, (f * fw, 0))
    return out

def draw_battle_strip() -> Image.Image:
    fw, fh, n = 40, 24, 4
    out = strip(fw, fh, n)
    for f in range(n):
        img = Image.new("RGBA", (fw, fh), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        # left soldier, crimson; right soldier, indigo
        d.rectangle((8, 19, 10, 24), fill=C("#2a2340"))
        d.rectangle((5, 11, 12, 19), fill=C("#a83a55"))
        d.rectangle((7, 6, 10, 11), fill=C("#f2c9a0"))
        d.rectangle((7, 3, 10, 6), fill=C("#7d2b44"))
        d.rectangle((30, 19, 32, 24), fill=C("#2a2340"))
        d.rectangle((27, 11, 34, 19), fill=C("#4c4a72"))
        d.rectangle((29, 6, 32, 11), fill=C("#f2c9a0"))
        d.rectangle((29, 3, 32, 6), fill=C("#3b395e"))
        # swords: clash on 1, recoil on 2, reset on 3
        if f == 0:
            d.line((13, 13, 21, 4), fill=C("#b9b6cc"), width=2)
            d.line((26, 13, 18, 5), fill=C("#b9b6cc"), width=2)
        elif f == 1:
            d.line((13, 13, 20, 5), fill=C("#b9b6cc"), width=2)
            d.line((26, 13, 18, 5), fill=C("#b9b6cc"), width=2)
            d.line((16, 3, 23, 11), fill=C("#ffe08a"), width=2)
            d.point((20, 6), C("#fff3c9"))
        elif f == 2:
            d.line((13, 14, 17, 3), fill=C("#b9b6cc"), width=2)
            d.line((26, 14, 22, 3), fill=C("#b9b6cc"), width=2)
        else:
            d.line((13, 14, 22, 14), fill=C("#b9b6cc"), width=2)
            d.line((26, 14, 17, 14), fill=C("#b9b6cc"), width=2)
        out.paste(img, (f * fw, 0))
    return out

def draw_archer_strip() -> Image.Image:
    fw, fh, n = 28, 18, 4
    out = strip(fw, fh, n)
    for f in range(n):
        img = Image.new("RGBA", (fw, fh), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        for x, cloak in ((5, "#4c4a72"), (17, "#7d2b44")):
            d.rectangle((x, 12, x + 2, 17), fill=C("#2a2340"))
            d.rectangle((x - 1, 6, x + 4, 12), fill=C(cloak))
            d.rectangle((x, 3, x + 3, 6), fill=C("#f2c9a0"))
            d.rectangle((x, 2, x + 3, 3), fill=C("#3b395e"))
            # bow and arrow; the release frame throws a bright line
            d.arc((x - 4, 4, x + 7, 15), 270, 90, fill=C("#7f5a45"), width=1)
            if f == 3:
                d.line((x + 4, 8, x + 12, 6), fill=C("#ffe08a"))
            else:
                d.line((x + 3, 8, x + 7, 8), fill=C("#b9b6cc"))
        out.paste(img, (f * fw, 0))
    return out

def draw_torch_strip() -> Image.Image:
    fw, fh, n = 10, 18, 4
    out = strip(fw, fh, n)
    for f in range(n):
        img = Image.new("RGBA", (fw, fh), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        d.rectangle((4, 13, 5, 17), fill=C("#553a32"))
        d.rectangle((3, 12, 6, 14), fill=C("#6b4a3e"))
        flame = [
            [(1, 12), (5, 1), (8, 12)],
            [(2, 12), (5, 2), (9, 12)],
            [(1, 12), (4, 0), (6, 12)],
            [(2, 12), (6, 2), (8, 12)],
        ][f]
        d.polygon(flame, fill=C("#ff8a4c"))
        d.polygon([(4, 12), (5, 5), (6, 12)], fill=C("#ffe08a"))
        d.point((5, 4), C("#fff3c9"))
        out.paste(img, (f * fw, 0))
    return out

def draw_crows_strip() -> Image.Image:
    fw, fh, n = 10, 5, 4
    out = strip(fw, fh, n)
    rows = [0, 1, 3, 1]
    for f in range(n):
        img = Image.new("RGBA", (fw, fh), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        y = rows[f]
        d.line((1, y, 4, 2), fill=C("#2d2b4b"))
        d.line((4, 2, 7, y), fill=C("#2d2b4b"))
        d.line((7, y, 9, y + 1), fill=C("#2d2b4b"))
        d.point((4, 2), C("#4c4a72"))
        d.point((4, 3), C("#2d2b4b"))
        out.paste(img, (f * fw, 0))
    return out

def draw_all() -> dict[str, Image.Image]:
    return {
        "sky": draw_sky().img,
        "far": draw_far().img,
        "mid": draw_mid().img,
        "near": draw_near().img,
        "flags": draw_flag_strip(),
        "princess": draw_princess_strip(),
        "trebuchet": draw_trebuchet_strip(),
        "battle": draw_battle_strip(),
        "archers": draw_archer_strip(),
        "torches": draw_torch_strip(),
        "crows": draw_crows_strip(),
    }


LOOPS = {
    "clockMs": 12000,
    "groups": [
        {
            "layer": "flags",
            "actors": [
                {"u": 678, "v": 6, "frameOffset": 0},
                {"u": 558, "v": 116, "frameOffset": 1},
                {"u": 802, "v": 116, "frameOffset": 2},
                {"u": 610, "v": 288, "frameOffset": 3},
                {"u": 766, "v": 288, "frameOffset": 1},
                {"u": 124, "v": 246, "frameOffset": 2},
                {"u": 454, "v": 328, "frameOffset": 3},
                {"u": 980, "v": 318, "frameOffset": 1},
                {"u": 1149, "v": 240, "frameOffset": 2},
                {"u": 1451, "v": 342, "frameOffset": 3},
                {"u": 1268, "v": 316, "frameOffset": 0},
                {"u": 1356, "v": 192, "frameOffset": 2},
            ],
        },
        {
            "layer": "princess",
            "actors": [{"u": 680, "v": 226, "frameOffset": 0}],
        },
        {
            "layer": "trebuchet",
            "actors": [{"u": 278, "v": 504, "frameOffset": 0}],
        },
        {
            "layer": "battle",
            "actors": [
                {"u": 196, "v": 380, "frameOffset": 0},
                {"u": 1128, "v": 282, "frameOffset": 2},
                {"u": 990, "v": 318, "frameOffset": 1},
            ],
        },
        {
            "layer": "archers",
            "actors": [
                {"u": 512, "v": 386, "frameOffset": 0},
                {"u": 1200, "v": 386, "frameOffset": 2},
            ],
        },
        {
            "layer": "torches",
            "actors": [
                {"u": 300, "v": 386, "frameOffset": 0},
                {"u": 560, "v": 386, "frameOffset": 2},
                {"u": 880, "v": 386, "frameOffset": 1},
                {"u": 1230, "v": 386, "frameOffset": 3},
            ],
        },
    ],
}

AMBIENT = {
    "loopMs": 120000,
    "groups": [
        {
            "layer": "crows",
            "actors": [
                {"u": 120, "v": 104, "speedX": 7.5, "bobAmp": 3.0, "bobFreq": 0.7, "phase": 0.0},
                {"u": 420, "v": 150, "speedX": -9.0, "bobAmp": 2.4, "bobFreq": 0.9, "phase": 1.1, "flip": True},
                {"u": 760, "v": 82, "speedX": 6.0, "bobAmp": 3.6, "bobFreq": 0.6, "phase": 2.2},
                {"u": 1020, "v": 176, "speedX": -11.0, "bobAmp": 2.0, "bobFreq": 1.0, "phase": 3.3, "flip": True},
                {"u": 1320, "v": 120, "speedX": 8.0, "bobAmp": 2.8, "bobFreq": 0.8, "phase": 4.4},
                {"u": 1500, "v": 60, "speedX": -7.0, "bobAmp": 2.2, "bobFreq": 0.75, "phase": 5.5, "flip": True},
            ],
        }
    ],
}


def hash12(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:12]


def manifest(images: dict[str, Image.Image]) -> dict:
    layers = [
        {
            "id": "sky",
            "type": "image",
            "src": "assets/skybox/castle/sky.png",
            "version": hash12(OUT / "sky.png"),
            "factor": 0.015,
            "driftX": 0.5,
            "alpha": 1,
        },
        {
            "id": "far",
            "type": "image",
            "src": "assets/skybox/castle/far.png",
            "version": hash12(OUT / "far.png"),
            "factor": 0.06,
        },
        {
            "id": "mid",
            "type": "image",
            "src": "assets/skybox/castle/mid.png",
            "version": hash12(OUT / "mid.png"),
            "factor": 0.18,
        },
        {
            "id": "near",
            "type": "image",
            "src": "assets/skybox/castle/near.png",
            "version": hash12(OUT / "near.png"),
            "factor": 0.5,
            "alpha": 0.62,
        },
        {
            "id": "flags",
            "type": "strip",
            "src": "assets/skybox/castle/flags.png",
            "version": hash12(OUT / "flags.png"),
            "factor": 0.3,
            "align": "mid",
            "frameW": 32,
            "frameH": 24,
            "frames": 4,
            "fps": 6,
        },
        {
            "id": "princess",
            "type": "strip",
            "src": "assets/skybox/castle/princess.png",
            "version": hash12(OUT / "princess.png"),
            "factor": 0.3,
            "align": "mid",
            "frameW": 24,
            "frameH": 34,
            "frames": 4,
            "fps": 4,
        },
        {
            "id": "trebuchet",
            "type": "strip",
            "src": "assets/skybox/castle/trebuchet.png",
            "version": hash12(OUT / "trebuchet.png"),
            "factor": 0.3,
            "align": "mid",
            "frameW": 72,
            "frameH": 52,
            "frames": 4,
            "fps": 3,
        },
        {
            "id": "battle",
            "type": "strip",
            "src": "assets/skybox/castle/battle.png",
            "version": hash12(OUT / "battle.png"),
            "factor": 0.3,
            "align": "mid",
            "frameW": 40,
            "frameH": 24,
            "frames": 4,
            "fps": 6,
        },
        {
            "id": "archers",
            "type": "strip",
            "src": "assets/skybox/castle/archers.png",
            "version": hash12(OUT / "archers.png"),
            "factor": 0.3,
            "align": "mid",
            "frameW": 28,
            "frameH": 18,
            "frames": 4,
            "fps": 5,
        },
        {
            "id": "torches",
            "type": "strip",
            "src": "assets/skybox/castle/torches.png",
            "version": hash12(OUT / "torches.png"),
            "factor": 0.3,
            "align": "mid",
            "frameW": 10,
            "frameH": 18,
            "frames": 4,
            "fps": 8,
        },
        {
            "id": "crows",
            "type": "strip",
            "src": "assets/skybox/castle/crows.png",
            "version": hash12(OUT / "crows.png"),
            "factor": 0.04,
            "frameW": 10,
            "frameH": 5,
            "frames": 4,
            "fps": 10,
        },
    ]
    return {
        "name": "castle",
        "title": "Castle Keep — Dusk Siege",
        "width": W,
        "height": H,
        "haze": 0.9,
        "ambient": AMBIENT,
        "loops": LOOPS,
        "layers": layers,
    }


def frame_of(strip_img: Image.Image, fw: int, fh: int, index: int) -> Image.Image:
    return strip_img.crop((index * fw, 0, (index + 1) * fw, fh))


def write_contact(images: dict[str, Image.Image], man: dict):
    contact = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    for name in ("sky", "far", "mid", "near"):
        contact.alpha_composite(images[name])
    # one representative frame of every strip, placed by the loops plan
    for group in man["loops"]["groups"]:
        strip_img = images[group["layer"]]
        layer = next(l for l in man["layers"] if l["id"] == group["layer"])
        for actor in group["actors"]:
            frame = frame_of(strip_img, layer["frameW"], layer["frameH"], actor["frameOffset"])
            contact.alpha_composite(frame, (actor["u"], actor["v"]))
    crow_layer = next(l for l in man["layers"] if l["id"] == "crows")
    for actor in man["ambient"]["groups"][0]["actors"]:
        frame = frame_of(images["crows"], crow_layer["frameW"], crow_layer["frameH"], 0)
        contact.alpha_composite(frame, (actor["u"], actor["v"]))
    contact.convert("RGB").save(OUT / "contact.png")
    # the three-screen strip the contract asks for
    preview = Image.new("RGB", (W * 2, H), (0, 0, 0))
    preview.paste(contact.convert("RGB"), (0, 0))
    preview.paste(contact.convert("RGB"), (W, 0))
    preview.save(OUT / "preview-3screens.png")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    images = draw_all()
    for name, image in images.items():
        image.save(OUT / f"{name}.png")
    man = manifest(images)
    (OUT / "manifest.json").write_text(json.dumps(man, indent="\t") + "\n")
    write_contact(images, man)
    (OUT / "NOTES.md").write_text((HAND / "NOTES.md").read_text())
    unused = sorted(set(PAL) - USED)
    if unused:
        print("unused palette colours:", ", ".join(unused))
    print(f"wrote {len(images)} PNGs + manifest.json + contact.png to {OUT}")


if __name__ == "__main__":
    main()
