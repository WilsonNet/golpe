#!/usr/bin/env python3
"""
Compose Anands' shipped sprite sheets from the hand-drawn reference boards.

The artist's boards (`unprocessed-sprites/anands-running.jpeg`,
`anands-ultimate.jpeg`, `anands-misc.jpeg`) are *paintings*, not production
atlases: characters spill over their panels, text labels sit on the canvas,
and the beige background is a baked-in colour. This script floods the board
away from outside each figure (so her own pixels survive whatever their
colour — see `extract`), keeps only the components that belong to the
character, snaps the JPEG noise to her palette, and scales each board once so
she stands the same height on every board.

The game's layout rules are per-hero — Anands is the hero whose sheets were
replaced by this art, and she gets her own cell geometry and her own clip
table (see `SHEET_CELLS` and `HERO_CLIPS` in the game):

- `anands.png` — 35 cells of 168x152: 0-3 run right, 4 face-on, 5-8 run left
  (mirrors), 9-10 idle profiles, 11-14 gun hold/fire, 15-18 gun run, 19-22
  dagger stab, 23-28 shoryuken, 29-32 thrust windup/dash, 33-34 damage.
  Every directional move is stored facing both ways, exactly like the walk
  cycle always has been.
- `anands-roll.png` — 16 cells of 168x152: the tumble, derived from the
  face-on frame by rotation.
- `anands-dragon.png` — 6 cells of 352x176: the dragon-thrust ride, the
  ultimate's own art: the lunge into the dragon and the flight it carries.
- `anands-portrait.png` — 128x192: the face-on frame blown up for the hero
  select and the ultimate cinematic's portrait card.

The misc board's weapon poses (machine gun, shoryuken, dagger, damage) are
hand-picked by cell rect measured against the board; the frames that are not
used (victory, sleep, the map illustration, the contextual idles) are left in
`unprocessed-sprites/` for the artist.

Usage: python3 scripts/make-anands-art.py            # cut the boards
       python3 scripts/make-anands-art.py --measure  # measure the shipped strip
"""

from PIL import Image
from scipy import ndimage
from scipy.cluster.vq import kmeans2
import numpy as np
import os
import sys

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


def extract_keyed(sheet, rect):
    """Cut one frame out of a board by keying the board's tones anywhere in
    the crop. Only the dragon ride still uses it: its energy is translucent
    over the panel, so there is no outline for a flood fill to stop at. On
    her body it deleted 21% of the silhouette (skin, shirt and lenses sit
    close to the board's beige) — see `extract`."""
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


# ---------------------------------------------------------------------------
# Board removal for her body: a flood fill from outside the figure.
#
# Keying the board's colour anywhere in the crop deleted everything of hers
# that shares a tone with it — skin, shirt, goggle lenses — 21% of her
# silhouette on average. The board is instead removed only where it is
# *connected to the crop's edge*, under a tight tolerance, so her dark outline
# stops the fill and every interior pixel survives whatever its colour.
# ---------------------------------------------------------------------------

EIGHT = np.ones((3, 3), bool)
FLOOD_TOL = 18          # max channel distance from a board tone
LINE_TOL = 44           # the pale-gold grid lines, blurred by the JPEG
POCKET_MIN = 30         # an enclosed pocket of panel this big is board
_BOARD_TONES: dict[str, list[tuple[int, int, int]]] = {}


