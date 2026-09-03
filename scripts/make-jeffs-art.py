#!/usr/bin/env python3
"""Generate Jeffs' pixel-art sprite sheets: the nine-frame character strip and
the sixteen-cell roll strip, in the Chrono Trigger / SNES style the project
commits to.

The layout is fixed by the game, not by this script:

- `jeffs.png`  — 576x96, nine 64x96 cells: 0-3 walk left, 4 face-on, 5-8 walk
  right (mirrors of 0-3). 2x art drawn at half size through `sheetScale` —
  the Anands standard: the collider stays 32x48, the pixels double, and the
  hero-select portrait, the ultimate cinematic and the move list all read
  crisp instead of blocky.
- `jeffs-roll.png` — 1280x96, sixteen 80x96 cells: 0-7 roll right, 8-15 roll
  left (mirrors). Derived from the face-on frame by rotation and a curled
  "ball" pose, exactly like `make-roll-art.py` does for the dude.

Jeffs is a middle-aged man in a fancy trench coat: greying slicked-back hair
with grey temples, heavy brows over narrowed eyes, a small nose with shadow
under it, stubble across a frowning jaw, a white shirt with a red tie, a dark
charcoal coat with gold buttons and a gold-buckled belt, the collar up. The
palette is the sheet's contract — the hit poses are derived from this sheet in
code (`createHeroPoses`), so the colours here are what the whole hero is drawn
from.

Pixel-art rules this sheet follows:

- Real proportions: the head is 20px on an 88px figure, with a neck, sloped
  shoulders and a coat skirt that ends above the knee — a trench covers the
  thigh, so the walk animates the shins, the boots and the hem, not the hips.
- Light from the upper left: every material carries a light/base/shade ramp
  and the left edges catch the light while the right edges fall to shade.
- Outline only on the silhouette: the dark navy edge never cuts through the
  face or the shirt, so the features sit in the light instead of in jail.
- A four-beat walk: contact, passing, contact, passing. The contact frames
  plant wide and ride 2px low, the passing frames pull the feet under the body
  and ride high, the hem kicks against the stride and the near arm
  counter-swings. Frame 0 doubles as the idle, so the contacts are closed
  stances, not mid-splits.
- Rotations stay NEAREST: a BICUBIC spin on pixel art smears every edge into
  grey mush.
- 2x earns its keep in the face: eyes carry pupils and glints, brows slope
  over two rows, stubble is dithered rather than banded, and the hair has
  strand separations — the face-on frame is the hero-select portrait and the
  ultimate card, so it is drawn, not doubled.

Usage: python3 scripts/make-jeffs-art.py
"""

from PIL import Image, ImageDraw

OUT_DIR = "public/assets"
CELL_W, CELL_H = 64, 96
GROUND_LINE = 92
ROLL_OUT = f"{OUT_DIR}/jeffs-roll.png"
STRIP_OUT = f"{OUT_DIR}/jeffs.png"

# ---- palette -------------------------------------------------------------
# Each region carries a light/base/shade ramp with the light struck from the
# upper left. The outline is deep navy, the SNES look.
OUT = (26, 20, 44)          # silhouette outline only
SKIN_L = (250, 222, 190)    # forehead, nose bridge, cheek light
SKIN = (238, 194, 152)      # weathered skin base
SKIN_S = (204, 156, 118)    # jaw, right side, under-brow
STUBBLE = (148, 108, 86)    # jaw dither, sideburns
HAIR = (74, 64, 60)         # greying brown, slicked back
HAIR_S = (46, 40, 42)       # under-side, back mass
HAIR_L = (104, 92, 86)      # strand separations in the light
GREY = (184, 176, 164)      # temples, top sheen: the middle-aged tell
GREY_S = (140, 132, 122)    # temple shade
BROW = (52, 44, 46)         # heavy brows
EYE_W = (244, 238, 232)     # eye white (kept narrow: narrowed eyes)
EYE_D = (32, 28, 38)        # pupil / lash line
GLINT = (255, 255, 255)     # eye catch-light, button shine, buckle shine
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
TIE_D = (222, 140, 120)     # tie stripe
PANTS = (58, 50, 54)
PANTS_S = (40, 34, 38)
PANTS_L = (86, 74, 78)      # crease catch-light
BOOTS = (46, 36, 38)
BOOTS_S = (28, 22, 26)
BOOTS_L = (104, 82, 82)     # toe cap light
SOLE = (20, 14, 16)         # boot sole line

CHARS = {
    ".": None,
    "O": OUT,
    "S": SKIN,
    "L": SKIN_L,
    "s": SKIN_S,
    "d": STUBBLE,
    "H": HAIR,
    "h": HAIR_S,
    "F": HAIR_L,
    "G": GREY,
    "y": GREY_S,
    "B": BROW,
    "W": EYE_W,
    "E": EYE_D,
    "I": GLINT,
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
    "J": TIE_D,
    "P": PANTS,
    "p": PANTS_S,
    "Q": PANTS_L,
    "V": BOOTS,
    "v": BOOTS_S,
    "U": BOOTS_L,
    "Z": SOLE,
}


