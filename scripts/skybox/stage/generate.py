#!/usr/bin/env python3
"""A quiet, purpose-built stage backdrop for golpe.

This is not a repaint of the hand city.  It is a Smash-style *set*: one long
aqueduct terrace, one giant tree, one broad low conservatory, a hard water line
and a lot of negative space.  Every pixel is hand-plotted at 1:1, with binary
alpha and the shared solarpunk palette.

    .venv/bin/python scripts/skybox/stage/generate.py

Outputs public/assets/skybox/stage/ and review artefacts beside this script.
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
WATER_Y = 500
FALL_W, FALL_H = 48, 240
BIRD_W, BIRD_H = 12, 8
ZEPP_W, ZEPP_H = 64, 28
BOAT_W, BOAT_H = 32, 14
GLINT_W, GLINT_H = 32, 8

# The composition map.  Hero crop is 0..800; the calm variation continues
# 800..1600.  Keeping these numbers in one place is what lets the review
# images and the generator agree about where the masses are.
DECK_Y = 418
DECK_X0, DECK_X1 = 250, 900
STEP_X0, STEP_X1 = 900, 940
HIGH_Y = 330
HIGH_X0, HIGH_X1 = 940, 1240
TREE_X = 690
CONS_X0, CONS_X1 = 18, 250
CONS_SPRING = 424
CONS_APEX = 332

FALL_ITEMS = [
    # (left edge of the 48px strip, top of the fall)
    (244, 372),      # the conservatory spillway, hero crop
    (960, HIGH_Y),   # the high viaduct mouth, calm variation
]

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "public" / "assets" / "skybox" / "stage"
HERE = Path(__file__).resolve().parent
REVIEW = HERE / "review"
PALETTE = json.loads((ROOT / "art" / "skybox" / "palette.json").read_text())
PAL = {h.lower(): tuple(int(h[i : i + 2], 16) for i in (1, 3, 5)) for h in PALETTE["all"]}
assert len(PAL) == len(PALETTE["all"]), "duplicate palette entries"

USED: set[str] = set()
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

# A deliberately small cast of colours.  Readings from the palette:
#   stone   cream body, warm shade, pale highlight
#   glass   teal, nothing darker than the water
#   green   four steps, no near-black foliage in the band
#   water   five steps
CREAM = ("#fff2d6", "#f3e0bb", "#e4c99b", "#d2b07c")
STONE_DARK = "#b98f61"
GLASS = ("#c8f7ec", "#96e8dc", "#66d0cf")
BRASS = ("#ffe08a", "#f7c85f", "#e4a73f", "#c9852f")
GREEN = ("#d7e98c", "#b7d879", "#8dc46f", "#68a963", "#478a58", "#2f6c4d")
WATER = ("#effff4", "#c8f7ec", "#96e8dc", "#66d0cf", "#42b2c2", "#2f8ba8")
INK = "#3b395e"


def C(hex_colour: str, alpha: int = 255) -> tuple[int, int, int, int]:
    h = hex_colour.lower()
    assert h in PAL, f"colour outside art/skybox/palette.json: {h}"
    USED.add(h)
    r, g, b = PAL[h]
    return (r, g, b, alpha)


def patch_from(arr: np.ndarray) -> Image.Image:
    return Image.fromarray(arr, "RGBA")


def ell_mask(w, h, cx, cy, rx, ry):
    yy, xx = np.mgrid[0:h, 0:w]
    return ((xx - cx) / max(rx, 0.1)) ** 2 + ((yy - cy) / max(ry, 0.1)) ** 2 <= 1.0


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
    top = max(0, -y)
    bottom = min(patch.height, H - y)
    if bottom <= top:
        return
    p = patch.crop((0, top, patch.width, bottom))
    yy = y + top
    x0 = x % img.width
    if x0 + p.width <= img.width:
        img.alpha_composite(p, (x0, yy))
    else:
        cut = img.width - x0
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

    def pieslice(self, x0, y0, x1, y1, a0, a1, fill):
        for o in self._offsets(x0, x1):
            self.d.pieslice((x0 + o, y0, x1 + o, y1), a0, a1, fill=fill)

    def line(self, pts, fill, width=1):
        xs = [p[0] for p in pts]
        for o in self._offsets(min(xs), max(xs)):
            self.d.line([(px + o, py) for px, py in pts], fill=fill, width=width)

    def polygon(self, pts, fill):
        xs = [p[0] for p in pts]
        for o in self._offsets(min(xs), max(xs)):
            self.d.polygon([(px + o, py) for px, py in pts], fill=fill)

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
# sky


SKY_STOPS = [
    (0.00, "#3f88ad"),
    (0.18, "#5aa6bd"),
    (0.38, "#78c2c7"),
    (0.56, "#9ad8cd"),
    (0.74, "#c6ebdc"),
    (0.90, "#eaf3df"),
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
    chose_high = frac > BAYER8[yy % 8, xx % 8]
    out = np.where(chose_high[..., None], cols[i1], cols[i0])
    for _, c in SKY_STOPS:
        USED.add(c)
    layer.img = Image.fromarray(np.dstack([out, np.full((H, W), 255, np.uint8)]), "RGBA")
    layer.d = ImageDraw.Draw(layer.img)

    sun(layer, 300, 300, 27)
    planet(layer, 430, 90, 38, -18)

    # Three clouds, no more.  The left one is the hero's cumulus; the middle
    # one is a shoulder behind the tree; the right one belongs to the calm
    # variation.  Every one is wider than it is tall.
    cloud(layer, 160, 215, 310, 92, 11)
    cloud(layer, 430, 205, 190, 62, 17)
    cloud(layer, 1200, 280, 300, 88, 23)
    return layer


def sun(layer: Layer, cx, cy, r):
    yy, xx = np.mgrid[0 : 2 * (r + 24), 0 : 2 * (r + 24)]
    c0 = r + 24
    dist = np.hypot(xx - c0, yy - c0)
    arr = np.zeros((2 * (r + 24), 2 * (r + 24), 4), dtype=np.uint8)
    m = dist <= r
    arr[m] = C("#fff3c9")
    m = (dist > r) & (dist <= r + 7) & bayer_mask(r * 2 + 48, r * 2 + 48, 0.55, 3, 4)
    arr[m] = C("#ffe6a1")
    m = (dist > r + 7) & (dist <= r + 19) & bayer_mask(r * 2 + 48, r * 2 + 48, 0.16, 1, 2)
    arr[m] = C("#ffd37a")
    layer.paste(patch_from(arr), cx - c0, cy - c0)


def planet(layer: Layer, cx, cy, r, tilt_deg):
    pad = int(r * 2.2)
    pw, ph = pad * 2, pad * 2
    lcx, lcy = pad, pad
    yy, xx = np.mgrid[0:ph, 0:pw]
    dx, dy = xx - lcx, yy - lcy
    th = math.radians(tilt_deg)
    xp = dx * math.cos(th) + dy * math.sin(th)
    yp = -dx * math.sin(th) + dy * math.cos(th)
    a_out, b_out = r * 1.92, r * 0.38
    a_in, b_in = r * 1.34, r * 0.23
    e_out = np.sqrt((xp / a_out) ** 2 + (yp / b_out) ** 2)
    e_in = np.sqrt((xp / a_in) ** 2 + (yp / b_in) ** 2)
    ring = (e_out <= 1.0) & (e_in >= 1.0)
    front = yp > 0

    arr = np.zeros((ph, pw, 4), dtype=np.uint8)
    ring_col = np.full((ph, pw, 3), PAL["#d2b07c"], dtype=np.uint8)
    ring_col[e_out > 0.96] = PAL["#ffe08a"]
    ring_col[(e_out <= 0.96) & (e_out > 0.84)] = PAL["#f7c85f"]
    ring_col[(e_out <= 0.84) & (e_in > 0.08)] = PAL["#e4a73f"]
    ring_col[e_in < 0.09] = PAL["#e4a73f"]
    for c in ("#ffe08a", "#f7c85f", "#e4a73f", "#d2b07c", "#c9852f"):
        USED.add(c)
    shadow_ring = yp < -r * 0.10
    ring_col[shadow_ring & (e_out > 0.86)] = PAL["#d2b07c"]
    arr[ring & ~front, :3] = ring_col[ring & ~front]
    arr[ring & ~front, 3] = 255

    inside = (xx - lcx) ** 2 + (yy - lcy) ** 2 <= r * r
    nx = dx / r
    ny = dy / r
    nz = np.sqrt(np.clip(1.0 - nx * nx - ny * ny, 0.0, 1.0))
    wob = np.sin(xx / 19.0) * 1.6 + np.sin(xx / 47.0 + 1.2) * 2.0
    band = ((yy + wob) / 10.0).astype(np.int32) % 5
    band_cols = ["#f3e0bb", "#e4c99b", "#f3e0bb", "#d2b07c", "#e4c99b"]
    for c in band_cols:
        USED.add(c)
    body = np.zeros((ph, pw, 3), dtype=np.uint8)
    for i, c in enumerate(band_cols):
        body[band == i] = PAL[c]
    light = 0.5 * nx - 0.55 * ny + 0.66 * nz
    shade = (light < 0.44) & bayer_mask(ph, pw, 0.65, lcx, lcy)
    body[shade] = PAL["#d2b07c"]
    body[light < 0.25] = PAL["#d2b07c"]
    limb = inside & (np.sqrt(dx * dx + dy * dy) > r - 1.5)
    body[limb & (nx > 0.05)] = PAL["#fff2d6"]
    body[inside & (light < 0.14) & bayer_mask(ph, pw, 0.5, 2, 4)] = PAL["#b98f61"]
    for c in ("#d2b07c", "#b98f61", "#fff2d6"):
        USED.add(c)
    arr[inside, :3] = body[inside]
    arr[inside, 3] = 255
    arr[ring & front, :3] = ring_col[ring & front]
    arr[ring & front, 3] = 255
    layer.paste(patch_from(arr), cx - lcx, cy - lcy)


def cloud(layer: Layer, cx, base_y, w, h, seed):
    rng = random.Random(seed)
    pad = 28
    pw, ph = w + pad * 2, h + pad * 2
    yy, xx = np.mgrid[0:ph, 0:pw]
    # Six large lobes, three of them rising into a crown.  The old city used
    # eleven plus thirty-four tufts; the calm version needs a silhouette, not
    # weather.
    spec = [
        (0.09, 0.73, 0.16, 0.15),
        (0.25, 0.54, 0.19, 0.24),
        (0.40, 0.40, 0.18, 0.29),
        (0.56, 0.35, 0.20, 0.32),
        (0.73, 0.48, 0.19, 0.25),
        (0.89, 0.70, 0.14, 0.16),
    ]
    lobes = []
    union = np.zeros((ph, pw), bool)
    for fx, fy, frx, fry in spec:
        ex, ey = pad + w * fx, pad + h * fy
        rx = w * frx * rng.uniform(0.95, 1.05)
        ry = h * fry * rng.uniform(0.95, 1.05)
        lobes.append((ex, ey, rx, ry))
        union |= ell_mask(pw, ph, ex, ey, rx, ry)
    union |= ell_mask(pw, ph, pad + w * 0.5, pad + h * 0.72, w * 0.34, h * 0.19)
    union |= ell_mask(pw, ph, pad + w * 0.5, pad + h * 0.90, w * 0.45, h * 0.10)

    arr = np.zeros((ph, pw, 4), dtype=np.uint8)
    arr[union] = C("#f6e6c9")
    # one soft underside band, not a smile on every lobe
    ys = np.arange(ph)[:, None]
    top = np.where(union, ys, ph + 10).min(axis=0)
    bottom = np.where(union, ys, -10).max(axis=0)
    t = np.arange(ph)[:, None] - top[None, :]
    b = bottom[None, :] - np.arange(ph)[:, None]
    arr[union & (t == 0)] = C("#fff8e8")
    arr[union & (t >= 1) & (t <= 3)] = C("#fff8e8")
    # A single pale underside, dithered.  The old cloud's #d3a17f line was a
    # black-ish rim at 1x; here it is a broken edge only.
    arr[union & (b == 0) & bayer_mask(ph, pw, 0.65, 1, 2)] = C("#d3a17f")
    arr[union & (b >= 1) & (b <= 3)] = C("#e9c9a2")
    arr[union & (b >= 4) & (b <= 10) & bayer_mask(ph, pw, 0.34, 2, 3)] = C("#e9c9a2")
    arr[union & (b >= 10) & (b <= 17) & bayer_mask(ph, pw, 0.12, 4, 1)] = C("#e9c9a2")
    right = np.zeros_like(union)
    right[:, 1:] = union[:, :-1]
    arr[union & ~right & (yy < pad + h * 0.7)] = C("#fff3c9")
    layer.paste(patch_from(arr), cx - (pad + w // 2), base_y - h - 28)


# ---------------------------------------------------------------------------
# far layer


def draw_far() -> Layer:
    layer = Layer()
    # Aerial perspective is the whole job here.  The land is one pale mint
    # band, barely darker than the horizon, so the aqueduct arches read as
    # openings rather than tunnels.  The profile is built from integer-period
    # sines, which makes the panorama seam exact by construction.
    xs = np.arange(W, dtype=np.float32)
    ridge = (
        462
        + 10.0 * np.sin(2 * math.pi * xs / W + 0.8)
        + 5.0 * np.sin(4 * math.pi * xs / W + 2.1)
        + 3.0 * np.sin(6 * math.pi * xs / W + 0.3)
    )
    for x in range(W):
        y = int(ridge[x])
        layer.rect(x, y, x, WATER_Y - 1, C("#78c2c7"))
        layer.rect(x, y, x, y + 1, C("#9ad8cd"))
        layer.rect(x, y + 2, x, y + 3, C("#9ad8cd"))
    # two low shelves, 1px and wide, to suggest terraced land without detail
    for y, x0, x1 in ((478, 120, 700), (486, 760, 1280)):
        layer.rect(x0, y, x1, y, C("#c6ebdc"))
    layer.rect(0, WATER_Y - 2, W - 1, WATER_Y - 1, C("#78c2c7"))
    return layer


# ---------------------------------------------------------------------------
# mid layer


def draw_mid() -> Layer:
    layer = Layer()
    quay(layer)
    conservatory(layer)
    aqueduct(layer)
    big_tree(layer)
    high_viaduct(layer)
    deck_plants(layer)
    waterline(layer)
    return layer


def quay(layer: Layer):
    # The far bank: a stone lip the canal meets, with a walkway on top.
    layer.rect(0, 486, W - 1, 499, C("#e4c99b"))
    layer.rect(0, 486, W - 1, 487, C("#f3e0bb"))
    layer.rect(0, 498, W - 1, 499, C("#b98f61"))
    for x in range(0, W, 104):
        layer.rect(x, 488, x, 497, C("#d2b07c"))
        layer.point(x + 2, 489, C("#f3e0bb"))
    # A few people, 6-7 px, silhouetted.  They are the only figures in the
    # picture and they stand on the far bank, never behind a platform.
    for i, (x, h) in enumerate(((380, 7), (545, 6), (860, 7), (1000, 6), (1332, 7), (1470, 6))):
        person(layer, x, 486, h, i)


def person(layer: Layer, x, base_y, h, seed):
    ink = C(INK)
    layer.rect(x - 1, base_y - h + 2, x + 1, base_y - 2, ink)
    layer.point(x, base_y - h + 1, ink)
    layer.point(x - 2, base_y - h + 2, ink)
    layer.point(x + 2, base_y - h + 2, ink)
    layer.line([(x - 1, base_y - 1), (x - 2, base_y)], ink)
    layer.line([(x + 1, base_y - 1), (x + 2, base_y)], ink)
    if seed % 2 == 0:
        layer.point(x + 2, base_y - h + 2, C("#9ad8cd"))


def conservatory(layer: Layer):
    x0, x1 = CONS_X0, CONS_X1
    cx = (x0 + x1) // 2
    rx = (x1 - x0) // 2
    ry = CONS_SPRING - CONS_APEX
    spring = CONS_SPRING

    # glass drum first, so the half dome can sit on it
    layer.rect(x0, spring, x1, WATER_Y - 1, C(CREAM[1]))
    layer.rect(x0, spring, x0 + 10, WATER_Y - 1, C(CREAM[2]))
    layer.rect(x1 - 8, spring, x1, WATER_Y - 1, C("#d2b07c"))
    layer.rect(x0, spring, x1, spring + 2, C(CREAM[0]))
    layer.rect(x0, 489, x1, 491, C(CREAM[2]))
    layer.rect(x0, 492, x1, 492, C("#f7c85f"))
    layer.rect(x0, 493, x1, 496, C(CREAM[1]))

    # two large arched doors, not a row of windows
    for i, (ax0, ax1) in enumerate(((x0 + 34, x0 + 90), (x0 + 142, x0 + 208))):
        layer.rect(ax0, 444, ax1, WATER_Y - 1, C("#66d0cf"))
        layer.rect(ax0, 444, ax1, 462, C("#96e8dc"))
        layer.rect(ax0, 444, ax1, 445, C("#c8f7ec"))
        layer.rect(ax0, 444, ax0 + 1, WATER_Y - 1, C("#f7c85f"))
        layer.rect(ax1 - 1, 444, ax1, WATER_Y - 1, C("#c9852f"))
        # the arch top is a shallow segment, one line
        for t in range(11):
            xx = ax0 + int((ax1 - ax0) * t / 10)
            yy = 444 - int(10 * math.sin(math.pi * t / 10))
            layer.rect(xx, yy, xx, yy + 1, C("#f7c85f"))
        # one broad pale reflection, no interior clutter
        layer.rect(ax0 + 7, 452, ax0 + 8, 494, C("#c8f7ec"))
        layer.rect(ax0 + 9, 466, ax0 + 9, 492, C("#96e8dc"))
        layer.rect(ax0 + 2, 476, ax1 - 2, 476, C("#96e8dc"))
    # horizontal glazing bars, only two
    layer.rect(x0 + 8, 468, x1 - 8, 468, C("#e4c99b"))
    layer.rect(x0 + 12, 482, x1 - 12, 482, C("#e4c99b"))

    # The broad half dome, wider than tall.  The rim is cream, the glass is
    # pale teal, and the ribs are vertical glazing bars -- a glasshouse, not a
    # scallop shell.
    layer.pieslice(x0, CONS_APEX, x1, spring + (spring - CONS_APEX), 180, 360, C(CREAM[2]))
    layer.pieslice(x0 + 2, CONS_APEX + 2, x1 - 2, spring + (spring - CONS_APEX) - 2, 180, 360, C("#96e8dc"))
    # a lower body tint, dithered, so the glass has weight without a gradient
    for x in range(x0 + 3, x1 - 2):
        u = (x - cx) / max(1, rx - 1)
        if abs(u) > 1:
            continue
        surface = spring - int(ry * math.sqrt(max(0.0, 1 - u * u)))
        start = max(surface + 2, 382)
        for y in range(start, spring - 1):
            if (y - start) > 8 and BAYER8[y % 8, x % 8] < 0.45:
                layer.point(x, y, C("#66d0cf"))
    # five vertical ribs, two horizontal glazing rings
    for s in (-0.72, -0.42, 0.0, 0.42, 0.72):
        x = cx + int(s * rx)
        top = spring - int(ry * math.sqrt(max(0.0, 1 - s * s)))
        layer.line([(x, spring - 2), (x, top + 1)], C("#e4c99b"))
        layer.point(x, top, C("#f3e0bb"))
    for yy in (376, 400):
        half = int(rx * math.sqrt(max(0.0, 1 - ((spring - yy) / ry) ** 2)))
        layer.rect(cx - half, yy, cx + half, yy, C("#e4c99b"))
    # brass spring band and a flat apex cap, no finial
    layer.rect(x0, spring - 1, x1, spring + 1, C("#e4a73f"))
    layer.rect(cx - 3, CONS_APEX, cx + 3, CONS_APEX + 1, C("#f7c85f"))
    # the hero fall's mouth: a small brass spillway cistern on the right
    # shoulder, bracketed to the dome.  It is a gutter, not a tower.
    layer.rect(230, 366, 258, 376, C(CREAM[1]))
    layer.rect(230, 366, 258, 367, C(CREAM[0]))
    layer.rect(232, 368, 256, 370, C("#96e8dc"))
    layer.rect(233, 369, 255, 369, C("#c8f7ec"))
    layer.rect(236, 373, 256, 376, C("#e4a73f"))
    layer.rect(238, 374, 254, 374, C("#ffe08a"))
    layer.rect(240, 376, 246, 404, C(CREAM[2]))
    layer.rect(240, 376, 241, 404, C(CREAM[1]))
    # a low roof garden on the left shoulder, two clumps only
    for gx, gw in ((x0 + 34, 30), (x0 + 92, 24)):
        bush(layer, gx, spring - 2, gw, 11, 7 + gx, flowers=False)


def bush(layer: Layer, cx, base_y, w, h, seed, flowers=False):
    rng = random.Random(seed)
    layer.ellipse(cx - w // 2, base_y - h, cx + w // 2, base_y, fill=C("#478a58"))
    for i in range(4):
        ox = rng.randint(-w // 3, w // 3)
        ry = rng.randint(3, max(4, h // 2))
        layer.ellipse(cx + ox - ry, base_y - h // 2 - ry, cx + ox + ry, base_y - 2, fill=C("#68a963"))
        layer.ellipse(cx + ox - ry + 1, base_y - h // 2 - ry, cx + ox + 1, base_y - 3, fill=C("#8dc46f"))
    if flowers:
        for i in range(3):
            layer.point(cx + rng.randint(-w // 2, w // 2), base_y - rng.randint(3, h), C("#f49bb8"))


def aqueduct(layer: Layer):
    x0, x1 = DECK_X0, DECK_X1
    stone = C(CREAM[1])
    light = C(CREAM[0])
    shade = C(CREAM[2])
    deep = C("#b98f61")
    # deck body and channel
    layer.rect(x0, DECK_Y, x1, DECK_Y + 11, stone)
    layer.rect(x0, DECK_Y, x1, DECK_Y + 1, light)
    layer.rect(x0, DECK_Y + 2, x1, DECK_Y + 3, C("#96e8dc"))
    layer.rect(x0, DECK_Y + 4, x1, DECK_Y + 4, C("#c8f7ec"))
    layer.rect(x0, DECK_Y + 8, x1, DECK_Y + 8, C("#f7c85f"))
    layer.rect(x0, DECK_Y + 10, x1, DECK_Y + 10, shade)
    for x in range(x0 + 18, x1, 66):
        layer.rect(x, DECK_Y + 5, x, DECK_Y + 7, C("#e4c99b"))
        if x % 3 == 0:
            layer.point(x + 3, DECK_Y + 3, C("#effff4"))
    # piers and arches.  The arches are large and empty; the far layer shows
    # through them as a cool band.
    piers = [300, 464, 628, 792, 900]
    for i, px in enumerate(piers):
        layer.rect(px - 9, DECK_Y + 12, px + 9, WATER_Y - 1, stone)
        layer.rect(px - 9, DECK_Y + 12, px - 6, WATER_Y - 1, light)
        layer.rect(px + 6, DECK_Y + 12, px + 9, WATER_Y - 1, shade)
        layer.rect(px - 11, 494, px + 11, WATER_Y - 1, C(CREAM[2]))
        layer.rect(px - 11, 494, px + 11, 495, C(CREAM[1]))
    spans = [(300, 464), (464, 628), (628, 792), (792, 900)]
    for a, b in spans:
        arch(layer, a + 9, b - 9, DECK_Y + 12, WATER_Y, 38, stone, shade, deep)
    # The deck simply emerges from behind the conservatory.  The hero fall is
    # the conservatory's own spillway, drawn above this deck.
    layer.rect(x0, DECK_Y + 12, 300 - 9, DECK_Y + 15, shade)


def arch(layer: Layer, x0, x1, top, spring, depth, stone, shade, deep):
    cx = (x0 + x1) // 2
    rx = max(1, (x1 - x0) // 2)
    for x in range(x0, x1 + 1):
        u = (x - cx) / rx
        y = spring - int(depth * math.sqrt(max(0.0, 1 - u * u)))
        if y - 1 >= top:
            layer.rect(x, top, x, y - 1, stone)
        layer.point(x, y, shade)
        layer.point(x, y - 1, stone)
    # keystone and a single shadow under the deck
    kx = cx
    ky = spring - depth
    layer.rect(kx - 2, ky - 4, kx + 2, ky + 3, C(CREAM[2]))
    layer.rect(kx - 1, ky - 3, kx + 1, ky + 2, C("#f7c85f"))
    layer.rect(x0, top, x1, top + 1, C("#d2b07c"))


def big_tree(layer: Layer):
    cx = TREE_X
    base = 420
    # Roots first: five low flares, not a straight pole.  The trunk forks at
    # y=360 and the limbs enter the crown; the fork is what stops the tree
    # reading as a lollipop.
    for dx, dy in ((-42, 2), (-27, 0), (27, 1), (43, 3)):
        layer.polygon(
            [(cx + dx // 4, base - 16), (cx + dx, base - 1 + dy), (cx + dx - 3, base + 1), (cx + dx // 3, base - 4)],
            C("#9b6a50"),
        )
    layer.polygon(
        [(cx - 9, 340), (cx + 10, 340), (cx + 18, 404), (cx + 13, base), (cx - 15, base), (cx - 19, 404)],
        C("#9b6a50"),
    )
    layer.polygon(
        [(cx - 9, 340), (cx - 1, 340), (cx + 1, 404), (cx - 9, base), (cx - 14, base)],
        C("#b9855e"),
    )
    layer.rect(cx + 8, 348, cx + 12, 404, C("#7f5446"))
    layer.rect(cx + 12, 404, cx + 15, 416, C("#7f5446"))
    # three bark strokes only
    layer.line([(cx - 7, 352), (cx - 5, 392)], C("#7f5446"))
    layer.line([(cx + 2, 356), (cx + 1, 404)], C("#7f5446"))
    layer.line([(cx - 10, 386), (cx - 9, 408)], C("#7f5446"))
    # the fork at y=300, with three limbs entering the high crown
    layer.line([(cx - 2, 342), (cx - 26, 312), (cx - 38, 292)], C("#9b6a50"), width=9)
    layer.line([(cx + 2, 342), (cx + 28, 314), (cx + 40, 294)], C("#9b6a50"), width=9)
    layer.line([(cx, 340), (cx + 4, 292)], C("#7f5446"), width=6)
    layer.line([(cx - 24, 316), (cx - 44, 300)], C("#7f5446"), width=3)
    layer.line([(cx + 26, 316), (cx + 46, 300)], C("#7f5446"), width=3)

    canopy(layer, cx, 90, 370, 210, 5)
    # four vines, not eight, and they stop well above the deck
    for i, (vx, ln) in enumerate(((cx - 122, 28), (cx - 62, 20), (cx + 34, 30), (cx + 120, 34))):
        vine(layer, vx, 300, ln, i)
    # sparse blossom: five pink pixels total
    for bx, by in ((cx - 144, 174), (cx - 130, 184), (cx - 118, 178), (cx + 108, 166), (cx + 126, 178)):
        layer.point(bx, by, C("#f49bb8"))


def canopy(layer: Layer, cx, top, width, height, seed):
    w, h = width, height
    pad = 22
    pw, ph = w + pad * 2, h + pad * 2
    yy, xx = np.mgrid[0:ph, 0:pw]
    # Three crown masses and two low skirts, plus a pair of top puffs.  The
    # silhouette is the whole design; internal bubbles would turn it into
    # broccoli.
    spec = [
        (0.21, 0.58, 0.20, 0.27),
        (0.46, 0.37, 0.23, 0.33),
        (0.74, 0.50, 0.21, 0.28),
        (0.31, 0.79, 0.20, 0.17),
        (0.66, 0.81, 0.21, 0.16),
        (0.33, 0.24, 0.12, 0.14),
        (0.62, 0.22, 0.11, 0.13),
    ]
    union = np.zeros((ph, pw), bool)
    for fx, fy, frx, fry in spec:
        ex = pad + w * fx
        ey = pad + h * fy
        union |= ell_mask(pw, ph, ex, ey, w * frx, h * fry)
    # a few torn tips
    rng = random.Random(seed)
    for _ in range(14):
        ang = rng.uniform(0, 2 * math.pi)
        ex = pad + w * (0.5 + 0.48 * math.cos(ang))
        ey = pad + h * (0.52 + 0.46 * math.sin(ang))
        r = rng.uniform(2.5, 5.0)
        union |= ell_mask(pw, ph, ex, ey, r, r)

    arr = np.zeros((ph, pw, 4), dtype=np.uint8)
    arr[union] = C("#68a963")
    ys = np.arange(ph)[:, None]
    topy = np.where(union, ys, ph + 10).min(axis=0)
    boty = np.where(union, ys, -10).max(axis=0)
    tt = np.arange(ph)[:, None] - topy[None, :]
    bb = boty[None, :] - np.arange(ph)[:, None]
    # Three broad, rounded lit masses, one for each crown, and one soft shade
    # under the lower right.  One giant oval reads as a leaf; three read as
    # foliage catching the sun.
    for fx, fy, frx, fry in ((0.27, 0.32, 0.32, 0.36), (0.54, 0.22, 0.26, 0.28), (0.73, 0.38, 0.22, 0.24)):
        dl = ((xx - (pad + w * fx)) / (w * frx)) ** 2 + ((yy - (pad + h * fy)) / (h * fry)) ** 2
        arr[union & (dl < 0.80)] = C("#8dc46f")
        arr[union & (dl >= 0.80) & (dl < 1.03) & bayer_mask(ph, pw, 0.52, 2, 5)] = C("#8dc46f")
    ds = ((xx - (pad + w * 0.70)) / (w * 0.55)) ** 2 + ((yy - (pad + h * 0.94)) / (h * 0.17)) ** 2
    arr[union & (ds < 0.86)] = C("#478a58")
    arr[union & (ds < 0.62) & bayer_mask(ph, pw, 0.42, 4, 3)] = C("#2f6c4d")
    # a soft shadow under the two top puffs
    arr[union & (yy > pad + h * 0.38) & (yy < pad + h * 0.52) & bayer_mask(ph, pw, 0.10, 3, 1)] = C("#478a58")
    # top rim and ragged bottom
    arr[union & (tt == 0)] = C("#b7d879")
    arr[union & (tt >= 1) & (tt <= 3)] = C("#8dc46f")
    arr[union & (bb == 0)] = C("#2f6c4d")
    arr[union & (bb >= 1) & (bb <= 3)] = C("#478a58")
    # a handful of bright leaf tips, 1px each
    arr[union & bayer_mask(ph, pw, 0.003, 7, 2)] = C("#b7d879")
    arr[union & bayer_mask(ph, pw, 0.0012, 3, 6)] = C("#d7e98c")
    arr[union & bayer_mask(ph, pw, 0.0025, 5, 4)] = C("#478a58")

    # Crop to the actual crown and hang it from `top`, centred on the trunk.
    ys_i, xs_i = np.where(union)
    x0, x1 = int(xs_i.min()), int(xs_i.max())
    y0, y1 = int(ys_i.min()), int(ys_i.max())
    crown = patch_from(arr).crop((x0, y0, x1 + 1, y1 + 1))
    layer.paste(crown, cx - crown.width // 2, top)


def vine(layer: Layer, x, y, length, seed):
    rng = random.Random(seed + 90)
    for i in range(length):
        layer.point(x + int(math.sin(i * 0.4) * 2), y + i, C("#478a58"))
        if i % 6 == 3:
            layer.point(x + 2 + int(math.sin(i * 0.4) * 2), y + i, C("#68a963"))
    layer.point(x, y + length, C("#8dc46f"))


def high_viaduct(layer: Layer):
    stone = C(CREAM[1])
    light = C(CREAM[0])
    shade = C(CREAM[2])
    deep = C("#b98f61")
    # three flat water stairs between the low terrace and the high bridge
    stairs = [(STEP_X0, 920, 398), (920, 932, 372), (932, HIGH_X0 + 4, 346)]
    for x0, x1, top in stairs:
        layer.rect(x0, top, x1 - 1, WATER_Y - 1, stone)
        layer.rect(x0, top, x1 - 1, top + 1, light)
        layer.rect(x0, top + 2, x1 - 1, top + 3, C("#96e8dc"))
        layer.rect(x0, top + 6, x1 - 1, top + 6, C("#f7c85f"))
        layer.rect(x1 - 3, top, x1 - 1, WATER_Y - 1, shade)
    # high deck
    layer.rect(HIGH_X0, HIGH_Y, HIGH_X1, HIGH_Y + 13, stone)
    layer.rect(HIGH_X0, HIGH_Y, HIGH_X1, HIGH_Y + 1, light)
    layer.rect(HIGH_X0, HIGH_Y + 2, HIGH_X1, HIGH_Y + 3, C("#96e8dc"))
    layer.rect(HIGH_X0, HIGH_Y + 9, HIGH_X1, HIGH_Y + 9, C("#f7c85f"))
    layer.rect(HIGH_X0, HIGH_Y + 12, HIGH_X1, HIGH_Y + 12, shade)
    # tall, broad arches.  The deck is a bridge, never a tower.
    piers = [990, 1080, 1170, 1240]
    for px in piers:
        layer.rect(px - 10, HIGH_Y + 14, px + 10, WATER_Y - 1, stone)
        layer.rect(px - 10, HIGH_Y + 14, px - 7, WATER_Y - 1, light)
        layer.rect(px + 7, HIGH_Y + 14, px + 10, WATER_Y - 1, shade)
        layer.rect(px - 12, 494, px + 12, WATER_Y - 1, C(CREAM[2]))
    for a, b in ((1000, 1070), (1090, 1160)):
        arch(layer, a, b, HIGH_Y + 14, WATER_Y, 108, stone, shade, deep)
    # the open mouth at the left end of the high deck, with a brass spout
    layer.rect(HIGH_X0, HIGH_Y + 14, 980, HIGH_Y + 18, shade)
    layer.rect(960, HIGH_Y + 3, 1014, HIGH_Y + 7, C("#e4a73f"))
    layer.rect(962, HIGH_Y + 4, 1012, HIGH_Y + 5, C("#ffe08a"))
    layer.rect(962, HIGH_Y + 8, 1012, HIGH_Y + 10, C("#c9852f"))
    # a low abutment where the bridge lands
    layer.rect(HIGH_X1, 400, HIGH_X1 + 58, WATER_Y - 1, stone)
    layer.rect(HIGH_X1, 400, HIGH_X1 + 58, 401, light)
    layer.rect(HIGH_X1, 402, HIGH_X1 + 58, 403, C("#96e8dc"))
    layer.rect(HIGH_X1 + 55, 400, HIGH_X1 + 58, WATER_Y - 1, shade)
    layer.rect(HIGH_X1 + 8, 420, HIGH_X1 + 50, 421, C("#e4c99b"))


def deck_plants(layer: Layer):
    # The tree's planter anchors the trunk.  Two small clumps break the long
    # horizontal at wide intervals; three read as decoration, two as growth.
    layer.rect(600, DECK_Y - 3, 780, DECK_Y, C(CREAM[2]))
    layer.rect(602, DECK_Y - 2, 778, DECK_Y - 2, C("#478a58"))
    for gx, gw, seed in ((626, 20, 4), (676, 24, 5), (732, 18, 6), (764, 14, 7)):
        bush(layer, gx, DECK_Y - 1, gw, 9, seed, flowers=False)
    for gx, gw, seed in ((332, 22, 1), (846, 20, 3)):
        bush(layer, gx, DECK_Y - 1, gw, 11, seed, flowers=False)
        layer.rect(gx - gw // 2, DECK_Y - 2, gx + gw // 2, DECK_Y, C(CREAM[2]))
    vine(layer, 742, DECK_Y + 9, 24, 4)
    vine(layer, 818, DECK_Y + 9, 18, 5)


def waterline(layer: Layer):
    # The one hard horizontal.  It sits 68px above the arena floor, so it
    # never tangents the platform line at y=568.
    layer.rect(0, WATER_Y - 1, W - 1, WATER_Y - 1, C("#9b6a50"))
    layer.rect(0, WATER_Y, W - 1, WATER_Y, C("#e2b98c"))


# ---------------------------------------------------------------------------
# near layer


def draw_near() -> Layer:
    layer = Layer()
    water(layer)
    reeds(layer, 0, 44, 9)
    reeds(layer, 1556, 1600, 8)
    return layer


def water(layer: Layer):
    # Three broad bands.  The near layer is drawn at alpha 0.35 by the
    # manifest, so the canal reads as atmosphere and the boats/glints (drawn
    # above it) carry the crisp detail.
    layer.rect(0, WATER_Y, W - 1, WATER_Y, C("#effff4"))
    layer.rect(0, WATER_Y + 1, W - 1, 506, C("#c8f7ec"))
    layer.rect(0, 508, W - 1, 529, C("#96e8dc"))
    layer.rect(0, 530, W - 1, 547, C("#66d0cf"))
    layer.rect(0, 548, W - 1, 599, C("#2f8ba8"))
    dither_rect(layer, 0, 508, W, 514, "#c8f7ec", 0.35, 1)
    dither_rect(layer, 0, 526, W, 536, "#66d0cf", 0.30, 3)
    dither_rect(layer, 0, 544, W, 554, "#2f8ba8", 0.30, 5)
    # broad reflection smears, not a mirrored city
    for x0, x1, col, density in (
        (34, 238, "#effff4", 0.30),
        (78, 206, "#c8f7ec", 0.22),
        (540, 872, "#c8f7ec", 0.28),
        (600, 810, "#96e8dc", 0.18),
        (930, 1030, "#effff4", 0.34),
        (1188, 1250, "#c8f7ec", 0.16),
    ):
        dither_rect(layer, x0, 500, x1, 540, col, density, 2)
    # sparse horizontal glints; the movable glints are a separate strip
    rng = random.Random(77)
    for i in range(16):
        x = rng.randint(10, W - 40)
        y = rng.randint(505, 552)
        ln = rng.randint(5, 17)
        layer.rect(x, y, x + ln, y, C(rng.choice(["#effff4", "#c8f7ec"])))
    # foliage tint in the tree's reflection, three flecks only
    for x, y in ((632, 512), (704, 518), (778, 508)):
        layer.point(x, y, C("#b7d879"))


def reeds(layer: Layer, x0, x1, count):
    rng = random.Random(x0 + 13)
    for i in range(count):
        x = x0 + (i * (x1 - x0)) // count + rng.randint(-3, 3)
        top = rng.randint(505, 535)
        layer.line([(x, 568), (x + rng.randint(-2, 2), top)], C("#2f6c4d"))
        layer.line([(x, 540), (x + 5, 522)], C("#478a58"))
        layer.line([(x, 548), (x - 5, 532)], C("#478a58"))
        layer.rect(x - 1, top - 3, x + 1, top, C("#68a963"))
        layer.point(x, top - 4, C("#8dc46f"))


# ---------------------------------------------------------------------------
# falls strip


def draw_falls() -> Image.Image:
    strip = Image.new("RGBA", (FALL_W * 6, FALL_H), (0, 0, 0, 0))
    for f in range(6):
        frame = Image.new("RGBA", (FALL_W, FALL_H), (0, 0, 0, 0))
        d = ImageDraw.Draw(frame)
        rng = random.Random(900 + f)
        # the foam crown stays pinned to the mouth
        for x in range(8, 41):
            h = 2 + (x * 7 + f * 3) % 4
            d.rectangle((x, 0, x, h), fill=C("#effff4"))
        d.rectangle((6, 2, 42, 5), fill=C("#c8f7ec"))
        d.rectangle((10, 1, 38, 2), fill=C("#effff4"))
        # The body is a set of vertical streaks with broken foam.  The whole
        # pattern scrolls 5px per frame (a 30px repeat), so frame 5 -> 0 is the
        # same 5px step as every other frame.
        shift = f * 5
        for x in range(7, 42):
            base = ["#effff4", "#c8f7ec", "#96e8dc", "#66d0cf"][(x * 5 + f) % 4]
            for y in range(6, 148):
                band = (y + shift + x * 11) % 30
                if band < 3:
                    continue
                col = base
                if band < 7 and (x + f) % 2 == 0:
                    col = "#c8f7ec"
                if band > 25 and (x + f) % 3 == 0:
                    col = "#96e8dc"
                frame.putpixel((x, y), C(col))
        # a couple of solid bright threads
        for x in (14 + f % 3, 30 - f % 3):
            for y in range(6, 140):
                if (y + shift + x) % 23 >= 2:
                    frame.putpixel((x, y), C("#effff4"))
        # the fall loosens into mist before it reaches the water
        for y in range(120, 148):
            density = (y - 120) / 28 * 0.55
            for x in range(8, 41):
                if BAYER8[y % 8, x % 8] < density and (x + y + f) % 4 != 0:
                    frame.putpixel((x, y), C("#c8f7ec"))
        # mist: dithered puffs, fading out by row 188
        for i in range(8):
            mx = 8 + (i * 5 + f * 3) % 30
            my = 138 + (i * 7 + f * 2) % 22
            rx = 5 + (i * 3) % 6
            ry = 3 + (i * 2) % 4
            for yy in range(my - ry, my + ry + 1):
                for xx in range(mx - rx, mx + rx + 1):
                    if 0 <= xx < FALL_W and 140 <= yy < 188:
                        if ((xx - mx) / rx) ** 2 + ((yy - my) / ry) ** 2 <= 1:
                            if BAYER8[yy % 8, xx % 8] < 0.55:
                                frame.putpixel((xx, yy), C("#c8f7ec" if (xx + yy + f) % 3 else "#96e8dc"))
        # side spray at the mouth
        for i in range(5):
            sx = 5 + (i * 3 + f) % 6
            sy = 4 + (i * 4 + f * 2) % 18
            frame.putpixel((sx, sy), C("#effff4"))
            frame.putpixel((43 - i, sy + 2), C("#c8f7ec"))
        strip.alpha_composite(frame, (f * FALL_W, 0))
    return strip


# ---------------------------------------------------------------------------
# movers


def draw_birds() -> Image.Image:
    strip = Image.new("RGBA", (BIRD_W * 4, BIRD_H), (0, 0, 0, 0))
    poses = [
        [(1, 3), (2, 2), (3, 1), (5, 2), (6, 1), (7, 2), (8, 3), (10, 4)],
        [(1, 4), (2, 4), (3, 4), (4, 4), (5, 4), (6, 4), (7, 4), (8, 4), (9, 4), (10, 4)],
        [(1, 6), (2, 5), (3, 4), (4, 5), (5, 5), (6, 5), (7, 5), (8, 5), (9, 5), (10, 6)],
        [(1, 4), (2, 4), (3, 4), (4, 4), (5, 4), (6, 4), (7, 4), (8, 4), (9, 4), (10, 4)],
    ]
    for f, pts in enumerate(poses):
        frame = Image.new("RGBA", (BIRD_W, BIRD_H), (0, 0, 0, 0))
        d = ImageDraw.Draw(frame)
        for x, y in pts:
            d.point((x, y), fill=C(INK))
        d.rectangle((5, 4, 6, 5), fill=C(INK))
        if f in (0, 2):
            d.point((5, 3), fill=C("#4c4a72"))
        strip.alpha_composite(frame, (f * BIRD_W, 0))
    return strip


def draw_zeppelin() -> Image.Image:
    strip = Image.new("RGBA", (ZEPP_W * 2, ZEPP_H), (0, 0, 0, 0))
    for f in range(2):
        frame = Image.new("RGBA", (ZEPP_W, ZEPP_H), (0, 0, 0, 0))
        d = ImageDraw.Draw(frame)
        # envelope, cream and calm
        d.ellipse((5, 4, 59, 19), fill=C("#f3e0bb"))
        d.ellipse((6, 5, 57, 12), fill=C("#fff2d6"))
        d.ellipse((7, 13, 57, 18), fill=C("#e4c99b"))
        d.line((8, 17, 56, 17), fill=C("#d2b07c"))
        for x in (18, 30, 42):
            d.line((x, 6, x, 18), fill=C("#e4c99b"))
        # brass nose and teal tail
        d.ellipse((56, 9, 60, 14), fill=C("#f7c85f"))
        d.polygon([(8, 11), (2, 6), (3, 12), (8, 13)], fill=C("#66d0cf"))
        d.polygon([(8, 12), (2, 17), (3, 11)], fill=C("#42b2c2"))
        # gondola
        d.rectangle((21, 19, 42, 24), fill=C("#e4c99b"))
        d.rectangle((22, 20, 41, 21), fill=C("#fff2d6"))
        d.rectangle((21, 23, 42, 24), fill=C("#d2b07c"))
        for x in (26, 33, 40):
            d.point((x, 21), fill=C("#ffe08a"))
        d.line((24, 19, 26, 17), fill=C("#d2b07c"))
        d.line((39, 19, 37, 17), fill=C("#d2b07c"))
        # propeller: two frames of a slow spin
        if f == 0:
            d.line((3, 20, 3, 13), fill=C("#9b6a50"))
            d.point((4, 14), fill=C("#c9852f"))
        else:
            d.line((3, 20, 7, 16), fill=C("#9b6a50"))
            d.point((7, 16), fill=C("#c9852f"))
        strip.alpha_composite(frame, (f * ZEPP_W, 0))
    return strip


def draw_boats() -> Image.Image:
    strip = Image.new("RGBA", (BOAT_W * 2, BOAT_H), (0, 0, 0, 0))
    for f in range(2):
        frame = Image.new("RGBA", (BOAT_W, BOAT_H), (0, 0, 0, 0))
        d = ImageDraw.Draw(frame)
        # hull
        d.polygon([(3, 8), (28, 8), (25, 12), (6, 12)], fill=C("#f3e0bb"))
        d.line((4, 9, 27, 9), fill=C("#fff2d6"))
        d.line((6, 12, 25, 12), fill=C("#9b6a50"))
        d.rectangle((8, 7, 24, 8), fill=C("#e4a73f"))
        # canopy, a teal awning
        d.rectangle((11, 3, 21, 4), fill=C("#96e8dc"))
        d.rectangle((12, 4, 20, 6), fill=C("#42b2c2"))
        d.line((11, 4, 11, 8), fill=C("#c9852f"))
        d.line((21, 4, 21, 8), fill=C("#c9852f"))
        # one tiny figure at the stern
        d.rectangle((24, 4, 25, 7), fill=C(INK))
        d.point((25, 3), fill=C(INK))
        # oar
        if f == 0:
            d.line((8, 6, 1, 13), fill=C("#9b6a50"))
        else:
            d.line((8, 6, 2, 11), fill=C("#9b6a50"))
        # wake
        d.point((3, 13), fill=C("#c8f7ec"))
        d.point((5, 13), fill=C("#96e8dc"))
        strip.alpha_composite(frame, (f * BOAT_W, 0))
    return strip


def draw_glints() -> Image.Image:
    strip = Image.new("RGBA", (GLINT_W * 4, GLINT_H), (0, 0, 0, 0))
    base = [
        [(3, 3, 9), (18, 5, 7), (26, 2, 4)],
        [(5, 4, 11), (20, 2, 4), (1, 6, 3)],
        [(2, 2, 6), (13, 5, 12), (27, 3, 3)],
        [(6, 5, 8), (17, 3, 5), (25, 6, 5)],
    ]
    for f, dashes in enumerate(base):
        frame = Image.new("RGBA", (GLINT_W, GLINT_H), (0, 0, 0, 0))
        d = ImageDraw.Draw(frame)
        for i, (x, y, ln) in enumerate(dashes):
            col = ["#effff4", "#c8f7ec", "#96e8dc"][(i + f) % 3]
            d.rectangle((x, y, min(31, x + ln), y), fill=C(col))
            if (i + f) % 2 == 0:
                d.point((x + ln // 2, y - 1), fill=C("#effff4"))
        strip.alpha_composite(frame, (f * GLINT_W, 0))
    return strip


# ---------------------------------------------------------------------------
# composition / review


TIMING = {
    "sky": 0.015,
    "far": 0.06,
    "mid": 0.18,
    "falls": 0.18,
    "near": 0.50,
    "birds": 0.04,
    "zeppelin": 0.03,
    "boats": 0.50,
    "water": 0.50,
}
NEAR_ALPHA = 0.50
HAZE = 1.15

AMBIENT = {
    "loopMs": 400000,
    "groups": [
        {
            "layer": "birds",
            "actors": [
                {"u": 140, "v": 132, "speedX": 16, "bobAmp": 2.0, "bobFreq": 0.35, "phase": 0.0},
                {"u": 322, "v": 166, "speedX": 16, "bobAmp": 1.6, "bobFreq": 0.32, "phase": 0.9},
                {"u": 512, "v": 118, "speedX": 16, "bobAmp": 2.4, "bobFreq": 0.30, "phase": 1.8},
                {"u": 724, "v": 205, "speedX": 16, "bobAmp": 2.0, "bobFreq": 0.38, "phase": 2.6},
                {"u": 1110, "v": 150, "speedX": 16, "bobAmp": 2.2, "bobFreq": 0.33, "phase": 3.4},
                {"u": 1430, "v": 186, "speedX": 16, "bobAmp": 1.8, "bobFreq": 0.36, "phase": 4.2},
            ],
        },
        {
            "layer": "zeppelin",
            "actors": [
                {"u": 258, "v": 78, "speedX": 8, "bobAmp": 2.0, "bobFreq": 0.08, "phase": 0.4},
            ],
        },
        {
            "layer": "boats",
            "actors": [
                {"u": 210, "v": 518, "speedX": 4, "bobAmp": 1.2, "bobFreq": 0.18, "phase": 0.0},
                {"u": 930, "v": 530, "speedX": -4, "bobAmp": 1.0, "bobFreq": 0.15, "phase": 1.7, "flip": True},
            ],
        },
        {
            "layer": "water",
            "actors": [
                {"u": 88, "v": 508, "speedX": 0, "bobAmp": 0.8, "bobFreq": 0.16, "phase": 0.0},
                {"u": 286, "v": 534, "speedX": 0, "bobAmp": 0.6, "bobFreq": 0.13, "phase": 1.1},
                {"u": 470, "v": 548, "speedX": 0, "bobAmp": 0.9, "bobFreq": 0.18, "phase": 2.2},
                {"u": 668, "v": 516, "speedX": 0, "bobAmp": 0.7, "bobFreq": 0.15, "phase": 3.0},
                {"u": 1044, "v": 538, "speedX": 0, "bobAmp": 0.8, "bobFreq": 0.14, "phase": 4.1},
                {"u": 1320, "v": 522, "speedX": 0, "bobAmp": 0.6, "bobFreq": 0.17, "phase": 5.3},
            ],
        },
    ],
}

STRIPS = {
    "falls": (FALL_W, FALL_H, 6, 9),
    "birds": (BIRD_W, BIRD_H, 4, 6),
    "zeppelin": (ZEPP_W, ZEPP_H, 2, 4),
    "boats": (BOAT_W, BOAT_H, 2, 3),
    "water": (GLINT_W, GLINT_H, 4, 4),
}


def layer_alpha(img: Image.Image, alpha: float) -> Image.Image:
    out = img.copy()
    a = out.getchannel("A").point(lambda v: int(round(v * alpha)))
    out.putalpha(a)
    return out


def crop_wrap(img: Image.Image, off: int, width: int) -> Image.Image:
    off %= img.width
    if off + width <= img.width:
        return img.crop((off, 0, off + width, H))
    part = Image.new("RGBA", (width, H), (0, 0, 0, 0))
    part.alpha_composite(img.crop((off, 0, img.width, H)), (0, 0))
    part.alpha_composite(img.crop((0, 0, width - (img.width - off), H)), (img.width - off, 0))
    return part


def strip_frame(strip: Image.Image, name: str, frame: int) -> Image.Image:
    fw, fh, count, _ = STRIPS[name]
    frame %= count
    return strip.crop((frame * fw, 0, (frame + 1) * fw, fh))


def compose_full(layers, cam_x=0, width=800, t=0.0, with_haze=False):
    """Compose in manifest order: sky, far, mid, falls, near, movers."""
    view = Image.new("RGBA", (width, H), (0, 0, 0, 0))
    for name in ("sky", "far", "mid"):
        view.alpha_composite(crop_wrap(layers[name], int(cam_x * TIMING[name]), width), (0, 0))
    # falls
    fw, fh, count, _ = STRIPS["falls"]
    shift = int(cam_x * TIMING["falls"]) % W
    for u, v in FALL_ITEMS:
        sx = (u - shift) % W
        if sx >= width:
            continue
        img = strip_frame(layers["falls"], "falls", 3)
        if sx + fw > width:
            view.alpha_composite(img.crop((0, 0, width - sx, fh)), (sx, v))
            view.alpha_composite(img.crop((width - sx, 0, fw, fh)), (0, v))
        else:
            view.alpha_composite(img, (sx, v))
    # near at its declared alpha
    view.alpha_composite(layer_alpha(crop_wrap(layers["near"], int(cam_x * TIMING["near"]), width), NEAR_ALPHA), (0, 0))
    # movers above near
    for name in ("birds", "zeppelin", "boats", "water"):
        fw, fh, count, fps = STRIPS[name]
        shift = int(cam_x * TIMING[name]) % W
        for group in AMBIENT["groups"]:
            if group["layer"] != name:
                continue
            for a in group["actors"]:
                sx = int((a["u"] + a["speedX"] * t - shift) % W)
                bob = a["bobAmp"] * math.sin(t * a["bobFreq"] * math.pi * 2 + a["phase"])
                y = int(a["v"] + bob)
                if sx >= width:
                    continue
                img = strip_frame(layers[name], name, int(t * fps) % count)
                if a.get("flip"):
                    img = img.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
                if sx + fw > width:
                    view.alpha_composite(img.crop((0, 0, width - sx, fh)), (sx, y))
                    view.alpha_composite(img.crop((width - sx, 0, fw, fh)), (0, y))
                else:
                    view.alpha_composite(img, (sx, y))
    if with_haze:
        view = apply_haze(view)
    return view


def apply_haze(view: Image.Image) -> Image.Image:
    """The runtime's pale screen haze and top scrim, for review only."""
    out = np.array(view.convert("RGBA")).astype(np.float32)
    bands = [
        (0, 130, 0.0), (130, 40, 0.03), (170, 40, 0.05), (210, 40, 0.07),
        (250, 40, 0.10), (290, 40, 0.14), (330, 40, 0.18), (370, 40, 0.23),
        (410, 40, 0.28), (450, 40, 0.34), (490, 40, 0.40), (530, 40, 0.44),
        (570, 30, 0.46),
    ]
    haze_col = np.array([200, 236, 228], dtype=np.float32)
    for y, h, a in bands:
        alpha = min(0.7, a * HAZE)
        if alpha <= 0:
            continue
        base = out[y : y + h, :, :3] / 255.0
        screen = 1.0 - (1.0 - base) * (1.0 - (haze_col / 255.0) * alpha)
        out[y : y + h, :, :3] = screen * 255.0
    scrim_col = np.array([7, 24, 35], dtype=np.float32)
    for y, h, a in (
        (0, 20, 0.16), (20, 20, 0.15), (40, 20, 0.14), (60, 20, 0.12),
        (80, 20, 0.10), (100, 20, 0.07), (120, 20, 0.04), (140, 20, 0.02),
    ):
        out[y : y + h, :, :3] = out[y : y + h, :, :3] * (1 - a) + scrim_col * a
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGBA")