def board_tones(sheet):
    """Every colour bin covering 2%+ of the whole board: its panels, its
    charcoal cells and their JPEG shades. None of her colours covers that much
    of a board, and a panel that happens not to touch a crop's edge ring is
    still known."""
    if sheet not in _BOARD_TONES:
        a = np.asarray(Image.open(f"{SRC}/anands-{sheet}.jpeg").convert("RGB"), int)
        q = (a // 12) * 12 + 6
        keys, cnt = np.unique(q.reshape(-1, 3), axis=0, return_counts=True)
        total = q.shape[0] * q.shape[1]
        _BOARD_TONES[sheet] = [
            tuple(int(v) for v in keys[i]) for i in np.argsort(-cnt) if cnt[i] / total > 0.02
        ]
    return _BOARD_TONES[sheet]


def near(rgb, colours, tol):
    out = np.zeros(rgb.shape[:2], bool)
    for c in colours:
        out |= np.abs(rgb - np.array(c)).max(-1) < tol
    return out


def strip_grid_lines(rgb, like):
    """The board's grid lines run behind her and join her to the crop's edge.
    A row or column that is line-coloured across a third of the crop is a
    line; its pixels are board only along the runs walking in from each edge,
    which stop at her outline — a line behind her face never cuts through
    skin that shares its tone."""
    walk = near(rgb, PALE_LINE + [(150, 130, 100)], LINE_TOL) | like
    strict = near(rgb, PALE_LINE, 30)
    h, w = like.shape

    def runs(n, ok, put):
        for i in range(n):
            if not ok(i):
                break
            put(i)
        for i in range(n - 1, -1, -1):
            if not ok(i):
                break
            put(i)

    for r in np.where(strict.mean(1) > 0.35)[0]:
        for rr in range(max(0, r - 1), min(h, r + 2)):
            runs(w, lambda i: walk[rr, i], lambda i: like.__setitem__((rr, i), True))
    for c in np.where(strict.mean(0) > 0.35)[0]:
        for cc in range(max(0, c - 1), min(w, c + 2)):
            runs(h, lambda i: walk[i, cc], lambda i: like.__setitem__((i, cc), True))


def board_outside(rgb, tones):
    """The board: tone-matched pixels connected to the crop's edge, plus big
    enclosed pockets of *light* panel (the gap between her legs). A dark
    pocket inside her is a trouser leg or the gun, never a charcoal cell."""
    like = near(rgb, tones, FLOOD_TOL)
    strip_grid_lines(rgb, like)
    lab, n = ndimage.label(like)
    edge = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    bg = np.isin(lab, edge[edge > 0])
    for i in range(1, n + 1):
        pocket = lab == i
        if not bg[pocket].any() and pocket.sum() >= POCKET_MIN and rgb[pocket].mean() > 110:
            bg |= pocket
    return bg


def eat_halo(rgb, bg, tones, palette, steps=3):
    """The JPEG blends her outline into the panel over a pixel or two. Grow
    the board into that ring, but only into pixels nearer a board tone than
    any colour of hers."""
    d_board = np.min([((rgb - np.array(t)) ** 2).sum(-1) for t in tones], axis=0)
    d_her = np.min([((rgb - p) ** 2).sum(-1) for p in palette.astype(int)], axis=0)
    eatable = d_board < d_her
    for _ in range(steps):
        grown = (ndimage.binary_dilation(bg, EIGHT) & eatable) | bg
        if (grown == bg).all():
            break
        bg = grown
    return bg


def keep_figure(fig, inner):
    """Her largest component, plus separate pieces (casings, a slash arc)
    that sit near her, inside the measured rect and off the crop's edge. A
    piece outside the rect is the neighbouring cell's muzzle flash or barrel,
    reaching in through the margin. An opening first drops the one-pixel
    crumbs of grid line that cling to her outline."""
    fig = ndimage.binary_opening(fig, np.ones((2, 2), bool))
    lab, n = ndimage.label(fig, EIGHT)
    if n == 0:
        return fig
    sizes = ndimage.sum(fig, lab, range(1, n + 1))
    main = int(np.argmax(sizes)) + 1
    ys, xs = np.where(lab == main)
    mx0, my0, mx1, my1 = xs.min() - 12, ys.min() - 12, xs.max() + 12, ys.max() + 12
    ix0, iy0, ix1, iy1 = inner
    keep = lab == main
    h, w = fig.shape
    for i, sl in enumerate(ndimage.find_objects(lab), 1):
        if i == main or sizes[i - 1] < 20:
            continue
        y0, y1, x0, x1 = sl[0].start, sl[0].stop, sl[1].start, sl[1].stop
        if y0 <= 1 or x0 <= 1 or y1 >= h - 1 or x1 >= w - 1:
            continue
        if x1 < mx0 or x0 > mx1 or y1 < my0 or y0 > my1:
            continue
        if x1 <= ix0 or x0 >= ix1 or y1 <= iy0 or y0 >= iy1:
            continue
        keep |= lab == i
    return keep


def crop_board(sheet, rect):
    src = Image.open(f"{SRC}/anands-{sheet}.jpeg").convert("RGB")
    m = MARGIN[sheet]
    x0, y0, x1, y1 = rect
    cx, cy = max(0, x0 - m), max(0, y0 - m)
    crop = src.crop((cx, cy, min(src.width, x1 + m), min(src.height, y1 + m)))
    return crop, (x0 - cx, y0 - cy, x1 - cx, y1 - cy)


def figure_mask(sheet, rect, palette=None):
    crop, inner = crop_board(sheet, rect)
    rgb = np.asarray(crop, int)
    tones = [c for c, _ in bg_candidates(crop)] + board_tones(sheet)
    bg = board_outside(rgb, tones)
    if palette is not None:
        bg = eat_halo(rgb, bg, tones, palette)
    return rgb, keep_figure(~bg, inner)


# Her palette: the board's JPEG turns every flat fill into a few hundred
# near-identical colours. K-means over the inside of every cut frame, with
# saturated pixels oversampled so the small bright accents (the teal lenses,
# the scarf) get colours of their own, then every pixel snaps to it.
PALETTE_SIZE = 48
ACCENTS = 8
ACCENT_DIST = 40      # RGB distance past which a pixel is badly fitted
_PALETTE = None


def palette():
    global _PALETTE
    if _PALETTE is None:
        px = []
        for sheet in ("running", "misc"):
            for rect in CELLS[sheet].values():
                rgb, mask = figure_mask(sheet, rect)
                px.append(rgb[ndimage.binary_erosion(mask)])
        px = np.concatenate(px).astype(float)
        sat = px.max(1) - px.min(1)
        weight = np.where(sat > 60, 4.0, 1.0)
        rng = np.random.default_rng(0)
        pick = rng.choice(len(px), 80000, p=weight / weight.sum())
        centres, _ = kmeans2(px[pick], PALETTE_SIZE, seed=1, minit="++")
        # Accents: the teal lenses are a few dozen pixels a frame, too rare
        # for any cluster of their own, and snapped to grey. Cluster the
        # pixels the palette fits worst and add those colours too.
        d = np.min([((px - c) ** 2).sum(-1) for c in centres], axis=0)
        worst = px[d > ACCENT_DIST**2]
        if len(worst) > ACCENTS * 20:
            accents, _ = kmeans2(worst, ACCENTS, seed=1, minit="++")
            centres = np.concatenate([centres, accents])
        _PALETTE = np.clip(centres.round(), 0, 255).astype(np.uint8)
    return _PALETTE


def extract(sheet, rect):
    """Cut one frame of her body out of a board: flood the board away from
    outside, eat the JPEG halo, snap to her palette, and return the
    content-cropped transparent frame at board resolution."""
    pal = palette()
    rgb, mask = figure_mask(sheet, rect, pal)
    ys, xs = np.where(mask)
    if len(ys) == 0:
        raise SystemExit(f"empty frame: {sheet} {rect}")
    rgb = rgb[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1]
    mask = mask[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1]
    d = ((rgb[..., None, :] - pal[None, None].astype(int)) ** 2).sum(-1)
    out = np.zeros(rgb.shape[:2] + (4,), np.uint8)
    out[..., :3] = pal[d.argmin(-1)]
    out[..., 3] = np.where(mask, 255, 0)
    frame = Image.fromarray(out)
    k = board_scale(sheet)
    return frame.resize((max(1, round(frame.width * k)), max(1, round(frame.height * k))), Image.NEAREST)


# One scale per board, so she is the same size in every frame of it: the
# board's standing reference frame stands CHAR_H tall and every other frame
# keeps its drawn height relative to it. Scaling each frame to CHAR_H
# stretched every crouch, lunge and stagger up to standing height.
BOARD_REFERENCE = {"running": "idle_front", "misc": "gun3"}
_BOARD_SCALE: dict[str, float] = {}


def board_scale(sheet):
    if sheet not in _BOARD_SCALE:
        _, mask = figure_mask(sheet, CELLS[sheet][BOARD_REFERENCE[sheet]], palette())
        ys = np.where(mask.any(1))[0]
        _BOARD_SCALE[sheet] = CHAR_H / (ys[-1] - ys[0] + 1)
    return _BOARD_SCALE[sheet]


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
    """Place a frame (already at its board's scale — see `board_scale`)
    bottom-aligned and centre-horizontally in the standard cell. A frame
    wider or taller than the cell is shrunk to fit, never cropped."""
    fit = min(1.0, CELL_W / frame.width, GROUND_LINE / frame.height)
    if fit < 1.0:
        frame = frame.resize((round(frame.width * fit), round(frame.height * fit)), Image.NEAREST)
    cell = Image.new("RGBA", (CELL_W, CELL_H), (0, 0, 0, 0))
    cell.alpha_composite(frame, ((CELL_W - frame.width) // 2, GROUND_LINE - frame.height))
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
    the generated heroes derive theirs: rotations about the feet plus a
    tucked ball pose, cells 0-7 rolling right and 8-15 their mirrors."""
    face = extract("running", CELLS["running"]["idle_front"])
    face = face.resize(
        (max(1, round(face.width * CHAR_H / face.height)), CHAR_H), Image.NEAREST
    )
    right = []
    for i in range(8):
        if i in (3, 4):
            # The ball: the tucked body — the face frame's torso — with the
            # real head pasted on top.
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
    frames = [extract_keyed("ultimate", CELLS["ultimate"][n]) for n in order]
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


def measure(path=f"{OUT}/anands.png", cell_w=CELL_W):
    """The extraction, measured on the shipped strip, per cell:

    - holes: transparent area fully enclosed by her silhouette, as a share of
      it. Keying the board by colour left 21% (the skin-looks-wrong bug); a
      clean cut leaves only the real gaps between an arm and her body.
    - debris: opaque pixels outside her main component (casings, a slash arc
      and a muzzle flash are legitimately separate; board crumbs are not).
    - top / feet: the figure's extent; the feet must sit on GROUND_LINE.
    - colours: distinct colours — the JPEG left thousands, the palette snap
      leaves at most PALETTE_SIZE + ACCENTS.
    """
    im = np.asarray(Image.open(path).convert("RGBA"))
    rows = []
    for i in range(im.shape[1] // cell_w):
        c = im[:, i * cell_w : (i + 1) * cell_w]
        m = c[..., 3] > 40
        filled = ndimage.binary_fill_holes(m)
        holes = (filled & ~m).sum() / filled.sum()
        lab, n = ndimage.label(m, EIGHT)
        debris = int(m.sum() - ndimage.sum(m, lab, range(1, n + 1)).max())
        ys = np.where(m.any(1))[0]
        colours = len(np.unique(c[..., :3][m].reshape(-1, 3), axis=0))
        rows.append((holes, debris, ys[0], ys[-1], colours))
        print(f"  cell {i:2d} holes {holes * 100:5.1f}%  debris {debris:4d}px  top {ys[0]:3d}  feet {ys[-1]:3d}  colours {colours}")
    print(
        f"  MEAN holes {np.mean([r[0] for r in rows]) * 100:.1f}%  debris {np.mean([r[1] for r in rows]):.0f}px"
        f"  colours {np.mean([r[4] for r in rows]):.0f}  feet off the ground line: {sum(r[3] != GROUND_LINE - 1 for r in rows)}"
    )


if __name__ == "__main__":
    if "--measure" in sys.argv:
        measure()
        sys.exit(0)
    build_character_strip()
    build_roll_strip()
    build_dragon_strip()
    build_portrait()
