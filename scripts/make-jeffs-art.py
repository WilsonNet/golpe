#!/usr/bin/env python3
""",
Generate Jeffs' pixel-art sprite sheets: the nine-frame character strip and
the sixteen-cell roll strip, in the Chrono Trigger / SNES style the project
commits to.

The layout is fixed by the game, not by this script:

- `jeffs.png`  — 288x48, nine 32x48 cells: 0-3 walk left, 4 face-on, 5-8 walk
  right (mirrors of 0-3). This is the frame budget a human artist must match
  when the real art lands; every cell is exactly one 32x48 sprite drawn at
  1:1, the same scale as Chrono Trigger's battle sprites.
- `jeffs-roll.png` — 640x48, sixteen 40x48 cells: 0-7 roll right, 8-15 roll
  left (mirrors). Derived from the face-on frame by rotation and a curled
  "ball" pose, exactly like `make-roll-art.py` does for the dude.

Jeffs is a middle-aged man in a fancy trench coat: greying slicked-back hair
with grey temples, heavy brows over narrowed eyes, a small nose with shadow
under it, stubble across a frowning jaw, a white shirt with a red tie, a dark
charcoal coat with gold buttons and a gold-buckled belt, the collar up. The
palette is the sheet's contract — the hit poses are derived from this sheet in
code (`createHeroPoses`), so the colours here are what the whole hero is drawn
from.

Usage: python3 scripts/make-jeffs-art.py
""",

from PIL import Image, ImageDraw

OUT_DIR = "public/assets"
CELL_W, CELL_H = 32, 48
GROUND_LINE = 46
ROLL_OUT = f"{OUT_DIR}/jeffs-roll.png"
STRIP_OUT = f"{OUT_DIR}/jeffs.png"

# ---- palette -------------------------------------------------------------
# Each region carries its own highlight/shade pair so the sheet reads like a
# SNES sprite: outline, light, base, shade, and the occasional deep shadow.
OUT = (26, 20, 44)       # outline: deep navy, the SNES look
SKIN = (238, 194, 152)   # weathered skin
SKIN_SHADE = (202, 156, 116)
SKIN_DARK = (158, 114, 84)   # stubble and jaw shadow
HAIR = (66, 58, 54)      # dark brown-grey, slicked back
HAIR_SHADE = (44, 38, 38)
HAIR_LIGHT = (182, 172, 162)  # the grey temples: the middle-aged tell
COAT = (46, 54, 68)      # charcoal trench
COAT_SHADE = (30, 36, 48)
COAT_DARK = (24, 28, 38)     # coat folds and under-arm
COAT_LIGHT = (92, 104, 124)  # lapel edges and shoulder light
TRIM = (206, 168, 88)    # gold: buttons and buckle
TRIM_SHADE = (140, 108, 52)
SHIRT = (238, 234, 226)
SHIRT_SHADE = (196, 190, 182)
TIE = (178, 54, 46)
TIE_SHADE = (126, 34, 30)
PANTS = (54, 46, 46)
PANTS_SHADE = (38, 32, 34)
BOOTS = (40, 32, 34)
BOOTS_SHADE = (26, 20, 24)

CHARS = {
    ".": None,
    "O": OUT,
    "S": SKIN,
    "s": SKIN_SHADE,
    "d": SKIN_DARK,
    "H": HAIR,
    "h": HAIR_SHADE,
    "L": HAIR_LIGHT,
    "C": COAT,
    "c": COAT_SHADE,
    "k": COAT_DARK,
    "K": COAT_LIGHT,
    "G": TRIM,
    "g": TRIM_SHADE,
    "T": SHIRT,
    "t": SHIRT_SHADE,
    "R": TIE,
    "r": TIE_SHADE,
    "P": PANTS,
    "p": PANTS_SHADE,
    "B": BOOTS,
    "b": BOOTS_SHADE,
    # The eye glint and the mouth — the two feature colours that are not a
    # region's shade but its *point*.
    "W": (246, 242, 236),
    "D": (52, 40, 44),
}


def draw_map(draw: ImageDraw.ImageDraw, rows: list[str], ox: int = 0, oy: int = 0):
    """Paint one row-string map (32x48) at 1:1, one character per pixel.

    A row shorter than the cell is right-padded with background — trailing
    dots are always empty anyway, and padding keeps a row that was hand-edited
    from silently shifting every column after it.
    """,
    for y, row in enumerate(rows):
        if len(row) > CELL_W:
            raise ValueError(
                f"row {y} is {len(row)} chars, expected at most {CELL_W}: {row!r}"
            )
        row = row.ljust(CELL_W, ".")
        for x, ch in enumerate(row):
            colour = CHARS.get(ch)
            if colour is None:
                continue
            draw.rectangle(
                [(ox + x, oy + y), (ox + x + 1, oy + y + 1)], fill=colour
            )