# ---- face-on maps (2x base, refined below) ----
FACE = [
    "................................................................",
    "................................................................",
    "................................................................",
    "................................................................",
    ".........................OHHHHHHHHHHHHO.........................",
    ".........................OHHHHHHHHHHHHO.........................",
    ".....................OHHGGGGHHhHHhHHGGGGHHO.....................",
    ".....................OHHGGGGHHhHHhHHGGGGHHO.....................",
    "...................OGGGGHHHHHHhHHhHHHHHHGGGGO...................",
    "...................OGGhhHHHHHHhHHhHHHHHHhhGGO...................",
    "...................OhhHHHHSSSLLLLLLSSSHHHHhhO...................",
    "...................OddddSSSSSLLLLLLSSSSSddddO...................",
    "...................OsSSSSSSSSLLLLLLSSSSSSSSsO...................",
    "...................OsSSSSSSSSLLLLLLSSSSSSSSsO...................",
    "...................OsssSBBBBBSLLLLSBBBBBSsssO...................",
    "...................OssSSBBBBBBLLLLBBBBBBSSssO...................",
    "...................OsssSsEEEESLLLLSEEEESSsssO...................",
    "...................OsssSSIEEWSLLLLSIEEWSSsssO...................",
    "...................OsssSLSSSSSNNNNSSSSSsssssO...................",
    "..................OsSSSSLLSSSSNNNNSSSSSssSSSsO..................",
    "..................OsdddSSSSSSNNNNNNSSSSSsdddsO..................",
    "..................OsddddSSSSMMMMMMMMSSSSddddsO..................",
    "..................OsdddddMMMSSddddSSMMMdddddsO..................",
    "..................OsdSdSdSdSdSdSSdSdSdSdSdSdsO..................",
    "..................OsSdSdSdSdSdSddSdSdSdSdSdSsO..................",
    "...................OsdSdSdSdSdSddSdSdSdSdSdsO...................",
    "....................OsdSdSdSdSdSSdSdSdSdSdsO....................",
    ".....................OsSdSdSdSdSSdSdSdSdSsO.....................",
    ".......................OSdSdSdSSSSdSdSdSO.......................",
    ".........................OSSSSSSSSSSSSO.........................",
    "................................................................",
    "................................................................",
]


