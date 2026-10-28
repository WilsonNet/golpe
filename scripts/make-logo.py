#!/usr/bin/env python3
"""The golpe solarpunk pixel logo.

Drawn as a 160 x 70 pixel grid and exported at 4x and 8x with nearest-neighbour
scaling, so every edge stays on a pixel. The palette is the Waterfront's
(`art/skybox/palette.json`): cream stone, brass sun, teal water, and the greens
of the aqueduct gardens. No pure black and no pure white.

    .venv/bin/python scripts/make-logo.py

Outputs:
    public/assets/logo.png                      640 x 280, the menu's asset
    art/logo/golpe-solarpunk.png                640 x 280
    art/logo/golpe-solarpunk@2x.png             1280 x 560
    art/logo/preview-waterfront.png             1280 x 720, on the skybox
    art/logo/preview-menu.png                   1280 x 720, on the menu gradient
"""

from __future__ import annotations

import json
import math
from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
PALETTE = json.loads((ROOT / "art" / "skybox" / "palette.json").read_text())
ALLOWED = set(PALETTE["all"])

W, H = 160, 70
SCALE_WEB = 4
SCALE_MASTER = 8

# The palette groups this logo uses, named for the drawing code.
INK = "#22213a"
INK_SOFT = "#2d2b4b"
STONE_TOP = "#fff8e8"
STONE_LIGHT = "#fff2d6"
STONE = "#f3e0bb"
STONE_MID = "#e4c99b"
STONE_DARK = "#d2b07c"
STONE_EDGE = "#b98f61"
STONE_LINE = "#cfa074"
STONE_SHADOW = "#7f5446"
GOLD_TOP = "#fff3c9"
GOLD_LIGHT = "#ffe08a"
GOLD = "#f7c85f"
GOLD_DARK = "#e4a73f"
GOLD_EDGE = "#c9852f"
GOLD_SHADOW = "#a36428"
SUN_CORE = "#fff3c9"
SUN_LIGHT = "#ffe6a1"
SUN = "#ffd37a"
SUN_EDGE = "#f6b45b"
TEAL_LIGHT = "#96e8dc"
TEAL = "#42b2c2"
TEAL_MID = "#2f8ba8"
TEAL_DARK = "#2b6c8b"
GREEN_LIGHT = "#d7e98c"
GREEN = "#68a963"
GREEN_MID = "#478a58"
GREEN_DARK = "#235342"
PINK_LIGHT = "#ffd2e0"
PINK = "#f49bb8"
PINK_DARK = "#c94d7c"
MAUVE = "#72586e"

USED: set[str] = set()


def rgba(color: str) -> tuple[int, int, int, int]:
	if not color.startswith("#") or len(color) != 7:
		raise ValueError(f"not a palette hex: {color}")
	if color not in ALLOWED:
		raise ValueError(f"colour outside the Waterfront palette: {color}")
	USED.add(color)
	return (
		int(color[1:3], 16),
		int(color[3:5], 16),
		int(color[5:7], 16),
		255,
	)


img = Image.new("RGBA", (W, H), (0, 0, 0, 0))


def put(x: int, y: int, color: str) -> None:
	if 0 <= x < W and 0 <= y < H:
		img.putpixel((x, y), rgba(color))


def hline(x0: int, x1: int, y: int, color: str) -> None:
	for x in range(x0, x1 + 1):
		put(x, y, color)


def vline(x: int, y0: int, y1: int, color: str) -> None:
	for y in range(y0, y1 + 1):
		put(x, y, color)


def rect(x0: int, y0: int, x1: int, y1: int, color: str) -> None:
	for y in range(y0, y1 + 1):
		hline(x0, x1, y, color)


