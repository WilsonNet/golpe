#!/usr/bin/env python3
"""
Compose Anands' shipped sprite sheets from the hand-drawn reference boards.

The artist's boards (`unprocessed-sprites/anands-running.jpeg`,
`anands-ultimate.jpeg`, `anands-misc.jpeg`) are *paintings*, not production
atlases: characters spill over their panels, text labels sit on the canvas,
and the beige background is a baked-in colour. This script removes the board
by colour (three tone families, each with its own tolerance: the beige
panels, the charcoal cell frames, the pale-gold grid lines), keeps only the
connected components that belong to the character, and normalises every frame
to a uniform standing height so the fighter reads the same size in every
stance.

The game's layout rules are per-hero — Anands is the hero whose sheets were
replaced by this art, and she gets her own cell geometry and her own clip
table (see `SHEET_CELLS` and `HERO_CLIPS` in the game):

- `anands.png` — 35 cells of 168x152: 0-3 run right, 4 face-on, 5-8 run left
  (mirrors), 9-10 idle profiles, 11-14 gun hold/fire, 15-18 gun run, 19-22
  dagger stab, 23-28 shoryuken, 29-32 thrust windup/dash, 33-34 damage.
  Every directional move is stored facing both ways, exactly like the walk
  cycle always has been.
- `anands-roll.png` — 16 cells of 168x152: the tumble, derived from the
  face-on frame by rotation, like `make-roll-art.py` does for the dude.
- `anands-dragon.png` — 6 cells of 352x176: the dragon-thrust ride, the
  ultimate's own art: the lunge into the dragon and the flight it carries.
- `anands-portrait.png` — 128x192: the face-on frame blown up for the hero
  select and the ultimate cinematic's portrait card.

The misc board's weapon poses (machine gun, shoryuken, dagger, damage) are
hand-picked by cell rect measured against the board; the frames that are not
used (victory, sleep, the map illustration, the contextual idles) are left in
`unprocessed-sprites/` for the artist.

Usage: python3 scripts/make-anands-art.py
"""

from PIL import Image
import os

SRC = "unprocessed-sprites"
OUT = "public/assets"

# ---------------------------------------------------------------------------
# The boards' cell rects, measured against the artwork (x0, y0, x1, y1).
# ---------------------------------------------------------------------------
CELLS: dict[str, dict[str, tuple[int, int, int, int]]] = {
    "running": {
        "idle_front": (180, 100, 250, 225),
        "idle_right": (790, 100, 875, 225),
        "run1": (180, 520, 270, 630),
        "run2": (385, 520, 475, 630),
        "run3": (585, 520, 680, 626),
        "run4": (785, 520, 880, 630),
    },
    "ultimate": {
        "attack4": (750, 525, 995, 635),
        "attack6": (445, 630, 710, 750),
        "fly2": (465, 775, 750, 875),
        "fly3": (750, 765, 995, 875),
        "fly4": (165, 885, 455, 995),
        "fly5": (440, 880, 735, 1000),
    },
	"misc": {
		# The gun row, re-measured against the board's own frames: the hold
		# figure stands at ~285-378, the firing figure (casings + muzzle
		# flash) at ~195-278, and the two run figures at ~665-755 and
		# ~765-855. The old rects straddled the board's cell boundaries and
		# cut every gun frame in half — two half-figures per cell, which the
		# move list's close-up preview is what finally made visible.
		"gun3": (296, 292, 372, 398),
		"gun4": (200, 292, 268, 398),
		"gun6": (672, 292, 748, 400),
		"gun7": (772, 292, 844, 400),
        "dagger2": (266, 410, 366, 513),
        "dagger3": (381, 410, 495, 513),
        "shoryu1": (150, 510, 250, 639),
        "shoryu2": (250, 510, 350, 639),
        "shoryu3": (350, 510, 450, 639),
        "thrust1": (662, 518, 745, 628),
        "thrust2": (763, 518, 882, 628),
        "damage1": (151, 748, 213, 854),
        "damage2": (292, 748, 382, 854),
    },
}

MARGIN = {"running": 18, "ultimate": 20, "misc": 14}

# ---------------------------------------------------------------------------
# Board removal: colour keying + connected components.
# ---------------------------------------------------------------------------

# The pale-gold grid lines and the charcoal cell frames, keyed with their own
# (tight) tolerances. The character's darkest outline is 70+ away from the
# charcoal and its pale skin 30+ away from the grid gold — safe.
PALE_LINE = [(182, 158, 120), (209, 173, 125)]
PALE_TOL = 26
CHARCOAL = (74, 74, 72)
CHARCOAL_TOL = 28
# The bottom-right map illustration's painted terrain: a gradient of tans and
# browns that defeats ring-derived keying (no single bin reaches the cutoff).
# The character's browns are 40+ away from every one of these.
MAP_TONES = [(192, 160, 112), (208, 160, 96), (128, 96, 48)]
MAP_TOL = 42


