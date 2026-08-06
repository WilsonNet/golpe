#!/usr/bin/env python3
"""
Generate Anands' pixel-art sprite sheets: the nine-frame character strip and
the sixteen-cell roll strip, in the Chrono Trigger / SNES style the project
commits to.

The layout is fixed by the game, not by this script:

- `anands.png`  — 288x48, nine 32x48 cells: 0-3 walk left, 4 face-on, 5-8 walk
  right (mirrors of 0-3). This is the frame budget a human artist must match
  when the real art lands; every cell is exactly one 16x24 sprite drawn at 2x.
- `anands-roll.png` — 640x48, sixteen 40x48 cells: 0-7 roll right, 8-15 roll
  left (mirrors). Derived from the face-on frame by rotation and a curled
  "ball" pose, exactly like `make-roll-art.py` does for the dude.

Anands is a Luca-inspired tinkerer: auburn bob, a headband with goggles
pushed up, an amber tunic with a teal sash, brown pants and boots. The
palette is the sheet's contract — the hit poses and dagger poses are derived
from this sheet in code (`createHeroPoses`), so the colours here are what the
whole hero is drawn from.

Usage: python3 scripts/make-hero-art.py
"""

from PIL import Image, ImageDraw

OUT_DIR = "public/assets"
CELL_W, CELL_H = 32, 48
LOGICAL_W, LOGICAL_H = 16, 24
SCALE = 2
GROUND_LINE = 46
ROLL_OUT = f"{OUT_DIR}/anands-roll.png"
STRIP_OUT = f"{OUT_DIR}/anands.png"

# ---- palette -------------------------------------------------------------
OUT = (26, 20, 44)      # outline: deep navy, the SNES look
SKIN = (242, 201, 160)
SKIN_SHADE = (214, 168, 122)
HAIR = (193, 68, 46)    # auburn
HAIR_SHADE = (140, 44, 34)
HAIR_LIGHT = (236, 132, 88)
TUNIC = (224, 182, 79)  # amber
TUNIC_SHADE = (166, 126, 46)
TEAL = (42, 157, 143)
TEAL_DARK = (26, 104, 96)
PANTS = (90, 74, 58)
BOOTS = (58, 42, 42)
GOGGLE = (222, 228, 236)
LENS = (106, 159, 216)

CHARS = {
    ".": None,
    "O": OUT,
    "S": SKIN,
    "s": SKIN_SHADE,
    "H": HAIR,
    "h": HAIR_SHADE,
    "L": HAIR_LIGHT,
    "T": TUNIC,
    "t": TUNIC_SHADE,
    "C": TEAL,
    "c": TEAL_DARK,
    "P": PANTS,
    "B": BOOTS,
    "G": GOGGLE,
    "g": LENS,
}


def draw_map(draw: ImageDraw.ImageDraw, rows: list[str], ox: int = 0, oy: int = 0):
    """Paint one row-string map (16x24) at logical scale, 2x pixels."""
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            colour = CHARS.get(ch)
            if colour is None:
                continue
            draw.rectangle(
                [(ox + x * SCALE, oy + y * SCALE),
                 (ox + x * SCALE + SCALE - 1, oy + y * SCALE + SCALE - 1)],
                fill=colour,
            )


# ---------------------------------------------------------------------------
# The face-on frame: the portrait. 16x24 logical.
# ---------------------------------------------------------------------------
FACE = [
    "................",
    "....HHHHHHHH....",
    "...HHHHHHHHHH...",
    "..HHHHHHHHHHHH..",
    "..HhhHHHHHHhhH..",
    "..HSHHHHHHHHSH..",
    "..HSSSSSSSSSSH..",
    "..HSsSSSSSSsSH..",
    "..HSsSSSSSSsSH..",
    "..HSSggSSggSSH..",
    "..HSSsSSSSsSSH..",
    "..HSSsSSSSsSSH..",
    "..HSSssssssSSH..",
    "...hSSSSSSSSh...",
    "...hSSSSSSSSh...",
    "..O...SSS...O...",
    ".....OTTTTO.....",
    "....OTTTTTTO....",
    "...OTtTTTTtTO...",
    "...OTtTTTTtTO...",
    "..OCTTTTTTTTCO..",
    "..OCTTTTTTTTCO..",
    "...OTTttttTTO...",
    "....OPPPPPPO....",
]


