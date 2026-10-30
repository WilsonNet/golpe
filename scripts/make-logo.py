#!/usr/bin/env python3
"""The golpe badge: the solarpunk wordmark on a construction hoarding sign.

The wordmark is drawn as it always was — a 160 x 70 pixel scene with a custom
lowercase face, the sun behind the `o`, the aqueduct plinth and its water — but
it is now set into a **badge**: an ink keyline, a hazard-tape band, and a brass
rail with rivets at the corners. The scene sits on a plate, and the plate is
what makes the word readable, because a sign carries its own background.

Two variants, one geometry, so the wordmark never competes with the page it
stands on:

    ink     ink enamel plate, cream lettering, teal hazard   — the menu, and
            every light page
    cream   cream enamel plate, ink lettering, yellow hazard — a dark page that
            wants the sign to be the brightest thing on it

The palette is the Waterfront's (`art/skybox/palette.json`): cream stone, brass
sun, teal water, aqueduct gardens. No pure black and no pure white.

    .venv/bin/python scripts/make-logo.py

Outputs (each 704 x 344, a 4x export of a 176 x 86 grid, drawn at 352px so the
menu is an exact 2x):

    public/assets/logo.png                  the ink plate: the menu, light pages
    public/assets/logo-cream.png            the cream plate: dark pages
    src/ui/assets/logo.png                  the menu's hashed Vite import (ink)
    art/logo/golpe-badge-ink.png            704 x 344
    art/logo/golpe-badge-cream.png          704 x 344
    art/logo/golpe-badge@2x.png             1280 x 688
    art/logo/preview-menu.png               1280 x 720, on the menu gradient
    art/logo/preview-readme.png             1280 x 720, both themes at README size
    art/logo/preview-waterfront.png         1280 x 720, on the skybox
"""

from __future__ import annotations

import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
PALETTE = json.loads((ROOT / "art" / "skybox" / "palette.json").read_text())
ALLOWED = set(PALETTE["all"])

# The scene, then the frame around it.
SCENE_W, SCENE_H = 160, 70
FRAME = 8
W, H = SCENE_W + FRAME * 2, SCENE_H + FRAME * 2
SCALE_WEB = 4
SCALE_MASTER = 8

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

USED: set[str] = set()


def rgba(color: str) -> tuple[int, int, int, int]:
	if not color.startswith("#") or len(color) != 7:
		raise ValueError(f"not a palette hex: {color}")
	if color not in ALLOWED:
		raise ValueError(f"colour outside the Waterfront palette: {color}")
	USED.add(color)
	return (int(color[1:3], 16), int(color[3:5], 16), int(color[5:7], 16), 255)


# ---------------------------------------------------------------------------
# Variants. The plate and the lettering swap; the frame's hazard changes too, so
# the badge's edge is a bright band on a dark page and a dark band on a light one.

VARIANTS = {
	"ink": {
		# The default mark: the plate is the darkest ink, the lettering cream,
		# and the hazard tape in the game's own teal. It sits inside a dark menu
		# without out-shouting the buttons, and on a white page the ink plate is
		# what makes it a badge rather than floating text.
		"plate": INK,
		"plate_edge_dark": INK_SOFT,
		"plate_edge_light": INK_SOFT,
		"letter": None,  # the original cream bands, with their ink rim
		"letter_rim": INK,
		"letter_shadow": INK_SOFT,
		"sun_ring": SUN_EDGE,
		"sun_rays": GOLD_EDGE,
		"planet_ring": STONE,
		"hazard": TEAL,
		"rail": GOLD_DARK,
		"rail_top": GOLD_LIGHT,
		"rail_bottom": GOLD_SHADOW,
	},
	"cream": {
		# The variant for a dark page that wants the sign to be the brightest
		# thing on it: an enamel plate, ink lettering, and yellow hazard tape.
		# On a white page the plate would dissolve into the page, so that is the
		# one place it is not used.
		"plate": STONE,
		"plate_edge_dark": STONE_MID,
		"plate_edge_light": STONE_TOP,
		"letter": INK,
		"letter_rim": STONE,
		"letter_shadow": None,
		"sun_ring": INK,
		"sun_rays": GOLD_SHADOW,
		"planet_ring": STONE_EDGE,
		"hazard": GOLD,
		"rail": GOLD_DARK,
		"rail_top": GOLD_LIGHT,
		"rail_bottom": GOLD_SHADOW,
	},
}