def dist(a, b):
    return max(abs(a[0] - b[0]), abs(a[1] - b[1]), abs(a[2] - b[2]))


def keyed_tolerance(colour):
    """A tone's own tolerance: tight for the frame tones, wide for beige."""
    if any(dist(colour, p) < PALE_TOL + 4 for p in PALE_LINE):
        return PALE_TOL
    if dist(colour, CHARCOAL) < CHARCOAL_TOL + 6:
        return CHARCOAL_TOL
    return 46


def is_map_tone(colour):
    return any(dist(colour, p) < MAP_TOL for p in MAP_TONES)


def bg_candidates(crop):
    """Every distinct colour cluster on the crop's border ring, with its
    tolerance. The ring samples whatever the cell sits on — beige panels,
    charcoal frames, gold lines — so the whole board dies by its own tone."""
    w, h = crop.size
    px = crop.load()
    hist = {}
    for x in range(w):
        for y in (0, h - 1):
            c = px[x, y]
            key = (c[0] // 6 * 6, c[1] // 6 * 6, c[2] // 6 * 6)
            hist[key] = hist.get(key, 0) + 1
    for y in range(h):
        for x in (0, w - 1):
            c = px[x, y]
            key = (c[0] // 6 * 6, c[1] // 6 * 6, c[2] // 6 * 6)
            hist[key] = hist.get(key, 0) + 1
    total = sum(hist.values())
    out = []
    for key, count in sorted(hist.items(), key=lambda kv: -kv[1]):
        if count < max(4, total * 0.02):
            break
        if all(dist(key, d) > 22 for d, _ in out):
            out.append((key, keyed_tolerance(key)))
    return out


def components_of(alpha):
    """Connected components (8-way) of the opaque pixels."""
    w, h = alpha.size
    a = alpha.point(lambda v: 255 if v > 40 else 0).convert("1")
    comps = []
    seen = set()
    for y in range(h):
        for x in range(w):
            if a.getpixel((x, y)) and (x, y) not in seen:
                stack = [(x, y)]
                pts = []
                while stack:
                    cx, cy = stack.pop()
                    if (cx, cy) in seen:
                        continue
                    seen.add((cx, cy))
                    pts.append((cx, cy))
                    for nx, ny in (
                        (cx - 1, cy), (cx + 1, cy), (cx, cy - 1), (cx, cy + 1),
                        (cx - 1, cy - 1), (cx + 1, cy - 1), (cx - 1, cy + 1), (cx + 1, cy + 1),
                    ):
                        if 0 <= nx < w and 0 <= ny < h and a.getpixel((nx, ny)) and (nx, ny) not in seen:
                            stack.append((nx, ny))
                if len(pts) >= 3:
                    comps.append(pts)
    return comps


def keep_character_components(rgba, comps):
    """Keep the largest component plus anything near it; drop the board's
    labels, frame fragments and specks. A fragment reaching the crop edge is
    a neighbouring cell's character — never keep it."""
    if not comps:
        return rgba
    w, h = rgba.size
    main = max(comps, key=len)
    main_x0 = min(p[0] for p in main)
    main_x1 = max(p[0] for p in main)
    main_y0 = min(p[1] for p in main)
    main_y1 = max(p[1] for p in main)

    def touches_border(c_x0, c_y0, c_x1, c_y1):
        return c_x0 <= 1 or c_y0 <= 1 or c_x1 >= w - 2 or c_y1 >= h - 2

    keep = {p for p in main}
    for comp in comps:
        if comp is main:
            continue
        c_x0 = min(p[0] for p in comp)
        c_x1 = max(p[0] for p in comp)
        c_y0 = min(p[1] for p in comp)
        c_y1 = max(p[1] for p in comp)
        if touches_border(c_x0, c_y0, c_x1, c_y1):
            continue
        near = not (
            c_x1 < main_x0 - 16 or c_x0 > main_x1 + 16
            or c_y1 < main_y0 - 16 or c_y0 > main_y1 + 16
        )
        big = len(comp) >= 80
        if near or big:
            keep |= set(comp)
    mask = Image.new("1", (w, h), 0)
    for p in keep:
        mask.putpixel(p, 1)
    rgba.putalpha(mask.convert("L"))
    return rgba


def extract(sheet, rect):
    """Cut one frame out of a board: crop, key the board's tones, drop the
    labels and specks, return the content-cropped transparent frame."""
    src = Image.open(f"{SRC}/anands-{sheet}.jpeg").convert("RGB")
    m = MARGIN[sheet]
    x0, y0, x1, y1 = rect
    x0 = max(0, x0 - m)
    y0 = max(0, y0 - m)
    x1 = min(src.width, x1 + m)
    y1 = min(src.height, y1 + m)
    crop = src.crop((x0, y0, x1, y1))
    cands = bg_candidates(crop)
    rgba = crop.convert("RGBA")
    px = rgba.load()
    w, h = rgba.size
    for yy in range(h):
        for xx in range(w):
            c = px[xx, yy][:3]
            if is_map_tone(c):
                px[xx, yy] = (c[0], c[1], c[2], 0)
                continue
            for bg, tol in cands:
                if dist(c, bg) < tol:
                    px[xx, yy] = (c[0], c[1], c[2], 0)
                    break
    rgba = keep_character_components(rgba, components_of(rgba.split()[3]))
    bbox = rgba.getbbox()
    if bbox is None:
        raise SystemExit(f"empty frame: {sheet} {rect}")
    return rgba.crop(bbox)


def mirrored(frame):
    return frame.transpose(Image.FLIP_LEFT_RIGHT)


# ---------------------------------------------------------------------------
# Normalisation and strip composition.
# ---------------------------------------------------------------------------

CHAR_H = 140        # every character frame stands this tall, in px
CELL_W, CELL_H = 168, 152
GROUND_LINE = CELL_H - 2

ROLL_CELL_W, ROLL_CELL_H = 168, 152
DRAGON_CELL_W, DRAGON_CELL_H = 352, 176
PORTRAIT_W, PORTRAIT_H = 128, 192


def normalise(frame):
    """Scale a frame to the standard standing height, preserving aspect, and
    place it bottom-aligned and centre-horizontally in the standard cell."""
    scale = CHAR_H / frame.height
    scaled = frame.resize(
        (max(1, round(frame.width * scale)), CHAR_H), Image.NEAREST
    )
    cell = Image.new("RGBA", (CELL_W, CELL_H), (0, 0, 0, 0))
    cell.alpha_composite(scaled, ((CELL_W - scaled.width) // 2, GROUND_LINE - CHAR_H))
    return cell


def build_character_strip():
    """The 37-cell sheet. Every directional move is stored facing both ways —
    the left cells are the right cells mirrored, exactly like the walk cycle's
    0-3/5-8 halves always have been."""
    run_r = [extract("running", CELLS["running"][f"run{i}"]) for i in range(1, 5)]
    face = extract("running", CELLS["running"]["idle_front"])
    idle_r = extract("running", CELLS["running"]["idle_right"])
    gun_hold_r = extract("misc", CELLS["misc"]["gun3"])
    gun_fire_r = extract("misc", CELLS["misc"]["gun4"])
    gun_run_r = [extract("misc", CELLS["misc"][f"gun{i}"]) for i in (6, 7)]
    stab_r = [extract("misc", CELLS["misc"][f"dagger{i}"]) for i in (2, 3)]
    shoryu_r = [extract("misc", CELLS["misc"][f"shoryu{i}"]) for i in (1, 2, 3)]
    thrust_r = [extract("misc", CELLS["misc"][f"thrust{i}"]) for i in (1, 2)]
    damage = [extract("misc", CELLS["misc"][f"damage{i}"]) for i in (1, 2)]

    frames = []
    frames += run_r                                  # 0-3 run right
    frames.append(face)                              # 4 face-on
    frames += [mirrored(f) for f in run_r]           # 5-8 run left
    frames.append(idle_r)                            # 9 idle right
    frames.append(mirrored(idle_r))                  # 10 idle left
    frames += [gun_hold_r, mirrored(gun_hold_r)]     # 11-12 gun hold
    frames += [gun_fire_r, mirrored(gun_fire_r)]     # 13-14 gun fire
    frames += gun_run_r                              # 15-16 gun run right
    frames += [mirrored(f) for f in gun_run_r]       # 17-18 gun run left
    frames += stab_r                                 # 19-20 stab right
    frames += [mirrored(f) for f in stab_r]          # 21-22 stab left
    frames += shoryu_r                               # 23-25 shoryuken right
    frames += [mirrored(f) for f in shoryu_r]        # 26-28 shoryuken left
    frames += thrust_r                               # 29-30 thrust right
    frames += [mirrored(f) for f in thrust_r]        # 31-32 thrust left
    frames += damage                                 # 33-34 damage (rear view)

    assert len(frames) == 35, len(frames)
    img = Image.new("RGBA", (CELL_W * len(frames), CELL_H), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        img.alpha_composite(normalise(f), (i * CELL_W, 0))
    img.save(f"{OUT}/anands.png")
    print(f"wrote {OUT}/anands.png ({img.width}x{img.height}, {len(frames)} cells)")


def build_roll_strip():
    """The tumble, derived from the face-on frame exactly like
    `make-roll-art.py` derives the dude's: rotations about the feet plus a
    tucked ball pose, cells 0-7 rolling right and 8-15 their mirrors."""
    face = extract("running", CELLS["running"]["idle_front"])
    face = face.resize(
        (max(1, round(face.width * CHAR_H / face.height)), CHAR_H), Image.NEAREST
    )
    right = []
    for i in range(8):
        if i in (3, 4):
            # The ball: the tucked body — the face frame's torso — with the
            # real head pasted on top, like `make-roll-art.py`'s ellipse.
            fw, fh = face.size
            head = face.crop((0, 0, fw, round(fh * 0.32)))
            head = head.resize((max(1, round(head.width * 44 / head.height)), 44), Image.NEAREST)
            torso = face.crop((0, round(fh * 0.34), fw, round(fh * 0.9)))
            torso = torso.resize(
                (max(1, round(torso.width * 96 / torso.height)), 96), Image.NEAREST
            )
            ball = Image.new("RGBA", (ROLL_CELL_W, ROLL_CELL_H), (0, 0, 0, 0))
            ball.alpha_composite(
                torso, ((ROLL_CELL_W - torso.width) // 2, ROLL_CELL_H - 100)
            )
            ball.alpha_composite(
                head, ((ROLL_CELL_W - head.width) // 2, ROLL_CELL_H - 100 - head.height // 2)
            )
            right.append(ball)
            continue
        rot = face.rotate(-(i * 60 + 15), expand=True, resample=Image.BICUBIC)
        bbox = rot.getbbox()
        if bbox:
            rot = rot.crop(bbox)
        cell = Image.new("RGBA", (ROLL_CELL_W, ROLL_CELL_H), (0, 0, 0, 0))
        cell.alpha_composite(rot, ((ROLL_CELL_W - rot.width) // 2, ROLL_CELL_H - rot.height))
        right.append(cell)

    img = Image.new("RGBA", (ROLL_CELL_W * 16, ROLL_CELL_H), (0, 0, 0, 0))
    for i, cell in enumerate(right):
        img.alpha_composite(cell, (i * ROLL_CELL_W, 0))
    for i, cell in enumerate(right):
        img.alpha_composite(
            mirrored(cell), ((8 + i) * ROLL_CELL_W, 0)
        )
    img.save(f"{OUT}/anands-roll.png")
    print(f"wrote {OUT}/anands-roll.png ({img.width}x{img.height}, 16 cells)")


def build_dragon_strip():
    """The ride: the ultimate's own art, lunge into the dragon then the
    flight. Six frames, drawn big — the dragon is a screen-filling event."""
    order = ["attack4", "attack6", "fly2", "fly3", "fly4", "fly5"]
    frames = [extract("ultimate", CELLS["ultimate"][n]) for n in order]
    img = Image.new("RGBA", (DRAGON_CELL_W * len(frames), DRAGON_CELL_H), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        cell = Image.new("RGBA", (DRAGON_CELL_W, DRAGON_CELL_H), (0, 0, 0, 0))
        cell.alpha_composite(f, ((DRAGON_CELL_W - f.width) // 2, (DRAGON_CELL_H - f.height) // 2))
        img.alpha_composite(cell, (i * DRAGON_CELL_W, 0))
    img.save(f"{OUT}/anands-dragon.png")
    print(f"wrote {OUT}/anands-dragon.png ({img.width}x{img.height}, {len(frames)} cells)")


def build_portrait():
    """The face-on frame, blown up to the portrait card's 128x192 canvas with
    the feet on the floor — the same figure the hero select and the ultimate
    cinematic show."""
    face = extract("running", CELLS["running"]["idle_front"])
    scale = (PORTRAIT_H - 4) / face.height
    scaled = face.resize(
        (max(1, round(face.width * scale)), PORTRAIT_H - 4), Image.NEAREST
    )
    img = Image.new("RGBA", (PORTRAIT_W, PORTRAIT_H), (0, 0, 0, 0))
    img.alpha_composite(scaled, ((PORTRAIT_W - scaled.width) // 2, PORTRAIT_H - scaled.height))
    img.save(f"{OUT}/anands-portrait.png")
    print(f"wrote {OUT}/anands-portrait.png ({img.width}x{img.height})")


if __name__ == "__main__":
    build_character_strip()
    build_roll_strip()
    build_dragon_strip()
    build_portrait()