TORSO_FRONT = [
    "..........................OOSSSSSSSSOO..........................",
    "..........................OOSSSSSSSSOO..........................",
    "..........................OOSSSSSSSSOO..........................",
    "..........................OOSSSSSSSSOO..........................",
    "................OOOOOOOOTTTTTTTTTTTTTTTTOOOOOOOO................",
    "................OOOOOOOOTTTTTTTTTTTTTTTTOOOOOOOO................",
    "..............OOCCCCKKTTTTTTTTTTTTTTTTTTTTKKCCCCOO..............",
    "..............OOCCCCKKTTTTTTTTTTTTTTTTTTTTKKCCCCOO..............",
    "............OOCCCCCCKKTTTTTTRRRRRRRRTTTTTTTTKKCCCCCCOO..........",
    "............OOCCCCCCKKTTTTTTRRRRRRRRTTTTTTTTKKCCCCCCOO..........",
    "............OOCCKKKKttTTTTRRnnRRRRRRTTTTTTTTttKKCCCCOO..........",
    "............OOCCKKKKttTTTTRRnnRRRRRRTTTTTTTTttKKCCCCOO..........",
    "..........OOCCKKKKttTTTTTTRRRRRRRRRRTTTTTTTTttKKKKCCCCOO........",
    "..........OOCCKKKKttTTTTTTRRRRRRRRRRTTTTTTTTttKKKKCCCCOO........",
    "..........OOCCKKKKttTTTTTTRRRRJJJJRRTTTTTTTTttKKKKCCCCOO........",
    "..........OOCCKKKKttTTTTTTRRRRJJJJRRTTTTTTTTttKKKKCCCCOO........",
    "..........OOCCccKKttTTTTTTRRRRrrRRRRTTTTTTTTttKKccCCCCOO........",
    "..........OOCCccKKttTTTTTTRRRRrrRRRRTTTTTTTTttKKccCCCCOO........",
    "..........OOCCccKKttTTTTTTRRRRrrRRRRTTTTTTTTttKKccCCCCOO........",
    "..........OOCCccKKttTTTTTTRRRRrrRRRRTTTTTTTTttKKccCCCCOO........",
    "..........OOCCccKKIDTTttTTRRRRrrRRRRTTTTttTTIDKKccCCCCOO........",
    "..........OOCCccKKDDTTttTTRRRRrrRRRRTTTTttTTDDKKccCCCCOO........",
    "..........OOCCccKKttTTTTTTRRRRJJJJRRTTTTTTTTttKKccCCCCOO........",
    "..........OOCCccKKttTTTTTTRRRRJJJJRRTTTTTTTTttKKccCCCCOO........",
    "..........OOCCccKKIDTTttTTRRRRrrRRRRTTTTttTTIDKKccCCCCOO........",
    "..........OOCCccKKDDTTttTTRRRRrrRRRRTTTTttTTDDKKccCCCCOO........",
    "..........OOCCccKKttTTTTTTRRRRrrRRRRttTTTTTTttKKccCCCCOO........",
    "..........OOCCccKKttTTTTTTRRRRrrRRRRttTTTTTTttKKccCCCCOO........",
    "..........OOCCccKKKKttttttttttttttttttttttttKKKKccCCCCOO........",
    "..........OOCCccKKKKttttttttttttttttttttttttKKKKccCCCCOO........",
    "..........OOCCCCCCCCCCKKccKKKKKKccKKKKKKKKCCCCCCCCCCOO..........",
    "..........OOCCCCCCCCCCKKccKKKKKKccKKKKKKKKCCCCCCCCCCOO..........",
    "..........OOCCCCCCCCCCkkkkkkIDDDDDDDDDDIkkkkkkCCCCCCCCCCOO......",
    "..........OOCCCCCCCCCCkkkkkkDDDDDDDDDDDDkkkkkkCCCCCCCCCCOO......",
    "..........OOCCCCCCCCCCkkkkkkDDggggggggDDkkkkkkCCCCCCCCCCOO......",
    "..........OOCCCCCCCCCCkkkkkkDDggggggggDDkkkkkkCCCCCCCCCCOO......",
    "............OOCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCOO..........",
    "............OOCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCOO..........",
    "............OOCCccCCCCCCCCCCCCCCCCCCCCCCCCCCCCccCCCCOO..........",
    "............OOCCccCCCCCCCCCCCCCCCCCCCCCCCCCCCCccCCCCOO..........",
    "............OOCCccCCCCCCCCkkCCCCCCCCkkCCCCCCCCccCCCCOO..........",
    "............OOCCccCCCCCCCCkkCCCCCCCCkkCCCCCCCCccCCCCOO..........",
    "............OOCCccCCCCCCCCkkCCCCCCCCkkCCCCCCCCccCCCCOO..........",
    "............OOCCccCCCCCCCCkkCCCCCCCCkkCCCCCCCCccCCCCOO..........",
    "............OOKKccCCCCCCCCkkCCCCCCCCkkCCCCCCCCccCCCCOO..........",
    "............OOKKccCCCCCCCCkkCCCCCCCCkkCCCCCCCCccCCCCOO..........",
    "............OOOOOOCCCCCCCCCCkkCCCCkkCCCCCCCCCCCCOOOOOO..........",
    "............OOOOOOCCCCCCCCCCkkCCCCkkCCCCCCCCCCCCOOOOOO..........",
]



PROFILE_HEAD = [
    "................................................................",
    "................................................................",
    "................................................................",
    "................................................................",
    "...........................OHHHHHHHHHHHHO.......................",
    ".........................OHHHHHHHHHHHHHHHHO.....................",
    ".......................OHHGGGGHHHHHHHHHHhhO.....................",
    ".......................OHHGGGGHHHhHHHHhHhhO.....................",
    ".....................OGGGGHHHHHHHHHHHHHHGGhhO...................",
    ".....................OGGhhHHHHHHHHHHHHHHhhhhO...................",
    ".....................OhhHHHSSLLLLSSSSShhhhO.....................",
    ".....................OhhHHSSSSLLLLSSSShhhhO.....................",
    ".....................OddddSSSSLLLLSSSSShhhhO....................",
    ".....................OddddSSSSLLLLSSSSShhhhO....................",
    ".....................OddddSSSSLLLLSSSSShhhhO....................",
    ".....................OddddSSBBBBSSSSSSShhhhO....................",
    ".....................OddddSSBBBBBBSSSShhhhO.....................",
    ".....................OddddSSEEEESSSSSSSShhO.....................",
    ".....................OddddSSIEEWWSSSSShhhhO.....................",
    ".....................OddddSSSSSSSSSSSShhhhO.....................",
    ".....................OddddSSSSSSSSSSSShhhhO.....................",
    ".....................OddddSSSSSSSSSSSShhhhO.....................",
    "...............OSSSSSSSSSSNNNNSSSSSSSShhhhO.....................",
    "...............OSSSSSSSSSSNNNNSSSSSSSShhhhO.....................",
    ".................OSSSSSSNNNNSSSSSSSSSShhhhO.....................",
    "...................OSSSSMMMMSSSSSSSSSShhhhO.....................",
    "...................OSSddddSdSdSdSSSSSShhhhO.....................",
    "...................OSSdSdSdSdSdSdSSSSShhhhO.....................",
    "...................OSSSdSdSdSdSdSdSSSShhhhO.....................",
    "....................OSSSdSdSdSdSdSdSSShhO.......................",
    "....................OSSSdSdSdSSSSSSShhO.........................",
    ".....................OSSSdSdSdSSSSSShhO.........................",
    "......................OSSSSdSdSSSSSShhO.........................",
    "........................OSSSSSSSSSShhhO.........................",
    "..........................OSSSSSSSShhkkkkO......................",
    "..........................OSSSSSSSShhkkkkO......................",
    "..........................OOOTTSSkkCCCCkkO......................",
    "..........................OOOTTTTSSkkCCCCkkO....................",
    "..........................OOOTTTTSSkkCCCCkkO....................",
    "..........................OOOTTTTSSkkCCCCkkO....................",
]


