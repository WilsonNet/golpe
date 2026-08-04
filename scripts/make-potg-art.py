#!/usr/bin/env python3
"""
Generate the Play of the Game splash art.

They exist for the same reason `make-roll-art.py` exists: the game ships
generated art rather than hand-drawn art, so a piece of the interface can be
*derived* from the palette it has to sit in instead of being a PNG somebody
colour-picked once and nobody dares re-tint.

  public/assets/potg-burst.png       a sunburst of gold rays, on transparency
  public/assets/potg-emblem.png      a laurel-and-blade medal, the ceremony's mark
  public/assets/potg-word-*.png      the wordmark, one file per word

**The wordmark is art rather than live text, and that is the point.** Overwatch
sets this card in Big Noodle Too — a condensed, uppercase, uniform-stroke
grotesque — and the whole character of the splash is that typeface. There is no
condensed display face that is present on Windows, macOS and Linux alike, so a
CSS font stack would have looked right on one machine and like Arial Bold on the
next; shipping a webfont means shipping a licence and a network request for four
words. Rendering the four words here, from whichever narrow grotesque the build
machine has, bakes the gradient and the outline in too — neither of which CSS
does well on text — and leaves the overlay free to animate each word as its own
block, which is what the entrance actually needs.

Both are drawn at 4x and downsampled, which is the whole of the anti-aliasing
strategy: the shapes are radial and hard-edged, and PIL has no vector renderer,
so supersampling is cheaper than the alternative and looks better than either.

The burst rotates behind the title in CSS. It is deliberately *not* a
`repeating-conic-gradient`, which was the first version: a conic gradient's rays
are perfectly hard-edged all the way to the rim, and the result read as a
warning label rather than as light. This one fades its rays out along their
length and blurs their edges, which is what makes it read as a flare.

    python3 scripts/make-potg-art.py
"""

import math
import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "assets")

# The HUD's gold, straight out of `fightHudStyles.ts`. Everything here is a
# tint of it so the splash cannot drift from the frames it appears over.
GOLD = (255, 209, 102)
GOLD_DEEP = (214, 156, 46)
INK = (24, 20, 12)

SS = 4  # supersample factor

# Bright top, gold body, deep bottom — the vertical gradient every heavy game
# wordmark has, and the reason this is baked art rather than a CSS colour.
WORD_TOP = (255, 246, 214)
WORD_MID = GOLD
WORD_BOTTOM = (196, 138, 38)
WORD_OUTLINE = (18, 14, 8)

# The wordmark's face, in order of preference. All are condensed or narrow
# grotesques; the first one present wins, and the last is a plain bold so the
# script still produces *something* on a machine with none of the others.
WORD_FONTS = (
    "/usr/share/fonts/gsfonts/NimbusSansNarrow-Bold.otf",
    "/usr/share/fonts/TTF/DejaVuSansCondensed-Bold.ttf",
    "/usr/share/fonts/liberation/LiberationSansNarrow-Bold.ttf",
    "/usr/share/fonts/liberation/LiberationSans-Bold.ttf",
    "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
)

WORDS = ("PLAY", "OF", "THE", "GAME")

# The verdict card's words. Same face, different metals: victory struck in the
# gold, defeat in a cold silver — a losing player should read the tone of the
# verdict from the colour before a word is legible — and a draw in a dimmed,
# spent gold, because nobody won and the card should not pretend otherwise.
PALETTES = {
    "victory": {
        "top": WORD_TOP,
        "mid": WORD_MID,
        "bottom": WORD_BOTTOM,
        "outline": WORD_OUTLINE,
    },
    "defeat": {
        "top": (240, 246, 255),
        "mid": (198, 210, 224),
        "bottom": (136, 150, 168),
        "outline": (10, 14, 22),
    },
    "draw": {
        "top": (246, 236, 200),
        "mid": (212, 192, 138),
        "bottom": (162, 142, 92),
        "outline": (18, 14, 8),
    },
}

VERDICT_WORDS = ("VICTORY", "DEFEAT", "DRAW")