# ---------------------------------------------------------------------------
# The scene. One image, 160 x 70, transparent where the plate shows through.

scene = Image.new("RGBA", (SCENE_W, SCENE_H), (0, 0, 0, 0))
pixels = scene.load()


def put(x: int, y: int, color: str) -> None:
	if 0 <= x < SCENE_W and 0 <= y < SCENE_H:
		pixels[x, y] = rgba(color)


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
# The word. A custom 20-pixel lowercase face: g o l p e.

mask = bytearray(SCENE_W * SCENE_H)


def mput(x: int, y: int) -> None:
	if 0 <= x < SCENE_W and 0 <= y < SCENE_H:
		mask[y * SCENE_W + x] = 255


def mclear(x: int, y: int) -> None:
	if 0 <= x < SCENE_W and 0 <= y < SCENE_H:
		mask[y * SCENE_W + x] = 0


def mrect(x0: int, y0: int, x1: int, y1: int) -> None:
	for y in range(y0, y1 + 1):
		for x in range(x0, x1 + 1):
			mput(x, y)


def mring(x0: int, y0: int, x1: int, y1: int, radius: int, thickness: int) -> None:
	for y in range(y0, y1 + 1):
		for x in range(x0, x1 + 1):
			if inside_round_rect(x, y, x0, y0, x1, y1, radius) and not (
				inside_round_rect(
					x, y,
					x0 + thickness, y0 + thickness,
					x1 - thickness, y1 - thickness,
					max(1, radius - thickness),
				)
			):
				mput(x, y)


# g: bowl, right stem, and a descender that curls back up to the left. The
# hook needs a counter of its own — a tail without one reads as a 9.
mring(29, 29, 48, 43, 4, 3)
mrect(45, 38, 48, 52)
mrect(38, 49, 48, 52)
mrect(34, 44, 37, 52)
mclear(34, 44)
mclear(35, 44)
mclear(34, 45)

# o: the sun's ring.
mring(53, 29, 72, 43, 4, 3)

# l: ascender with a small foot to the right.
mrect(78, 24, 81, 44)
mrect(79, 42, 84, 44)
mclear(84, 44)

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


def glyph_boxes() -> list[dict[str, int | str]]:
	"""The five letters as connected components, left to right.

	A letter that touches its neighbour is no longer a letter, so this doubles
	as the drawing's own gate: the word must have exactly five components, and
	the generator refuses to write a sheet where it does not.
	"""
	seen: set[tuple[int, int]] = set()
	boxes: list[tuple[int, int, int, int]] = []
	for y in range(SCENE_H):
		for x in range(SCENE_W):
			if not mask[y * SCENE_W + x] or (x, y) in seen:
				continue
			stack = [(x, y)]
			min_x = max_x = x
			min_y = max_y = y
			while stack:
				px, py = stack.pop()
				if (px, py) in seen:
					continue
				if not (0 <= px < SCENE_W and 0 <= py < SCENE_H):
					continue
				if not mask[py * SCENE_W + px]:
					continue
				seen.add((px, py))
				min_x, max_x = min(min_x, px), max(max_x, px)
				min_y, max_y = min(min_y, py), max(max_y, py)
				stack.extend(((px + 1, py), (px - 1, py), (px, py + 1), (px, py - 1)))
			boxes.append((min_x, min_y, max_x, max_y))
	boxes.sort()
	letters = "golpe"
	return [
		{
			"letter": letters[i],
			"x": x0,
			"y": y0,
			"w": x1 - x0 + 1,
			"h": y1 - y0 + 1,
		}
		for i, (x0, y0, x1, y1) in enumerate(boxes)
	]