PROFILE_TORSO = [
    "................OOOOOOTTTTSSkkCCCCkkKKOO........................",
    "................OOOOOOTTTTSSkkCCCCkkKKOO........................",
    "..............OOCCCCKKTTTTTTSSkkCCCCCCCCCCkkOO..................",
    "..............OOCCCCKKTTTTTTSSkkCCCCCCCCCCkkOO..................",
    "............OOCCCCCCKKTTTTTTRRRRSSkkCCCCCCCCCCkkOO..............",
    "............OOCCCCCCKKTTTTTTRRRRSSkkCCCCCCCCCCkkOO..............",
    "............OOCCCCKKTTTTTTRRRRRRRRSSkkCCCCCCCCCCkkOO............",
    "............OOCCCCKKTTTTTTRRRRRRRRSSkkCCCCCCCCCCkkOO............",
    "............OOCCCCKKTTTTTTRJJRrrRRSSkkCCCCCCCCCCkkOO............",
    "............OOCCCCKKTTTTTTRJJRrrRRSSkkCCCCCCCCCCkkOO............",
    "............OOCCCCKKTTTTTTRRRRrrRRSSkkCCCCCCCCCCkkOO............",
    "............OOCCCCKKTTTTTTRRRRrrRRSSkkCCCCCCCCCCkkOO............",
    "............OOCCCCKKTTTTTTRRRRrrRRSSkkCCCCCCCCCCkkOO............",
    "............OOCCCCKKTTTTTTRRRRrrRRSSkkCCCCCCCCCCkkOO............",
    "............OOCCccKKTTTTTTRRRRrrRRSSkkCCCCCCCCCCkkOO............",
    "............OOCCccKKTTTTTTRRRRrrRRSSkkCCCCCCCCCCkkOO............",
    "............OOCCccKKTTTTTTRJJRrrRRSSkkCCCCCCCCCCkkOO............",
    "............OOCCccKKTTTTTTRJJRrrRRSSkkCCCCCCCCCCkkOO............",
    "............OOCCccKKIDTTTTRRrrRRSSTTkkCCCCCCCCCCkkOO............",
    "............OOCCccKKDDTTTTRRrrRRSSTTkkCCCCCCCCCCkkOO............",
    "............OOCCccKKTTTTTTRRRRrrRRSSkkCCCCCCCCCCkkOO............",
    "............OOCCccKKTTTTTTRRRRrrRRSSkkCCCCCCCCCCkkOO............",
    "............OOCCccKKIDTTTTRRrrRRSSTTkkCCCCCCCCCCkkOO............",
    "............OOCCccKKDDTTTTRRrrRRSSTTkkCCCCCCCCCCkkOO............",
    "............OOCCccKKKKttttttttttttSSkkCCCCCCCCCCkkOO............",
    "............OOCCccKKKKttttttttttttSSkkCCCCCCCCCCkkOO............",
    "............OOCCCCCCCCKKKKKKKKKKKKKKKKCCCCCCCCCCkkOO............",
    "............OOCCCCCCCCKKKKKKKKKKKKKKKKCCCCCCCCCCkkOO............",
    "............OOCCCCCCCCkkkkIDDDDDDIkkkkCCCCCCCCCCkkOO............",
    "............OOCCCCCCCCkkkkDDDDDDDDkkkkCCCCCCCCCCkkOO............",
    "............OOCCCCCCCCkkkkDDggggDDkkkkCCCCCCCCCCkkOO............",
    "............OOCCCCCCCCkkkkDDggggDDkkkkCCCCCCCCCCkkOO............",
    "............OOCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCkkOO..............",
    "............OOCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCkkOO..............",
    "............OOCCccCCCCCCCCCCCCCCCCCCCCCCCCccCCkkOO..............",
    "............OOCCccCCCCCCCCCCCCCCCCCCCCCCCCccCCkkOO..............",
    "............OOCCccCCCCCCkkCCCCCCCCkkCCCCccCCCCkkOO..............",
    "............OOCCccCCCCCCkkCCCCCCCCkkCCCCccCCCCkkOO..............",
    "............OOKKccCCCCCCkkCCCCCCCCkkCCCCccCCCCkkOO..............",
    "............OOKKccCCCCCCkkCCCCCCCCkkCCCCccCCCCkkOO..............",
    "............OOOOOOCCCCCCkkCCCCCCCCkkCCCCCCCCCCkkOOOO............",
    "............OOOOOOCCCCCCkkCCCCCCCCkkCCCCCCCCCCkkOOOO............",
]