def draw_micro_text(img, x, y, text, colour, scale=1):
    glyphs = {
        "0": ["111", "101", "101", "101", "111"],
        "1": ["010", "110", "010", "010", "111"],
        "8": ["111", "101", "111", "101", "111"],
        "C": ["111", "100", "100", "100", "111"],
        "A": ["010", "101", "111", "101", "101"],
        "M": ["101", "111", "111", "101", "101"],
        " ": ["000", "000", "000", "000", "000"],
    }
    for i, ch in enumerate(text.upper()):
        glyph = glyphs.get(ch, glyphs[" "])
        for gy, row in enumerate(glyph):
            for gx, bit in enumerate(row):
                if bit == "1":
                    for oy in range(scale):
                        for ox in range(scale):
                            px, py = x + (i * 4 + gx) * scale + ox, y + gy * scale + oy
                            if 0 <= px < img.width and 0 <= py < img.height:
                                img.putpixel((px, py), colour)


# ---------------------------------------------------------------------------
# output


def manifest():
    def version(name):
        return hashlib.sha256((OUT / name).read_bytes()).hexdigest()[:12]

    layers = [
        {
            "id": "sky",
            "type": "image",
            "src": "assets/skybox/stage/sky.png",
            "version": version("sky.png"),
            "factor": 0.015,
            "driftX": 0.35,
            "alpha": 1,
        },
        {
            "id": "far",
            "type": "image",
            "src": "assets/skybox/stage/far.png",
            "version": version("far.png"),
            "factor": 0.06,
        },
        {
            "id": "mid",
            "type": "image",
            "src": "assets/skybox/stage/mid.png",
            "version": version("mid.png"),
            "factor": 0.18,
        },
        {
            "id": "falls",
            "type": "strip",
            "src": "assets/skybox/stage/falls.png",
            "version": version("falls.png"),
            "factor": 0.18,
            "align": "mid",
            "frameW": FALL_W,
            "frameH": FALL_H,
            "frames": 6,
            "fps": 9,
            "items": [{"u": u, "v": v} for u, v in FALL_ITEMS],
        },
        {
            "id": "near",
            "type": "image",
            "src": "assets/skybox/stage/near.png",
            "version": version("near.png"),
            "factor": 0.50,
            # The canal and reeds frame the floor; at full strength they share
            # the fighter's value band.  0.35 is the starting readability
            # value, measured in review/readability.png.
            "alpha": NEAR_ALPHA,
        },
    ]
    for name in ("birds", "zeppelin", "boats", "water"):
        fw, fh, count, fps = STRIPS[name]
        layers.append(
            {
                "id": name,
                "type": "strip",
                "src": f"assets/skybox/stage/{name}.png",
                "version": version(f"{name}.png"),
                "factor": TIMING[name],
                "frameW": fw,
                "frameH": fh,
                "frames": count,
                "fps": fps,
                "alpha": 0.9 if name in ("birds", "zeppelin") else (0.8 if name == "water" else 1),
            }
        )
    return {
        "name": "stage",
        "title": "Solarpunk Stage — Quiet Terrace",
        "width": W,
        "height": H,
        "haze": HAZE,
        "ambient": AMBIENT,
        "layers": layers,
    }