def burst(size=640, rays=24):
    """A radial flare: `rays` tapered gold wedges, fading out toward the rim."""
    big = size * SS
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    c = big / 2
    outer = c * 0.98

    # Alternating long and short rays. A single ray length reads as a gear;
    # two lengths read as light, because real flares are never uniform.
    for i in range(rays):
        a0 = (i / rays) * math.tau
        long_ray = i % 2 == 0
        reach = outer * (1.0 if long_ray else 0.66)
        half = (math.tau / rays) * (0.20 if long_ray else 0.13)
        tip = (c + math.cos(a0) * reach, c + math.sin(a0) * reach)
        left = (c + math.cos(a0 - half) * c * 0.16, c + math.sin(a0 - half) * c * 0.16)
        right = (c + math.cos(a0 + half) * c * 0.16, c + math.sin(a0 + half) * c * 0.16)
        alpha = 210 if long_ray else 150
        draw.polygon([left, tip, right], fill=(*GOLD, alpha))

    # A hot core, so the rays look like they are coming *from* somewhere.
    for r, a in ((0.20, 235), (0.13, 255)):
        draw.ellipse(
            [c - c * r, c - c * r, c + c * r, c + c * r],
            fill=(*GOLD, a),
        )

    img = img.filter(ImageFilter.GaussianBlur(radius=SS * 1.6))
    img = img.resize((size, size), Image.LANCZOS)

    # Fade the whole thing out toward the rim. Done as an alpha mask rather than
    # by shortening the rays: the rays have to *reach* the edge or the flare
    # looks clipped, they just must not arrive at full strength.
    fade = Image.new("L", (size, size), 0)
    fd = ImageDraw.Draw(fade)
    steps = 96
    for i in range(steps, 0, -1):
        t = i / steps
        r = (size / 2) * t
        # Full strength through the middle third, then a smooth run-off.
        v = int(255 * min(1.0, max(0.0, (1.0 - t) * 1.9)))
        fd.ellipse([size / 2 - r, size / 2 - r, size / 2 + r, size / 2 + r], fill=v)
    alpha = img.getchannel("A").point(lambda p: p)
    img.putalpha(Image.composite(alpha, Image.new("L", (size, size), 0), fade))
    return img


def emblem(size=256):
    """A medal: a ringed disc, two crossed blades, and a laurel to either side."""
    big = size * SS
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    c = big / 2

    # The disc, with a deep rim so it reads as struck metal rather than a dot.
    draw.ellipse([c - big * 0.34, c - big * 0.34, c + big * 0.34, c + big * 0.34],
                 fill=(*GOLD_DEEP, 255))
    draw.ellipse([c - big * 0.30, c - big * 0.30, c + big * 0.30, c + big * 0.30],
                 fill=(*GOLD, 255))
    draw.ellipse([c - big * 0.25, c - big * 0.25, c + big * 0.25, c + big * 0.25],
                 fill=(*INK, 255))

    # Two crossed blades on the face. Straight quads rather than a font glyph:
    # the game's weapon is a sword and the mark should say so without needing an
    # icon set nothing else in the project uses.
    for lean in (1, -1):
        ang = lean * 0.55

        def place(x, y, ang=ang):
            px, py = x * big, y * big
            return (
                c + px * math.cos(ang) - py * math.sin(ang),
                c + px * math.sin(ang) + py * math.cos(ang),
            )

        for shape, colour in (
            # blade, then guard, then grip — back to front
            ([(-0.026, -0.22), (0.026, -0.22), (0.020, 0.06), (-0.020, 0.06)], GOLD),
            ([(-0.075, 0.06), (0.075, 0.06), (0.075, 0.088), (-0.075, 0.088)], GOLD_DEEP),
            ([(-0.016, 0.088), (0.016, 0.088), (0.016, 0.175), (-0.016, 0.175)], GOLD_DEEP),
        ):
            draw.polygon([place(x, y) for x, y in shape], fill=(*colour, 255))
        # The pommel, which is what stops the grip reading as a stub.
        px, py = place(0, 0.19)
        pr = big * 0.026
        draw.ellipse([px - pr, py - pr, px + pr, py + pr], fill=(*GOLD, 255))

    # A laurel: leaves stepping up both flanks of the disc. Angles are measured
    # from straight down (PIL's y grows downward), then mirrored — computing them
    # as `angle * side` instead put both wreaths on the same flank.
    for side in (-1, 1):
        for i in range(7):
            t = i / 6
            ang = math.radians(90 + side * (18 + 92 * t))
            r = big * (0.37 + 0.02 * math.sin(t * math.pi))
            lx, ly = c + math.cos(ang) * r, c + math.sin(ang) * r
            leaf = big * (0.055 - 0.022 * t)
            draw.ellipse([lx - leaf, ly - leaf * 0.55, lx + leaf, ly + leaf * 0.55],
                         fill=(*GOLD, 235))

    img = img.filter(ImageFilter.GaussianBlur(radius=SS * 0.5))
    return img.resize((size, size), Image.LANCZOS)