LEGS_FRONT = [
    [
        "............OOOOOO..........................OOOOOO..............",
        "............OOOOOO..........................OOOOOO..............",
        "............OOPPPPOO........................OOPPPPOO............",
        "............OOPPPPOO........................OOPPPPOO............",
        "............OOPQPPOO........................OOPQPPOO............",
        "............OOPQPPOO........................OOPQPPOO............",
        "............OOPQppOO........................OOppPPOO............",
        "............OOPQppOO........................OOppPPOO............",
        "............OOPQppOO........................OOppPPOO............",
        "............OOPQppOO........................OOppPPOO............",
        "............OOPQppOO........................OOppPPOO............",
        "............OOPQppOO........................OOppPPOO............",
        "..........OOVVVVVVOO......................OOVVVVVVOO............",
        "..........OOVVVVVVOO......................OOVVVVVVOO............",
        "..........OOVVUUvvOO......................OOUUvvVVOO............",
        "..........OOVVUUvvOO......................OOUUvvVVOO............",
        "..........OOvvvvvvOO......................OOvvvvvvOO............",
        "..........OOZZZZZZOO......................OOZZZZZZOO............",
    ],
    [
        "................................................................",
        "................................................................",
        "....................OOOOOOOO........OOOOOOOO....................",
        "....................OOOOOOOO........OOOOOOOO....................",
        "....................OOPQPPOO........OOPQPPOO....................",
        "....................OOPQPPOO........OOPQPPOO....................",
        "....................OOPQppOO........OOppPPOO....................",
        "....................OOPQppOO........OOppPPOO....................",
        "....................OOPQppOO........OOppPPOO....................",
        "....................OOPQppOO........OOppPPOO....................",
        "....................OOPQppOO........OOVVVVOO....................",
        "....................OOPQppOO........OOVVVVOO....................",
        "....................OOVVVVOO........OOUUvvOO....................",
        "....................OOVVVVOO........OOUUvvOO....................",
        "....................OOUUvvOO..........OOvvvvOO..................",
        "....................OOUUvvOO..........OOvvvvOO..................",
        "....................OOvvvvOO....................................",
        "....................OOZZZZOO....................................",
    ],
    [
        "............OOOOOO..........................OOOOOO..............",
        "............OOOOOO..........................OOOOOO..............",
        "............OOPPPPOO........................OOPPPPOO............",
        "............OOPPPPOO........................OOPPPPOO............",
        "............OOPQPPOO........................OOPQPPOO............",
        "............OOPQPPOO........................OOPQPPOO............",
        "............OOppPPOO........................OOPQppOO............",
        "............OOppPPOO........................OOPQppOO............",
        "............OOppPPOO........................OOPQppOO............",
        "............OOppPPOO........................OOPQppOO............",
        "............OOppPPOO........................OOPQppOO............",
        "............OOppPPOO........................OOPQppOO............",
        "............OOVVVVVVOO......................OOVVVVVVOO..........",
        "............OOVVVVVVOO......................OOVVVVVVOO..........",
        "............OOVVvvUUOO......................OOVVUUvvOO..........",
        "............OOVVvvUUOO......................OOVVUUvvOO..........",
        "............OOvvvvvvOO......................OOvvvvvvOO..........",
        "............OOZZZZZZOO......................OOZZZZZZOO..........",
    ],
    [
        "................................................................",
        "................................................................",
        "....................OOOOOOOO........OOOOOOOO....................",
        "....................OOOOOOOO........OOOOOOOO....................",
        "....................OOPQPPOO........OOPQPPOO....................",
        "....................OOPQPPOO........OOPQPPOO....................",
        "....................OOPQPPOO........OOppPPOO....................",
        "....................OOPQPPOO........OOppPPOO....................",
        "....................OOppPPOO........OOppPPOO....................",
        "....................OOppPPOO........OOppPPOO....................",
        "....................OOVVVVOO........OOppPPOO....................",
        "....................OOVVVVOO........OOppPPOO....................",
        "....................OOUUvvOO........OOVVVVOO....................",
        "....................OOUUvvOO........OOVVVVOO....................",
        "......................OOvvvvOO......OOUUvvOO....................",
        "......................OOvvvvOO......OOUUvvOO....................",
        "....................................OOvvvvOO....................",
        "....................................OOZZZZOO....................",
    ],
]