def face_frame() -> Image.Image:
    img = Image.new("RGBA", (CELL_W, CELL_H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw_map(draw, FACE, 0, 0)
    return img


# ---------------------------------------------------------------------------
# The left-profile walk cycle. The torso/head is one base; the legs and the
# arms change per frame. Rows 15..23 are the legs; row 13-14 the arms.
# ---------------------------------------------------------------------------
PROFILE_TOP = [
    "................",
    "....HHHHHH......",
    "...HHHHHHHH.....",
    "..HHHHHHHHHH....",
    "..HLhHHHHHHH....",
    "..HSSHHHHHHH....",
    "..HSSSSSSSSH....",
    "..HSsSSSSSH.....",
    "..HSsSSSSSH.....",
    "..HSSggSSSH.....",
    "..HSSsSSSSH.....",
    "..HSSssSSSH.....",
    "...hSSSSSH......",
    "...hSSSSSS......",
    "..O..OTTTTO.....",
    ".....OTTTTO.....",
    "....OTTTTTTO....",
    "....OTtTTTTO....",
    "...OCTTTTTTO....",
    "...OCTTTTTTO....",
    "....OTTtttO.....",
]

# Four leg poses, rows 20..23 (boots at the bottom). Each is 4 rows.
LEGS = [
    # A: standing / passing — weight centred
    [
        "....OPP.O.....",
        "....OPPOO.....",
        "....OPPOO.....",
        "....OBBO......",
    ],
    # B: left leg forward (the stride out)
    [
        "...OPPO..O....",
        "...OPPO..OO...",
        "...OPPO..OO...",
        "...OBBO..BO...",
    ],
    # C: passing — legs together mid-stride
    [
        "....OPPO......",
        "....OPPO......",
        "....OPPO......",
        "....OBBO......",
    ],
    # D: right leg forward
    [
        "....O..OPPO...",
        "....OO..OPPO..",
        "....OO..OPPO..",
        "....BO..OBBO..",
    ],
]

# Arms per frame (row 13-14 area): a swing against the legs.
ARMS = [
    [  # A
        "...hSSSSSS......",
        "...hSSSSSS......",
    ],
    [  # B — leading arm reaches forward
        "....SSSSSO.....",
        "....SSSSSO.....",
    ],
    [  # C
        "...hSSSSSS......",
        "...hSSSSSS......",
    ],
    [  # D — trailing arm swings back
        "..OSSSSS........",
        "..OSSSSS........",
    ],
]


def profile_frame(leg_idx: int) -> Image.Image:
    img = Image.new("RGBA", (CELL_W, CELL_H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    top = list(PROFILE_TOP)
    top[13] = ARMS[leg_idx][0]
    top[14] = ARMS[leg_idx][1]
    draw_map(draw, top, 0, 0)
    draw_map(draw, LEGS[leg_idx], 0, 20 * SCALE)
    # A little bob: frames B and D are the stride, so the body rides 1px high.
    if leg_idx in (1, 3):
        img = img.crop((0, -SCALE, CELL_W, CELL_H - SCALE)).resize(
            (CELL_W, CELL_H), Image.NEAREST
        )
        body = Image.new("RGBA", (CELL_W, CELL_H), (0, 0, 0, 0))
        body.alpha_composite(img, (0, 0))
        img = body
    return img


def build_strip() -> None:
    img = Image.new("RGBA", (CELL_W * 9, CELL_H), (0, 0, 0, 0))
    left = [profile_frame(i) for i in range(4)]
    face = face_frame()
    for i, f in enumerate(left):
        img.paste(f, (i * CELL_W, 0))
    img.paste(face, (4 * CELL_W, 0))
    for i, f in enumerate(left):
        img.paste(f.transpose(Image.FLIP_LEFT_RIGHT), ((5 + i) * CELL_W, 0))
    img.save(STRIP_OUT)
    print(f"wrote {STRIP_OUT} ({img.width}x{img.height})")


# ---------------------------------------------------------------------------
# The roll strip: derived from the face-on frame, exactly like the dude's.
# Cells 0-7 roll right; 8-15 mirror them. See make-roll-art.py for the recipe.
# ---------------------------------------------------------------------------
ROLL_CELL_W = 40


def ball_frame(face: Image.Image) -> Image.Image:
    """A curled body: an ellipse of tunic with the real head pasted on."""
    cell = Image.new("RGBA", (ROLL_CELL_W, CELL_H), (0, 0, 0, 0))
    d = ImageDraw.Draw(cell)
    # The tucked body, in the tunic's palette.
    d.ellipse([10, 30, 34, 46], fill=TUNIC_SHADE)
    d.ellipse([12, 30, 30, 44], fill=TUNIC)
    d.ellipse([16, 30, 26, 42], fill=TEAL)
    d.ellipse([20, 26, 24, 30], fill=HAIR)
    # The actual head, cropped from the sheet's face frame.
    head = face.crop((4, 0, 12, 12)).resize((12, 12), Image.NEAREST)
    cell.alpha_composite(head, (17, 22))
    return cell


def build_roll() -> None:
    face = face_frame()
    right: list[Image.Image] = []
    for i in range(8):
        angle = (i * 60 + 15) % 360
        if i in (3, 4):
            right.append(ball_frame(face))
            continue
        rot = face.rotate(-angle, expand=True, resample=Image.BICUBIC)
        bbox = rot.getbbox()
        if bbox:
            rot = rot.crop(bbox)
        cell = Image.new("RGBA", (ROLL_CELL_W, CELL_H), (0, 0, 0, 0))
        cx = (ROLL_CELL_W - rot.width) // 2
        cell.alpha_composite(rot, (cx, GROUND_LINE - rot.height))
        right.append(cell)

    img = Image.new("RGBA", (ROLL_CELL_W * 16, CELL_H), (0, 0, 0, 0))
    for i, cell in enumerate(right):
        img.paste(cell, (i * ROLL_CELL_W, 0))
    for i, cell in enumerate(right):
        img.paste(
            cell.transpose(Image.FLIP_LEFT_RIGHT),
            ((8 + i) * ROLL_CELL_W, 0),
        )
    img.save(ROLL_OUT)
    print(f"wrote {ROLL_OUT} ({img.width}x{img.height})")


if __name__ == "__main__":
    build_strip()
    build_roll()