def word_font(size):
    """The first narrow grotesque this machine actually has."""
    for path in WORD_FONTS:
        if os.path.exists(path):
            return ImageFont.truetype(path, size), path
    return ImageFont.load_default(), "(default)"


def gradient(width, height, palette=None):
    """A vertical bright-to-deep ramp, the height of one word.

    `palette` lets a verdict word be struck in a different metal — see
    `PALETTES`; the default is the gold the wordmark is struck in.
    """
    pal = palette or {"top": WORD_TOP, "mid": WORD_MID, "bottom": WORD_BOTTOM}
    ramp = Image.new("RGB", (1, height))
    px = ramp.load()
    for y in range(height):
        t = y / max(1, height - 1)
        # Two segments, so the highlight sits in the top third rather than
        # halfway down — a linear ramp reads as a flat gold slab.
        if t < 0.38:
            u = t / 0.38
            a, b = pal["top"], pal["mid"]
        else:
            u = (t - 0.38) / 0.62
            a, b = pal["mid"], pal["bottom"]
        px[0, y] = tuple(int(a[i] + (b[i] - a[i]) * u) for i in range(3))
    return ramp.resize((width, height), Image.NEAREST)


def wordmark(word, size=150, squeeze=0.93, outline=7, palette=None):
    """
    One word of the splash, as a tight-cropped RGBA image.

    Drawn at 4x and squeezed horizontally afterwards. The squeeze is what turns
    a merely narrow face into a *display* one: Big Noodle's silhouette is taller
    than it is wide by a long way, and no font on a stock Linux box goes that
    far on its own.

    `palette` strikes the word in a different metal. The verdict card's VICTORY
    is gold and its DEFEAT is a cold silver — same face, same recipe, so the
    two cards are recognisably the same family of moment.
    """
    pal = palette or {
        "top": WORD_TOP,
        "mid": WORD_MID,
        "bottom": WORD_BOTTOM,
        "outline": WORD_OUTLINE,
    }
    font, _ = word_font(size * SS)
    probe = Image.new("L", (1, 1))
    box = ImageDraw.Draw(probe).textbbox((0, 0), word, font=font)
    pad = outline * SS + 8 * SS
    w = box[2] - box[0] + pad * 2
    h = box[3] - box[1] + pad * 2

    # The glyph shapes as a mask, drawn once and reused for both the fill and
    # the outline — dilating the same mask is what keeps the outline exactly
    # concentric, which a second stroked draw does not guarantee.
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).text((pad - box[0], pad - box[1]), word, font=font, fill=255)

    ring = mask.filter(ImageFilter.MaxFilter(outline * 2 * SS - 1))
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    out.paste(Image.new("RGBA", (w, h), (*pal["outline"], 255)), (0, 0), ring)
    out.paste(gradient(w, h, pal).convert("RGBA"), (0, 0), mask)

    out = out.resize(
        (max(1, int(w * squeeze / SS)), max(1, h // SS)), Image.LANCZOS
    )
    return out.crop(out.getbbox() or (0, 0, out.width, out.height))


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    _, face = word_font(10)
    print(f"wordmark face: {face}")
    words = [(f"potg-word-{w.lower()}.png", wordmark(w)) for w in WORDS]
    # The verdict words share the face; only the metal changes. Same crop, so
    # the victory card and the wordmark are visibly the same family.
    words += [
        (f"potg-word-{w.lower()}.png", wordmark(w, palette=PALETTES[w.lower()]))
        for w in VERDICT_WORDS
    ]
    for name, image in [("potg-burst.png", burst()), ("potg-emblem.png", emblem())] + words:
        path = os.path.abspath(os.path.join(OUT_DIR, name))
        image.save(path)
        print(f"wrote {path} ({image.size[0]}x{image.size[1]})")


if __name__ == "__main__":
    main()