ARMS_FRONT = [
    [  # pose 0
        "............OOCCKKKK............................................",
        "............OOCCKKKK............................................",
        "..........OOCCCCKKOO............................................",
        "..........OOCCCCKKOO............................................",
        "..........OOCCCCKKOO............................................",
        "..........OOCCCCKKOO............................................",
        "..........OOCCCCKKOO............................................",
        "..........OOCCCCKKOO............................................",
        "..........OOCCCCKKOO............................................",
        "..........OOCCCCKKOO............................................",
        "..........OOCCCCKKOO............................................",
        "..........OOCCCCKKOO............................................",
        "..........OOCCCCKKOO............................................",
        "..........OOCCCCKKOO............................................",
        "..........OOCCCCKKOO............................................",
        "..........OOCCCCKKOO............................................",
        "..........OOCCCCKKOO............................................",
        "..........OOCCCCKKOO............................................",
        "..........OOCCCCKKOO............................................",
        "..........OOCCCCKKOO............................................",
        "..........OOCCCCKKOO............................................",
        "..........OOCCCCKKOO............................................",
        "..........OOCCCCKKOO............................................",
        "..........OOCCCCKKOO............................................",
        "..........OOSSSSKKOO............................................",
        "..........OOSSSSKKOO............................................",
        "..........OOSSSSSSOO............................................",
        "..........OOSSSSSSOO............................................",
        "............OOSSSSOO............................................",
        "............OOSSSSOO............................................",
        "................................................................",
        "................................................................",
        "................................................................",
        "................................................................",
    ],
    [  # pose 1
        "............OOCCKKKK............................................",
        "............OOCCKKKK............................................",
        "..........OOCCCCKKOO............................................",
        "..........OOCCCCKKOO............................................",
        "..........OOCCCCKKOO............................................",
        "..........OOCCCCKKOO............................................",
        "..........OOCCCCKKOO............................................",
        "..........OOCCCCKKOO............................................",
        "..........OOCCCCKKOO............................................",
        "..........OOCCCCKKOO............................................",
        "..........OOCCCCKKOO............................................",
        "..........OOCCCCKKOO............................................",
        "..........OOCCCCKKOO............................................",
        "..........OOCCCCKKOO............................................",
        "..........OOCCCCKKOO............................................",
        "..........OOCCCCKKOO............................................",
        "..........OOCCCCKKOO............................................",
        "..........OOCCCCKKOO............................................",
        "..........OOCCCCKKOO............................................",
        "..........OOCCCCKKOO............................................",
        "..........OOCCCCKKOO............................................",
        "..........OOCCCCKKOO............................................",
        "..........OOCCCCKKOO............................................",
        "..........OOCCCCKKOO............................................",
        "..........OOCCCCKKOO............................................",
        "..........OOCCCCKKOO............................................",
        "..........OOSSSSKKOO............................................",
        "..........OOSSSSKKOO............................................",
        "..........OOSSSSSSOO............................................",
        "..........OOSSSSSSOO............................................",
        "............OOSSSSOO............................................",
        "............OOSSSSOO............................................",
        "................................................................",
        "................................................................",
    ],
    [  # pose 2
        "............................................KKKKCCOO............",
        "............................................KKKKCCOO............",
        "............................................OOKKCCCCOO..........",
        "............................................OOKKCCCCOO..........",
        "............................................OOKKCCCCOO..........",
        "............................................OOKKCCCCOO..........",
        "............................................OOKKCCCCOO..........",
        "............................................OOKKCCCCOO..........",
        "............................................OOKKCCCCOO..........",
        "............................................OOKKCCCCOO..........",
        "............................................OOKKCCCCOO..........",
        "............................................OOKKCCCCOO..........",
        "............................................OOKKCCCCOO..........",
        "............................................OOKKCCCCOO..........",
        "............................................OOKKCCCCOO..........",
        "............................................OOKKCCCCOO..........",
        "............................................OOKKCCCCOO..........",
        "............................................OOKKCCCCOO..........",
        "............................................OOKKCCCCOO..........",
        "............................................OOKKCCCCOO..........",
        "............................................OOKKCCCCOO..........",
        "............................................OOKKCCCCOO..........",
        "............................................OOKKCCCCOO..........",
        "............................................OOKKCCCCOO..........",
        "............................................OOKKSSSSOO..........",
        "............................................OOKKSSSSOO..........",
        "............................................OOSSSSSSOO..........",
        "............................................OOSSSSSSOO..........",
        "............................................OOSSSSOO............",
        "............................................OOSSSSOO............",
        "................................................................",
        "................................................................",
        "................................................................",
        "................................................................",
    ],
    [  # pose 3
        "............................................KKKKCCOO............",
        "............................................KKKKCCOO............",
        "............................................OOKKCCCCOO..........",
        "............................................OOKKCCCCOO..........",
        "............................................OOKKCCCCOO..........",
        "............................................OOKKCCCCOO..........",
        "............................................OOKKCCCCOO..........",
        "............................................OOKKCCCCOO..........",
        "............................................OOKKCCCCOO..........",
        "............................................OOKKCCCCOO..........",
        "............................................OOKKCCCCOO..........",
        "............................................OOKKCCCCOO..........",
        "............................................OOKKCCCCOO..........",
        "............................................OOKKCCCCOO..........",
        "............................................OOKKCCCCOO..........",
        "............................................OOKKCCCCOO..........",
        "............................................OOKKCCCCOO..........",
        "............................................OOKKCCCCOO..........",
        "............................................OOKKCCCCOO..........",
        "............................................OOKKCCCCOO..........",
        "............................................OOKKCCCCOO..........",
        "............................................OOKKCCCCOO..........",
        "............................................OOKKCCCCOO..........",
        "............................................OOKKCCCCOO..........",
        "............................................OOKKCCCCOO..........",
        "............................................OOKKCCCCOO..........",
        "............................................OOKKSSSSOO..........",
        "............................................OOKKSSSSOO..........",
        "............................................OOSSSSSSOO..........",
        "............................................OOSSSSSSOO..........",
        "............................................OOSSSSOO............",
        "............................................OOSSSSOO............",
        "................................................................",
        "................................................................",
    ],
]