# ---------------------------------------------------------------------------
# The face-on frame: the portrait. 32x48, one pixel per character.
#
# The face is set and weathered: slicked-back hair with grey temples, heavy
# brows that slope down toward a small nose with shadow under it, narrowed
# eyes with a glint, stubble scattered across the jaw and a mouth set in a
# frown. The coat is the fancy — the collar up, white shirt, red tie with a
# proper knot, gold buttons, a gold-buckled belt — because the whole point of
# Jeffs is that the executioner dresses well.
# ---------------------------------------------------------------------------
FACE = [
    # ---- head: hair with grey streaks, the hairline dipping at the sides ----
    "................................",
    "........HHHHHHHHHHHHHH........",
    ".......HHHLHHHHHHHLHHHH.......",
    "......LLHHHHHHHHHHHHHHLL......",
    "......HhHLHHHHHHHHHLHhH......",
    "......LLhHHHHHHHHHHHHhLL......",
    ".....LLhHHHSSSSSSSSHHHhLL.....",
    # ---- heavy brows, two pixels tall, sloping toward the nose ----
    "........SHHHSSSSSSSHHHSS........",
    "........SHHHSSSSSSSHHHSS........",
    # ---- narrowed eyes, two pixels tall, right under the brows ----
    "........SSDDSSSSSSDDSSS........",
    "........SSDDSSSSSSDDSSS........",
    # ---- a small nose with shadow under it ----
    ".........SSSSdSSSSSSSSS.........",
    ".........SSSSdSSSSSSSSS.........",
    ".........SSSSddSSSSSSSS.........",
    ".........SSSSssSSSSSSSS.........",
    # ---- stubble, and the frown in two rows ----
    ".........ssssssssssssss.........",
    ".........sssDDDDDDDDsss.........",
    ".........sssssDDDDsssss.........",
    ".........ssssssssssssss.........",
    "........SssssssssssssssS........",
    # ---- chin and jaw ----
    ".......OdSSSSSSSSSSSSSSdO.......",
    "......OOdSSSSSSSSSSSSSSdOO......",
    "......OOSSSSSSSSSSSSSSOO........",
    ".......OdSSSSSSSSSSSSdO.........",
    "........OSSSSSSSSSSSSO..........",
    ".........OSSSSSSSSSSO...........",
    # ---- collar and the tie's knot ----
    "..........OTTTTTTTTTO..........",
    ".........OTtTTTTTTTtTO.........",
    "........OTtTTTTRRTTTTtTO........",
    ".......OCCtTTTRRRRTTtCCO........",
    "......OCCKtTTTRRRRTTTttKCCO.....",
    ".....OCCKKtTTTRRRRTTTtKKCCO.....",
    # ---- the tie's shaft, then the shirt with buttons ----
    ".....OCCKKtTTTRRRRTTTtKKCCO.....",
    ".....OCCKKtTTTTTRRTTTTTtKKCCO...",
    ".....OCCKKtTTTTTRRTTTTTtKKCCO...",
    ".....OCCKtTTTTTTTTTTTTTTtKCC....",
    ".....OCCKtTTTTGTTTTTTTTtKCC....",
    ".....OCcKtTTTTTTTTTTTTTtKcCO....",
    ".....OCcKtTTTTGTTTTTTTTtKcCO....",
    ".....OCcKtTTTTTTTTTTTTTtKcCO....",
    ".....OCcKtTTTTGTTTTTTTTtKcCO....",
    ".....OCcKKttttttttttttttKKcCO...",
    # ---- the belt and its gold buckle ----
    ".....OCCCCCKKKKKKKKKKCCCCCO.....",
    ".....OCCCCCkkkkkGGkkkkkCCCCCO...",
    # ---- the hem and the legs ----
    "......OCCCCCCCCCCCCCCCCCO.......",
    "......OPPPPPPPPPPPPPPPPO........",
    "......OPppppppppppppppO.........",
    "......OBBBBBBBBBBBBBBBBO........",
    "......OBBBBbBBBBBBBBBBbO........",
]

