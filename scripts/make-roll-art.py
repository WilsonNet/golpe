#!/usr/bin/env python3
"""
Generate public/assets/roll.png — the tumble roll frames for the gun stance.

The roll is the shipped character (the face-on frame of `dude.png`) tucked and
rotated end-over-end, exactly the way the hit textures in
`src/game/render/assets.ts` are derived from the same strip: generated art that
is guaranteed to look like the character because it *is* the character.

Layout: a 16-cell strip of 40x48 cells. Cells 0-7 are the roll moving right
(clockwise on screen — head leads, which is the direction a forward somersault
rotates in the game's side view); cells 8-15 are the mirror for moving left.
Eight cells per direction make one complete 360° loop, matching the roll's
320ms travel at 8 x 25fps.

Each frame applies (angle, scale_x, scale_y) to the face-on frame, then pins
the result to the cell's ground line. The -90/-270 sprawl frames are low and
long — GunZ's tumbled hitbox drawn as a pose — and the diagonals are squashed
into a tuck so the roll reads as a rolling ball, not a rigid figure spinning.

Usage:  python3 scripts/make-roll-art.py
"""

from PIL import Image, ImageDraw

CELL_W, CELL_H = 40, 48
GROUND_LINE = 45  # cell y where the rolled figure's bottom rests
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
face = dude.crop((4 * 32, 0, 5 * 32, 48))

strip = Image.new("RGBA", (CELL_W * 16, CELL_H), (0, 0, 0, 0))


def frame_cell(angle, sx, sy):
    cell = Image.new("RGBA", (CELL_W, CELL_H), (0, 0, 0, 0))
    f = face.resize(
        (max(1, round(32 * sx)), max(1, round(48 * sy))), Image.BICUBIC
    )
    f = f.rotate(angle, expand=True, resample=Image.BICUBIC)
    bbox = f.getbbox()
    if bbox is None:
        return cell
    f = f.crop(bbox)
    cell.paste(f, (CELL_W // 2 - f.width // 2, GROUND_LINE - f.height), f)
    return cell


def ball_frame(slant):
    """
    The top of the roll: the character curled into a low ball sitting on the
    ground line. The body is an ellipse in the outfit's own palette; the head
    is the *actual* head pixels from the dude strip, tucked under the body so
    the gold hair peeks out at the ground-contact end. `slant` tilts the whole
    ball for the frames climbing into and out of the apex.
    """
    ball = Image.new("RGBA", (CELL_W, CELL_H), (0, 0, 0, 0))
    d = ImageDraw.Draw(ball)
    cx, cy, rx, ry = 20, 38, 12, 8
    d.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], outline=(0, 0, 0, 255), width=1)
    d.ellipse(
        [cx - rx + 1, cy - ry + 1, cx + rx - 1, cy + ry - 1],
        fill=(112, 48, 192, 255),  # outfit #7030c0
    )
    # Underside shadow, so the ball reads as resting on the ground.
    d.ellipse(
        [cx - rx + 2, cy + 2, cx + rx - 2, cy + ry - 2],
        fill=(96, 0, 176, 255),  # #6000b0
    )
    # Shoulder highlight on the front of the ball.
    d.ellipse([cx - 8, cy - 5, cx, cy - 1], fill=(160, 96, 192, 255))  # #a060c0
    # Folded knees over the top of the ball.
    d.ellipse(
        [cx - 8, cy - ry - 2, cx + 8, cy - 3], fill=(64, 16, 32, 255)  # #401020
    )
    # The real head, tucked under the ground end: gold hair against the floor.
    head = face.crop((6, 8, 27, 25)).resize((14, 11), Image.BICUBIC)
    ball.paste(head, (cx - 7, cy + ry - 10), head)

    if slant:
        # Pivot on the ground-contact point under the ball, so a slanted ball
        # stays planted instead of swinging off the ground line.
        ball = ball.rotate(
            slant, expand=False, resample=Image.BICUBIC, center=(cx, GROUND_LINE)
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