LEGS_PROFILE = [
    [
        "........OOOOOO..............................OOOO................",
        "........OOOOOO..............................OOOO................",
        "......OOPPPPPPOO..........................OOPPPPOO..............",
        "......OOPPPPPPOO..........................OOPPPPOO..............",
        "......OOPPppPPOO..........................OOPPppOO..............",
        "......OOPPppPPOO..........................OOPPppOO..............",
        "......OOPPppPPOO..........................OOPPppOO..............",
        "......OOPPppPPOO..........................OOPPppOO..............",
        "......OOVVVVVVOO..........................OOPPppOO..............",
        "......OOVVVVVVOO..........................OOPPppOO..............",
        "......OOUUvvVVOO............................OOVVOO..............",
        "......OOUUvvVVOO............................OOVVOO..............",
        "......OOvvvvvvOO............................OOvvOO..............",
        "......OOZZZZZZOO............................OOZZOO..............",
    ],
    [
        "....................OOOOOO......................................",
        "....................OOOOOO......................................",
        "..................OOPPPPPPOO..........OOOOOOOO..................",
        "..................OOPPPPPPOO..........OOOOOOOO..................",
        "..................OOPPppPPOO..........OOPPppOO..................",
        "..................OOPPppPPOO..........OOPPppOO..................",
        "..................OOPPppPPOO..........OOPPppOO..................",
        "..................OOPPppPPOO..........OOPPppOO..................",
        "..................OOVVVVVVOO............OOPPppOO................",
        "..................OOVVVVVVOO............OOPPppOO................",
        "..................OOUUvvVVOO............OOVVVVOO................",
        "..................OOUUvvVVOO............OOVVVVOO................",
        "..................OOvvvvvvOO............OOUUOO..................",
        "..................OOZZZZZZOO............OOUUOO..................",
    ],
    [
        "..................OOOO..............................OOOOOO......",
        "..................OOOO..............................OOOOOO......",
        "................OOPPPPOO..........................OOPPPPPPOO....",
        "................OOPPPPOO..........................OOPPPPPPOO....",
        "................OOPPppOO..........................OOPPppPPOO....",
        "................OOPPppOO..........................OOPPppPPOO....",
        "................OOPPppOO..........................OOPPppPPOO....",
        "................OOPPppOO..........................OOPPppPPOO....",
        "................OOPPppOO..........................OOVVVVVVOO....",
        "................OOPPppOO..........................OOVVVVVVOO....",
        "..................OOVVOO............................OOVVuuVVOO..",
        "..................OOVVOO............................OOVVuuVVOO..",
        "..................OOvvOO............................OOvvvvvvOO..",
        "..................OOZZOO............................OOZZZZZZOO..",
    ],
    [
        "........................................OOOOOO..................",
        "........................................OOOOOO..................",
        "....................OOOOOOOO..........OOPPPPPPOO................",
        "....................OOOOOOOO..........OOPPPPPPOO................",
        "....................OOPPppOO..........OOPPppPPOO................",
        "....................OOPPppOO..........OOPPppPPOO................",
        "....................OOPPppOO..........OOPPppPPOO................",
        "....................OOPPppOO..........OOPPppPPOO................",
        "......................OOPPppOO..........OOVVVVVVOO..............",
        "......................OOPPppOO..........OOVVVVVVOO..............",
        "......................OOVVVVOO..........OOVVuuVVOO..............",
        "......................OOVVVVOO..........OOVVuuVVOO..............",
        "........................OOUUOO..........OOvvvvvvOO..............",
        "........................OOUUOO..........OOZZZZZZOO..............",
    ],
]



