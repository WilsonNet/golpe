#!/usr/bin/env python3
"""Generate Jeffs' pixel-art sprite sheets: the nine-frame character strip and
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

Pixel-art rules this sheet follows (the old sheet broke all of them, which is
why it read as a flat block: a head half the sprite tall, single-pixel eyes
floating in a skin fill, legs that never lifted):

- Real proportions: the head is 10px on a 44px figure, with a neck, sloped
  shoulders and a coat skirt that ends above the knee — a trench covers the
  thigh, so the walk animates the shins, the boots and the hem, not the hips.
- Light from the upper left: every material carries a light/base/shade ramp
  and the left edges catch the light while the right edges fall to shade.
- Outline only on the silhouette: the dark navy edge never cuts through the
  face or the shirt, so the features sit in the light instead of in jail.
- A four-beat walk: contact, passing, contact, passing. The contact frames
  plant wide and ride 1px low, the passing frames pull the feet under the body
  and ride high, the hem kicks against the stride and the near arm
  counter-swings. Frame 0 doubles as the idle, so the contacts are closed
  stances, not mid-splits.
- Rotations stay NEAREST: a BICUBIC spin on 32px art smears every edge into
  grey mush, which is what the old roll strip did.

Usage: python3 scripts/make-jeffs-art.py
"""

from PIL import Image, ImageDraw

OUT_DIR = "public/assets"
CELL_W, CELL_H = 32, 48
GROUND_LINE = 46
ROLL_OUT = f"{OUT_DIR}/jeffs-roll.png"
STRIP_OUT = f"{OUT_DIR}/jeffs.png"

# ---- palette -------------------------------------------------------------
# Each region carries a light/base/shade ramp with the light struck from the
# upper left. The outline is deep navy, the SNES look.
OUT = (26, 20, 44)          # silhouette outline only
SKIN_L = (250, 222, 190)    # forehead, nose bridge, cheek light
SKIN = (238, 194, 152)      # weathered skin base
SKIN_S = (204, 156, 118)    # jaw, right side, under-brow
STUBBLE = (148, 108, 86)    # jaw checker, sideburns
HAIR = (74, 64, 60)         # greying brown, slicked back
HAIR_S = (46, 40, 42)       # under-side, back mass
GREY = (184, 176, 164)      # temples, top sheen: the middle-aged tell
BROW = (52, 44, 46)         # heavy brows
EYE_W = (244, 238, 232)     # eye white (kept narrow: narrowed eyes)
EYE_D = (32, 28, 38)        # pupil / lash line
NOSE_S = (170, 126, 96)     # nose shadow
MOUTH = (96, 52, 52)        # frown
COAT_L = (104, 116, 140)    # lapel edges, left shoulder light
COAT = (52, 60, 78)         # charcoal trench base
COAT_S = (36, 42, 58)       # right side, under-arm, skirt folds
COAT_D = (24, 28, 42)       # deep folds, collar under-side, hem vent
GOLD = (216, 176, 92)       # buttons, buckle
GOLD_S = (146, 110, 54)     # button shade, buckle shade
SHIRT = (240, 236, 228)
SHIRT_S = (198, 190, 180)
TIE = (186, 58, 48)
TIE_S = (130, 36, 32)
TIE_L = (224, 118, 96)      # knot catch-light
PANTS = (58, 50, 54)
PANTS_S = (40, 34, 38)
BOOTS = (46, 36, 38)
BOOTS_S = (28, 22, 26)
BOOTS_L = (104, 82, 82)     # toe cap light

CHARS = {
    ".": None,
    "O": OUT,
    "S": SKIN,
    "L": SKIN_L,
    "s": SKIN_S,
    "d": STUBBLE,
    "H": HAIR,
    "h": HAIR_S,
    "G": GREY,
    "B": BROW,
    "W": EYE_W,
    "E": EYE_D,
    "N": NOSE_S,
    "M": MOUTH,
    "C": COAT,
    "c": COAT_S,
    "k": COAT_D,
    "K": COAT_L,
    "D": GOLD,
    "g": GOLD_S,
    "T": SHIRT,
    "t": SHIRT_S,
    "R": TIE,
    "r": TIE_S,
    "n": TIE_L,
    "P": PANTS,
    "p": PANTS_S,
    "V": BOOTS,
    "v": BOOTS_S,
    "U": BOOTS_L,
}


