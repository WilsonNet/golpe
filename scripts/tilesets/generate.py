#!/usr/bin/env python3
"""
Waterfront platform tileset generator.

Generates, from the shared hand-painted Waterfront palette:

  public/assets/tilesets/waterfront-platforms.png   64x24, 8x8 tiles
  public/assets/tilesets/waterfront-props.png       64x48, named prop frames
  public/assets/tilesets/waterfront-platforms.json  frames + SHA-256 versions
  public/assets/tilesets/waterfront-preview.png     320x80, 1x art-card sample

QA-only (not shipped):
  scripts/tilesets/tiling-test.png                  3x3 seam test, 6x nearest

The art is explicit pixel maps. There is no random number generator, no
anti-aliasing and no colour outside art/skybox/palette.json. Transparent pixels
are given the palette's deep indigo RGB so even a naive full-pixel audit sees
only palette colours.

Run from the repository root:

    .venv/bin/python scripts/tilesets/generate.py
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

from PIL import Image

# ---------------------------------------------------------------------------
# Paths and palette
# ---------------------------------------------------------------------------

ROOT = Path(__file__).resolve().parents[2]
PALETTE_PATH = ROOT / "art" / "skybox" / "palette.json"
OUT_DIR = ROOT / "public" / "assets" / "tilesets"
QA_DIR = ROOT / "scripts" / "tilesets"

PALETTE_DOC = json.loads(PALETTE_PATH.read_text())
PALETTE_HEX = [h.lower() for h in PALETTE_DOC["all"]]
PALETTE_RGB = {
    tuple(int(h[i : i + 2], 16) for i in (1, 3, 5)): h for h in PALETTE_HEX
}

# Named colours. Every one is a member of art/skybox/palette.json.
C = {
    "deep": "#22213a",
    "shadow": "#2d2b4b",
    "shadow2": "#3b395e",
    "stone_dark": "#235342",
    "stone": "#2f6c4d",
    "stone_light": "#478a58",
    "moss_light": "#68a963",
    "moss": "#8dc46f",
    "moss_hi": "#b7d879",
    "moss_pale": "#d7e98c",
    "cream_hi": "#fff2d6",
    "cream": "#f3e0bb",
    "cream_mid": "#e4c99b",
    "tan": "#d2b07c",
    "tan_dark": "#b98f61",
    "brass_hi": "#ffe08a",
    "brass": "#f7c85f",
    "brass_mid": "#e4a73f",
    "brass_dark": "#c9852f",
    "brass_deep": "#a36428",
    "pink_hi": "#ffd2e0",
    "pink": "#f49bb8",
    "pink_dark": "#e66d97",
    "pink_deep": "#c94d7c",
    "teal": "#2b6c8b",
    "teal_light": "#2f8ba8",
    "wood_hi": "#cfa074",
    "wood_light": "#b9855e",
    "wood": "#9b6a50",
    "wood_dark": "#7f5446",
    "warm_hi": "#ffe6a1",
    "warm": "#ffd37a",
    "warm_mid": "#f6b45b",
    "sky_dark": "#2f6b98",
    "sky": "#3f88ad",
    "sky_light": "#5aa6bd",
    "sky_pale": "#78c2c7",
    "cloud": "#c6ebdc",
    "cloud_hi": "#eaf3df",
    "cloud_cream": "#fff8e8",
    "cloud_cream_mid": "#f6e6c9",
    "cloud_cream_shadow": "#e9c9a2",
    "far": "#688596",
    "far_dark": "#587387",
    "far_deep": "#4b657e",
}
for _name, _hex in C.items():
    assert _hex in PALETTE_HEX, f"{_name} {_hex} is not in the palette"

# Single-character alphabet used by every hand-written pixel map.
KEY = {
    "0": C["deep"],
    "1": C["shadow"],
    "2": C["shadow2"],
    "a": C["stone_dark"],
    "b": C["stone"],
    "c": C["stone_light"],
    "d": C["moss_light"],
    "e": C["moss"],
    "f": C["moss_hi"],
    "g": C["moss_pale"],
    "h": C["cream_hi"],
    "i": C["cream"],
    "j": C["cream_mid"],
    "k": C["tan"],
    "l": C["tan_dark"],
    "m": C["brass_hi"],
    "n": C["brass"],
    "o": C["brass_mid"],
    "p": C["brass_dark"],
    "q": C["brass_deep"],
    "r": C["pink_hi"],
    "s": C["pink"],
    "t": C["pink_dark"],
    "u": C["pink_deep"],
    "v": C["teal"],
    "w": C["teal_light"],
    "A": C["wood_hi"],
    "B": C["wood_light"],
    "C": C["wood"],
    "D": C["wood_dark"],
    "E": C["warm_hi"],
    "F": C["warm"],
    "G": C["warm_mid"],
    "H": C["sky_dark"],
    "I": C["sky"],
    "J": C["sky_light"],
    "K": C["sky_pale"],
    "L": C["cloud"],
    "M": C["cloud_hi"],
    "U": C["cloud_cream"],
    "V": C["cloud_cream_mid"],
    "W": C["cloud_cream_shadow"],
    "N": C["far"],
    "O": C["far_dark"],
    "P": C["far_deep"],
}
KEY_RGB = {k: tuple(int(v[i : i + 2], 16) for i in (1, 3, 5)) for k, v in KEY.items()}
KEY_RGB["."] = None

DEEP_RGB = KEY_RGB["0"]


# ---------------------------------------------------------------------------
# Tiny canvas. None means transparent.
# ---------------------------------------------------------------------------


class Canvas:
    def __init__(self, width: int, height: int):
        self.width = width
        self.height = height
        self.px: list[list[tuple[int, int, int] | None]] = [
            [None] * width for _ in range(height)
        ]

    def set_rgb(self, x: int, y: int, rgb: tuple[int, int, int]) -> None:
        if 0 <= x < self.width and 0 <= y < self.height:
            self.px[y][x] = rgb

    def set_key(self, x: int, y: int, key: str) -> None:
        rgb = KEY_RGB[key]
        if rgb is not None:
            self.set_rgb(x, y, rgb)

    def blit(self, art: list[str], x: int, y: int) -> None:
        """Draw a rectangular pixel map; '.' is transparent."""
        for j, row in enumerate(art):
            for i, ch in enumerate(row):
                if ch != ".":
                    assert ch in KEY_RGB, f"unknown pixel key {ch!r}"
                    self.set_key(x + i, y + j, ch)

    def paste(self, image: Image.Image, x: int, y: int) -> None:
        """Paste an RGBA image, skipping fully transparent pixels."""
        rgba = image.convert("RGBA")
        for py in range(rgba.height):
            for px in range(rgba.width):
                r, g, b, a = rgba.getpixel((px, py))
                if a:
                    assert a == 255
                    self.set_rgb(x + px, y + py, (r, g, b))

    def to_image(self) -> Image.Image:
        img = Image.new("RGBA", (self.width, self.height), (*DEEP_RGB, 0))
        for y in range(self.height):
            for x in range(self.width):
                rgb = self.px[y][x]
                if rgb is not None:
                    img.putpixel((x, y), (*rgb, 255))
        return img


def mirror(art: list[str]) -> list[str]:
    return [row[::-1] for row in art]


def check_art(name: str, art: list[str], width: int, height: int) -> None:
    assert len(art) == height, f"{name}: expected {height} rows, got {len(art)}"
    for i, row in enumerate(art):
        assert len(row) == width, (
            f"{name}: row {i} is {len(row)} px, expected {width}: {row!r}"
        )
        for ch in row:
            assert ch == "." or ch in KEY_RGB, f"{name}: unknown key {ch!r}"


# ---------------------------------------------------------------------------
# Platform tiles. 8x8, palette-only, hand-set.
# ---------------------------------------------------------------------------

TOP_LEFT = [
    "00efedde",
    "01defede",
    "01ihiiii",
    "01onoooo",
    "00000000",
    "0mnccccc",
    "0opaaaaa",
    "01baaaaa",
]

TILES: dict[str, list[str]] = {
    # Row 0: the standable top. Moss / stone over a cream lip and brass trim.
    # The face below the lip starts the same 1px indigo mortar grid as fillA,
    # so topA can be a horizontal TilingSprite and the lip never steps.
    "topLeft": TOP_LEFT,
    "topA": [
        "efgfeded",
        "defedefd",
        "ihiiiiii",
        "onoooooo",
        "00000000",
        "1ccccccc",
        "1bbbbbbb",
        "1baaaaaa",
    ],
    "topB": [
        "dedsedfd",
        "edrsefde",
        "ihiiiiii",
        "nmnnonno",
        "00000000",
        "1ccccccc",
        "1bbbbbbb",
        "1baaaaaa",
    ],
    "topRight": mirror(TOP_LEFT),
    "topMoss": [
        "fgfefdef",
        "efdefede",
        "iihdiiei",
        "ono0oo0o",
        "00000000",
        "1ccccccc",
        "1baaaada",
        "1baadaaa",
    ],
    "topStone": [
        "ijihiiji",
        "jkjijjkj",
        "hihiihii",
        "onooopoo",
        "00000000",
        "1ccccccc",
        "1bbbbbbb",
        "1baaaaaa",
    ],
    # Row 1: the face. Deep green stone. The mortar is indigo (#2d2b4b), not
    # near-black, so the block grid reads as masonry instead of a UI waffle;
    # the block itself gets a two-pixel top-left bevel.
    "midLeft": [
        "01111111",
        "01cccccc",
        "01baaaaa",
        "01baaaaa",
        "0mnbaaaa",
        "0opbaaaa",
        "01baaaaa",
        "01baaaaa",
    ],
    "fillA": [
        "11111111",
        "1ccccccc",
        "1bbbbbbb",
        "1baaaaaa",
        "1baabaaa",
        "1baaaaaa",
        "1baaaaaa",
        "1baaaaaa",
    ],
    "fillB": [
        "11111111",
        "1ccccccc",
        "1ccc1ccc",
        "1cbbbbbb",
        "1cbbbbbb",
        "1cbbbbbb",
        "1cbbbbbb",
        "1cbbbbbb",
    ],
    "fillC": [
        "11111111",
        "1ccccccc",
        "1bbbbbbb",
        "1baaaaaa",
        "11111111",
        "cccc1ccc",
        "bbbb1bbb",
        "aaaa1aaa",
    ],
    "midRight": mirror(
        [
            "01111111",
            "01cccccc",
            "01baaaaa",
            "01baaaaa",
            "0mnbaaaa",
            "0opbaaaa",
            "01baaaaa",
            "01baaaaa",
        ]
    ),
    "fillMoss": [
        "11111111",
        "1defrdcd",
        "1edrsraa",
        "1cedtaaa",
        "1bcaaaaa",
        "1baadaaa",
        "1aaaaaaa",
        "1adaaaaa",
    ],
    "fillCrack": [
        "11111111",
        "1cccc0c1",
        "1baaa0aa",
        "1baa0a0a",
        "1ba0aa0a",
        "1b0aaa0a",
        "1a0aaa01",
        "10aaaaaa",
    ],
    "fillTrim": [
        "11no1111",
        "1cnocccc",
        "1bnoaaaa",
        "1bnoaaaa",
        "1bpoaaaa",
        "1bnoaaaa",
        "1anoaaaa",
        "1anoaaaa",
    ],
    # Row 2: the underside. Dark carved edge, indigo shadow, moss drip.
    "bottomLeft": [
        "01111111",
        "01cccccc",
        "01baaaaa",
        "0mn11111",
        "0op00000",
        "01111111",
        "01111111",
        "00000000",
    ],
    "bottomA": [
        "1baaaaaa",
        "1baaaaaa",
        "1baaaaaa",
        "1111d111",
        "00000000",
        "11111111",
        "11111111",
        "00000000",
    ],
    "bottomB": [
        "1baaaaaa",
        "1baaaaaa",
        "1baaaaaa",
        "1jkj1111",
        "00000000",
        "11111111",
        "11111111",
        "00000000",
    ],
    "bottomRight": mirror(
        [
            "01111111",
            "01cccccc",
            "01baaaaa",
            "0mn11111",
            "0op00000",
            "01111111",
            "01111111",
            "00000000",
        ]
    ),
    "bottomMoss": [
        "1baaaaaa",
        "1baadaaa",
        "1aadedaa",
        "111ded11",
        "000ded00",
        "1111d111",
        "11111111",
        "00000000",
    ],
    "bottomShadow": [
        "1baaaaaa",
        "1baaaaaa",
        "11111111",
        "00000000",
        "00002000",
        "00000000",
        "00000000",
        "00000000",
    ],
    "bottomTrim": [
        "1baaaaaa",
        "1baaaaaa",
        "11111111",
        "1onomono",
        "1poqopoq",
        "00000000",
        "11111111",
        "00000000",
    ],
}

TILE_ROWS = [
    ["topLeft", "topA", "topB", "topRight", "topMoss", "topStone"],
    [
        "midLeft",
        "fillA",
        "fillB",
        "fillC",
        "midRight",
        "fillMoss",
        "fillCrack",
        "fillTrim",
    ],
    [
        "bottomLeft",
        "bottomA",
        "bottomB",
        "bottomRight",
        "bottomMoss",
        "bottomShadow",
        "bottomTrim",
    ],
]

for _row in TILE_ROWS:
    for _name in _row:
        check_art(_name, TILES[_name], 8, 8)

TILE_FRAMES: dict[str, list[int]] = {}
for _ry, _names in enumerate(TILE_ROWS):
    for _cx, _name in enumerate(_names):
        TILE_FRAMES[_name] = [_cx * 8, _ry * 8, 8, 8]


def make_platform_atlas() -> Image.Image:
    canvas = Canvas(64, 24)
    for name, (x, y, w, h) in TILE_FRAMES.items():
        assert (w, h) == (8, 8)
        canvas.blit(TILES[name], x, y)
    return canvas.to_image()


# ---------------------------------------------------------------------------
# Props. These are deliberately hand-set too: an 8px tile has no room for
# procedural noise, and the props are the map-maker's place-making objects.
# ---------------------------------------------------------------------------

VINE = [
    "..dded..",
    ".dceedd.",
    "..dbbd..",
    "...bb...",
    ".dd.b...",
    "dcd.b.dd",
    ".d..b.d.",
    "....b...",
    "..ddb...",
    ".dcdb.dd",
    "..d.b.d.",
    "....b...",
    ".dd.b...",
    "dcd.b.dd",
    ".d..b.d.",
    "....b...",
    "..ddb...",
    ".dcdb.dd",
    "..d.b.d.",
    "....b...",
    ".dd.b...",
    "dcd.b...",
    ".d..b...",
    "....d...",
]

VINE_FLOWER = [
    "..dded..",
    ".dceedd.",
    "..dbbd..",
    "...bb...",
    ".rs.b...",
    "rst.b.dd",
    ".tu.b.d.",
    "....b...",
    "..ddb.rs",
    ".dcdb.tu",
    "..d.b.s.",
    "....b.t.",
    ".dd.b...",
    "dcd.b...",
    ".d..b...",
    "....b.rs",
    "..ddb.tu",
    ".dcdb.s.",
    "..d.b.t.",
    "....b...",
    ".dd.b...",
    "dcd.b...",
    ".d..b...",
    "....d...",
]

LANTERN = [
    "...oo...",
    "..onno..",
    ".onnnno.",
    ".oEEEEo.",
    ".oEFoFo.",
    ".oFGoGo.",
    ".onnnno.",
    "...oo...",
    "...on...",
    "...on...",
    "...on...",
    "...on...",
    "..oooo..",
    ".onnnno.",
    ".oppppo.",
    "..oooo..",
]

BARREL = [
    ".DDDDDDDDDDDD.",
    ".DBBBBBBBBBBD.",
    "DBBBBBBBBBBBBD",
    "DnnnnnnnnnnnnD",
    "DooooooooooooD",
    "DBCCCCCCCCCCBD",
    "DBCCCCCCCCCCBD",
    "DBCCCCCCCCCCBD",
    "DBCCCCCCCCCCBD",
    "DBCCCCCCCCCCBD",
    "DBCCCCCCCCCCBD",
    "DnnnnnnnnnnnnD",
    "DooooooooooooD",
    "DBCCCCCCCCCCBD",
    ".DBBBBBBBBBBD.",
    ".DDDDDDDDDDDD.",
]

CRATE_BASE = [
    "DDDDDDDDDDDDDDDD",
    "DBBBBBBBBBBBBBBD",
    "DBCCCCCCCCCCCCBD",
    "DBCCCCCCCCCCCCBD",
    "DBCCCCCCCCCCCCBD",
    "DDDDDDDDDDDDDDDD",
    "DBCCCCCCCCCCCCBD",
    "DBCCCCCCCCCCCCBD",
    "DBCCCCCCCCCCCCBD",
    "DDDDDDDDDDDDDDDD",
    "DBCCCCCCCCCCCCBD",
    "DBCCCCCCCCCCCCBD",
    "DBCCCCCCCCCCCCBD",
    "DBBBBBBBBBBBBBBD",
    "DBBBBBBBBBBBBBBD",
    "DDDDDDDDDDDDDDDD",
]

BUSH_14 = [
    "....dd..dd....",
    "..ddeeddeedd..",
    ".dceedeeddeed.",
    "dceedeeddeeddd",
    "ddeeddeeddeedd",
    ".bddddddddddb.",
]

BUSH_12 = [
    "..dd..dd....",
    ".dded.dded..",
    "dceddeddedd.",
    ".dddddddddd.",
]

PLANTER_BOX = [
    "hhhhhhhhhhhhhhhhhhhhhhhh",
    "iiiiiiiiiiiiiiiiiiiiiiii",
    "ljjjjjjjjjjonjjjjjjjjjjl",
    "ljjjjjjjjjjpojjjjjjjjjjl",
    "lkkkkkkkkkkkkkkkkkkkkkkl",
    "llllllllllllllllllllllll",
]

FLOWER_BOX = [
    "DBBBBBBBBBBBBBBD",
    "DCnnnnnnnnnnnnCD",
    "DCCCCCCCCCCCCCCD",
    "DDDDDDDDDDDDDDDD",
]

SPILL_LEFT = [
    "..d.",
    ".dde",
    "dded",
    ".dd.",
]

SPILL_RIGHT = mirror(SPILL_LEFT)

FLOWER = [
    ".r.",
    "rsr",
    ".t.",
]


def make_vine(flower: bool) -> Image.Image:
    art = VINE_FLOWER if flower else VINE
    check_art("vine", art, 8, 24)
    canvas = Canvas(8, 24)
    canvas.blit(art, 0, 0)
    return canvas.to_image()


def make_lantern() -> Image.Image:
    check_art("lantern", LANTERN, 8, 16)
    canvas = Canvas(8, 16)
    canvas.blit(LANTERN, 0, 0)
    return canvas.to_image()


def make_barrel() -> Image.Image:
    check_art("barrel", BARREL, 14, 16)
    canvas = Canvas(14, 16)
    canvas.blit(BARREL, 0, 0)
    # Stave shadow + lit edge. The hoops stay uninterrupted.
    for y in list(range(5, 11)) + [13]:
        canvas.set_key(4, y, "D")
        canvas.set_key(9, y, "D")
        canvas.set_key(3, y, "B")
        canvas.set_key(8, y, "B")
    for y in (1, 14):
        canvas.set_key(4, y, "D")
        canvas.set_key(9, y, "D")
    # Rivets on both hoops.
    for y in (3, 11):
        for x in (2, 6, 10):
            canvas.set_key(x, y, "m")
    return canvas.to_image()


def make_crate() -> Image.Image:
    check_art("crate", CRATE_BASE, 16, 16)
    canvas = Canvas(16, 16)
    canvas.blit(CRATE_BASE, 0, 0)
    # 2px diagonal brace, lit on its upper-left side, dark on the lower.
    for i in range(12):
        x = 2 + i
        y = 13 - i
        canvas.set_key(x, y, "A")
        canvas.set_key(x + 1, y, "B")
        canvas.set_key(x + 2, y, "D")
    for x, y in ((3, 2), (12, 2), (3, 13), (12, 13)):
        canvas.set_key(x, y, "m")
    return canvas.to_image()


def make_planter() -> Image.Image:
    for name, art, w, h in (
        ("bush14", BUSH_14, 14, 6),
        ("planter box", PLANTER_BOX, 24, 6),
        ("spill", SPILL_LEFT, 4, 4),
    ):
        check_art(name, art, w, h)
    canvas = Canvas(24, 12)
    canvas.blit(PLANTER_BOX, 0, 6)
    canvas.blit(BUSH_14, 5, 0)
    # Two plus-shaped flowers; their transparent corners keep the leaf colour.
    for fx in (6, 12):
        canvas.blit(FLOWER, fx, 1)
    canvas.blit(SPILL_LEFT, 1, 3)
    canvas.blit(SPILL_RIGHT, 19, 3)
    # Slab seams on the cream box, away from the brass medallion.
    for x in (5, 18):
        for y in (8, 9):
            canvas.set_key(x, y, "k")
    return canvas.to_image()


def make_flower_box() -> Image.Image:
    for name, art, w, h in (
        ("bush12", BUSH_12, 12, 4),
        ("flower box", FLOWER_BOX, 16, 4),
    ):
        check_art(name, art, w, h)
    canvas = Canvas(16, 8)
    canvas.blit(FLOWER_BOX, 0, 4)
    canvas.blit(BUSH_12, 2, 0)
    for fx in (4, 10):
        canvas.blit(FLOWER, fx, 0)
    return canvas.to_image()


PROPS: dict[str, tuple[list[int], Image.Image]] = {
    "vine": ([0, 0, 8, 24], make_vine(False)),
    "vineFlower": ([8, 0, 8, 24], make_vine(True)),
    "planter": ([16, 0, 24, 12], make_planter()),
    "lantern": ([40, 0, 8, 16], make_lantern()),
    "crate": ([48, 0, 16, 16], make_crate()),
    "barrel": ([0, 24, 14, 16], make_barrel()),
    "flowerBox": ([16, 24, 16, 8], make_flower_box()),
}


def make_prop_atlas() -> Image.Image:
    canvas = Canvas(64, 48)
    for name, (frame, image) in PROPS.items():
        x, y, w, h = frame
        assert image.size == (w, h), f"{name}: {image.size} != {(w, h)}"
        canvas.paste(image, x, y)
    return canvas.to_image()


# ---------------------------------------------------------------------------
# Preview: a 1x art card, 320x80. Sky, a low far-city skyline and the quay.
# ---------------------------------------------------------------------------

BAYER_8 = [
    [0, 32, 8, 40, 2, 34, 10, 42],
    [48, 16, 56, 24, 50, 18, 58, 26],
    [12, 44, 4, 36, 14, 46, 6, 38],
    [60, 28, 52, 20, 62, 30, 54, 22],
    [3, 35, 11, 43, 1, 33, 9, 41],
    [51, 19, 59, 27, 49, 17, 57, 25],
    [15, 47, 7, 39, 13, 45, 5, 37],
    [63, 31, 55, 23, 61, 29, 53, 21],
]

SKY_STOPS = [
    (0.0, KEY_RGB["H"]),  # #2f6b98
    (0.55, KEY_RGB["I"]),  # #3f88ad
    (1.0, KEY_RGB["J"]),  # #5aa6bd
]


def sky_rgb(x: int, y: int) -> tuple[int, int, int]:
    t = y / 79.0
    for i in range(len(SKY_STOPS) - 1):
        t0, c0 = SKY_STOPS[i]
        t1, c1 = SKY_STOPS[i + 1]
        if t <= t1 or i == len(SKY_STOPS) - 2:
            frac = 0.0 if t1 == t0 else (t - t0) / (t1 - t0)
            frac = max(0.0, min(1.0, frac))
            if BAYER_8[y % 8][x % 8] < frac * 64.0:
                return c1
            return c0
    return SKY_STOPS[-1][1]


CLOUD = [
    "............UUUU............",
    ".........VVVVVVVVVV.........",
    "......VVVVVVVVVVVVVVVV......",
    "....VVVVVVVVVVVVVVVVVVVV....",
    "..VVVVVVVVVVVVVVVVVVVVVVVV..",
    ".WWWWWWWWWWWWWWWWWWWWWWWWWW.",
    "..WWWWWWWWWWWWWWWWWWWWWWWW..",
]


def draw_sky(canvas: Canvas) -> None:
    for y in range(canvas.height):
        for x in range(canvas.width):
            canvas.set_rgb(x, y, sky_rgb(x, y))


def draw_far_city(canvas: Canvas) -> None:
    """A low, hazy skyline behind the lower quay. Broad blocks, no spires."""
    base = 48
    # Shared ground haze, one row above the lower quay.
    for x in range(252, 320):
        canvas.set_key(x, base - 1, "P")
    blocks = [
        (256, 10, 40, "P"),
        (265, 8, 35, "O"),
        (272, 14, 33, "P"),
        (285, 10, 38, "O"),
        (294, 16, 31, "P"),
        (310, 10, 40, "O"),
    ]
    for x0, w, top, colour in blocks:
        for x in range(x0, min(x0 + w, 320)):
            for y in range(top, base - 1):
                canvas.set_key(x, y, colour)
        # A 1px lighter roof edge.
        for x in range(x0, min(x0 + w, 320)):
            canvas.set_key(x, top, "N")
    # A shallow half-dome, wider than tall, on the third block.
    dome_x, dome_top = 277, 30
    for i, (half, y) in enumerate(((3, 30), (5, 31), (6, 32))):
        for x in range(dome_x - half, dome_x + half + 1):
            canvas.set_key(x, y, "N" if y == dome_top else "P")
    # A couple of warm windows; tiny, but they say the city is inhabited.
    for x, y in ((268, 40), (298, 39), (313, 45)):
        canvas.set_key(x, y, "G")
    # Teal glass sliver on the tallest block.
    for y in (35, 36):
        canvas.set_key(300, y, "v")


def draw_wall(
    canvas: Canvas,
    atlas: Image.Image,
    x: int,
    y: int,
    top: list[str],
    mid1: list[str],
    mid2: list[str],
    bottom: list[str],
    left_cap: bool = True,
    right_cap: bool = True,
) -> None:
    """Draw a 4-row, len(top)+caps wide quay wall. Each list is inner columns."""
    width = len(top) + (1 if left_cap else 0) + (1 if right_cap else 0)
    rows = []
    for r, names in enumerate((top, mid1, mid2, bottom)):
        if left_cap:
            names = ([["topLeft"], ["midLeft"], ["midLeft"], ["bottomLeft"]][r]) + names
        if right_cap:
            names = names + [
                ["topRight"],
                ["midRight"],
                ["midRight"],
                ["bottomRight"],
            ][r]
        assert len(names) == width, (r, len(names), width)
        rows.append(names)
    for r, names in enumerate(rows):
        for c, name in enumerate(names):
            frame = TILE_FRAMES[name]
            tile = atlas.crop((
                frame[0],
                frame[1],
                frame[0] + frame[2],
                frame[1] + frame[3],
            ))
            canvas.paste(tile, x + c * 8, y + r * 8)


TOP_NAMES = [
    "topA", "topA", "topMoss", "topA", "topB", "topA", "topA", "topMoss",
    "topA", "topA", "topA", "topB", "topA", "topMoss", "topA", "topA",
    "topStone", "topA", "topA", "topB", "topA", "topMoss", "topA", "topA",
    "topStone", "topA", "topMoss", "topA", "topB", "topA",
]

MID1_NAMES = [
    "fillA", "fillB", "fillA", "fillA", "fillC", "fillA", "fillB", "fillMoss",
    "fillA", "fillB", "fillA", "fillA", "fillTrim", "fillA", "fillB", "fillA",
    "fillC", "fillA", "fillA", "fillB", "fillA", "fillMoss", "fillA", "fillB",
    "fillA", "fillA", "fillC", "fillA", "fillCrack", "fillA",
]

MID2_NAMES = [
    "fillB", "fillA", "fillC", "fillA", "fillA", "fillB", "fillA", "fillMoss",
    "fillA", "fillA", "fillB", "fillA", "fillTrim", "fillB", "fillA", "fillC",
    "fillA", "fillA", "fillB", "fillA", "fillC", "fillA", "fillB", "fillA",
    "fillA", "fillC", "fillB", "fillA", "fillC", "fillB",
]

BOTTOM_NAMES = [
    "bottomA", "bottomB", "bottomA", "bottomA", "bottomMoss", "bottomA",
    "bottomB", "bottomMoss", "bottomA", "bottomA", "bottomB", "bottomA",
    "bottomTrim", "bottomA", "bottomB", "bottomA", "bottomA", "bottomShadow",
    "bottomA", "bottomB", "bottomA", "bottomMoss", "bottomA", "bottomA",
    "bottomB", "bottomA", "bottomA", "bottomShadow", "bottomA", "bottomB",
]

LOWER_TOP = ["topA", "topB", "topMoss", "topA", "topStone", "topA"]
LOWER_MID1 = ["fillA", "fillB", "fillA", "fillMoss", "fillA", "fillC"]
LOWER_MID2 = ["fillB", "fillA", "fillC", "fillA", "fillB", "fillA"]
LOWER_BOTTOM = ["bottomA", "bottomB", "bottomMoss", "bottomA", "bottomB", "bottomA"]


def make_preview(platform_atlas: Image.Image, prop_atlas: Image.Image) -> Image.Image:
    canvas = Canvas(320, 80)
    draw_sky(canvas)
    canvas.blit(CLOUD, 24, 4)
    draw_far_city(canvas)

    # The 256x32 hero ledge: 4 tile rows, both side caps.
    draw_wall(canvas, platform_atlas, 0, 24, TOP_NAMES, MID1_NAMES, MID2_NAMES, BOTTOM_NAMES)
    # The 64px ground sample, stepped down to the right. It is a separate
    # 4-row wall, so its left and right caps are both visible.
    draw_wall(canvas, platform_atlas, 256, 48, LOWER_TOP, LOWER_MID1, LOWER_MID2, LOWER_BOTTOM)

    # Contact shadows on the standable lip, drawn before the props.
    for x, y, w in (
        (160, 24, 24),  # planter
        (198, 24, 6),   # lantern
        (272, 48, 16),  # crate
        (292, 48, 16),  # flower box
    ):
        for i in range(w):
            canvas.set_key(x + i, y, "1")

    def prop(name: str, x: int, y: int) -> None:
        frame, image = PROPS[name]
        canvas.paste(image, x, y)

    # Main ledge props: vines hang from the underside, planter and lantern
    # stand on the moss.
    prop("vine", 64, 56)
    prop("planter", 160, 12)
    prop("lantern", 196, 8)
    # Lower ground sample: a crate and a low flower box.
    prop("crate", 272, 32)
    prop("flowerBox", 292, 40)
    return canvas.to_image()


# ---------------------------------------------------------------------------
# Audits and the 3x3 tiling test
# ---------------------------------------------------------------------------


def audit_image(name: str, image: Image.Image) -> dict:
    rgba = image.convert("RGBA")
    pixels = rgba.load()
    colours = set()
    alphas = set()
    transparent = 0
    for y in range(rgba.height):
        for x in range(rgba.width):
            r, g, b, a = pixels[x, y]
            alphas.add(a)
            colours.add((r, g, b))
            if a == 0:
                transparent += 1
            elif a != 255:
                raise AssertionError(f"{name}: non-binary alpha {a}")
    non_palette = colours - set(PALETTE_RGB)
    if non_palette:
        raise AssertionError(f"{name}: non-palette colours {sorted(non_palette)}")
    return {
        "size": rgba.size,
        "colours": len(colours),
        "transparent": transparent,
        "alphas": sorted(alphas),
    }


def check_frames() -> None:
    for name, (x, y, w, h) in TILE_FRAMES.items():
        assert w == 8 and h == 8, (name, w, h)
        assert 0 <= x and x + w <= 64, (name, x, w)
        assert 0 <= y and y + h <= 24, (name, y, h)
    for name, (frame, image) in PROPS.items():
        x, y, w, h = frame
        assert image.size == (w, h), (name, image.size, (w, h))
        assert 0 <= x and x + w <= 64, (name, x, w)
        assert 0 <= y and y + h <= 48, (name, y, h)
    # No overlapping prop frames.
    frames = list(PROPS.items())
    for i, (a, (fa, _)) in enumerate(frames):
        for b, (fb, _) in frames[i + 1 :]:
            ax, ay, aw, ah = fa
            bx, by, bw, bh = fb
            overlap = ax < bx + bw and bx < ax + aw and ay < by + bh and by < ay + ah
            assert not overlap, f"{a} overlaps {b}"


def check_tiling(platform_atlas: Image.Image) -> dict:
    """Build the 3x3 panels, assert the joints, and save a 6x QA sheet."""
    def tile(name: str) -> Image.Image:
        x, y, w, h = TILE_FRAMES[name]
        return platform_atlas.crop((x, y, x + w, y + h))

    # Panel A: pure 3x3 tiling of fillA.
    fill = Image.new("RGBA", (24, 24), (0, 0, 0, 0))
    for r in range(3):
        for c in range(3):
            fill.paste(tile("fillA"), (c * 8, r * 8))
    # Panel B: topA / fillA / bottomA, three columns wide.
    wall = Image.new("RGBA", (24, 24), (0, 0, 0, 0))
    for r, name in enumerate(("topA", "fillA", "bottomA")):
        for c in range(3):
            wall.paste(tile(name), (c * 8, r * 8))
    # Panel C: the 9-slice with cap variants; 4 tiles wide, 3 tall.
    capped = Image.new("RGBA", (32, 24), (0, 0, 0, 0))
    rows = [
        ("topLeft", "topA", "topA", "topRight"),
        ("midLeft", "fillA", "fillA", "midRight"),
        ("bottomLeft", "bottomA", "bottomA", "bottomRight"),
    ]
    for r, names in enumerate(rows):
        for c, name in enumerate(names):
            capped.paste(tile(name), (c * 8, r * 8))

    w = wall.load()
    c = capped.load()

    def rgb(x: int, y: int, img=fill) -> tuple[int, int, int]:
        return img.load()[x, y][:3]

    deep = DEEP_RGB
    joint = KEY_RGB["1"]

    # 1. The fill pattern has period 8 horizontally and vertically.
    for y in range(24):
        for x in range(16):
            assert rgb(x, y) == rgb(x + 8, y), f"fill x period at {x},{y}"
    for y in range(16):
        for x in range(24):
            assert rgb(x, y) == rgb(x, y + 8), f"fill y period at {x},{y}"

    # 2. The mortar is exactly one pixel wide at each tile boundary.
    for x in (8, 16):
        column = [rgb(x, y) for y in range(24)]
        assert all(v == joint for v in column), f"joint column {x} is not solid"
        assert any(rgb(x - 1, y) != joint for y in range(24)), f"double joint left of {x}"
        assert any(rgb(x + 1, y) != joint for y in range(24)), f"double joint right of {x}"
    for y in (8, 16):
        row = [rgb(x, y) for x in range(24)]
        assert all(v == joint for v in row), f"joint row {y} is not solid"
        assert any(rgb(x, y - 1) != joint for x in range(24)), f"double joint above {y}"
        assert any(rgb(x, y + 1) != joint for x in range(24)), f"double joint below {y}"

    # 3. The cream lip and brass trim are uninterrupted across the wall.
    for y in (2, 3):
        for x in range(24):
            assert w[x, y][:3] != deep, f"top lip broken at {x},{y}"
            assert w[x, y][:3] != joint, f"top lip shadow at {x},{y}"

    # 4. topA's face continues into fillA, and fillA's face into bottomA.
    for x in range(24):
        assert w[x, 15][:3] == w[x, 16][:3], f"fill->bottom face break at {x}"

    # 5. The face mortar is one continuous column: topA's 3px face course
    #    lands its x=0 joint exactly on fillA's.
    for y in range(5, 15):
        assert w[0, y][:3] == joint, f"face mortar steps at y={y}"

    # 6. The side cap outline is continuous in the capped panel.
    for y in range(24):
        assert c[0, y][:3] == deep, f"left cap outline broken at y={y}"
        assert c[31, y][:3] == deep, f"right cap outline broken at y={y}"

    # 7. Every cap variant carries a brass stud.
    for name in ("topLeft", "topRight", "midLeft", "midRight", "bottomLeft", "bottomRight"):
        art = TILES[name]
        pixels = {ch for row in art for ch in row}
        assert pixels & set("mnopq"), f"{name} has no brass stud"

    # Build the QA sheet at 6x nearest, three panels, a sky margin; no text.
    scale = 6
    margin = 12
    gap = 12
    width = (24 + 24 + 32) * scale + margin * 2 + gap * 2
    height = 24 * scale + margin * 2
    sheet = Image.new("RGBA", (width, height), (*KEY_RGB["I"], 255))
    x = margin
    for panel in (fill, wall, capped):
        sheet.paste(
            panel.resize((panel.width * scale, panel.height * scale), Image.NEAREST),
            (x, margin),
        )
        x += panel.width * scale + gap
    sheet.save(QA_DIR / "tiling-test.png", "PNG", compress_level=9)

    return {
        "pure_panel": fill.size,
        "wall_panel": wall.size,
        "capped_panel": capped.size,
        "sheet": sheet.size,
        "joint_width_px": 1,
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def sha12(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:12]


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    QA_DIR.mkdir(parents=True, exist_ok=True)

    check_frames()

    platform_atlas = make_platform_atlas()
    prop_atlas = make_prop_atlas()
    preview = make_preview(platform_atlas, prop_atlas)

    platform_path = OUT_DIR / "waterfront-platforms.png"
    props_path = OUT_DIR / "waterfront-props.png"
    preview_path = OUT_DIR / "waterfront-preview.png"

    platform_atlas.save(platform_path, "PNG", compress_level=9)
    prop_atlas.save(props_path, "PNG", compress_level=9)
    preview.save(preview_path, "PNG", compress_level=9)

    # The hashes are of the exact bytes on disk.
    platform_version = sha12(platform_path)
    props_version = sha12(props_path)

    doc = {
        "name": "waterfront-platforms",
        "image": "assets/tilesets/waterfront-platforms.png",
        "version": platform_version,
        "tileWidth": 8,
        "tileHeight": 8,
        "tiles": {name: TILE_FRAMES[name] for row in TILE_ROWS for name in row},
        "props": {
            "image": "assets/tilesets/waterfront-props.png",
            "version": props_version,
            "frames": {name: frame for name, (frame, _) in PROPS.items()},
        },
    }
    json_path = OUT_DIR / "waterfront-platforms.json"
    text = json.dumps(doc, indent=2)
    # Keep every [x, y, w, h] on one line, as the contract reads.
    text = re.sub(
        r"\[\n\s+(-?\d+),\n\s+(-?\d+),\n\s+(-?\d+),\n\s+(-?\d+)\n\s+\]",
        r"[\1, \2, \3, \4]",
        text,
    )
    json_path.write_text(text + "\n")

    # Re-read and verify every version against the bytes on disk.
    written = json.loads(json_path.read_text())
    assert written["version"] == sha12(platform_path)
    assert written["props"]["version"] == sha12(props_path)

    audits = {
        "platforms": audit_image("platforms", platform_atlas),
        "props": audit_image("props", prop_atlas),
        "preview": audit_image("preview", preview),
    }
    tiling = check_tiling(platform_atlas)

    # A 2x QA view of the preview for the "inspect at 1x and 2x" gate.
    preview.resize((640, 160), Image.NEAREST).save(
        QA_DIR / "preview-2x.png", "PNG", compress_level=9
    )

    print("waterfront-platforms")
    print(f"  platforms  {platform_atlas.width}x{platform_atlas.height}  tiles={len(TILE_FRAMES)}  version={platform_version}")
    print(f"  props      {prop_atlas.width}x{prop_atlas.height}  frames={len(PROPS)}  version={props_version}")
    print(f"  preview    {preview.width}x{preview.height}")
    print(f"  json       {json_path.relative_to(ROOT)}")
    for name, a in audits.items():
        print(
            f"  {name:9s} {a['size'][0]}x{a['size'][1]}  colours={a['colours']:2d}  "
            f"transparent={a['transparent']:4d}  alpha={a['alphas']}"
        )
    print(
        f"  tiling     fill={tiling['pure_panel']} wall={tiling['wall_panel']} "
        f"capped={tiling['capped_panel']} sheet={tiling['sheet']} "
        f"joint={tiling['joint_width_px']}px  PASS"
    )
    print("  palette    all pixels are art/skybox/palette.json colours; alpha is 0/255 only")
    print(f"  QA         {QA_DIR / 'tiling-test.png'}")
    print(f"  QA         {QA_DIR / 'preview-2x.png'}")


if __name__ == "__main__":
    main()