ARMS_PROFILE = [
    [  # pose 0
        "..........................CCCC..................................",
        "..........................CCCC..................................",
        "..........................CCCC..................................",
        "..........................CCCC..................................",
        "..........................CCCCCC................................",
        "..........................CCCCCC................................",
        "............................CCCCCC..............................",
        "............................CCCCCC..............................",
        "............................CCCCCCCC............................",
        "............................CCCCCCCC............................",
        "..............................CCCCCC............................",
        "..............................CCCCCC............................",
        "..............................SSSSOO............................",
        "..............................SSSSOO............................",
        "..............................SSSSOO............................",
        "..............................SSSSOO............................",
    ],
    [  # pose 1
        "........................CCCC....................................",
        "........................CCCC....................................",
        "........................CCCC....................................",
        "........................CCCC....................................",
        "........................CCCC....................................",
        "........................CCCC....................................",
        "........................CCCC....................................",
        "........................CCCC....................................",
        "........................CCCC....................................",
        "........................CCCC....................................",
        "........................CCCC....................................",
        "........................CCCC....................................",
        "........................SSSSOO..................................",
        "........................SSSSOO..................................",
        "........................SSSSOO..................................",
        "........................SSSSOO..................................",
    ],
    [  # pose 2
        "......................CCCC......................................",
        "......................CCCC......................................",
        "....................CCCCCC......................................",
        "....................CCCCCC......................................",
        "..................CCCCCC........................................",
        "..................CCCCCC........................................",
        "..................CCCC..........................................",
        "..................CCCC..........................................",
        "................CCCCCC..........................................",
        "................CCCCCC..........................................",
        "................CCCC............................................",
        "................CCCC............................................",
        "..............OOSSSSOO..........................................",
        "..............OOSSSSOO..........................................",
        "..............OOSSSSOO..........................................",
        "..............OOSSSSOO..........................................",
    ],
    [  # pose 3
        "........................CCCC....................................",
        "........................CCCC....................................",
        "........................CCCC....................................",
        "........................CCCC....................................",
        "........................CCCC....................................",
        "........................CCCC....................................",
        "........................CCCC....................................",
        "........................CCCC....................................",
        "........................CCCC....................................",
        "........................CCCC....................................",
        "........................CCCC....................................",
        "........................CCCC....................................",
        "........................SSSSOO..................................",
        "........................SSSSOO..................................",
        "........................SSSSOO..................................",
        "........................SSSSOO..................................",
    ],
]

def paint(rows: list[str], ox: int = 0, oy: int = 0) -> Image.Image:
    """Paint row-string maps at 1:1 onto a fresh 64x96 cell.

    Every row must be exactly 64 chars: a short row used to silently right-pad
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




def face_frame() -> Image.Image:
    img = paint(FACE, 0, 0)
    layer(img, TORSO_FRONT, 30)
    layer(img, LEGS_FRONT[0], 75)
    layer(img, ARMS_FRONT[1], 34)
    return img


def front_walk_frame(i: int) -> Image.Image:
    """Face-on walk is only used for the turn frame's neighbours; the real
    walk cycle is the profile. Still, keep it honest: bob + stride + swing."""
    bob = -2 if i in (1, 3) else 0
    img = paint(FACE, 0, bob)
    layer(img, TORSO_FRONT, 30 + bob)
    layer(img, LEGS_FRONT[i], 75)
    layer(img, ARMS_FRONT[i], 34)
    return img


def profile_frame(leg_idx: int) -> Image.Image:
    bob = -2 if leg_idx in (1, 3) else 0
    img = paint(PROFILE_HEAD, 0, bob)
    layer(img, PROFILE_TORSO, 40 + bob)
    layer(img, LEGS_PROFILE[leg_idx], 79)
    layer(img, ARMS_PROFILE[leg_idx], 46 + bob)
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
# light crown, gold button winking out — with the real head tucked into the
# roll's leading end. Cells 0-7 roll right; 8-15 mirror them.
# ---------------------------------------------------------------------------
ROLL_CELL_W = 80


def stepped_ball(cx: int, ground_y: int) -> Image.Image:
    """A curled body as stepped scanlines: crisp at 1:1, no smeared ellipse.

    A low tuck centred on (cx, ground_y - 14): the coat's crown catches the
    light on top, the gold button winks out of the side, and the head (pasted
    separately) tucks into the front, not on top — a snowman is not a roll.
    """
    cell = Image.new("RGBA", (ROLL_CELL_W, CELL_H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(cell)
    # (y-offset from ground, half-width, colour).
    rows = [
        (2, 14, COAT_D),
        (4, 20, COAT_S),
        (6, 24, COAT),
        (8, 26, COAT),
        (10, 28, COAT),
        (12, 28, COAT_L),
        (14, 26, COAT_L),
        (16, 24, COAT),
        (18, 22, COAT),
        (20, 18, COAT_S),
        (22, 14, COAT_S),
        (24, 10, COAT_D),
        (26, 6, COAT_D),
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
    draw.point([(cx - 6, ground_y - 12)], fill=GOLD + (255,))
    draw.point([(cx - 4, ground_y - 12)], fill=GOLD_S + (255,))
    return cell


def ball_frame(face: Image.Image) -> Image.Image:
    cell = stepped_ball(ROLL_CELL_W // 2 - 4, GROUND_LINE)
    # The actual head tucked into the roll's leading (right) end, chin down:
    # the grey temples stay readable so the ball is unmistakably Jeffs.
    head = face.crop((20, 4, 44, 30)).resize((22, 20), Image.NEAREST)
    cell.alpha_composite(head, (ROLL_CELL_W // 2 + 8, GROUND_LINE - 20))
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