GLYPHS = glyph_boxes()
if len(GLYPHS) != 5:
	raise SystemExit(f"the word broke into {len(GLYPHS)} pieces, not 5 letters")


def draw_scene(c: dict[str, str | None]) -> None:
	"""The wordmark scene on the current image, with the variant's palette."""
	# --- sky: the sun and the ringed planet, behind the word.
	for angle in range(0, 360, 30):
		rad = math.radians(angle)
		for step in (14, 15, 16):
			x = round(63 + math.cos(rad) * step)
			y = round(31 + math.sin(rad) * step)
			if step == 15 and angle % 60 == 0:
				continue
			put(x, y, c["sun_rays"] if angle % 60 else GOLD_EDGE)

	ring(63, 31, 12, 1, c["sun_rays"])
	circle(63, 31, 11, SUN)
	circle(63, 31, 9, SUN_LIGHT)
	circle(63, 31, 5, SUN_CORE)

	ellipse_ring(12, 13, 10, 3, c["planet_ring"])
	circle(12, 13, 5, GOLD_SHADOW)
	ring(12, 13, 5, 1, INK)
	circle(11, 12, 3, GOLD)
	put(10, 10, GOLD_LIGHT)
	put(9, 10, GOLD_LIGHT)
	ellipse_ring(12, 13, 10, 3, c["planet_ring"], front_only=True)

	bird(101, 11)
	bird(110, 15)
	bird(94, 19)

	# --- the aqueduct gardens: vines and leaves behind the word.
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

	# --- the word, with the shadow that gives the plate its depth.
	word_mask = Image.frombytes("L", (SCENE_W, SCENE_H), bytes(mask))
	expanded = word_mask.filter(ImageFilter.MaxFilter(5))
	if c["letter_shadow"] is not None:
		shadow_img = Image.new("RGBA", (SCENE_W, SCENE_H), rgba(c["letter_shadow"]))
		scene.paste(shadow_img, (3, 4), expanded)

	# On the dark plate the rim is what holds a cream letter together. On the
	# cream plate the letter itself is the ink, and a rim would only fatten it
	# until the counters closed.
	outline_img = Image.new("RGBA", (SCENE_W, SCENE_H), rgba(c["letter_rim"]))
	scene.paste(outline_img, (0, 0), expanded)

	# A counter is part of the letter, not a window: the o's hole must show the
	# plate, or the sun behind it turns the o into a brass-filled ring. Flood
	# the outside of the word, and everything the flood cannot reach is a
	# counter.
	outside = bytearray(SCENE_W * SCENE_H)
	stack = []
	for x in range(SCENE_W):
		stack.append((x, 0))
		stack.append((x, SCENE_H - 1))
	for y in range(SCENE_H):
		stack.append((0, y))
		stack.append((SCENE_W - 1, y))
	while stack:
		x, y = stack.pop()
		if not (0 <= x < SCENE_W and 0 <= y < SCENE_H):
			continue
		if outside[y * SCENE_W + x] or mask[y * SCENE_W + x]:
			continue
		outside[y * SCENE_W + x] = 255
		stack.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
	for y in range(SCENE_H):
		for x in range(SCENE_W):
			if not mask[y * SCENE_W + x] and not outside[y * SCENE_W + x]:
				put(x, y, c["plate"])

	for y in range(SCENE_H):
		for x in range(SCENE_W):
			if not mask[y * SCENE_W + x]:
				continue
			is_o = 53 <= x <= 72 and 29 <= y <= 43
			if c["letter"] is not None:
				put(x, y, c["letter"])
				continue
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
				if y == 0 or not mask[(y - 1) * SCENE_W + x]:
					color = GOLD_TOP
				elif y == SCENE_H - 1 or not mask[(y + 1) * SCENE_W + x]:
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
				if y == 0 or not mask[(y - 1) * SCENE_W + x]:
					color = STONE_TOP
				elif y == SCENE_H - 1 or not mask[(y + 1) * SCENE_W + x]:
					color = STONE_EDGE
			put(x, y, color)

	# A single warm glint on the o: the sun is the focal point, not a flat ring.
	for x, y in ((57, 31), (58, 31), (57, 32)):
		if mask[y * SCENE_W + x]:
			put(x, y, GOLD_TOP if c["letter"] is None else c["letter"])

	# The sprout growing out of the l.
	polyline([(84, 24), (86, 21), (89, 18)], GREEN_DARK, 1)
	polyline([(84, 24), (86, 21), (89, 18)], GREEN_MID, 0)
	leaf(88, 20, 1)
	leaf(85, 18, -1)

	# --- the aqueduct plinth and the water.
	rect(11, 53, 149, 56, INK)
	rect(12, 54, 148, 56, STONE_LIGHT)
	hline(12, 148, 54, STONE_TOP)
	hline(12, 148, 56, STONE_EDGE)
	vline(12, 54, 56, STONE)
	vline(148, 54, 56, STONE_DARK)

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
		rect(x0 - 1, 56, x1 + 1, 57, STONE_DARK)
		rect(x0, 63, x1, 65, STONE_MID)
		put(x0 + 2, 60, STONE_LINE)
		put(x1 - 2, 61, STONE_LINE)

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
			if (x - x0) % 5 == 0 and top > 58:
				for y in range(57, top):
					put(x, y, STONE_LINE)

	for cx in (37, 120):
		rect(cx, 57, cx + 2, 60, STONE_DARK)
		rect(cx + 1, 57, cx + 1, 59, STONE_LIGHT)
	rect(77, 55, 80, 59, GOLD_SHADOW)
	rect(78, 56, 79, 58, GOLD)
	put(78, 56, GOLD_LIGHT)

	rect(8, 66, 152, 69, TEAL_MID)
	hline(8, 152, 66, TEAL)
	hline(8, 152, 67, TEAL_LIGHT)
	hline(8, 152, 68, TEAL_DARK)
	hline(8, 152, 69, TEAL_DARK)
	for x0 in (12, 44, 72, 90, 104, 128):
		hline(x0, x0 + 11, 67, TEAL_LIGHT if x0 % 3 else TEAL)
		hline(x0 + 3, x0 + 7, 68, TEAL)

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
# The badge: keyline, hazard tape, brass rail, plate, rivets.