def circle(cx: int, cy: int, radius: int, color: str) -> None:
	for y in range(cy - radius, cy + radius + 1):
		for x in range(cx - radius, cx + radius + 1):
			if (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius:
				put(x, y, color)


def ring(cx: int, cy: int, radius: int, thickness: int, color: str) -> None:
	inner = radius - thickness
	for y in range(cy - radius, cy + radius + 1):
		for x in range(cx - radius, cx + radius + 1):
			d = (x - cx) ** 2 + (y - cy) ** 2
			if inner * inner < d <= radius * radius:
				put(x, y, color)


def ellipse_ring(
	cx: int, cy: int, rx: int, ry: int, color: str, front_only: bool = False
) -> None:
	for x in range(cx - rx, cx + rx + 1):
		t = (x - cx) / rx
		if abs(t) > 1:
			continue
		y = round(cy + ry * math.sqrt(max(0.0, 1 - t * t)))
		if front_only and x < cx:
			continue
		put(x, y, color)
		put(x, y + 1, color if x < cx else STONE_LINE)


def polyline(points: list[tuple[int, int]], color: str, radius: int) -> None:
	for (x0, y0), (x1, y1) in zip(points, points[1:]):
		steps = max(abs(x1 - x0), abs(y1 - y0), 1)
		for step in range(steps + 1):
			t = step / steps
			x = round(x0 + (x1 - x0) * t)
			y = round(y0 + (y1 - y0) * t)
			for dy in range(-radius, radius + 1):
				for dx in range(-radius, radius + 1):
					put(x + dx, y + dy, color)


def inside_round_rect(
	x: int, y: int, x0: int, y0: int, x1: int, y1: int, radius: int
) -> bool:
	if x < x0 or x > x1 or y < y0 or y > y1:
		return False
	cx = min(max(x, x0 + radius), x1 - radius)
	cy = min(max(y, y0 + radius), y1 - radius)
	return (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius


def leaf(cx: int, cy: int, direction: int, large: bool = False) -> None:
	"""A five-wide pixel leaf; the stem is the caller's vine."""
	w, h = (7, 4) if large else (6, 3)
	ox = cx - w // 2
	oy = cy - h // 2
	shape = [
		[(0, 1), (1, 0), (3, 0), (4, 1), (3, 2), (1, 2)],
		[(1, 1), (2, 0), (4, 0), (5, 1), (4, 2), (2, 2)],
		[(2, 1), (3, 0), (5, 0), (6, 1), (5, 2), (3, 2)],
	][:h]
	for dy, row in enumerate(shape):
		for dx, _ in row:
			x = ox + (dx if direction >= 0 else 5 - dx)
			put(x, oy + dy, GREEN_DARK)
	for dy, row in enumerate(shape):
		for dx, _ in row:
			x = ox + (dx if direction >= 0 else 5 - dx)
			if dy in (0, h - 1) or dx in (0, 5):
				continue
			put(x, oy + dy, GREEN if (dx + dy) % 3 else GREEN_LIGHT)
	# The midrib, one pixel along the long axis.
	x = ox + (2 if direction >= 0 else 3)
	for dy in range(1, h - 1):
		put(x, oy + dy, GREEN_MID)


def flower(cx: int, cy: int) -> None:
	for dx, dy in ((0, -1), (0, 1), (-1, 0), (1, 0)):
		put(cx + dx, cy + dy, PINK)
	put(cx - 1, cy - 1, PINK_LIGHT)
	put(cx + 1, cy - 1, PINK_LIGHT)
	put(cx, cy, GOLD_LIGHT)
	put(cx, cy - 2, PINK_DARK)


def bird(x: int, y: int) -> None:
	put(x, y, INK_SOFT)
	put(x + 1, y - 1, INK_SOFT)
	put(x + 2, y, INK_SOFT)


# ---------------------------------------------------------------------------
# Sky: the sun and the ringed planet. Drawn first, behind the word.

# Sun rays: twelve short dashes, deliberately broken so they read as a halo.
for angle in range(0, 360, 30):
	rad = math.radians(angle)
	for step in (14, 15, 16):
		x = round(63 + math.cos(rad) * step)
		y = round(31 + math.sin(rad) * step)
		if step == 15 and angle % 60 == 0:
			continue
		put(x, y, SUN_EDGE if angle % 60 else GOLD_EDGE)

ring(63, 31, 12, 1, SUN_EDGE)
circle(63, 31, 11, SUN)
circle(63, 31, 9, SUN_LIGHT)
circle(63, 31, 5, SUN_CORE)

# The ringed planet, upper left. The ring passes behind the disc and then in
# front of the lower half, the classic Saturn read at ten pixels.
ellipse_ring(12, 13, 10, 3, STONE)
circle(12, 13, 5, GOLD_SHADOW)
ring(12, 13, 5, 1, INK)
circle(11, 12, 3, GOLD)
put(10, 10, GOLD_LIGHT)
put(9, 10, GOLD_LIGHT)
ellipse_ring(12, 13, 10, 3, STONE, front_only=True)

bird(101, 11)
bird(110, 15)
bird(94, 19)

# ---------------------------------------------------------------------------
# The aqueduct gardens: vines and leaves behind the word.

polyline([(20, 53), (18, 47), (23, 41), (19, 35), (26, 30)], GREEN_DARK, 1)
polyline([(20, 53), (18, 47), (23, 41), (19, 35), (26, 30)], GREEN_MID, 0)
leaf(18, 45, -1)
leaf(22, 39, 1)
leaf(20, 33, -1)
leaf(25, 31, 1, large=True)

polyline([(140, 53), (143, 47), (137, 41), (145, 35), (140, 29)], GREEN_DARK, 1)
polyline([(140, 53), (143, 47), (137, 41), (145, 35), (140, 29)], GREEN_MID, 0)
leaf(143, 45, 1)
leaf(139, 38, -1)
leaf(144, 32, 1, large=True)
flower(146, 35)
flower(138, 42)

# ---------------------------------------------------------------------------
# The word. A custom 20-pixel lowercase face: g o l p e.

mask = bytearray(W * H)


def mput(x: int, y: int) -> None:
	if 0 <= x < W and 0 <= y < H:
		mask[y * W + x] = 255


def mclear(x: int, y: int) -> None:
	if 0 <= x < W and 0 <= y < H:
		mask[y * W + x] = 0


def mrect(x0: int, y0: int, x1: int, y1: int) -> None:
	for y in range(y0, y1 + 1):
		for x in range(x0, x1 + 1):
			mput(x, y)


def mring(x0: int, y0: int, x1: int, y1: int, radius: int, thickness: int) -> None:
	for y in range(y0, y1 + 1):
		for x in range(x0, x1 + 1):
			if inside_round_rect(x, y, x0, y0, x1, y1, radius) and not inside_round_rect(
				x, y, x0 + thickness, y0 + thickness, x1 - thickness, y1 - thickness,
				max(1, radius - thickness),
			):
				mput(x, y)


# g: bowl, right stem, and a descender that curls back up to the left. The
# rise is what keeps it a g rather than a 9 at this weight.
mring(29, 29, 48, 43, 4, 3)
mrect(45, 38, 48, 50)
mrect(41, 48, 48, 50)
mrect(36, 45, 41, 50)
mclear(36, 45)
mclear(37, 45)
mclear(36, 46)

# o: the sun's ring.
mring(53, 29, 72, 43, 4, 3)

# l: ascender with a small foot to the right.
mrect(81, 24, 84, 44)
mrect(82, 42, 87, 44)
mclear(87, 44)

# p: left stem and the bowl on its right.
mrect(91, 29, 94, 50)
mring(93, 29, 110, 43, 4, 3)
mclear(93, 29)
mclear(93, 30)

# e: top, middle, bottom bars, left stem, upper-right shoulder.
mrect(115, 29, 117, 43)
mrect(115, 29, 134, 31)
mrect(115, 35, 134, 37)
mrect(115, 41, 134, 43)
mrect(132, 29, 134, 37)
for x, y in ((115, 29), (134, 29), (115, 43), (134, 43), (115, 31), (115, 41)):
	mclear(x, y)

word_mask = Image.frombytes("L", (W, H), bytes(mask))
expanded = word_mask.filter(ImageFilter.MaxFilter(5))
shadow = expanded.copy()

# A low indigo shadow gives the cream a hold on a bright sky; it is deliberately
# offset down-right, the light source being the sun above the o.
shadow_img = Image.new("RGBA", (W, H), rgba(INK_SOFT))
img.paste(shadow_img, (3, 4), shadow)

outline_img = Image.new("RGBA", (W, H), rgba(INK))
img.paste(outline_img, (0, 0), expanded)

# The fill: cream stone, banded by height, with the o struck in brass.
for y in range(H):
	for x in range(W):
		if not mask[y * W + x]:
			continue
		is_o = 53 <= x <= 72 and 29 <= y <= 43
		if is_o:
			if y <= 31:
				color = GOLD_TOP
			elif y <= 35:
				color = GOLD_LIGHT
			elif y <= 39:
				color = GOLD
			elif y <= 42:
				color = GOLD_DARK
			else:
				color = GOLD_EDGE
			if y == 0 or not mask[(y - 1) * W + x]:
				color = GOLD_TOP
			elif y == H - 1 or not mask[(y + 1) * W + x]:
				color = GOLD_SHADOW
		else:
			if y <= 27:
				color = STONE_TOP
			elif y <= 32:
				color = STONE_LIGHT
			elif y <= 37:
				color = STONE
			elif y <= 42:
				color = STONE_MID
			elif y <= 47:
				color = STONE_DARK
			else:
				color = STONE_EDGE
			if y == 0 or not mask[(y - 1) * W + x]:
				color = STONE_TOP
			elif y == H - 1 or not mask[(y + 1) * W + x]:
				color = STONE_EDGE
		put(x, y, color)

# A single warm glint on the o: the sun is the focal point, not a flat ring.
for x, y in ((57, 31), (58, 31), (57, 32)):
	if mask[y * W + x]:
		put(x, y, GOLD_TOP)

# The sprout growing out of the l.
polyline([(84, 24), (86, 21), (89, 18)], GREEN_DARK, 1)
polyline([(84, 24), (86, 21), (89, 18)], GREEN_MID, 0)
leaf(88, 20, 1)
leaf(85, 18, -1)

# ---------------------------------------------------------------------------
# The aqueduct plinth and the water. Three arches, because the Waterfront's
# signature is a viaduct you can read at a glance, not a plank.

# Cornice: a two-pixel overhang with a dark keyline and a light top edge.
rect(11, 53, 149, 56, INK)
rect(12, 54, 148, 56, STONE_LIGHT)
hline(12, 148, 54, STONE_TOP)
hline(12, 148, 56, STONE_EDGE)
vline(12, 54, 56, STONE)
vline(148, 54, 56, STONE_DARK)

# The arcade wall. Piers: 14-20, 55-61, 95-101, 140-146.
rect(13, 57, 147, 65, INK)
rect(14, 57, 146, 65, STONE_MID)
hline(14, 146, 57, STONE_LIGHT)
hline(14, 146, 65, STONE_EDGE)
for x0, x1 in ((14, 20), (55, 61), (95, 101), (140, 146)):
	rect(x0, 57, x1, 65, STONE)
	vline(x0, 58, 64, STONE_LIGHT)
	vline(x1, 58, 64, STONE_DARK)
	hline(x0, x1, 58, STONE_LIGHT)
	hline(x0, x1, 64, STONE_EDGE)
	# A capital under the cornice and a plinth above the water.
	rect(x0 - 1, 56, x1 + 1, 57, STONE_DARK)
	rect(x0, 63, x1, 65, STONE_MID)
	put(x0 + 2, 60, STONE_LINE)
	put(x1 - 2, 61, STONE_LINE)

# Three segmental arch openings. The wall above each opening is the arch ring.
for x0, x1 in ((21, 54), (62, 94), (102, 139)):
	center = (x0 + x1) / 2
	half = (x1 - x0) / 2
	for x in range(x0, x1 + 1):
		t = (x - center) / half
		top = 58 + round(4 * t * t)
		put(x, top, STONE_SHADOW)
		for y in range(top + 1, 65):
			put(x, y, TEAL_DARK)
		put(x, 64, TEAL_MID)
		# Voussoirs: one block joint every five pixels, following the curve.
		if (x - x0) % 5 == 0 and top > 58:
			for y in range(57, top):
				put(x, y, STONE_LINE)

# Keystones: stone on the outer arches, the one brass note on the middle.
for cx in (37, 120):
	rect(cx, 57, cx + 2, 60, STONE_DARK)
	rect(cx + 1, 57, cx + 1, 59, STONE_LIGHT)
rect(77, 55, 80, 59, GOLD_SHADOW)
rect(78, 56, 79, 58, GOLD)
put(78, 56, GOLD_LIGHT)

# Water: a band, broken highlights, a lily, and reeds.
rect(8, 66, 152, 69, TEAL_MID)
hline(8, 152, 66, TEAL)
hline(8, 152, 67, TEAL_LIGHT)
hline(8, 152, 68, TEAL_DARK)
hline(8, 152, 69, TEAL_DARK)
for x0 in (12, 44, 72, 90, 104, 128):
	hline(x0, x0 + 11, 67, TEAL_LIGHT if x0 % 3 else TEAL)
	hline(x0 + 3, x0 + 7, 68, TEAL)

# A lily pad with its flower, and two reeds at the left pier.
rect(114, 67, 122, 69, GREEN_DARK)
rect(115, 67, 121, 68, GREEN)
hline(116, 120, 67, GREEN_LIGHT)
put(118, 69, TEAL_MID)
flower(120, 65)
vline(24, 63, 66, GREEN_DARK)
vline(25, 62, 66, GREEN_MID)
put(24, 62, GREEN_LIGHT)
vline(29, 63, 66, GREEN_DARK)
put(29, 62, GREEN)

# ---------------------------------------------------------------------------
# Exports.

web = img.resize((W * SCALE_WEB, H * SCALE_WEB), Image.Resampling.NEAREST)
master = img.resize((W * SCALE_MASTER, H * SCALE_MASTER), Image.Resampling.NEAREST)

art_dir = ROOT / "art" / "logo"
public = ROOT / "public" / "assets"
art_dir.mkdir(parents=True, exist_ok=True)
public.mkdir(parents=True, exist_ok=True)

web.save(public / "logo.png")
web.save(art_dir / "golpe-solarpunk.png")
master.save(art_dir / "golpe-solarpunk@2x.png")

# Preview on the Waterfront: the exact contact sheet the skybox generator leaves.
skybox = ROOT / "public" / "assets" / "skybox" / "hand" / "contact.png"
if skybox.exists():
	background = Image.open(skybox).convert("RGBA")
	crop = background.crop((160, 20, 160 + 1280, 20 + 560))
	crop.alpha_composite(master)
	crop.save(art_dir / "preview-waterfront.png")

# Preview on the menu's own deep-teal gradient.
menu = Image.new("RGBA", (1280, 720), (0, 0, 0, 255))
for y in range(720):
	t = y / 719
	r = round(16 + (5 - 16) * t)
	g = round(27 + (5 - 27) * t)
	b = round(36 + (7 - 36) * t)
	for x in range(1280):
		menu.putpixel((x, y), (r, g, b, 255))
menu.alpha_composite(master, (0, 80))
menu.save(art_dir / "preview-menu.png")

print("logo written:")
print(f"  {public / 'logo.png'}  {web.width}x{web.height}")
print(f"  {art_dir / 'golpe-solarpunk@2x.png'}  {master.width}x{master.height}")
print(f"  palette colours used: {len(USED)}")