# ---------------------------------------------------------------------------
# The left-profile walk cycle. The torso/head is one base; the arms replace
# rows 27-34 and the legs replace rows 43-47 per frame. The trench hangs long
# with the collar up behind the neck, a gold-buckled belt, and a hem that
# flares with the stride.
# ---------------------------------------------------------------------------
PROFILE_TOP = [
    # ---- head: face forward-left, hair swept back with a tail ----
    "................................",
    "........HHHHHHHHHHHHH..........",
    ".......HHHLHHHHHHHLHHH.........",
    "......HHHHHHHHHHHHHHHH.........",
    "......HHhHLHHHHHHHLHHH.........",
    "......LLhHHHHHHHHHHHH.........",
    "......LLHSSSSSSSSSSSSH........",
    # ---- brow (two pixels tall) and the eye ----
    ".......hHSSHHSSSSSSSSS.........",
    ".......hHSSHHSSSSSSSSS.........",
    ".......hSSSWdSSSSSSSS.........",
    # ---- nose ----
    ".......hSSSdSSSSSSSSS.........",
    "......OhSSSdSSSSSSSSS.........",
    ".....OOSSSSdSSSSSSSS.........",
    "......OdSSSssSSSSSSS.........",
    # ---- stubble and the frown ----
    ".......hssssssssssss.........",
    ".......hssDDDDssssss.........",
    ".......hssssDDssssss.........",
    ".......hssssssssssss.........",
    # ---- chin, jaw and the collar-up flap ----
    "......OhSSSSSSSSSSSS.........",
    ".....OOSSSSSSSSSSSS.........",
    "......OdSSSSSSSSSSCC........",
    ".......OSSSSSSSSSSCC.........",
    ".......OSSSSSSSSSSCC.........",
    # ---- shoulders ----
    ".....OCCCSSSSSSSSSCCCO........",
    "....OCCCSSSSSSSSSSCCCO........",
    # ---- torso: shirt and the tie hanging in the coat's opening ----
    "....OCcKTTTRRTTTTKCCCCCCO......",
    "....OCcKTTTRRRRTTKCCCCCCO......",
    "....OCcKTTTTRRRTTTKCCCCCCO......",
    # ---- rows 27-34 are replaced per frame by ARMS ----
    "....OCcKTTTTRRRTTTKCCCCCCO......",
    "....OCcKTTTTRRRTTTKCCCCCCO......",
    "....OCcKTTTTTTTTTKCCCCCCO......",
    "....OCcKTTTTTTTTTKCCCCCCO......",
    "....OCcKTTTTTTTTTKCCCCCCO......",
    "....OCcKTTTTTTTTTKCCCCCCO......",
    "....OCcKTTTTTTTTTKCCCCCCO......",
    "....OCcKTTTTTTTTTKCCCCCCO......",
    # ---- lapels close, the belt with its buckle, the hem ----
    "....OCcKKTTTTTTTTKKCCCCCCO......",
    "....OCcCCCCCCCCCCCCCCCCCO.......",
    "....OCcCCCCCCCCCCCCCCCCCO.......",
    "....OCcCCCCKKKKKKKKKKCCCO.......",
    "....OCcCCCCkkkkkGGkkkkCCCO......",
    "....OCCCCCCCCCCCCCCCCCCO........",
    # ---- rows 41-47 are replaced per frame by LEGS ----
    "....OCCCCCCCCCCCCCCCCCCO........",
    "....OCCCCCCCCCCCCCCCCCCO........",
    "....OCCCCCCCCCCCCCCCCCCO........",
    "....OCCCCCCCCCCCCCCCCCCO........",
    "....OCCCCCCCCCCCCCCCCCCO........",
    "....OCCCCCCCCCCCCCCCCCCO........",
    "....OCCCCCCCCCCCCCCCCCCO........",
]

# Leg poses, rows 43..47. Each is 5 rows: three of trousers, two of boots.
LEGS = [
    # A: standing / passing — weight centred
    [
        "......OPPPP......PPPO..........",
        "......OPPPp......pPPO..........",
        "......OPPPp......pPPO..........",
        "......OPPPp......pPPO..........",
        "......OBBBB......BBBO..........",
        "......OBBBB......BBBO..........",
    ],
    # B: the front leg strides out, the rear leg straightens — the stride
    [
        "....OPPP.......OPPPO..........",
        "....OPPPp......pPPPO..........",
        "....OPPPp......pPPPO..........",
        "....OPPPp......pPPPO..........",
        "....OBBBB......OBBBO..........",
        "....OBBBB......OBBBO..........",
    ],
    # C: passing — legs together mid-stride
    [
        "......OPPPP....pPPPO..........",
        "......OPPPp....pPPPO..........",
        "......OPPPp....pPPPO..........",
        "......OPPPp....pPPPO..........",
        "......OBBBB....BBBBO..........",
        "......OBBBB....BBBBO..........",
    ],
    # D: the rear leg comes through, the front leg lifts — the other stride
    [
        ".....OPPPO.....OPPP...........",
        ".....OPPPp.....pPPP...........",
        ".....OPPPp.....pPPP...........",
        ".....OPPPp.....pPPP...........",
        ".....OBBBO.....OBBB...........",
        ".....OBBBO.....OBBB...........",
    ],
]

