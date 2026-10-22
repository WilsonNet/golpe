#!/usr/bin/env python3
"""
The map maker's decoration catalogue: every prop, its category, how it
attaches, and the pixels.

`generate.py` packs these into `<theme>-props.png` and writes their frames into
the tileset JSON; `themes.py` redraws them under each theme's colours. The
catalogue is also written to `src/game/maps/propCatalog.json`, which is the
editor's palette and the attach rules — so a prop exists in exactly one place,
here, and the editor, the game and the art can never disagree about its name
or its size.

Every pixel is a palette *key* (see `generate.py`'s KEY), never an RGB. That
is what lets a theme recolour the props: a window frame drawn in stone keys is
flagstone in the Castle and packed earth in the Meadow.

Attach rules (the editor's placement, see specs/map-maker.md):

  stand  the bottom row sits on the surface under the cursor
  hang   the top row hangs from the ceiling above the cursor
  wall   mounted on a platform's face: kept inside the platform under the cursor
  air    exactly where it was clicked — flying birds, balloons, clouds

A prop with `anim` frames is animated in the game (`AnimatedSprite`); the
editor draws its first frame. Animation is presentation only — nothing that
moves here is ever simulated.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Callable

# ---------------------------------------------------------------------------
# A key grid. Draw with keys; `generate.py` turns it into pixels.
# ---------------------------------------------------------------------------


class G:
    def __init__(self, w: int, h: int):
        self.w = w
        self.h = h
        self.k: list[list[str | None]] = [[None] * w for _ in range(h)]

    def px(self, x: int, y: int, key: str) -> "G":
        if 0 <= x < self.w and 0 <= y < self.h:
            self.k[y][x] = key
        return self

    def get(self, x: int, y: int) -> str | None:
        if 0 <= x < self.w and 0 <= y < self.h:
            return self.k[y][x]
        return None

    def rect(self, x: int, y: int, w: int, h: int, key: str) -> "G":
        for j in range(y, y + h):
            for i in range(x, x + w):
                self.px(i, j, key)
        return self

    def hl(self, x0: int, x1: int, y: int, key: str) -> "G":
        return self.rect(x0, y, x1 - x0 + 1, 1, key)

    def vl(self, x: int, y0: int, y1: int, key: str) -> "G":
        return self.rect(x, y0, 1, y1 - y0 + 1, key)

    def box(self, x: int, y: int, w: int, h: int, fill: str, edge: str) -> "G":
        self.rect(x, y, w, h, edge)
        if w > 2 and h > 2:
            self.rect(x + 1, y + 1, w - 2, h - 2, fill)
        return self

    def disc(self, cx: float, cy: float, rx: float, ry: float, key: str) -> "G":
        for j in range(self.h):
            for i in range(self.w):
                dx = (i + 0.5 - cx) / max(rx, 0.01)
                dy = (j + 0.5 - cy) / max(ry, 0.01)
                if dx * dx + dy * dy <= 1.0:
                    self.px(i, j, key)
        return self

    def ball(
        self, cx: float, cy: float, rx: float, ry: float, hi: str, mid: str, dark: str
    ) -> "G":
        """A disc lit from the upper left: a dark crescent, a highlight."""
        self.disc(cx, cy, rx, ry, dark)
        self.disc(cx - rx * 0.18, cy - ry * 0.18, rx * 0.82, ry * 0.82, mid)
        self.disc(cx - rx * 0.42, cy - ry * 0.42, rx * 0.3, ry * 0.3, hi)
        return self

    def line(self, x0: int, y0: int, x1: int, y1: int, key: str) -> "G":
        n = max(abs(x1 - x0), abs(y1 - y0), 1)
        for t in range(n + 1):
            self.px(round(x0 + (x1 - x0) * t / n), round(y0 + (y1 - y0) * t / n), key)
        return self

    def art(self, rows: list[str], x: int = 0, y: int = 0) -> "G":
        for j, row in enumerate(rows):
            for i, ch in enumerate(row):
                if ch != ".":
                    self.px(x + i, y + j, ch)
        return self

    def outline(self, key: str = "0") -> "G":
        """A one-pixel outline around everything drawn, into empty cells."""
        edge = []
        for j in range(self.h):
            for i in range(self.w):
                if self.k[j][i] is not None:
                    continue
                if any(
                    self.get(i + dx, j + dy) not in (None, "~")
                    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))
                ):
                    edge.append((i, j))
        for i, j in edge:
            self.k[j][i] = key
        return self

    def swap(self, old: str, new: str) -> "G":
        for row in self.k:
            for i, v in enumerate(row):
                if v == old:
                    row[i] = new
        return self

    def copy(self) -> "G":
        g = G(self.w, self.h)
        g.k = [row[:] for row in self.k]
        return g

    def flipped(self) -> "G":
        g = G(self.w, self.h)
        g.k = [row[::-1] for row in self.k]
        return g

    def shifted(self, dx: int, dy: int) -> "G":
        g = G(self.w, self.h)
        for j in range(self.h):
            for i in range(self.w):
                v = self.k[j][i]
                if v is not None:
                    g.px(i + dx, j + dy, v)
        return g


@dataclass
class Prop:
    name: str
    label: str
    category: str
    attach: str
    build: Callable[[], "G | list[G]"]
    #: Milliseconds per animation frame, when `build` returns several.
    ms: int = 0
    frames: list[G] = field(default_factory=list)

    def draw(self) -> list[G]:
        out = self.build()
        self.frames = out if isinstance(out, list) else [out]
        if not isinstance(self.frames[0], G):
            # One of generate.py's original seven: already an image.
            return self.frames
        w, h = self.frames[0].w, self.frames[0].h
        for f in self.frames:
            assert (f.w, f.h) == (w, h), f"{self.name}: frames differ in size"
            for row in f.k:
                for v in row:
                    assert v is None or len(v) == 1, f"{self.name}: bad key {v!r}"
        return self.frames


CATEGORIES = [
    ("nature", "Nature"),
    ("town", "Town"),
    ("walls", "Windows & walls"),
    ("lights", "Lights & fire"),
    ("hanging", "Hanging"),
    ("critters", "Critters"),
    ("sky", "Sky"),
]

# ---------------------------------------------------------------------------
# Nature
# ---------------------------------------------------------------------------


def bush(flowers: str | None = None) -> G:
    g = G(18, 11)
    g.ball(5, 7, 4.5, 4, "f", "e", "d")
    g.ball(13, 7, 4.5, 4, "f", "e", "d")
    g.ball(9, 5, 5, 4.5, "g", "e", "d")
    g.rect(2, 9, 14, 1, "d")
    if flowers:
        for x, y in ((5, 5), (11, 3), (14, 6), (8, 8)):
            g.px(x, y, flowers).px(x + 1, y, "r")
    return g.outline("1")


def tall_grass() -> G:
    g = G(13, 9)
    for x, h, lean in ((1, 5, 0), (3, 8, 1), (5, 6, -1), (7, 9, 1), (9, 6, 0), (11, 7, -1)):
        for j in range(h):
            g.px(x + (lean if j > h // 2 else 0), 8 - j, "e" if j < h - 2 else "f")
        g.px(x, 8, "d")
    return g


def flowers(petal: str, petal_dark: str) -> G:
    g = G(11, 9)
    for x, h in ((1, 4), (5, 6), (9, 3)):
        g.vl(x, 8 - h + 2, 8, "d")
        g.px(x - 1, 8 - h + 3, "e")
        g.art([".P.", "PcP", ".D."], x - 1, 8 - h)
        g.swap("P", petal).swap("D", petal_dark).swap("c", "m")
    return g


def sunflower() -> G:
    g = G(9, 22)
    g.vl(4, 7, 21, "d")
    g.art(["ee..", ".eed"], 5, 12)
    g.art(["..ee", "dee."], 0, 16)
    g.disc(4.5, 4.5, 4.5, 4.5, "n")
    g.disc(4.5, 4.5, 3.4, 3.4, "m")
    g.disc(4.5, 4.5, 2, 2, "C")
    g.px(4, 4, "D").px(5, 3, "B")
    return g.outline("1")


def mushroom() -> G:
    g = G(9, 9)
    g.rect(3, 5, 3, 4, "i").vl(5, 5, 8, "k")
    g.disc(4.5, 4, 4.5, 3, "z")
    g.disc(4, 3.5, 3.4, 2.2, "y")
    g.px(2, 3, "9").px(5, 2, "9").px(7, 4, "9").px(4, 4, "9")
    g.hl(1, 7, 5, "u")
    g.rect(3, 5, 3, 1, "i")
    return g.outline("1")


def mushrooms() -> G:
    g = G(15, 10)
    big = mushroom()
    small = G(7, 7)
    small.rect(2, 4, 2, 3, "i").disc(3.5, 3, 3.5, 2.2, "x").disc(3, 2.7, 2.4, 1.4, "y")
    small.px(2, 2, "9").px(4, 3, "9").outline("1")
    for j in range(big.h):
        for i in range(big.w):
            if big.k[j][i]:
                g.px(i + 5, j + 1, big.k[j][i])
    for j in range(small.h):
        for i in range(small.w):
            if small.k[j][i]:
                g.px(i, j + 3, small.k[j][i])
    return g


def rock(w: int = 13, h: int = 8) -> G:
    g = G(w, h)
    g.ball(w / 2, h * 0.62, w / 2 - 0.5, h * 0.62 - 0.5, "4", "5", "O")
    g.px(int(w * 0.3), int(h * 0.4), "N")
    g.px(int(w * 0.6), int(h * 0.7), "P")
    return g.outline("1")


def boulder() -> G:
    g = G(24, 15)
    g.ball(12, 9, 11.5, 8.5, "4", "5", "O")
    g.ball(7, 9, 5, 4, "4", "5", "O")
    g.line(10, 4, 13, 9, "P").line(13, 9, 12, 13, "P")
    g.art([".dd", "deef", ".d."], 15, 2)
    g.hl(2, 21, 14, "P")
    return g.outline("1")


def stump() -> G:
    g = G(16, 11)
    g.rect(2, 3, 12, 7, "C")
    g.vl(4, 4, 9, "D").vl(8, 4, 9, "B").vl(11, 4, 9, "D")
    g.disc(8, 3, 6, 2.2, "A")
    g.disc(8, 3, 3.6, 1.2, "B")
    g.px(8, 3, "D")
    g.art(["D..", "DD.", "CDD"], 0, 8)
    g.art(["..D", ".DD", "DDC"], 13, 8)
    g.art(["e.", "ee"], 12, 1)
    return g.outline("1")


def round_tree() -> G:
    g = G(34, 50)
    g.rect(14, 28, 6, 22, "C").vl(15, 28, 49, "B").vl(19, 28, 49, "D")
    g.art(["D....D", "DD..DD", "CDDDDC"], 14, 47)
    g.line(17, 34, 24, 27, "C").line(17, 33, 10, 27, "C")
    for cx, cy, r in ((10, 21, 8), (24, 21, 8), (17, 12, 10), (8, 13, 6), (26, 13, 6), (17, 24, 8)):
        g.ball(cx, cy, r, r * 0.9, "f", "e", "d")
    for x, y in ((12, 9), (21, 6), (26, 16), (7, 18), (16, 19)):
        g.px(x, y, "g").px(x + 1, y, "g")
    return g.outline("1")


def pine() -> G:
    g = G(22, 44)
    g.rect(9, 36, 4, 8, "C").vl(9, 36, 43, "D")
    for i, (y, half) in enumerate(((4, 3), (10, 5), (16, 7), (22, 9), (28, 10))):
        for j in range(8):
            w = int(half * (j + 2) / 9) + 1
            g.hl(11 - w, 10 + w, y + j, "d" if j > 5 else "e")
            g.px(11 - w, y + j, "c").px(10 + w, y + j, "c")
    g.vl(10, 2, 4, "e").vl(11, 1, 4, "e")
    for x, y in ((8, 14), (13, 20), (6, 27), (15, 31), (10, 9)):
        g.px(x, y, "f")
    return g.outline("1")


def dead_tree() -> G:
    g = G(24, 36)
    g.rect(10, 14, 4, 22, "D").vl(11, 14, 35, "C")
    for a, b, c, d in ((12, 16, 4, 6), (12, 14, 20, 4), (11, 22, 3, 16), (13, 20, 22, 14),
                       (6, 9, 2, 5), (18, 7, 21, 2), (12, 15, 12, 3)):
        g.line(a, b, c, d, "D")
    g.art(["D..D", "DCCD"], 10, 34)
    return g.outline("1")


def fern() -> G:
    g = G(14, 11)
    for x0, y0, x1, y1 in ((7, 10, 1, 3), (7, 10, 13, 3), (7, 10, 3, 0), (7, 10, 11, 0), (7, 10, 7, 1)):
        g.line(x0, y0, x1, y1, "d")
        n = max(abs(x1 - x0), abs(y1 - y0))
        for t in range(1, n, 2):
            x = round(x0 + (x1 - x0) * t / n)
            y = round(y0 + (y1 - y0) * t / n)
            g.px(x - 1, y, "e").px(x + 1, y, "f")
    return g


def log() -> G:
    g = G(26, 9)
    g.rect(3, 1, 21, 7, "C").hl(3, 23, 1, "B").hl(3, 23, 7, "D").hl(5, 20, 4, "D")
    g.disc(3.5, 4.5, 3, 3.5, "A").disc(3.5, 4.5, 1.6, 2, "B").px(3, 4, "D")
    g.art(["ee.", ".fe"], 14, 0)
    return g.outline("1")


def snowman() -> G:
    g = G(16, 22)
    g.ball(8, 16.5, 6, 5, "9", "M", "K")
    g.ball(8, 9, 4.5, 4, "9", "M", "K")
    g.rect(4, 2, 8, 2, "0").rect(5, 0, 6, 3, "0").hl(5, 10, 2, "z")
    g.px(6, 8, "0").px(9, 8, "0")
    g.art(["xxx", ".y."], 7, 9)
    g.px(8, 14, "0").px(8, 17, "0")
    g.hl(4, 12, 12, "z").px(10, 13, "z").px(10, 14, "y")
    g.line(2, 14, 0, 11, "D").line(13, 14, 15, 11, "D")
    return g.outline("1")


def reeds() -> G:
    g = G(11, 15)
    for x, top in ((1, 5), (4, 1), (7, 3), (9, 6)):
        g.vl(x, top + 3, 14, "e")
        g.rect(x, top, 1, 4, "C").px(x, top, "D")
    g.art(["d.d.d", ".e.e."], 3, 12)
    return g


# ---------------------------------------------------------------------------
# Town
# ---------------------------------------------------------------------------


def bench() -> G:
    g = G(26, 12)
    g.rect(1, 1, 24, 2, "B").rect(1, 4, 24, 2, "C").hl(1, 24, 3, "D")
    g.rect(1, 6, 24, 2, "A").hl(1, 24, 7, "C")
    for x in (3, 21):
        g.rect(x, 8, 2, 4, "0").vl(x, 0, 6, "0")
    return g.outline("1")


def signpost() -> G:
    g = G(18, 20)
    g.rect(8, 4, 2, 16, "C").vl(8, 4, 19, "D")
    g.art([
        "BBBBBBBBBBBBB...",
        "BAAAAAAAAAAAAB..",
        "BA.DD.D.DDD.AAB.",
        "BAAAAAAAAAAAAB..",
        "BBBBBBBBBBBBB...",
    ], 1, 1)
    g.swap(".", ".")
    g.art([
        "...BBBBBBBBBBB",
        "..BAAAAAAAAAAB",
        ".BAADD.DDD.DAB",
        "..BAAAAAAAAAAB",
        "...BBBBBBBBBBB",
    ], 3, 8)
    return g.outline("1")


def mailbox() -> G:
    g = G(10, 16)
    g.rect(4, 8, 2, 8, "O")
    g.rect(1, 2, 8, 7, "z").rect(1, 1, 8, 1, "y").rect(2, 0, 6, 1, "y")
    g.hl(2, 7, 4, "u").rect(8, 3, 1, 2, "n")
    g.vl(9, 0, 4, "m").px(9, 0, "z")
    return g.outline("1")


def well() -> G:
    g = G(26, 28)
    g.rect(3, 18, 20, 10, "b")
    for y in (18, 22, 26):
        g.hl(3, 22, y, "1")
    for x in (7, 13, 19):
        g.vl(x, 19, 21, "1")
    for x in (5, 11, 17):
        g.vl(x, 23, 25, "1")
    g.rect(2, 17, 22, 2, "c")
    g.rect(4, 6, 2, 12, "C").rect(20, 6, 2, 12, "C")
    g.art([
        ".........DDDDDDDD.........",
        "......DDDzzzzzzzzDDD......",
        "...DDDzzzzzyyzzzzzzzDDD...",
        "DDDzzzzzyyyyyyyyzzzzzzzDDD",
    ], 0, 0)
    g.hl(5, 20, 8, "D").vl(13, 8, 14, "N").rect(11, 14, 5, 3, "C").hl(11, 15, 14, "B")
    return g.outline("1")


def fence() -> G:
    g = G(24, 11)
    for x in (1, 9, 17):
        g.rect(x, 1, 5, 10, "A").vl(x + 4, 1, 10, "C").px(x + 2, 0, "A")
        g.px(x, 1, "B").px(x + 4, 1, "B")
    g.rect(0, 3, 24, 2, "B").rect(0, 7, 24, 2, "B").hl(0, 23, 4, "D").hl(0, 23, 8, "D")
    return g.outline("1")


def bollard() -> G:
    g = G(7, 9)
    g.rect(1, 2, 5, 7, "O").vl(1, 2, 8, "N").disc(3.5, 2, 2.5, 1.5, "N").px(2, 1, "4")
    g.hl(1, 5, 5, "P")
    return g.outline("1")


def anchor() -> G:
    g = G(16, 18)
    g.disc(8, 2.5, 2.5, 2.5, "P").disc(8, 2.5, 1.2, 1.2, None or "~")
    g.swap("~", "~")
    g.vl(7, 4, 15, "O").vl(8, 4, 15, "P").hl(4, 11, 6, "O")
    for x in range(1, 15):
        y = 16 - int(4 * math.sin(math.pi * (x - 1) / 13))
        g.px(x, y, "O").px(x, y - 1, "N")
    g.art(["O.", "OO"], 0, 11).art([".O", "OO"], 14, 11)
    g.k = [[None if v == "~" else v for v in row] for row in g.k]
    return g.outline("1")


def sack() -> G:
    g = G(11, 10)
    g.ball(5.5, 6, 5, 4, "j", "k", "l")
    g.rect(4, 0, 3, 3, "k").hl(3, 7, 2, "D")
    g.px(3, 5, "l").px(7, 6, "l")
    return g.outline("1")


def amphora() -> G:
    g = G(10, 14)
    g.ball(5, 8, 4, 5, "8", "7", "6")
    g.rect(3, 1, 4, 3, "7").hl(2, 7, 0, "8")
    g.art(["7..", ".7."], 0, 3).art(["..7", ".7."], 7, 3)
    g.hl(2, 7, 8, "x").hl(2, 7, 10, "6")
    g.rect(4, 12, 2, 2, "6")
    return g.outline("1")


def chest() -> G:
    g = G(16, 12)
    g.rect(1, 4, 14, 8, "C").rect(1, 1, 14, 3, "B").hl(2, 13, 0, "B").hl(1, 14, 4, "D")
    for x in (1, 14):
        g.vl(x, 1, 11, "o")
    g.rect(6, 4, 4, 3, "n").px(7, 5, "0").px(8, 5, "0").px(7, 6, "q")
    g.hl(2, 13, 9, "D")
    return g.outline("1")


def cart() -> G:
    g = G(32, 20)
    g.rect(4, 3, 22, 9, "B").rect(4, 3, 22, 2, "A").hl(4, 25, 11, "D")
    for x in (10, 16, 22):
        g.vl(x, 5, 10, "C")
    g.line(26, 9, 31, 7, "C").line(26, 10, 31, 8, "D")
    g.art(["ss.f.", "rsffe", ".eeee"], 8, 0).art(["f.ee", "efed"], 18, 0)
    for cx in (9, 21):
        g.disc(cx, 14.5, 5, 5, "D").disc(cx, 14.5, 3.6, 3.6, "~")
        g.line(cx - 3, 14, cx + 3, 15, "C").line(cx, 11, cx, 18, "C").px(cx, 14, "n")
    g.k = [[None if v == "~" else v for v in row] for row in g.k]
    return g.outline("1")


def tombstone() -> G:
    g = G(12, 14)
    g.rect(1, 4, 10, 10, "5").disc(6, 4.5, 5, 4, "5")
    g.vl(1, 4, 13, "4").px(2, 2, "4").hl(3, 5, 1, "4")
    g.vl(10, 4, 13, "O")
    g.hl(4, 7, 6, "P").vl(5, 4, 10, "P").vl(6, 4, 10, "P")
    g.art(["d.de", "eded"], 0, 12)
    return g.outline("1")


def statue() -> G:
    g = G(16, 34)
    g.rect(1, 26, 14, 8, "c").hl(1, 14, 26, "g").rect(3, 24, 10, 2, "b").hl(1, 14, 33, "a")
    g.art([
        "......55......",
        ".....5445.....",
        ".....5445.....",
        "......55......",
        "....554455....",
        "...54444445...",
        "..5.544445.5..",
        ".5..544445..5.",
        "5...544445...4",
        "....544445...4",
        "....544445...4",
        "....54..45...4",
        "....54..45...4",
        "....54..45...4",
        "....54..45...4",
        "...554..455..4",
        "...555..555..4",
    ], 1, 4)
    g.vl(14, 0, 12, "4").px(14, 0, "N")
    return g.outline("1")


def fountain() -> G:
    g = G(30, 22)
    g.rect(1, 14, 28, 8, "b").hl(1, 28, 14, "c").hl(1, 28, 21, "a")
    g.rect(3, 15, 24, 2, "R").hl(3, 26, 15, "S")
    g.rect(13, 5, 4, 10, "b").vl(13, 5, 14, "c")
    g.disc(15, 5, 6, 1.6, "c")
    for x, y in ((9, 7), (8, 9), (8, 11), (21, 7), (22, 9), (22, 11), (15, 2), (14, 0), (16, 1)):
        g.px(x, y, "S")
    g.px(15, 3, "T").px(10, 13, "T").px(20, 13, "T")
    return g.outline("1")


def flagpole(phase: int) -> G:
    g = G(20, 38)
    g.vl(1, 2, 37, "O").vl(2, 2, 37, "N").disc(1.5, 1.5, 1.5, 1.5, "n")
    g.rect(0, 35, 4, 3, "P")
    for i in range(16):
        wave = round(1.6 * math.sin((i / 16) * math.pi * 2 + phase * math.pi / 2))
        for j in range(10):
            key = "z" if j < 3 or j > 6 else "m"
            if i < 2 or i > 13:
                key = "y" if key == "z" else key
            g.px(3 + i, 3 + j + wave, key)
        g.px(3 + i, 3 + wave, "y")
    return g.outline("1")


def cannon() -> G:
    g = G(22, 13)
    g.rect(4, 2, 16, 6, "P").hl(4, 19, 2, "N").hl(4, 19, 7, "0")
    g.rect(18, 1, 3, 8, "O").rect(2, 3, 3, 4, "O").px(1, 5, "O")
    g.hl(9, 9, 2, "n").vl(9, 2, 7, "n").vl(15, 2, 7, "n")
    g.disc(9, 9.5, 3.5, 3.5, "C").disc(9, 9.5, 1.3, 1.3, "n")
    g.rect(2, 10, 14, 3, "D")
    return g.outline("1")


def anvil() -> G:
    g = G(14, 9)
    g.art([
        "OOOOOOOOOOOO..",
        "NNNNNNNNNNNNNN",
        ".OOOOOOOOOOO..",
        "....OOOOO.....",
        "....OPPPO.....",
        "...OOPPPOO....",
        "..OOOOOOOOO...",
    ], 0, 2)
    g.rect(2, 0, 3, 2, "D").px(3, 0, "C")
    return g.outline("1")


def haybale() -> G:
    g = G(18, 13)
    g.rect(1, 1, 16, 12, "n").hl(1, 16, 1, "m")
    for y in range(3, 12, 2):
        for x in range(2 + (y % 4), 16, 4):
            g.px(x, y, "o")
    g.vl(5, 1, 12, "D").vl(12, 1, 12, "D")
    g.art(["m.m", ".m."], 7, 0)
    return g.outline("1")


def weapon_rack() -> G:
    g = G(18, 22)
    g.rect(1, 4, 16, 2, "C").rect(1, 14, 16, 2, "C").vl(1, 2, 21, "D").vl(16, 2, 21, "D")
    for x, blade in ((4, "4"), (8, "9"), (12, "4")):
        g.vl(x, 0, 12, blade).vl(x + 1, 1, 12, "5")
        g.hl(x - 1, x + 2, 13, "n").rect(x, 14, 2, 4, "D").px(x, 18, "n")
    g.art(["..O..", ".ONO.", "ONNNO", ".ONO."], 6, 17)
    return g.outline("1")


def training_dummy() -> G:
    g = G(16, 30)
    g.rect(7, 18, 2, 12, "C").rect(4, 28, 8, 2, "D")
    g.rect(1, 9, 14, 3, "C").hl(1, 14, 9, "B")
    g.ball(8, 13, 5, 7, "j", "k", "l")
    g.ball(8, 5, 4, 4, "j", "k", "l")
    g.hl(4, 11, 15, "D").hl(4, 11, 17, "D")
    g.art(["z.z", ".z.", "z.z"], 5, 3).px(10, 5, "0")
    g.line(5, 11, 11, 18, "z")
    return g.outline("1")


def crate_stack() -> G:
    g = G(20, 30)
    def crate_at(x: int, y: int, s: int) -> None:
        g.box(x, y, s, s, "C", "D")
        g.rect(x + 1, y + 1, s - 2, 1, "B")
        g.line(x + 2, y + s - 3, x + s - 3, y + 2, "A")
        g.line(x + 3, y + s - 3, x + s - 3, y + 3, "B")
        for cx, cy in ((x + 2, y + 2), (x + s - 3, y + 2), (x + 2, y + s - 3), (x + s - 3, y + s - 3)):
            g.px(cx, cy, "m")
    crate_at(0, 14, 16)
    crate_at(4, 2, 12)
    g.art(["rs", "ts"], 15, 12)
    return g


def potted_plant() -> G:
    g = G(12, 16)
    g.rect(2, 10, 8, 6, "8").hl(1, 10, 10, "7").hl(3, 8, 15, "6").vl(9, 11, 15, "7")
    for x0, y0, x1, y1 in ((6, 10, 1, 2), (6, 10, 10, 1), (6, 10, 6, 0), (6, 10, 3, 4), (6, 10, 9, 5)):
        g.line(x0, y0, x1, y1, "d")
        g.px(x1, y1, "f").px(x1 + 1, y1, "e")
    return g.outline("1")


def street_stall() -> G:
    g = G(32, 30)
    for i in range(32):
        stripe = "z" if (i // 4) % 2 == 0 else "9"
        g.rect(i, 1, 1, 6, stripe)
    for i in range(0, 32, 4):
        g.art(["zzzz", ".zz."] if (i // 4) % 2 == 0 else ["9999", ".99."], i, 7)
    g.hl(0, 31, 0, "y")
    g.vl(2, 9, 29, "D").vl(29, 9, 29, "D")
    g.rect(1, 20, 30, 10, "C").rect(1, 20, 30, 2, "A").hl(1, 30, 29, "D")
    g.vl(10, 22, 28, "D").vl(21, 22, 28, "D")
    for x, k in ((4, "y"), (8, "x"), (12, "m"), (16, "e"), (20, "y"), (24, "x")):
        g.ball(x + 1.5, 18.5, 1.8, 1.6, "9", k, "u" if k != "e" else "d")
    return g.outline("1")


# ---------------------------------------------------------------------------
# Windows & walls — mounted on a platform's face
# ---------------------------------------------------------------------------


def window(lit: bool, w: int = 12, h: int = 14, arch: bool = False, panes: int = 4) -> G:
    g = G(w, h)
    glass = ("E", "F", "G") if lit else ("K", "J", "I")
    r = w / 2

    def inside(i: int, j: int) -> bool:
        if not (0 <= i < w and 0 <= j < h):
            return False
        if not arch or j >= r:
            return True
        return (i + 0.5 - r) ** 2 + (j + 0.5 - r) ** 2 <= r * r + 0.5

    for j in range(h):
        for i in range(w):
            if inside(i, j):
                g.px(i, j, "D")
    for j in range(1, h - 2):
        for i in range(1, w - 1):
            if all(inside(i + dx, j + dy) for dx, dy in ((1, 0), (-1, 0), (0, -1))):
                g.px(i, j, glass[1])
    # Light: a bright corner and a darker band at the bottom.
    g.rect(1, h - 5, w - 2, 2, glass[2])
    hy = int(r) if arch else 2
    g.px(2, hy, glass[0]).px(3, hy, glass[0]).px(2, hy + 1, glass[0])
    if panes >= 2:
        g.vl(w // 2 - (1 if w % 2 == 0 else 0), 1, h - 3, "D")
    if panes >= 4:
        g.hl(1, w - 2, (h - 2) // 2, "D")
    # Stone sill.
    g.hl(0, w - 1, h - 2, "c").hl(0, w - 1, h - 1, "a")
    return g


def window_round() -> G:
    g = G(10, 10)
    g.disc(5, 5, 5, 5, "n").disc(5, 5, 3.8, 3.8, "I").disc(4.4, 4.4, 2.5, 2.5, "J")
    g.px(3, 3, "K").px(4, 3, "K").px(3, 4, "K").px(6, 6, "H")
    for x, y in ((5, 0), (0, 5), (9, 5), (5, 9)):
        g.px(x, y, "q")
    return g


def window_shutters() -> G:
    g = G(22, 14)
    inner = window(True, 12, 14)
    for j in range(14):
        for i in range(12):
            if inner.k[j][i]:
                g.px(i + 5, j, inner.k[j][i])
    for x in (0, 17):
        g.box(x, 0, 5, 12, "e", "d")
        for y in (2, 5, 8):
            g.hl(x + 1, x + 3, y, "c")
    return g


def window_box() -> G:
    g = G(14, 20)
    inner = window(True, 12, 14, panes=4)
    for j in range(14):
        for i in range(12):
            if inner.k[j][i]:
                g.px(i + 1, j, inner.k[j][i])
    g.rect(0, 15, 14, 4, "C").hl(0, 13, 15, "B").hl(0, 13, 18, "D")
    g.art([".ee.rse.eetsee.", "eeffeeffeeeffe"], 0, 12)
    g.px(1, 19, "D").px(12, 19, "D")
    return g


def stained_glass() -> G:
    g = G(14, 22)
    g.rect(0, 5, 14, 17, "b").disc(7, 7, 7, 7, "b")
    g.rect(1, 7, 12, 13, "Y").disc(7, 7.5, 6, 6, "Y")
    cells = [("X", 2, 8), ("z", 7, 8), ("Q", 2, 13), ("n", 7, 13), ("R", 2, 17), ("X", 7, 17)]
    for k, x, y in cells:
        g.rect(x, y, 5, 4, k)
    g.disc(7, 5, 3, 3, "m").disc(7, 5, 1.5, 1.5, "x")
    for y in (12, 16):
        g.hl(1, 12, y, "0")
    g.vl(7, 7, 20, "0").vl(6, 8, 20, "0")
    g.hl(0, 13, 20, "c").hl(0, 13, 21, "a")
    return g


def window_barred() -> G:
    g = window(False, 12, 12, panes=0)
    g.swap("J", "Z").swap("I", "0").swap("K", "3")
    for x in (3, 6, 9):
        g.vl(x, 1, 9, "O")
        g.px(x, 1, "N")
    return g


def door() -> G:
    g = G(18, 28)
    g.rect(0, 4, 18, 24, "a").disc(9, 7, 9, 7, "a")
    g.rect(2, 7, 14, 21, "C").disc(9, 8, 7, 6, "C")
    for x in (5, 9, 13):
        g.vl(x, 4, 27, "D")
    g.vl(3, 6, 27, "B")
    for y in (10, 22):
        g.hl(2, 15, y, "q").px(4, y, "m").px(13, y, "m")
    g.disc(12.5, 16.5, 1, 1, "n").px(12, 16, "m")
    g.rect(1, 26, 16, 2, "c").hl(0, 17, 27, "b")
    return g


def clock() -> G:
    g = G(16, 16)
    g.disc(8, 8, 8, 8, "o").disc(8, 8, 6.6, 6.6, "i").disc(8, 8, 5.5, 5.5, "h")
    for a in range(12):
        x = 8 + 5.0 * math.sin(a * math.pi / 6)
        y = 8 - 5.0 * math.cos(a * math.pi / 6)
        g.px(int(x), int(y), "l" if a % 3 else "0")
    g.line(8, 8, 8, 4, "0").line(8, 8, 11, 9, "0").px(8, 8, "z")
    return g


def shield() -> G:
    g = G(14, 16)
    for j in range(16):
        half = 7 if j < 8 else max(1, round(7 - (j - 8) * 0.85))
        g.hl(7 - half, 6 + half, j, "z")
    g.outline("q")
    for j in range(16):
        for i in range(14):
            if g.k[j][i] == "z" and i >= 7:
                g.k[j][i] = "H"
    g.hl(0, 13, 0, "q")
    g.art([".mm.", "mnnm", ".mm.", ".mm.", "m..m"], 5, 4)
    return g.outline("0")


def poster() -> G:
    g = G(12, 15)
    g.rect(0, 0, 12, 15, "i").hl(0, 11, 14, "k").vl(11, 0, 14, "k")
    g.hl(2, 9, 2, "C").hl(3, 8, 3, "C")
    g.rect(3, 5, 6, 5, "j").disc(6, 7, 2, 2, "8").hl(4, 7, 9, "7").px(5, 7, "0").px(7, 7, "0")
    g.hl(2, 9, 11, "l").hl(3, 8, 12, "l")
    g.px(1, 0, "z").px(10, 0, "z")
    g.px(11, 14, None or "k")
    return g


def vent() -> G:
    g = G(14, 9)
    g.box(0, 0, 14, 9, "P", "O")
    for y in (2, 4, 6):
        g.hl(1, 12, y, "0")
    for x, y in ((1, 1), (12, 1), (1, 7), (12, 7)):
        g.px(x, y, "N")
    return g


def ivy() -> G:
    g = G(18, 18)
    leaves = [(2, 1), (6, 3), (10, 1), (14, 4), (4, 7), (9, 6), (13, 9), (2, 11), (7, 11), (11, 14), (15, 13), (5, 15)]
    g.line(1, 0, 5, 17, "D").line(8, 0, 12, 17, "D").line(15, 0, 9, 12, "D")
    for i, (x, y) in enumerate(leaves):
        g.art([".e.", "efe", ".d."] if i % 2 else ["ee.", "efd", ".d."], x, y)
    return g


def crack() -> G:
    g = G(12, 12)
    for a, b, c, d in ((6, 0, 5, 4), (5, 4, 7, 7), (7, 7, 5, 11), (5, 4, 1, 6), (7, 7, 11, 8), (1, 6, 0, 9)):
        g.line(a, b, c, d, "0")
    g.px(6, 5, "1").px(4, 8, "1").px(8, 8, "1")
    return g


def bricks() -> G:
    g = G(20, 10)
    g.rect(0, 0, 20, 10, "1")
    for row, y in enumerate((1, 4, 7)):
        off = 0 if row % 2 == 0 else 3
        for x in range(-3 + off, 20, 6):
            g.rect(max(0, x), y, min(5, 20 - max(0, x)) - (max(0, x) - x), 2, "7" if (x + row) % 4 else "8")
            if x >= 0:
                g.px(x, y, "8")
    for x, y in ((0, 0), (19, 0), (0, 9), (19, 9), (1, 0), (18, 9)):
        g.k[y][x] = None
    return g


def birdhouse() -> G:
    g = G(12, 18)
    g.art([
        ".....zz.....",
        "....zyyz....",
        "...zyyyyz...",
        "..zyyyyyyz..",
        ".zyyyyyyyyz.",
        "zzzzzzzzzzzz",
    ], 0, 0)
    g.rect(2, 6, 8, 8, "A").vl(9, 6, 13, "C").hl(2, 9, 13, "C")
    g.disc(6, 9, 1.6, 1.6, "0").hl(5, 7, 12, "D").px(6, 12, "B")
    g.rect(5, 14, 2, 4, "D")
    return g


def shop_sign() -> G:
    g = G(22, 16)
    g.hl(0, 15, 0, "0").vl(0, 0, 3, "0").line(1, 3, 6, 0, "0")
    g.vl(4, 1, 4, "O").vl(13, 1, 4, "O")
    g.box(1, 4, 16, 11, "B", "D")
    g.hl(2, 15, 5, "A")
    g.art([".nn.", "nmmn", "nmmn", ".nn.", ".oo."], 7, 7)
    return g


def awning() -> G:
    g = G(28, 10)
    for i in range(28):
        k = "z" if (i // 4) % 2 == 0 else "9"
        g.rect(i, 1, 1, 6, k)
        g.px(i, 1, "y" if k == "z" else "U")
    for i in range(0, 28, 4):
        k = "z" if (i // 4) % 2 == 0 else "9"
        g.art([k * 4, "." + k * 2 + "."], i, 7)
    g.hl(0, 27, 0, "O")
    return g


def balcony() -> G:
    g = G(28, 14)
    g.rect(0, 10, 28, 4, "c").hl(0, 27, 10, "g").hl(0, 27, 13, "a")
    g.hl(0, 27, 0, "O").hl(0, 27, 1, "P")
    for x in range(1, 28, 3):
        g.vl(x, 2, 9, "O")
    g.art(["..ee", ".efe", "eedd"], 3, 6).art(["rs.", "ts."], 4, 4)
    g.art(["ee..", "efe.", "ddee"], 21, 6).art([".rs", ".st"], 21, 4)
    return g.outline("1")


def pipe() -> G:
    g = G(8, 24)
    g.rect(2, 0, 4, 24, "N").vl(2, 0, 23, "4").vl(5, 0, 23, "O")
    for y in (3, 12, 21):
        g.rect(1, y, 6, 2, "O").hl(1, 6, y, "4")
    g.art(["S", "R"], 3, 22)
    return g


def crest() -> G:
    g = G(26, 14)
    g.rect(10, 0, 6, 14, "z").vl(10, 0, 13, "y").vl(15, 0, 13, "u")
    g.hl(10, 15, 0, "m")
    g.art([".m.", "mnm", ".m."], 11, 5)
    for side in (0, 1):
        for i in range(9):
            x = 9 - i if side == 0 else 16 + i
            y = 3 + int(2 * math.sin(i / 2.0))
            g.vl(x, y, y + 1 + (i % 3 == 0), "d" if i % 2 else "e")
    return g


def mosaic() -> G:
    g = G(16, 16)
    keys = ["Q", "R", "X", "m", "z", "S"]
    for j in range(0, 16, 2):
        for i in range(0, 16, 2):
            d = abs(i - 7) + abs(j - 7)
            g.rect(i, j, 2, 2, keys[(d // 2) % len(keys)])
    for j in range(16):
        for i in range(16):
            if abs(i - 7.5) + abs(j - 7.5) > 8.2:
                g.k[j][i] = None
    return g.outline("0")


# ---------------------------------------------------------------------------
# Lights & fire
# ---------------------------------------------------------------------------


def flame(frame: int, w: int = 6, h: int = 8) -> G:
    shapes = [
        ["..x...", ".xFx..", ".xEFx.", "xFEEFx", "xFEEFx", ".xFFx.", "..yy..", "......"],
        ["...x..", "..xFx.", ".xFEx.", "xFEEFx", "xFEEEx", ".xFFx.", "..yy..", "......"],
        ["......", "..x...", ".xFx..", ".xEFx.", "xFEEFx", ".xFFx.", "..yy..", "......"],
    ]
    g = G(w, h)
    g.art(shapes[frame % 3])
    return g


def torch(frame: int) -> G:
    g = G(8, 16)
    f = flame(frame)
    for j in range(8):
        for i in range(6):
            if f.k[j][i]:
                g.px(i + 1, j, f.k[j][i])
    g.rect(2, 7, 4, 2, "O").hl(2, 5, 7, "N")
    g.rect(3, 9, 2, 5, "C").vl(3, 9, 13, "B")
    g.rect(1, 13, 6, 2, "O").hl(1, 6, 13, "N").px(3, 15, "P").px(4, 15, "P")
    return g


def brazier(frame: int) -> G:
    g = G(14, 16)
    for dx, fr in ((1, frame), (4, frame + 1), (7, frame + 2)):
        f = flame(fr)
        for j in range(8):
            for i in range(6):
                if f.k[j][i]:
                    g.px(i + dx, j, f.k[j][i])
    g.rect(1, 7, 12, 3, "O").hl(1, 12, 7, "N").hl(2, 11, 10, "P")
    g.rect(3, 11, 8, 1, "O").vl(4, 11, 15, "O").vl(9, 11, 15, "O")
    g.line(2, 15, 4, 12, "O").line(11, 15, 9, 12, "O")
    for x in (3, 6, 9):
        g.px(x, 8, "x")
    return g


def campfire(frame: int) -> G:
    g = G(18, 12)
    for dx, dy, fr in ((3, 1, frame), (6, 0, frame + 1), (9, 1, frame + 2)):
        f = flame(fr)
        for j in range(8):
            for i in range(6):
                if f.k[j][i]:
                    g.px(i + dx, j + dy, f.k[j][i])
    g.line(1, 11, 16, 8, "C").line(1, 8, 16, 11, "D").line(2, 11, 15, 8, "B")
    for x in (0, 3, 13, 16):
        g.rect(x, 10, 2, 2, "5")
    return g


def candles(frame: int) -> G:
    g = G(12, 10)
    for x, h, k in ((1, 5, 0), (5, 7, 1), (9, 4, 2)):
        g.rect(x, 10 - h, 2, h, "#").vl(x + 1, 10 - h, 9, "j")
        tip = (frame + k) % 3
        g.px(x + (1 if tip == 1 else 0), 10 - h - 2, "F").px(x, 10 - h - 1, "E").px(x + 1, 10 - h - 1, "x" if tip == 2 else "E")
    return g


def streetlamp() -> G:
    g = G(14, 42)
    g.rect(6, 10, 2, 30, "P").vl(6, 10, 39, "O")
    g.rect(4, 38, 6, 4, "P").hl(4, 9, 38, "O").rect(5, 34, 4, 2, "P")
    g.art([
        "....PPPPPP....",
        "...PNNNNNNP...",
        "..PPPPPPPPPP..",
        "...PEEEEEEP...",
        "...PEFFFFEP...",
        "...PEFGGFEP...",
        "...PEEEEEEP...",
        "..PPPPPPPPPP..",
        ".....PPPP.....",
    ], 0, 0)
    g.px(7, 0, "N").px(6, 0, "N")
    return g


def hanging_lamp() -> G:
    g = G(10, 22)
    g.vl(5, 0, 9, "O").px(4, 3, "P").px(4, 6, "P")
    g.art([
        "...nnnn...",
        "..nmmmmn..",
        ".noooooon.",
        ".oEEEEEEo.",
        ".oEFFFFEo.",
        ".oEFGGFEo.",
        ".oEEEEEEo.",
        "..oooooo..",
        "....pp....",
    ], 0, 10)
    return g


def string_lights() -> G:
    g = G(48, 10)
    for i in range(48):
        y = 1 + int(4 * math.sin(math.pi * i / 47))
        g.px(i, y, "0")
        if i % 6 == 3:
            k = ("E", "x", "R", "m", "s", "S")[(i // 6) % 6]
            g.rect(i - 1, y + 1, 3, 3, k).px(i, y + 1, "O").px(i - 1, y + 2, "9")
    g.px(0, 0, "0").px(47, 0, "0")
    return g


def lantern_paper(frame: int) -> G:
    g = G(12, 22)
    g.vl(6, 0, 4, "0")
    sway = (0, 1, 0, -1)[frame % 4]
    body = G(12, 17)
    body.rect(4, 0, 4, 2, "D").rect(4, 15, 4, 2, "D")
    body.ball(6, 8.5, 5.5, 6.5, "x", "z", "u")
    body.disc(6, 8.5, 2.4, 4.8, "y")
    body.disc(5.5, 7.5, 1.2, 2.5, "F")
    for y in (5, 8, 11):
        body.hl(1, 10, y, "u")
    body.vl(6, 16, 16, "m")
    for j in range(17):
        for i in range(12):
            if body.k[j][i]:
                g.px(i + sway, j + 5, body.k[j][i])
    return g


def neon_heart(frame: int) -> G:
    g = G(14, 12)
    on = frame % 2 == 0
    art = [
        "..tt....tt....",
        ".t..t..t..t...",
        "t....tt....t..",
        "t..........t..",
        ".t........t...",
        "..t......t....",
        "...t....t.....",
        "....t..t......",
        ".....tt.......",
    ]
    g.art(art, 1, 1)
    if on:
        g.swap("t", "s")
        g.outline("t")
    else:
        g.swap("t", "u")
    return g


# ---------------------------------------------------------------------------
# Hanging — from a platform's underside
# ---------------------------------------------------------------------------


def roots() -> G:
    g = G(12, 16)
    for x, length, drift in ((1, 9, 1), (4, 15, -1), (7, 11, 1), (10, 7, -1)):
        for j in range(length):
            g.px(x + (drift if j > length * 0.6 else 0), j, "C" if j < length - 2 else "D")
    g.hl(0, 11, 0, "D")
    g.px(3, 6, "C").px(8, 4, "C")
    return g


def chain() -> G:
    g = G(5, 26)
    for y in range(0, 24, 4):
        if (y // 4) % 2 == 0:
            g.art([".O.", "O.O", "O.O", ".O."], 1, y)
        else:
            g.art(["N", "N", "N", "N"], 2, y)
    g.art(["OOO", "O.O"], 1, 24)
    return g


def banner(main: str, dark: str, light: str, emblem: str) -> G:
    g = G(14, 30)
    g.rect(0, 0, 14, 2, "D").px(0, 2, "D").px(13, 2, "D")
    g.rect(1, 2, 12, 24, main).vl(1, 2, 25, light).vl(12, 2, 25, dark)
    for i in range(6):
        g.vl(1 + i, 26, 26 + i, main).vl(12 - i, 26, 26 + i, main)
    g.hl(1, 12, 4, "n").hl(1, 12, 23, "n")
    g.art([
        "...ee...",
        "..emme..",
        ".emnnme.",
        "emnnnnme",
        ".emnnme.",
        "..emme..",
        "...ee...",
    ], 3, 9)
    g.swap("e", emblem)
    return g.outline("1")


def bunting() -> G:
    g = G(48, 12)
    for i in range(48):
        y = int(3 * math.sin(math.pi * i / 47))
        g.px(i, y, "D")
    colours = ("z", "m", "Q", "s", "e", "X")
    for n, x in enumerate(range(2, 44, 7)):
        y = int(3 * math.sin(math.pi * (x + 2) / 47)) + 1
        k = colours[n % len(colours)]
        for j in range(7):
            half = 3 - j // 2
            g.hl(x + 3 - half, x + 3 + half, y + j, k)
        g.px(x + 2, y, "9")
    return g


def icicles() -> G:
    g = G(18, 12)
    g.rect(0, 0, 18, 2, "M")
    for x, length in ((1, 6), (4, 11), (7, 5), (10, 9), (13, 4), (16, 7)):
        for j in range(length):
            w = 2 if j < length / 2 else 1
            g.rect(x, j, w, 1, "T" if j < 2 else "S")
        g.px(x, length - 1, "R")
    return g


def stalactite() -> G:
    g = G(10, 16)
    for j in range(16):
        half = max(0, 5 - j * 5 // 15)
        if half:
            g.hl(5 - half, 4 + half, j, "5")
            g.px(5 - half, j, "4").px(4 + half, j, "O")
    g.px(4, 15, "5").px(5, 15, "O")
    return g


def cobweb() -> G:
    g = G(16, 16)
    for a in range(0, 91, 18):
        rad = math.radians(a)
        g.line(0, 0, round(15 * math.cos(rad)), round(15 * math.sin(rad)), "M")
    for r in (4, 8, 12):
        prev = None
        for a in range(0, 91, 18):
            rad = math.radians(a)
            p = (round(r * math.cos(rad)), round(r * math.sin(rad)))
            if prev:
                g.line(prev[0], prev[1], p[0], p[1], "L")
            prev = p
    g.art([".0.", "000", ".0."], 9, 9)
    return g


def bell() -> G:
    g = G(12, 16)
    g.rect(5, 0, 2, 3, "O").hl(3, 8, 2, "D")
    g.art([
        "....nnnn....",
        "...nmmmmn...",
        "...nmmnnn...",
        "..nmmnnnno..",
        "..nmnnnnno..",
        "..nmnnnnno..",
        ".nmnnnnnnoo.",
        "nmnnnnnnnoop",
        "pppppppppppp",
    ], 0, 3)
    g.rect(5, 12, 2, 2, "q")
    return g


def birdcage(frame: int) -> G:
    g = G(14, 24)
    g.vl(7, 0, 3, "O").disc(7, 3, 1.5, 1.5, "n").k[3][7] = None
    for x in (2, 5, 9, 12):
        g.vl(x, 7, 21, "o")
    g.disc(7, 8, 6, 4, "o").disc(7, 8.5, 5, 3.5, "~")
    g.k = [[None if v == "~" else v for v in row] for row in g.k]
    for x in (2, 5, 9, 12):
        g.vl(x, 7, 21, "o")
    g.rect(1, 21, 13, 2, "n").hl(1, 13, 23, "p")
    g.hl(3, 11, 16, "C")
    # A canary on its perch, hopping between two poses.
    bird = ["..mm.", ".mmmx", "mmnm.", ".nn.."] if frame == 0 else [".mm..", "xmmm.", ".mnmm", "..nn."]
    g.art(bird, 5, 12)
    g.px(7 if frame == 0 else 6, 12, "0")
    return g


def hanging_plant() -> G:
    g = G(14, 22)
    g.line(7, 0, 2, 8, "O").line(7, 0, 12, 8, "O").vl(7, 0, 8, "O")
    g.rect(2, 9, 10, 5, "8").hl(1, 12, 9, "7").hl(3, 10, 13, "6")
    for x, length in ((1, 6), (3, 9), (10, 7), (12, 5)):
        for j in range(length):
            g.px(x + (j % 3 == 2), 14 + j, "e" if j % 2 else "d")
    g.art(["ee.ee", "efeef", ".ee.."], 3, 6)
    return g


def laundry() -> G:
    g = G(48, 18)
    for i in range(48):
        g.px(i, int(3 * math.sin(math.pi * i / 47)), "O")
    items = [
        (3, ["QQQQQQQQ", "QSQQQQSQ", "..QQQQ..", "..QQQQ..", "..QQQQ..", "..QQQQ.."]),
        (14, ["zzzzz", "zzzzz", "zz.zz", "zz.zz", "zz.zz"]),
        (23, ["9999999999", "9U999999U9", "9999999999", "9U999999U9", "..999999..", "..999999..", "..UUUUUU.."]),
        (37, ["mmmmmmm", ".mnnnm.", ".mmmmm.", ".m.m.m."]),
    ]
    for x, rows in items:
        y = int(3 * math.sin(math.pi * (x + len(rows[0]) / 2) / 47)) + 1
        g.art(rows, x, y)
        g.px(x, y - 1, "D").px(x + len(rows[0]) - 1, y - 1, "D")
    return g


def bat(frame: int) -> G:
    g = G(14, 10)
    if frame == 0:
        g.art([
            "......0.......",
            "......0.......",
            ".....303......",
            "....30003.....",
            "...3000003....",
            "...3000003....",
            "....3x0x3.....",
            ".....000......",
            "......3.......",
        ], 0, 0)
    else:
        g.art([
            "......0.......",
            "......0.......",
            ".....303......",
            "3...30003...3.",
            "33.3000003.33.",
            ".3330000033...",
            "....3x0x3.....",
            ".....000......",
            "......3.......",
        ], 0, 0)
    return g


# ---------------------------------------------------------------------------
# Critters
# ---------------------------------------------------------------------------


def pigeon(frame: int) -> G:
    g = G(10, 9)
    if frame == 0:
        g.art([
            "...55.....",
            "..5R45....",
            "..o554....",
            "...5544...",
            "...554444.",
            "...5554445",
            "....55555.",
            ".....o.o..",
        ], 0, 1)
        g.px(3, 2, "0")
    else:  # pecking
        g.art([
            "..........",
            "..........",
            "...544....",
            "..55544...",
            ".5R554445.",
            ".o5555555.",
            "....55555.",
            ".....o.o..",
        ], 0, 1)
        g.px(2, 5, "0")
    return g.outline("1")


def gull(frame: int) -> G:
    g = G(12, 10)
    g.art([
        "..99......",
        ".9999.....",
        "on9999....",
        "...99999..",
        "...9999955",
        "...99999P5",
        "....9999P.",
        ".....n.n..",
    ], 0, 2)
    g.px(3, 3, "0")
    if frame == 1:
        g.art(["...9", "..99", ".999"], 5, 0)
    return g.outline("1")


def crow(frame: int) -> G:
    g = G(10, 9)
    head_y = 0 if frame == 0 else 1
    g.art(["..33.", ".3003", "o300."], 0, head_y)
    g.px(2, head_y + 1, "Q")
    g.art([
        "..30003...",
        "..300003..",
        "...300003.",
        "....30333",
        ".....o.o..",
    ], 0, 3)
    g.swap("3", "0").swap("0", "0")
    g.px(3, head_y + 1, "R")
    return g.outline("3")


def sparrow(frame: int) -> G:
    g = G(8, 7)
    g.art([
        "..CC....",
        ".CA0C...",
        "oCAACC..",
        "..jACCD.",
        "..jjCDDD",
        "...q.q..",
    ], 0, 1 if frame == 0 else 0)
    if frame == 1:
        g.k[6] = [None] * 8
        g.art(["...q.q.."], 0, 6)
    return g


def cat(frame: int) -> G:
    g = G(14, 12)
    g.art([
        "...P...P......",
        "...PP.PP......",
        "...PPPPP......",
        "..PmPPPmP.....",
        "..PPPhPPP.....",
        "...PPPPP......",
        "...PPPPPP.....",
        "..PPPPPPPP....",
        "..PPPPPPPPP...",
        "..PPPPPPPPP...",
        "...hh.PPhh....",
    ], 0, 1)
    tail = [(10, 9), (11, 8), (12, 7), (12, 6)] if frame == 0 else [(10, 9), (11, 9), (12, 8), (13, 7)]
    for x, y in tail:
        g.px(x, y, "P")
    return g.outline("0")


def cat_sleeping() -> G:
    g = G(16, 8)
    g.art([
        "..x.x...........",
        ".xxxxx..........",
        ".xxyxxxxxxxx....",
        "xxxxxxxxxxxxxx..",
        "xxyxxxxyxxxxxxx.",
        ".xxxxxxxxxxxxxxx",
        "..yyyyyyyyyyyyy.",
    ], 0, 1)
    g.px(2, 4, "0").px(4, 4, "0")
    return g.outline("1")


def dog(frame: int) -> G:
    g = G(16, 12)
    g.art([
        ".BB...........",
        "BCBB..........",
        "BBBBB.........",
        "0BBBBB........",
        ".BBBBBBBBBBB..",
        "..BBBBBBBBBBB.",
        "..BAABBBBBBBB.",
        "..BB.BB..BB.BB",
        "..BB.BB..BB.BB",
    ], 1, 2)
    g.px(3, 4, "0").px(1, 6, "s")
    tail = [(14, 5), (15, 4)] if frame == 0 else [(14, 6), (15, 6)]
    for x, y in tail:
        g.px(x, y, "B")
    return g.outline("1")


def chicken(frame: int) -> G:
    g = G(10, 11)
    g.art([
        "...zz.....",
        "..9999....",
        ".o90999...",
        "..z99999..",
        "...999999U",
        "...9999U99",
        "....9999U.",
        ".....n.n..",
        "....nn.nn.",
    ], 0, 1 if frame == 0 else 2)
    if frame == 1:
        g.k[10] = [None] * 10
    return g.outline("1")


def frog() -> G:
    g = G(9, 7)
    g.art([
        ".ff.ff...",
        "f0ff0f...",
        "eeeeeee..",
        "eegggee..",
        ".eegee.d.",
        "dd...ddd.",
    ], 0, 1)
    return g.outline("1")


def snail() -> G:
    g = G(11, 8)
    g.ball(6, 3.5, 3.5, 3.5, "8", "7", "6")
    g.disc(6, 3.5, 1.4, 1.4, "8").px(6, 3, "6")
    g.art(["k......jjj.", "kjjjjjjjjjj"], 0, 6)
    g.vl(1, 3, 6, "j").px(0, 2, "k").px(2, 2, "k")
    return g.outline("1")


def rabbit(frame: int) -> G:
    g = G(10, 11)
    ears = ["..9.9.", "..9.9.", "..999."] if frame == 0 else ["...99.", "..9.9.", "..999."]
    g.art(ears, 1, 0)
    g.art([
        "..99999...",
        "..909999..",
        "..s999999.",
        "...999999U",
        "...9999999",
        "...99..99.",
    ], 0, 3)
    g.px(3, 3, "M")
    return g.outline("1")


def owl(frame: int) -> G:
    g = G(10, 12)
    g.art([
        ".C......C.",
        ".CC....CC.",
        ".CCCCCCCC.",
        "CjjCCCCjjC",
        "Cj0jCCj0jC",
        "CjjjnnjjjC",
        ".CCCnnCCC.",
        ".CjjjjjjC.",
        ".CjDjjDjC.",
        ".CjjDjjjC.",
        "..CCCCCC..",
        "..n.nn.n..",
    ], 0, 0)
    if frame == 1:
        for x in (2, 7):
            g.px(x, 4, "C").px(x - 1, 4, "C").px(x + 1, 4, "C")
    return g.outline("1")


def crab(frame: int) -> G:
    g = G(14, 8)
    g.art([
        "zz........zz",
        "z.z......z.z",
        ".zz.0..0.zz.",
        "...zyzzyz...",
        "..zyyyyyyz..",
        "...zzzzzz...",
        "..z.z..z.z..",
    ], 1 if frame == 0 else 0, 1)
    return g.outline("1")


def rat() -> G:
    g = G(12, 6)
    g.art([
        "..........",
        ".s5..555..",
        "0555555555",
        ".s5555555.",
        "..5.5..5..",
    ], 0, 0)
    g.line(10, 2, 11, 1, "7")
    return g.outline("1")


def penguin(frame: int) -> G:
    g = G(10, 13)
    g.art([
        "...000....",
        "..00000...",
        "..0909x...",
        "..00000x..",
        ".0099900..",
        "00999990..",
        "0.99999.0.",
        "0.99999.0.",
        "..99999...",
        "..09990...",
        "..x...x...",
    ], 0, 1 if frame == 0 else 0)
    return g.outline("3")


def fox() -> G:
    g = G(18, 12)
    g.art([
        "y...y.............",
        "yy.yy.............",
        "xyyyx.............",
        "x0xx9.............",
        ".xxx99............",
        "..xxxxxxxxxx...yy.",
        "..xxxxxxxxxxx.yyx9",
        "..x9xxxxxxxxxyyx9.",
        "..x9.xx...xx..yx..",
        "..0..00...00......",
    ], 0, 2)
    return g.outline("1")


def butterfly(frame: int) -> G:
    g = G(9, 7)
    if frame == 0:
        g.art([
            "ss...ss..",
            "sts.sts..",
            "sxt0txs..",
            ".st0ts...",
            ".s.0.s...",
        ], 0, 1)
    else:
        g.art([
            "..s.s....",
            "..t0t....",
            "..x0x....",
            "...0.....",
        ], 1, 2)
    return g


# ---------------------------------------------------------------------------
# Sky — placed in the air
# ---------------------------------------------------------------------------


def bird_flying(frame: int) -> G:
    g = G(12, 7)
    up = [
        "0.........0.",
        "00.......00.",
        ".00.....00..",
        "..00.0.00...",
        "....000.....",
        ".....0......",
    ]
    down = [
        "............",
        "............",
        ".....0......",
        "...00000....",
        "..00.0.00...",
        ".00.....00..",
    ]
    g.art(up if frame == 0 else down, 0, 0)
    return g.swap("0", "3")


def flock(frame: int) -> G:
    g = G(40, 18)
    for i, (x, y) in enumerate(((0, 9), (8, 5), (16, 1), (24, 6), (31, 11), (12, 13))):
        b = bird_flying((frame + i) % 2)
        for j in range(b.h):
            for k in range(b.w):
                if b.k[j][k] and k < 9:
                    g.px(x + k, y + j - 1, b.k[j][k])
    return g


def gull_gliding(frame: int) -> G:
    g = G(18, 8)
    wings = [
        "99...........99..",
        ".999.......999...",
        "..9999.9.9999....",
        "....99999999.....",
        ".....P999on......",
    ] if frame == 0 else [
        ".................",
        "..999.......999..",
        ".9..999.9.999..9.",
        "....99999999.....",
        ".....P999on......",
    ]
    g.art(wings, 0, 1)
    return g.outline("4")


def balloon(colour: str, dark: str, hi: str) -> G:
    g = G(12, 24)
    g.ball(6, 6.5, 5.5, 6.5, hi, colour, dark)
    g.art([".D.", "DDD"], 5, 13)
    for j in range(16, 24):
        g.px(6 + (1 if (j // 3) % 2 else 0), j, "4")
    return g.outline("1")


def kite() -> G:
    g = G(16, 28)
    for j in range(14):
        half = j if j < 6 else max(0, 6 - (j - 6) * 6 // 8)
        for i in range(-half, half + 1):
            k = "z" if (i < 0) ^ (j < 6) else "m"
            g.px(7 + i, j, k)
    g.vl(7, 0, 13, "D").hl(1, 13, 5, "D")
    for j in range(14, 28):
        x = 7 + round(2 * math.sin(j / 2.2))
        g.px(x, j, "4")
        if j in (17, 21, 25):
            g.art(["z.z", ".z."], x - 1, j)
    return g


def leaves() -> G:
    g = G(16, 12)
    for x, y, k in ((1, 1, "x"), (8, 0, "n"), (12, 5, "y"), (4, 7, "o"), (10, 9, "z")):
        g.art([k + k + ".", "." + k + k], x, y)
    return g


def cloud_puff() -> G:
    g = G(34, 14)
    for cx, cy, rx, ry in ((9, 9, 7, 4.5), (18, 6, 8, 5.5), (26, 9, 7, 4.5), (15, 10, 9, 4)):
        g.disc(cx, cy, rx, ry, "M")
    for cx, cy, rx, ry in ((17, 5, 5, 3), (8, 7.5, 4, 2.4)):
        g.disc(cx, cy, rx, ry, "9")
    g.hl(4, 30, 12, "L").hl(6, 28, 13, "L")
    return g


def fireflies(frame: int) -> G:
    g = G(18, 14)
    spots = ((2, 3), (9, 1), (15, 4), (5, 10), (12, 8), (16, 12), (8, 12))
    for i, (x, y) in enumerate(spots):
        if (i + frame) % 3 == 0:
            g.art([".F.", "FEF", ".F."], x - 1, y - 1)
        elif (i + frame) % 3 == 1:
            g.px(x, y, "G")
    return g


def sparkle(frame: int) -> G:
    g = G(9, 9)
    if frame == 0:
        g.art(["....9....", "....T....", "....9....", "..T999T..", "99T999T99", "..T999T..", "....9....", "....T....", "....9...."])
    elif frame == 1:
        g.art(["....T....", "...9.9...", "..9.T.9..", "...T9T...", "..9.T.9..", "...9.9...", "....T...."], 0, 1)
    else:
        g.art(["...T.", "..T9T", "...T."], 2, 3)
    return g


def airship() -> G:
    g = G(36, 20)
    g.ball(18, 6.5, 16, 6, "U", "V", "W")
    for x in (8, 14, 20, 26):
        g.vl(x, 1, 12, "W")
    g.rect(31, 2, 5, 9, "z").hl(31, 35, 6, "y")
    g.line(10, 12, 13, 15, "D").line(26, 12, 23, 15, "D")
    g.rect(12, 15, 12, 4, "C").hl(12, 23, 15, "A").hl(12, 23, 18, "D")
    for x in (14, 17, 20):
        g.px(x, 16, "F")
    g.vl(2, 4, 9, "O").vl(1, 5, 8, "N")
    return g.outline("1")


def moon() -> G:
    g = G(16, 16)
    g.disc(8, 8, 7.5, 7.5, "#").disc(10.5, 6, 6.5, 6.5, "~")
    g.k = [[None if v == "~" else v for v in row] for row in g.k]
    g.px(4, 9, "j").px(5, 12, "j").px(3, 6, "9")
    return g


def star() -> G:
    g = G(7, 7)
    g.art(["...#...", "...#...", "..#9#..", "##999##", "..#9#..", "...#...", "...#..."])
    return g


# ---------------------------------------------------------------------------
# The catalogue. Order is the palette's order inside each category.
# ---------------------------------------------------------------------------


def anim(fn: Callable[[int], G], n: int) -> Callable[[], list[G]]:
    return lambda: [fn(i) for i in range(n)]


def catalogue(legacy: dict[str, Callable[[], object]]) -> list[Prop]:
    """`legacy` holds `generate.py`'s seven original builders (images)."""
    from_legacy = lambda name: legacy[name]  # noqa: E731 — returns an Image
    P = Prop
    return [
        # Nature
        P("bush", "Bush", "nature", "stand", lambda: bush()),
        P("bushFlower", "Flowering bush", "nature", "stand", lambda: bush("s")),
        P("tallGrass", "Tall grass", "nature", "stand", tall_grass),
        P("flowersRed", "Red flowers", "nature", "stand", lambda: flowers("z", "u")),
        P("flowersBlue", "Blue flowers", "nature", "stand", lambda: flowers("Q", "Y")),
        P("sunflower", "Sunflower", "nature", "stand", sunflower),
        P("fern", "Fern", "nature", "stand", fern),
        P("reeds", "Reeds", "nature", "stand", reeds),
        P("mushroom", "Toadstool", "nature", "stand", mushroom),
        P("mushrooms", "Mushroom patch", "nature", "stand", mushrooms),
        P("rock", "Rock", "nature", "stand", lambda: rock()),
        P("boulder", "Boulder", "nature", "stand", boulder),
        P("stump", "Stump", "nature", "stand", stump),
        P("log", "Log", "nature", "stand", log),
        P("tree", "Round tree", "nature", "stand", round_tree),
        P("pine", "Pine", "nature", "stand", pine),
        P("deadTree", "Bare tree", "nature", "stand", dead_tree),
        P("snowman", "Snowman", "nature", "stand", snowman),
        P("planter", "Planter", "nature", "stand", from_legacy("planter")),
        P("flowerBox", "Flower box", "nature", "stand", from_legacy("flowerBox")),
        P("pottedPlant", "Potted plant", "nature", "stand", potted_plant),
        # Town
        P("crate", "Crate", "town", "stand", from_legacy("crate")),
        P("barrel", "Barrel", "town", "stand", from_legacy("barrel")),
        P("crateStack", "Crate stack", "town", "stand", crate_stack),
        P("sack", "Sack", "town", "stand", sack),
        P("amphora", "Amphora", "town", "stand", amphora),
        P("chest", "Treasure chest", "town", "stand", chest),
        P("bench", "Bench", "town", "stand", bench),
        P("signpost", "Signpost", "town", "stand", signpost),
        P("mailbox", "Mailbox", "town", "stand", mailbox),
        P("fence", "Fence", "town", "stand", fence),
        P("bollard", "Bollard", "town", "stand", bollard),
        P("anchor", "Anchor", "town", "stand", anchor),
        P("well", "Well", "town", "stand", well),
        P("fountain", "Fountain", "town", "stand", fountain),
        P("statue", "Statue", "town", "stand", statue),
        P("tombstone", "Tombstone", "town", "stand", tombstone),
        P("cart", "Flower cart", "town", "stand", cart),
        P("stall", "Market stall", "town", "stand", street_stall),
        P("haybale", "Hay bale", "town", "stand", haybale),
        P("cannon", "Cannon", "town", "stand", cannon),
        P("anvil", "Anvil", "town", "stand", anvil),
        P("weaponRack", "Weapon rack", "town", "stand", weapon_rack),
        P("dummy", "Training dummy", "town", "stand", training_dummy),
        P("flag", "Flag", "town", "stand", anim(flagpole, 4), 160),
        # Windows & walls
        P("windowLit", "Lit window", "walls", "wall", lambda: window(True)),
        P("windowDark", "Window", "walls", "wall", lambda: window(False)),
        P("windowArched", "Arched window", "walls", "wall", lambda: window(True, 12, 18, arch=True, panes=2)),
        P("windowTall", "Tall window", "walls", "wall", lambda: window(False, 10, 22, arch=True, panes=2)),
        P("windowRound", "Porthole", "walls", "wall", window_round),
        P("windowShutters", "Shuttered window", "walls", "wall", window_shutters),
        P("windowBox", "Window with flowers", "walls", "wall", window_box),
        P("windowBarred", "Barred window", "walls", "wall", window_barred),
        P("stainedGlass", "Stained glass", "walls", "wall", stained_glass),
        P("door", "Door", "walls", "wall", door),
        P("balcony", "Balcony", "walls", "wall", balcony),
        P("awning", "Awning", "walls", "wall", awning),
        P("shopSign", "Shop sign", "walls", "wall", shop_sign),
        P("clock", "Clock", "walls", "wall", clock),
        P("shield", "Shield", "walls", "wall", shield),
        P("crest", "Laurel crest", "walls", "wall", crest),
        P("mosaic", "Mosaic", "walls", "wall", mosaic),
        P("poster", "Wanted poster", "walls", "wall", poster),
        P("birdhouse", "Birdhouse", "walls", "wall", birdhouse),
        P("ivy", "Ivy", "walls", "wall", ivy),
        P("bricks", "Exposed bricks", "walls", "wall", bricks),
        P("crack", "Crack", "walls", "wall", crack),
        P("vent", "Vent", "walls", "wall", vent),
        P("pipe", "Drainpipe", "walls", "wall", pipe),
        # Lights & fire
        P("lantern", "Lamp post", "lights", "stand", from_legacy("lantern")),
        P("streetlamp", "Street lamp", "lights", "stand", streetlamp),
        P("torch", "Wall torch", "lights", "wall", anim(torch, 3), 120),
        P("brazier", "Brazier", "lights", "stand", anim(brazier, 3), 120),
        P("campfire", "Campfire", "lights", "stand", anim(campfire, 3), 120),
        P("candles", "Candles", "lights", "stand", anim(candles, 3), 180),
        P("neonHeart", "Neon heart", "lights", "wall", anim(neon_heart, 2), 700),
        P("hangingLamp", "Hanging lamp", "lights", "hang", hanging_lamp),
        P("paperLantern", "Paper lantern", "lights", "hang", anim(lantern_paper, 4), 260),
        P("stringLights", "String lights", "lights", "hang", string_lights),
        # Hanging
        P("vine", "Vine", "hanging", "hang", from_legacy("vine")),
        P("vineFlower", "Flowering vine", "hanging", "hang", from_legacy("vineFlower")),
        P("roots", "Roots", "hanging", "hang", roots),
        P("chain", "Chain", "hanging", "hang", chain),
        P("bannerRed", "Red banner", "hanging", "hang", lambda: banner("z", "u", "y", "e")),
        P("bannerBlue", "Blue banner", "hanging", "hang", lambda: banner("I", "H", "J", "Q")),
        P("bannerPurple", "Royal banner", "hanging", "hang", lambda: banner("X", "Y", "s", "m")),
        P("bunting", "Bunting", "hanging", "hang", bunting),
        P("laundry", "Washing line", "hanging", "hang", laundry),
        P("hangingPlant", "Hanging plant", "hanging", "hang", hanging_plant),
        P("bell", "Bell", "hanging", "hang", bell),
        P("birdcage", "Birdcage", "hanging", "hang", anim(birdcage, 2), 420),
        P("icicles", "Icicles", "hanging", "hang", icicles),
        P("stalactite", "Stalactite", "hanging", "hang", stalactite),
        P("cobweb", "Cobweb", "hanging", "hang", cobweb),
        P("bat", "Bat", "hanging", "hang", anim(bat, 2), 900),
        # Critters
        P("pigeon", "Pigeon", "critters", "stand", anim(pigeon, 2), 650),
        P("gull", "Seagull", "critters", "stand", anim(gull, 2), 900),
        P("crow", "Crow", "critters", "stand", anim(crow, 2), 800),
        P("sparrow", "Sparrow", "critters", "stand", anim(sparrow, 2), 300),
        P("owl", "Owl", "critters", "stand", anim(owl, 2), 1400),
        P("chicken", "Chicken", "critters", "stand", anim(chicken, 2), 380),
        P("cat", "Cat", "critters", "stand", anim(cat, 2), 600),
        P("catSleeping", "Sleeping cat", "critters", "stand", cat_sleeping),
        P("dog", "Dog", "critters", "stand", anim(dog, 2), 220),
        P("fox", "Fox", "critters", "stand", fox),
        P("rabbit", "Rabbit", "critters", "stand", anim(rabbit, 2), 900),
        P("frog", "Frog", "critters", "stand", frog),
        P("snail", "Snail", "critters", "stand", snail),
        P("crab", "Crab", "critters", "stand", anim(crab, 2), 340),
        P("rat", "Rat", "critters", "stand", rat),
        P("penguin", "Penguin", "critters", "stand", anim(penguin, 2), 500),
        P("butterfly", "Butterfly", "critters", "air", anim(butterfly, 2), 160),
        # Sky
        P("birdFlying", "Bird", "sky", "air", anim(bird_flying, 2), 220),
        P("flock", "Flock", "sky", "air", anim(flock, 2), 240),
        P("gullGliding", "Gliding gull", "sky", "air", anim(gull_gliding, 2), 700),
        P("balloonRed", "Red balloon", "sky", "air", lambda: balloon("z", "u", "x")),
        P("balloonBlue", "Blue balloon", "sky", "air", lambda: balloon("Q", "Z", "S")),
        P("kite", "Kite", "sky", "air", kite),
        P("airship", "Airship", "sky", "air", airship),
        P("cloud", "Cloud", "sky", "air", cloud_puff),
        P("leaves", "Falling leaves", "sky", "air", leaves),
        P("fireflies", "Fireflies", "sky", "air", anim(fireflies, 3), 260),
        P("sparkle", "Sparkle", "sky", "air", anim(sparkle, 3), 200),
        P("moon", "Moon", "sky", "air", moon),
        P("star", "Star", "sky", "air", star),
    ]
