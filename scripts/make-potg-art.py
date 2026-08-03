#!/usr/bin/env python3
"""
Generate the Play of the Game splash art.

Two files, and they exist for the same reason `make-roll-art.py` exists: the
game ships generated art rather than hand-drawn art, so a piece of the interface
can be *derived* from the palette it has to sit in instead of being a PNG
somebody colour-picked once and nobody dares re-tint.

  public/assets/potg-burst.png    a sunburst of gold rays, on transparency
  public/assets/potg-emblem.png   a laurel-and-blade medal, the ceremony's mark

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

from PIL import Image, ImageDraw, ImageFilter

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "assets")

# The HUD's gold, straight out of `fightHudStyles.ts`. Everything here is a
# tint of it so the splash cannot drift from the frames it appears over.
GOLD = (255, 209, 102)
GOLD_DEEP = (214, 156, 46)
INK = (24, 20, 12)

SS = 4  # supersample factor


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


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for name, image in (("potg-burst.png", burst()), ("potg-emblem.png", emblem())):
        path = os.path.abspath(os.path.join(OUT_DIR, name))
        image.save(path)
        print(f"wrote {path} ({image.size[0]}x{image.size[1]})")


if __name__ == "__main__":
    main()