badge = Image.new("RGBA", (W, H), (0, 0, 0, 0))
bpix = badge.load()


def bput(x: int, y: int, color: str) -> None:
	if 0 <= x < W and 0 <= y < H:
		bpix[x, y] = rgba(color)


def brect(x0: int, y0: int, x1: int, y1: int, color: str) -> None:
	for y in range(y0, y1 + 1):
		for x in range(x0, x1 + 1):
			bput(x, y, color)


def bhline(x0: int, x1: int, y: int, color: str) -> None:
	brect(x0, y, x1, y, color)


def bvline(x: int, y0: int, y1: int, color: str) -> None:
	brect(x, y0, x, y1, color)


def draw_badge(c: dict[str, str | None]) -> Image:
	out = Image.new("RGBA", (W, H), (0, 0, 0, 0))
	global bpix
	bpix = out.load()

	# The silhouette and the hazard tape, on a 4px diagonal staircase.
	brect(0, 0, W - 1, H - 1, INK)
	for y in range(2, H - 2):
		for x in range(2, W - 2):
			bput(x, y, c["hazard"] if ((x + y) // 4) % 2 else INK)

	# The brass rail the plate is bolted into.
	brect(FRAME - 2, FRAME - 2, W - 1 - FRAME + 2, H - 1 - FRAME + 2, c["rail"])
	bhline(FRAME - 2, W - 1 - FRAME + 2, FRAME - 2, c["rail_top"])
	bvline(FRAME - 2, FRAME - 2, H - 1 - FRAME + 2, c["rail_top"])
	bhline(FRAME - 2, W - 1 - FRAME + 2, H - 1 - FRAME + 2, c["rail_bottom"])
	bvline(W - 1 - FRAME + 2, FRAME - 2, H - 1 - FRAME + 2, c["rail_bottom"])

	# The plate, then the scene on it.
	brect(FRAME, FRAME, W - 1 - FRAME, H - 1 - FRAME, c["plate"])
	global scene, pixels
	fresh = Image.new("RGBA", (SCENE_W, SCENE_H), (0, 0, 0, 0))
	scene = fresh
	pixels = fresh.load()
	draw_scene(c)
	out.alpha_composite(fresh, (FRAME, FRAME))

	# The enamel's inset: a dark lip on top and left, a lit edge below and
	# right, drawn over the scene's outermost pixels so it frames the plate.
	bhline(FRAME, W - 1 - FRAME, FRAME, c["plate_edge_dark"])
	bvline(FRAME, FRAME, H - 1 - FRAME, c["plate_edge_dark"])
	bhline(FRAME, W - 1 - FRAME, H - 1 - FRAME, c["plate_edge_light"])
	bvline(W - 1 - FRAME, FRAME, H - 1 - FRAME, c["plate_edge_light"])

	# Corner brackets: four steel angles holding the plate, each with its own
	# bolt. This is what makes the frame read as a hoarding sign rather than a
	# picture frame.
	inner_x1, inner_y1 = W - 1 - FRAME, H - 1 - FRAME
	for left, top in ((True, True), (False, True), (True, False), (False, False)):
		x0 = FRAME if left else inner_x1 - 8
		y0 = FRAME if top else inner_y1 - 8
		vx0, vx1 = (x0, x0 + 2) if left else (x0 + 6, x0 + 8)
		hy0, hy1 = (y0, y0 + 2) if top else (y0 + 6, y0 + 8)
		brect(x0, y0, x0 + 8, y0 + 8, c["rail_bottom"])
		brect(x0 + 1, y0 + 1, x0 + 7, y0 + 7, c["plate"])
		brect(vx0, y0, vx1, y0 + 8, c["rail"])
		brect(x0, hy0, x0 + 8, hy1, c["rail"])
		bvline(vx0 if left else vx1, y0, y0 + 8, c["rail_top"])
		bhline(x0, x0 + 8, hy0 if top else hy1, c["rail_top"])
		# The bolt sits in the angle, one pixel clear of both arms.
		bx, by = x0 + 4, y0 + 4
		brect(bx, by, bx + 2, by + 2, c["rail_bottom"])
		bput(bx, by, STONE_TOP)

	# Rivets on the hazard band's corners: the sign is assembled, not printed.
	for bx, by in ((3, 3), (W - 8, 3), (3, H - 8), (W - 8, H - 8)):
		brect(bx, by, bx + 4, by + 4, c["rail_bottom"])
		brect(bx + 1, by + 1, bx + 3, by + 3, c["rail_top"])
		bput(bx + 1, by + 1, STONE_TOP)

	return out


# ---------------------------------------------------------------------------
# Exports.

WEB_SIZE = (W * SCALE_WEB, H * SCALE_WEB)
MASTER_SIZE = (W * SCALE_MASTER, H * SCALE_MASTER)
art_dir = ROOT / "art" / "logo"
public = ROOT / "public" / "assets"
ui_assets = ROOT / "src" / "ui" / "assets"
for folder in (art_dir, public, ui_assets):
	folder.mkdir(parents=True, exist_ok=True)

badges = {name: draw_badge(spec) for name, spec in VARIANTS.items()}
web = {name: b.resize(WEB_SIZE, Image.Resampling.NEAREST) for name, b in badges.items()}
master = {
	name: b.resize(MASTER_SIZE, Image.Resampling.NEAREST) for name, b in badges.items()
}

web["ink"].save(public / "logo.png")
web["cream"].save(public / "logo-cream.png")
web["ink"].save(ui_assets / "logo.png")
web["ink"].save(art_dir / "golpe-badge-ink.png")
web["cream"].save(art_dir / "golpe-badge-cream.png")
master["ink"].save(art_dir / "golpe-badge@2x.png")

# The probe's manifest. It is generated, never hand-edited: the glyph boxes are
# the drawing's own connected components, so a letter that merges with its
# neighbour changes this file and `scripts/logo-probe.ts` fails on it.
word_x = min(g["x"] for g in GLYPHS)
word_y = min(g["y"] for g in GLYPHS)
word_x1 = max(g["x"] + g["w"] - 1 for g in GLYPHS)
word_y1 = max(g["y"] + g["h"] - 1 for g in GLYPHS)
manifest = {
	"note": "Generated by scripts/make-logo.py. Do not hand-edit.",
	"grid": {"w": W, "h": H, "scale": SCALE_WEB, "frame": FRAME},
	"word": {
		"x": word_x,
		"y": word_y,
		"w": word_x1 - word_x + 1,
		"h": word_y1 - word_y + 1,
	},
	"glyphs": GLYPHS,
	"display": {"width": WEB_SIZE[0] // 2},
	"variants": {
		"ink": {
			"file": "public/assets/logo.png",
			"plate": VARIANTS["ink"]["plate"],
			"backgrounds": ["#0b141b", "#ffffff"],
		},
		"cream": {
			"file": "public/assets/logo-cream.png",
			"plate": VARIANTS["cream"]["plate"],
			"backgrounds": ["#0b141b", "#0d1117"],
		},
	},
}
(art_dir / "badge.json").write_text(json.dumps(manifest, indent="\t") + "\n")


def menu_backdrop() -> Image.Image:
	"""The menu card's own deep-teal gradient, at 1280 x 720."""
	background = Image.new("RGBA", (1280, 720), (0, 0, 0, 255))
	draw = ImageDraw.Draw(background)
	for y in range(720):
		t = y / 719
		draw.line(
			[(0, y), (1279, y)],
			fill=(
				round(16 + (5 - 16) * t),
				round(27 + (5 - 27) * t),
				round(36 + (7 - 36) * t),
				255,
			),
		)
	return background


menu = menu_backdrop()
menu.alpha_composite(
	web["ink"],
	((1280 - WEB_SIZE[0]) // 2, (720 - WEB_SIZE[1]) // 2),
)
menu.save(art_dir / "preview-menu.png")

readme = Image.new("RGBA", (1280, 720), (0, 0, 0, 255))
readme_draw = ImageDraw.Draw(readme)
readme_draw.rectangle([0, 0, 1279, 359], fill=(255, 255, 255, 255))
readme_draw.rectangle([0, 360, 1279, 719], fill=(13, 17, 23, 255))
readme.alpha_composite(
	web["cream"], ((1280 - WEB_SIZE[0]) // 2, 360 + (360 - WEB_SIZE[1]) // 2)
)
readme.alpha_composite(web["ink"], ((1280 - WEB_SIZE[0]) // 2, (360 - WEB_SIZE[1]) // 2))
readme.save(art_dir / "preview-readme.png")

skybox = public / "skybox" / "hand" / "contact.png"
if skybox.exists():
	background = Image.open(skybox).convert("RGBA")
	crop = background.crop((160, 20, 160 + 1280, 20 + 640))
	crop.alpha_composite(
		web["ink"], ((1280 - WEB_SIZE[0]) // 2, (640 - WEB_SIZE[1]) // 2)
	)
	crop.save(art_dir / "preview-waterfront.png")

print("badge written:")
for name in VARIANTS:
	suffix = "" if name == "ink" else f"-{name}"
	print(f"  {name:6s} {WEB_SIZE[0]}x{WEB_SIZE[1]}  ->  public/assets/logo{suffix}.png")
print(f"  master {MASTER_SIZE[0]}x{MASTER_SIZE[1]}  art/logo/golpe-badge@2x.png")
print(f"  palette colours used: {len(USED)}")