# Arms per frame (rows 27-34): coat sleeves with gloved hands, the near arm
# swinging against the stride.
ARMS = [
    [  # A — both sleeves hang along the coat
        "....OCcKTTTTRRRTTTKCCCCCCO......",
        "....OCcKTTTTRRRTTTKCCCCCCO......",
        "....OCcKTTTTTTTTTKCCCCCCO......",
        "....OCcKTTTTTTTTTKCCCCCCO......",
        "....OCcKTTTTTTTTTKCCCCCCO......",
        "....OCcKTTTTTTTTTKCCCCCCO......",
        "....OCcKTTTTTTTTTKCCCCCCO......",
        "....OCcKTTTTTTTTTKCCCCCCO......",
    ],
    [  # B — the front arm reaches forward, hand showing
        "....OCcKTTTTRRRTTTKCCCCCCO......",
        "...OCCcKTTTTRRRTTKCCCCCCO.......",
        "...OCCcKTTTTTTTTKCCCCCCO.......",
        "...OCCcKTTTTTTTTKCCCCCCO.......",
        "...OCSScKTTTTTTTKCCCCCCO.......",
        "....OSScKTTTTTTTKCCCCCCO........",
        "....OSSSCKTTTTTTKCCCCCCO........",
        ".....OSSCKTTTTTTKCCCCCCO........",
    ],
    [  # C — sleeves hang again, mid-stride
        "....OCcKTTTTRRRTTTKCCCCCCO......",
        "....OCcKTTTTRRRTTTKCCCCCCO......",
        "....OCcKTTTTTTTTTKCCCCCCO......",
        "....OCcKTTTTTTTTTKCCCCCCO......",
        "....OCcKTTTTTTTTTKCCCCCCO......",
        "....OCcKTTTTTTTTTKCCCCCCO......",
        "....OCcKTTTTTTTTTKCCCCCCO......",
        "....OCcKTTTTTTTTTKCCCCCCO......",
    ],
    [  # D — the arm swings back along the body
        "....OCcKTTTTRRRTTTKCCCCCCO......",
        ".....OCcKTTTTRRTTKCCCCCCO.......",
        ".....OCcKTTTTTTTKCCCCCCO.......",
        ".....OCcKTTTTTTTKCCCCCCO.......",
        ".....OCcKTTTTTTTKCCCCCCO.......",
        ".....OCcKTTTTTTTKCCCCCCO.......",
        ".....OCcKTTTTTTTKCCCCCCO.......",
        "......OCcKTTTTTKCCCCCCO........",
    ],
]
def face_frame() -> Image.Image:
    img = Image.new("RGBA", (CELL_W, CELL_H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw_map(draw, FACE, 0, 0)
    return img


def profile_frame(leg_idx: int) -> Image.Image:
    img = Image.new("RGBA", (CELL_W, CELL_H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    top = list(PROFILE_TOP)
    # The arms own rows 27-34 and the legs own rows 43-47: the base torso is
    # the coat, and each frame layers the swing of the sleeve and the stride
    # of the trousers over it.
    top[27:35] = ARMS[leg_idx]
    draw_map(draw, top, 0, 0)
    draw_map(draw, LEGS[leg_idx], 0, 41)
    # A little bob: frames B and D are the stride, so the body rides 1px high.
    if leg_idx in (1, 3):
        img = img.crop((0, -1, CELL_W, CELL_H - 1)).resize(
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
# The roll strip: derived from the face-on frame, exactly like Anands'.
# Cells 0-7 roll right; 8-15 mirror them.
# ---------------------------------------------------------------------------
ROLL_CELL_W = 40


def ball_frame(face: Image.Image) -> Image.Image:
    """A curled body: an ellipse of coat with the real head pasted on.""",
    cell = Image.new("RGBA", (ROLL_CELL_W, CELL_H), (0, 0, 0, 0))
    d = ImageDraw.Draw(cell)
    # The tucked body, in the coat's palette.
    d.ellipse([10, 30, 34, 46], fill=COAT_SHADE)
    d.ellipse([12, 30, 30, 44], fill=COAT)
    d.ellipse([14, 30, 28, 43], fill=COAT_LIGHT)
    d.ellipse([16, 30, 26, 42], fill=COAT)
    d.ellipse([21, 26, 24, 30], fill=TRIM)
    # The actual head, cropped from the sheet's face frame.
    head = face.crop((6, 0, 26, 19)).resize((14, 13), Image.NEAREST)
    cell.alpha_composite(head, (15, 21))
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
