#!/usr/bin/env python3
"""
Generate public/assets/roll.png — the tumble roll frames for the gun stance.

The roll is the shipped character (the face-on frame of `dude.png`) tucked and
rotated end-over-end, exactly the way the hit textures in
`src/game/render/assets.ts` are derived from the same strip: generated art that
is guaranteed to look like the character because it *is* the character.

Layout: a 16-cell strip of 80x96 cells. Cells 0-7 are the roll moving right
(clockwise on screen — head leads, which is the direction a forward somersault
rotates in the game's side view); cells 8-15 are the mirror for moving left.
Eight cells per direction make one complete 360° loop, matching the roll's
320ms travel at 8 x 25fps.

Each frame applies (angle, scale_x, scale_y) to the face-on frame, then pins
the result to the cell's ground line. The -90/-270 sprawl frames are low and
long — GunZ's tumbled hitbox drawn as a pose — and the diagonals are squashed
into a tuck so the roll reads as a rolling ball, not a rigid figure spinning.

2x art drawn at half size through `sheetScale`, like the strip it is cut
from. Rotations stay NEAREST: a BICUBIC spin smears every edge into grey mush,
which is what the old strip did.

Usage:  python3 scripts/make-dude-art.py && python3 scripts/make-roll-art.py
"""

from PIL import Image, ImageDraw

CELL_W, CELL_H = 80, 96
GROUND_LINE = 90  # cell y where the rolled figure's bottom rests
OUT = "public/assets/roll.png"

# Per-frame recipe: ("rot", angle, scale_x, scale_y) rotates the tucked figure;
# ("ball", slant) draws the low tuck ball — the top of the arc, where a real
# roll is a curled ball on the ground rather than a figure rotating in place.
# Angles are PIL's: positive = CCW, so negative = clockwise. Moving right, the
# head leads clockwise — a forward roll. Eight frames at 45° steps make a
# complete 360° loop, which is why the strip is 8 cells per direction and the
# sim's TUMBLE_DURATION_MS (320) is 8 x 40ms.
FRAMES = [
    ("rot", 0, 0.78, 0.66),  # dip: deep crouch before the roll
    ("rot", -45, 0.6, 0.62),  # tuck: head down, everything compresses
    ("rot", -90, 0.48, 0.82),  # sprawl: flat on the ground line, long and low
    ("ball", -45),  # the ball rolling over the top, head leading down-right
    ("ball", 0),  # the ball at the apex, sitting on the ground line
    ("ball", 45),  # the ball rolling down the far side
    ("rot", -270, 0.48, 0.82),  # sprawl: flat the other way
    ("rot", -315, 0.6, 0.62),  # feet down, landing crouch
]

dude = Image.open("public/assets/dude.png").convert("RGBA")
face = dude.crop((4 * 64, 0, 5 * 64, 96))

strip = Image.new("RGBA", (CELL_W * 16, CELL_H), (0, 0, 0, 0))


def frame_cell(angle, sx, sy):
    cell = Image.new("RGBA", (CELL_W, CELL_H), (0, 0, 0, 0))
    f = face.resize(
        (max(1, round(64 * sx)), max(1, round(96 * sy))), Image.NEAREST
    )
    f = f.rotate(angle, expand=True, resample=Image.NEAREST)
    bbox = f.getbbox()
    if bbox is None:
        return cell
    f = f.crop(bbox)
    cell.alpha_composite(f, (CELL_W // 2 - f.width // 2, GROUND_LINE - f.height))
    return cell


def ball_frame(slant):
    """
    The top of the roll: the character curled into a low ball sitting on the
    ground line. The body is an ellipse in the outfit's own palette; the head
    is the *actual* face pixels from the dude strip, tucked under the body so
    the orange face peeks out at the ground-contact end. `slant` tilts the whole
    ball for the frames climbing into and out of the apex.
    """
    ball = Image.new("RGBA", (CELL_W, CELL_H), (0, 0, 0, 0))
    d = ImageDraw.Draw(ball)
    cx, cy, rx, ry = 40, 76, 24, 16
    d.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], outline=(0, 0, 0, 255), width=2)
    d.ellipse(
        [cx - rx + 2, cy - ry + 2, cx + rx - 2, cy + ry - 2],
        fill=(128, 84, 200, 255),  # hood purple
    )
    # Underside shadow, so the ball reads as resting on the ground.
    d.ellipse(
        [cx - rx + 4, cy + 4, cx + rx - 4, cy + ry - 4],
        fill=(92, 52, 160, 255),  # hood shade
    )
    # Hood-light crown on the front of the ball.
    d.ellipse([cx - 16, cy - 10, cx, cy - 2], fill=(168, 132, 220, 255))
    # Folded tunic over the top of the ball.
    d.ellipse(
        [cx - 16, cy - ry - 4, cx + 16, cy - 6], fill=(150, 100, 55, 255)
    )
    # The real face, tucked under the ground end: orange against the floor.
    head = face.crop((20, 38, 44, 57)).resize((28, 22), Image.NEAREST)
    ball.alpha_composite(head, (cx - 14, cy + ry - 20))

    if slant:
        # Pivot on the ground-contact point under the ball, so a slanted ball
        # stays planted instead of swinging off the ground line.
        ball = ball.rotate(
            slant, expand=False, resample=Image.NEAREST, center=(cx, GROUND_LINE)
        )
    return ball


for i, recipe in enumerate(FRAMES):
    if recipe[0] == "rot":
        _, angle, sx, sy = recipe
        right = frame_cell(angle, sx, sy)
    else:
        right = ball_frame(recipe[1])
    strip.paste(right, (i * CELL_W, 0))
    strip.paste(right.transpose(Image.FLIP_LEFT_RIGHT), ((i + 8) * CELL_W, 0))

strip.save(OUT)
print(f"wrote {OUT}: {strip.size}")