def paint(rows: list[str], ox: int = 0, oy: int = 0) -> Image.Image:
    """Paint row-string maps at 1:1 onto a fresh 32x48 cell.

    Every row must be exactly 32 chars: a short row used to silently right-pad
    and shift nothing, but it hid typos for a year, so now it fails loudly.
    """
    img = Image.new("RGBA", (CELL_W, CELL_H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    for y, row in enumerate(rows):
        if len(row) != CELL_W:
            raise ValueError(f"row {y} is {len(row)} chars, expected {CELL_W}: {row!r}")
        for x, ch in enumerate(row):
            colour = CHARS.get(ch)
            if colour is None:
                continue
            draw.point([(ox + x, oy + y)], fill=colour + (255,))
    return img


def layer(base: Image.Image, rows: list[str], oy: int = 0) -> Image.Image:
    """Paint row-strings over an existing cell (limbs over the torso)."""
    draw = ImageDraw.Draw(base)
    for y, row in enumerate(rows):
        if len(row) != CELL_W:
            raise ValueError(f"row {y} is {len(row)} chars, expected {CELL_W}: {row!r}")
        for x, ch in enumerate(row):
            colour = CHARS.get(ch)
            if colour is None:
                continue
            draw.point([(x, oy + y)], fill=colour + (255,))
    return base


# ---------------------------------------------------------------------------
# The face-on frame: the portrait. Head rows 2-14 on a 44px figure — a neck,
# sloped shoulders and a tapered jaw replace the old sheet's floating block.
#
# The face is set and weathered: slicked-back hair with a grey sheen and grey
# temples, heavy brows sloping down toward the nose, narrowed tieknot eyes
# (dark lash lines, not googly whites), a small nose with shadow under it,
# checker stubble across the jaw and a two-row frown. Light strikes the left:
# the left cheek carries the light tone, the right falls to shade.
# ---------------------------------------------------------------------------
FACE = [
    "................................",  # 0
    "................................",  # 1
    "..........OOHHHHHHHHOO..........",  # 2 crown
    "........OOHHHHHHHHHHHHOO........",  # 3 full hair
    "........OHGGHHHHHHHHGGHO........",  # 4 grey sheen + temples
    "........OHhHHHHHHHHHHhHO........",  # 5 shaded sides
    "........OHhHLLSSSSLHHhHO........",  # 6 hairline, lit forehead
    "........OddHSSSSSSSSHddO........",  # 7 sideburns start
    "........OdsSBBBSSBBBSsdO........",  # 8 heavy brows
    "........OdsSEESSSSEESsdO........",  # 9 narrowed lash-line eyes
    "........OdsSSSNSSSNSSsdO........",  # 10 nose bridge shadow
    "........OddSSSNNSNSSSddO........",  # 11 nose + shadow under
    "........OddSSMMMMMMSSddO........",  # 12 frown, upper lip
    "........OdsSdMMMMMMdSSsdO.......",  # 13 frown corners pull down
    "........OdsSdddddddSSsdO........",  # 14 stubble chin
    "................................",  # 15
]

# Every row must be exactly one cell wide; fail fast, not silently shifted.

assert all(len(r) == CELL_W for r in FACE), "face map miscounted"

# ---------------------------------------------------------------------------
# The face-on torso: collar-up trench, white shirt V, knotted red tie,
# double-breasted gold buttons, gold-buckled belt, skirt with a centre vent.
# Rows 15-38; the legs (rows 38-46) are per-frame so the walk can stride.
# {hem} shifts the skirt 1px against the stride for secondary motion.
# ---------------------------------------------------------------------------
TORSO_FRONT = [
    ".............OSSSSO.............",  # 15 neck
    ".............OSSSSO.............",  # 16 neck meets collar
    "........OOOOTTTTTTTTOOOO........",  # 17 collar wings + shirt
    ".......OCCKTTTTTTTTTTKCCO.......",  # 18 shoulders catch light left
    "......OCCCKTTTRRRRTTTTKCCCO.....",  # 19 lapels open, knot appears
    "......OCKKtTTRnRRRTTTTtKCCO.....",  # 20 knot with catch-light
    ".....OCKKtTTTRRRRRTTTTtKKCCO....",  # 21 tie shaft
    ".....OCKKtTTTRRRRRTTTTtKKCCO....",  # 22
    ".....OCcKtTTTRRrRRTTTTtKcCCO....",  # 23 shade on the right
    ".....OCcKtTTTRRrRRTTTTtKcCCO....",  # 24
    ".....OCcKDTtTRRrRRTTtTDKcCCO....",  # 25 first gold buttons
    ".....OCcKtTTTRRrRRTTTTtKcCCO....",  # 26
    ".....OCcKDTtTRRrRRTTtTDKcCCO....",  # 27 second gold buttons
    ".....OCcKtTTTRRrRRtTTTtKcCCO....",  # 28 shirt narrows to the belt
    ".....OCcKKttttttttttttKKcCCO....",  # 29 shirt hem shade
    ".....OCCCCCKKKKKKKKKKCCCCCO.....",  # 30 belt strap, lit top edge
    ".....OCCCCCkkkDDDDDDkkkCCCCCO...",  # 31 buckle in gold
    ".....OCCCCCkkkDggggDkkkCCCCCO...",  # 32 buckle shade row
    "......OCCCCCCCCCCCCCCCCCCCO.....",  # 33 skirt, hem begins
    "......OCcCCCCCCCCCCCCCCcCCO.....",  # 34 fold shade right
    "......OCcCCCCkCCCCkCCCCcCCO.....",  # 35 vent folds
    "......OCcCCCCkCCCCkCCCCcCCO.....",  # 36
    "......OKcCCCCkCCCCkCCCCcCCO.....",  # 37 left hem catches light
    "......OOOCCCCCkCCkCCCCCCOOO.....",  # 38 hem points, vent opens
]

assert all(len(r) == CELL_W for r in TORSO_FRONT), "torso map miscounted"

# Legs, rows 38-46 (9 rows each). A/C are the planted contacts (wide, 1px
# low — the bob), B/D the passing frames (feet under the body, lifted heels).
# Every boot has a lit toe cap so the feet read against the dark floor.
LEGS_FRONT = [
    [  # A — contact: left foot out, right planted (also the idle)
        "......OOO.............OOO.......",
        "......OPPO............OPPO......",
        "......OPPO............OPPO......",
        "......OPpO............OpPO......",
        "......OPpO............OpPO......",
        "......OPpO............OpPO......",
        ".....OVVVO...........OVVVO......",
        ".....OVUvO...........OUvVO......",
        ".....OvvvO...........OvvvO......",
    ],
    [  # B — passing: feet under the body, right heel lifted
        "................................",
        "..........OOOO....OOOO..........",
        "..........OPPO....OPPO..........",
        "..........OPpO....OpPO..........",
        "..........OPpO....OpPO..........",
        "..........OPpO....OVVO..........",
        "..........OVVO....OUvO..........",
        "..........OUvO.....OvvO.........",
        "..........OvvO..................",
    ],
    [  # C — contact, mirrored: right foot out
        "......OOO.............OOO.......",
        "......OPPO............OPPO......",
        "......OPPO............OPPO......",
        "......OpPO............OPpO......",
        "......OpPO............OPpO......",
        "......OpPO............OPpO......",
        "......OVVVO...........OVVVO.....",
        "......OVvUO...........OVUvO.....",
        "......OvvvO...........OvvvO.....",
    ],
    [  # D — passing, mirrored: left heel lifted
        "................................",
        "..........OOOO....OOOO..........",
        "..........OPPO....OPPO..........",
        "..........OPPO....OpPO..........",
        "..........OpPO....OpPO..........",
        "..........OVVO....OpPO..........",
        "..........OUvO....OVVO..........",
        "...........OvvO...OUvO..........",
        "..................OvvO..........",
    ],
]

# Sleeves + hands, rows 17-33 (17 rows). The coat sleeve covers to the wrist;
# the hand is two skin pixels. Contacts counter-swing against the feet.
ARMS_FRONT = [
    [  # A — left arm forward (hand low-front), right arm back
        "......OCKK......................",
        ".....OCCKO......................",
        ".....OCCKO......................",
        ".....OCCKO......................",
        ".....OCCKO......................",
        ".....OCCKO......................",
        ".....OCCKO......................",
        ".....OCCKO......................",
        ".....OCCKO......................",
        ".....OCCKO......................",
        ".....OCCKO......................",
        ".....OCCKO......................",
        ".....OSSKO......................",
        ".....OSSSO......................",
        "......OSSO......................",
        "................................",
        "................................",
    ],
    [  # B — passing: both sleeves hang mid
        "......OCKK......................",
        ".....OCCKO......................",
        ".....OCCKO......................",
        ".....OCCKO......................",
        ".....OCCKO......................",
        ".....OCCKO......................",
        ".....OCCKO......................",
        ".....OCCKO......................",
        ".....OCCKO......................",
        ".....OCCKO......................",
        ".....OCCKO......................",
        ".....OCCKO......................",
        ".....OCCKO......................",
        ".....OSSKO......................",
        ".....OSSSO......................",
        "......OSSO......................",
        "................................",
    ],
    [  # C — mirror of A
        "......................KKCO......",
        "......................OKCCO.....",
        "......................OKCCO.....",
        "......................OKCCO.....",
        "......................OKCCO.....",
        "......................OKCCO.....",
        "......................OKCCO.....",
        "......................OKCCO.....",
        "......................OKCCO.....",
        "......................OKCCO.....",
        "......................OKCCO.....",
        "......................OKCCO.....",
        "......................OKSSO.....",
        "......................OSSSO.....",
        "......................OSSO......",
        "................................",
        "................................",
    ],
    [  # D — mirror of B
        "......................KKCO......",
        "......................OKCCO.....",
        "......................OKCCO.....",
        "......................OKCCO.....",
        "......................OKCCO.....",
        "......................OKCCO.....",
        "......................OKCCO.....",
        "......................OKCCO.....",
        "......................OKCCO.....",
        "......................OKCCO.....",
        "......................OKCCO.....",
        "......................OKCCO.....",
        "......................OKCCO.....",
        "......................OKSSO.....",
        "......................OSSSO.....",
        "......................OSSO......",
        "................................",
    ],
]


def face_frame() -> Image.Image:
    img = paint(FACE, 0, 0)
    layer(img, TORSO_FRONT, 15)
    layer(img, LEGS_FRONT[0], 38)
    layer(img, ARMS_FRONT[1], 17)
    return img


def front_walk_frame(i: int) -> Image.Image:
    """Face-on walk is only used for the turn frame's neighbours; the real
    walk cycle is the profile. Still, keep it honest: bob + stride + swing."""
    img = paint(FACE, 0, -1 if i in (1, 3) else 0)
    layer(img, TORSO_FRONT, 15 + (-1 if i in (1, 3) else 0))
    layer(img, LEGS_FRONT[i], 38)
    layer(img, ARMS_FRONT[i], 17)
    return img


# ---------------------------------------------------------------------------
# The left-profile walk cycle. Side view facing left: the hair sweeps back,
# the nose protrudes past the face line, one narrowed eye looks left, the
# collar stands up behind the neck, and the coat opens at the front edge with
# the tie's edge showing. Legs stride heel-to-toe; the near arm swings from
# the shoulder against the legs.
# ---------------------------------------------------------------------------
PROFILE_HEAD = [
    "................................",  # 0
    "................................",  # 1
    "..........OOHHHHHHHHHHO.........",  # 2 crown sweeps back
    ".........OHHHHHHHHHHHHHO........",  # 3
    ".........OHGGHHHHHHHHHHHO.......",  # 4 grey temple at the front
    ".........OHhHHHHHHHHHHHhO.......",  # 5
    ".........OhHLLSSSSSSShhO........",  # 6 forehead in profile
    ".........OddHSSSSSSSSShhO.......",  # 7 temple, front sideburn
    ".........OddHSBBBSSSSShhO.......",  # 8 brow over the eye's front
    ".........OddHSEWSSSSSSShO.......",  # 9 eye looks left: pupil front
    ".........OddHSSSSSSSSShhO.......",  # 10 cheek
    ".........OddHSSSSSSSSShhO.......",  # 11 nose bridge still inside
    ".......OSSSSSSSSSSSShhO.........",  # 12 nose tip leaves the face line
    ".......OSSSSSNNSSSSShhO.........",  # 13 nose base shadow
    "........OSSSSMMSSSSSShhO........",  # 14 frown under the nose
    "........OSSSSddSSSShhO..........",  # 15 stubble jaw
    "........OSSSddSSShhOO...........",  # 16 chin tucks back
    ".........OSSSddSSShkO...........",  # 17 jaw to the neck
    ".........OOddHSSSkkO............",  # 18 collar-up flap rises behind
    ".........OOOTTSkCCkO............",  # 19 neck meets collar
]

assert all(len(r) == CELL_W for r in PROFILE_HEAD), "profile head miscounted"

PROFILE_TORSO = [
    "........OOOTTSkCCkKO............",  # 20 collar stands, shirt edge
    ".......OCCKTTTSkCCCCCkO.........",  # 21 shoulder
    "......OCCCKTTTRRSkCCCCCkO.......",  # 22 tie edge in the opening
    "......OCCKTTTRRRRSkCCCCCkO......",  # 23 tie edge in the opening
    "......OCCKTTTRRrRSkCCCCCkO......",  # 24
    "......OCCKTTTRRrRSkCCCCCkO......",  # 25 tie shade
    "......OCCKTTTRRrRSkCCCCCkO......",  # 26
    "......OCcKTTTRRrRSkCCCCCkO......",  # 27 right edge falls to shade
    "......OCcKTTTRRrRSkCCCCCkO......",  # 28
    "......OCcKDTTRrRSTkCCCCCkO......",  # 29 gold button
    "......OCcKTTTRRrRSkCCCCCkO......",  # 30
    "......OCcKDTTRrRSTkCCCCCkO......",  # 31 gold button
    "......OCcKKttttttSkCCCCCkO......",  # 32 shirt hem to belt
    "......OCCCCKKKKKKKKCCCCCkO......",  # 33 belt, lit top
    "......OCCCCkkDDDDkkCCCCCkO......",  # 34 buckle
    "......OCCCCkkDggDkkCCCCCkO......",  # 35 buckle shade
    "......OCCCCCCCCCCCCCCCCkO.......",  # 36 skirt
    "......OCcCCCCCCCCCCCCcCkO.......",  # 37 folds
    "......OCcCCCkCCCCkCCcCCkO.......",  # 38 vent folds
    "......OKcCCCkCCCCkCCcCCkO.......",  # 39 hem light left
    "......OOOCCCkCCCCkCCCCCkOO......",  # 40 hem points
]

assert all(len(r) == CELL_W for r in PROFILE_TORSO), "profile torso miscounted"

# Profile legs, rows 40-46 (7 rows). Facing left: negative x is forward.
# A: left leg reaches forward, right leg trails back. B: left plants under the
# body, right knee bends with the heel kicked up. C/D mirror.
LEGS_PROFILE = [
    [  # A — stride: front foot forward, rear foot back on its toe
        "....OOO...............OO........",
        "...OPPPO.............OPPO.......",
        "...OPpPO.............OPpO.......",
        "...OPpPO.............OPpO.......",
        "...OVVVO.............OPpO.......",
        "...OUvVO..............OVO.......",
        "...OvvvO..............OvO.......",
    ],
    [  # B — passing: front leg plants, rear heel kicks up behind
        "..........OOO...................",
        ".........OPPPO.....OOOO.........",
        ".........OPpPO.....OPpO.........",
        ".........OPpPO.....OPpO.........",
        ".........OVVVO......OPpO........",
        ".........OUvVO......OVVO........",
        ".........OvvvO......OUO.........",
    ],
    [  # C — stride mirrored: right leg forward
        ".........OO...............OOO...",
        "........OPPO.............OPPPO..",
        "........OPpO.............OPpPO..",
        "........OPpO.............OPpPO..",
        "........OPpO.............OVVVO..",
        ".........OVO..............OVuVO.",
        ".........OvO..............OvvvO.",
    ],
    [  # D — passing mirrored
        "....................OOO.........",
        "..........OOOO.....OPPPO........",
        "..........OPpO.....OPpPO........",
        "..........OPpO.....OPpPO........",
        "...........OPpO.....OVVVO.......",
        "...........OVVO.....OVuVO.......",
        "............OUO.....OvvvO.......",
    ],
]

# Near arm swings from the shoulder (x13, y22). Sleeve 2px, hand 2x2 skin.
ARMS_PROFILE = [
    [  # A — arm swings back while the left leg goes forward
        ".............CC.................",
        ".............CC.................",
        ".............CCC................",
        "..............CCC...............",
        "..............CCCC..............",
        "...............CCC..............",
        "...............SSO..............",
        "...............SSO..............",
    ],
    [  # B — arm hangs mid, hand at the hip
        "............CC..................",
        "............CC..................",
        "............CC..................",
        "............CC..................",
        "............CC..................",
        "............CC..................",
        "............SSO.................",
        "............SSO.................",
    ],
    [  # C — arm swings forward, hand leading
        "...........CC...................",
        "..........CCC...................",
        ".........CCC....................",
        ".........CC.....................",
        "........CCC.....................",
        "........CC......................",
        ".......OSSO.....................",
        ".......OSSO.....................",
    ],
    [  # D — arm returns through mid
        "............CC..................",
        "............CC..................",
        "............CC..................",
        "............CC..................",
        "............CC..................",
        "............CC..................",
        "............SSO.................",
        "............SSO.................",
    ],
]


def profile_frame(leg_idx: int) -> Image.Image:
    bob = -1 if leg_idx in (1, 3) else 0
    img = paint(PROFILE_HEAD, 0, bob)
    layer(img, PROFILE_TORSO, 20 + bob)
    layer(img, LEGS_PROFILE[leg_idx], 40)
    layer(img, ARMS_PROFILE[leg_idx], 23 + bob)
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
# The roll strip: rotation frames stay NEAREST so the pixels survive the spin,
# and the tucked ball is a stepped pixel ellipse in the coat's own palette —
# light crown, gold button winking out — with the real head tucked under it.
# Cells 0-7 roll right; 8-15 mirror them.
# ---------------------------------------------------------------------------
ROLL_CELL_W = 40


def stepped_ball(cx: int, ground_y: int) -> Image.Image:
    """A curled body as stepped scanlines: crisp at 1:1, no smeared ellipse.

    A low tuck centred on (cx, ground_y - 7): the coat's crown catches the
    light on top, the gold button winks out of the side, and the head (pasted
    separately) tucks into the front, not on top — a snowman is not a roll.
    """
    cell = Image.new("RGBA", (ROLL_CELL_W, CELL_H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(cell)
    # (y-offset from ground, half-width, colour).
    rows = [
        (1, 7, COAT_D),
        (2, 10, COAT_S),
        (3, 12, COAT),
        (4, 13, COAT),
        (5, 14, COAT),
        (6, 14, COAT_L),
        (7, 13, COAT_L),
        (8, 12, COAT),
        (9, 11, COAT),
        (10, 9, COAT_S),
        (11, 7, COAT_S),
        (12, 5, COAT_D),
        (13, 3, COAT_D),
    ]
    for dy, hw, col in rows:
        y = ground_y - dy
        draw.line([(cx - hw, y), (cx + hw, y)], fill=col + (255,))
    # Outline the silhouette ends.
    for dy, hw in [(dy, hw) for dy, hw, _ in rows]:
        y = ground_y - dy
        draw.point([(cx - hw - 1, y)], fill=OUT + (255,))
        draw.point([(cx + hw + 1, y)], fill=OUT + (255,))
    # The gold button winks out of the tuck — the coat's signature.
    draw.point([(cx - 3, ground_y - 6)], fill=GOLD + (255,))
    draw.point([(cx - 2, ground_y - 6)], fill=GOLD_S + (255,))
    return cell


def ball_frame(face: Image.Image) -> Image.Image:
    cell = stepped_ball(ROLL_CELL_W // 2 - 2, GROUND_LINE)
    # The actual head tucked into the roll's leading (right) end, chin down:
    # the grey temples stay readable so the ball is unmistakably Jeffs.
    head = face.crop((10, 2, 22, 15)).resize((12, 11), Image.NEAREST)
    cell.alpha_composite(head, (ROLL_CELL_W // 2 + 4, GROUND_LINE - 10))
    return cell


def build_roll() -> None:
    face = face_frame()
    right: list[Image.Image] = []
    for i in range(8):
        angle = (i * 60 + 15) % 360
        if i in (3, 4):
            right.append(ball_frame(face))
            continue
        # NEAREST keeps the pixels crisp; BICUBIC turned the spin to mush.
        rot = face.rotate(-angle, expand=True, resample=Image.NEAREST)
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