def sanitize_transparency(im: Image.Image) -> Image.Image:
    a = np.array(im.convert("RGBA")).copy()
    m = a[..., 3] == 0
    a[m, 0], a[m, 1], a[m, 2] = PAL["#244f7d"]
    return Image.fromarray(a, "RGBA")


def verify_assets():
    expected = {
        "sky.png": (1600, 600),
        "far.png": (1600, 600),
        "mid.png": (1600, 600),
        "falls.png": (288, 240),
        "near.png": (1600, 600),
        "birds.png": (48, 8),
        "zeppelin.png": (128, 28),
        "boats.png": (64, 14),
        "water.png": (128, 8),
        "contact.png": (1600, 600),
        "preview-3screens.png": (2400, 600),
    }
    for name, (w, h) in expected.items():
        im = Image.open(OUT / name)
        assert im.size == (w, h), (name, im.size)
    # every pixel is palette RGB and alpha is binary
    allowed = set(PAL.values())
    for name in expected:
        if name in ("contact.png", "preview-3screens.png"):
            continue
        a = np.array(Image.open(OUT / name).convert("RGBA"))
        assert set(np.unique(a[..., 3])) <= {0, 255}, (name, np.unique(a[..., 3]))
        colours = {tuple(int(v) for v in px) for px in a[a[..., 3] > 0][::5, :3]}
        bad = colours - allowed
        assert not bad, (name, list(bad)[:8])
    # horizontal seam: the wrap pair should be no worse than a normal pair
    for name in ("sky.png", "far.png", "mid.png", "near.png"):
        a = np.array(Image.open(OUT / name).convert("RGBA")).astype(int)
        wrap = np.abs(a[:, 0] - a[:, -1]).mean()
        neigh = np.abs(a[:, 0] - a[:, 1]).mean()
        assert wrap <= max(6.0, neigh * 3.0 + 2.0), (name, wrap, neigh)
        print(f"seam {name}: wrap={wrap:.2f} neighbour={neigh:.2f}")
    # mover bounds and fall mouths
    for group in AMBIENT["groups"]:
        name = group["layer"]
        fw, fh, count, fps = STRIPS[name]
        for a in group["actors"]:
            assert 0 <= a["u"] < W, (name, a)
            assert 0 <= a["v"] and a["v"] + fh + abs(a["bobAmp"]) <= H, (name, a)
    for u, v in FALL_ITEMS:
        assert 0 <= u <= W - FALL_W and v + 180 <= H, (u, v)
    # manifest hashes
    m = json.loads((OUT / "manifest.json").read_text())
    for l in m["layers"]:
        path = ROOT / "public" / l["src"]
        assert path.exists(), path
        want = hashlib.sha256(path.read_bytes()).hexdigest()[:12]
        assert l["version"] == want, (l["id"], l["version"], want)
    print("verified dimensions, palette, alpha, seams, movers and hashes")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    REVIEW.mkdir(parents=True, exist_ok=True)

    sky = draw_sky()
    far = draw_far()
    mid = draw_mid()
    falls = draw_falls()
    near = draw_near()
    birds = draw_birds()
    zeppelin = draw_zeppelin()
    boats = draw_boats()
    glints = draw_glints()
    layers = {
        "sky": sky.img,
        "far": far.img,
        "mid": mid.img,
        "falls": falls,
        "near": near.img,
        "birds": birds,
        "zeppelin": zeppelin,
        "boats": boats,
        "water": glints,
    }

    # contact: raw layers, full panorama, t=0, near at its declared alpha
    contact = compose_full(layers, cam_x=0, width=W, t=0.0).convert("RGB")
    # preview: three camera stations, 800 px each
    panels = []
    for cam in (0, 800, 1600):
        panels.append(compose_full(layers, cam_x=cam, width=800, t=0.0))
    preview = Image.new("RGBA", (2400, H), (36, 79, 125, 255))
    for i, p in enumerate(panels):
        preview.alpha_composite(p, (i * 800, 0))
    for i in (1, 2):
        for y in range(H):
            preview.putpixel((i * 800, y), C("#e4a73f") if y % 3 == 0 else C("#a36428"))
    for i, cam in enumerate((0, 800, 1600)):
        draw_micro_text(preview, 8 + i * 800, 8, f"CAM {cam if cam else 0}", C("#fff2d6"), 2)

    sky.img.save(OUT / "sky.png")
    sanitize_transparency(far.img).save(OUT / "far.png")
    sanitize_transparency(mid.img).save(OUT / "mid.png")
    sanitize_transparency(falls).save(OUT / "falls.png")
    sanitize_transparency(near.img).save(OUT / "near.png")
    sanitize_transparency(birds).save(OUT / "birds.png")
    sanitize_transparency(zeppelin).save(OUT / "zeppelin.png")
    sanitize_transparency(boats).save(OUT / "boats.png")
    sanitize_transparency(glints).save(OUT / "water.png")
    contact.save(OUT / "contact.png")
    preview.convert("RGB").save(OUT / "preview-3screens.png")

    # review artefacts, never loaded by the game
    compose_full(layers, cam_x=0, width=800, t=0.0, with_haze=True).convert("RGB").save(REVIEW / "hero-haze.png")
    compose_full(layers, cam_x=0, width=1600, t=0.0, with_haze=True).convert("RGB").save(REVIEW / "contact-haze.png")
    # double tile: the only honest seam review
    tiled = Image.new("RGBA", (W * 2, H), (0, 0, 0, 0))
    tiled.alpha_composite(contact.convert("RGBA"), (0, 0))
    tiled.alpha_composite(contact.convert("RGBA"), (W, 0))
    tiled.convert("RGB").save(REVIEW / "tiled-2x.png")

    # the arena on top of the backdrop: the only way to judge tangencies and
    # the fighter/background value separation without booting the game
    arena = compose_full(layers, cam_x=0, width=800, t=0.0, with_haze=True).convert("RGBA")
    ad = ImageDraw.Draw(arena)
    platforms = [
        (0, 568, 800, 32), (90, 450, 130, 24), (580, 450, 130, 24),
        (330, 360, 140, 24), (60, 250, 120, 24), (620, 250, 120, 24),
        (350, 170, 100, 24), (280, 468, 24, 100), (496, 468, 24, 100),
    ]
    for x, y, w, h in platforms:
        ad.rectangle((x, y, x + w - 1, y + h - 1), fill=(47, 108, 77, 255))
        ad.rectangle((x, y, x + w - 1, y + 1), fill=(104, 169, 99, 255))
        ad.rectangle((x, y, x + w - 1, y), fill=(35, 83, 66, 255))
    for fx, fy in ((196, 520), (612, 520), (360, 312), (645, 200), (100, 400)):
        ad.rectangle((fx, fy, fx + 31, fy + 47), fill=(59, 57, 94, 255))
        ad.rectangle((fx, fy, fx + 31, fy + 1), fill=(76, 74, 114, 255))
    arena.convert("RGB").save(REVIEW / "platforms.png")

    (OUT / "manifest.json").write_text(json.dumps(manifest(), indent=2) + "\n")
    notes = HERE / "NOTES.md"
    if notes.exists():
        (OUT / "NOTES.md").write_text(notes.read_text())

    verify_assets()
    print(f"wrote {OUT} ({len(USED)} palette colours used)")


if __name__ == "__main__":
    main()
