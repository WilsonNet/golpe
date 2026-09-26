"""Jeffs' smoke grenade: a 3D canister, rendered as a tumbling strip.

    python3 scripts/make-smoke-grenade-art.py      # renders and stitches the strip

The canister is thrown, and a thrown thing tumbles. Drawn flat and spun with
`sprite.rotation` it is a sticker turning in the picture plane; rendered from
a model it flips *through* depth — the cap swings toward you, the spoon and
the pull ring come round the side — which is what reads as a real object in
the air. This is the one prop that earns a model (see the ai-art-pipeline
skill: "will it ever be drawn from a second angle?" — every frame of its
flight is one).

It is an M18-style smoke canister, in the look of Jeffs' board
(`unprocessed-sprites/jeffs-actions.jpeg`, the "Smoke Grenade" row: an olive
can with a dark fuze): an olive steel body, a pale stencil band, the dark
fuze on top with the spoon down its side and the pull ring. Shaded with the
shared LiaToon shader and the ink hull, so it sits with the fighters.

Output: `public/assets/smoke-grenade.png`, `FRAMES` cells of `CELL`x`CELL`
px in one row — one full end-over-end flip, thrown to the right (the top
goes forward, clockwise on screen). The game plays it by flight time and
mirrors it for a throw to the left (`ItemFx.syncSmokeGrenades`). The script
is the source (it is small); `--save` also writes `art/props/smoke-grenade.blend`
to open in Blender.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import sprite_rig  # noqa: E402
from sprite_rig import Part  # noqa: E402

ROOT = sprite_rig.ROOT
BLEND = os.path.join(ROOT, "art", "props", "smoke-grenade.blend")

FRAMES = 16  # one full flip
CELL = 32  # px
PX_PER_M = sprite_rig.PX_PER_M  # the fighters' density: 1 m = 32 px
# The flip's axis leans toward the camera, so the tumble is not a turn in the
# picture plane: the cap and the base swing through depth as it goes over.
AXIS_LEAN_DEG = 28.0
# And the can rolls about its own length once per flip, bringing the spoon
# and the ring round from the far side.
ROLLS_PER_FLIP = 1

sprite_rig.PALETTE.update(
    {
        # (lit, shade, highlight) — shades hue-shifted toward violet, like Jeffs'.
        "can_olive": ((0.44, 0.5, 0.24), (0.24, 0.27, 0.16), (0.62, 0.68, 0.36)),
        "can_band": ((0.9, 0.88, 0.8), (0.6, 0.58, 0.6), (1.0, 1.0, 0.96)),
        "fuze": ((0.3, 0.31, 0.36), (0.14, 0.14, 0.2), (0.56, 0.58, 0.66)),
        "spoon": ((0.72, 0.74, 0.78), (0.4, 0.42, 0.52), (0.95, 0.96, 1.0)),
        "ring": ((0.9, 0.72, 0.36), (0.6, 0.42, 0.2), (1.0, 0.92, 0.62)),
    }
)
sprite_rig.SHINY.update({"fuze", "spoon", "ring"})

# The can, in metres at sprite density: 0.56 m long reads as ~18 px — the
# size the flat texture it replaces was, a fifth of a fighter's height.
R = 0.16
H = 0.44


def build_canister(col):
    can = Part("SmokeGrenade")
    z0, z1 = -H / 2, H / 2
    # The body: a straight can with a rolled lip at each end.
    can.tube([(0, 0, z0), (0, 0, z1)], [R, R], "can_olive", sides=20, up=(1, 0, 0))
    can.tube([(0, 0, z0 - 0.015), (0, 0, z0 + 0.03)], [R + 0.012, R + 0.012], "can_olive", sides=20, up=(1, 0, 0))
    can.tube([(0, 0, z1 - 0.03), (0, 0, z1 + 0.015)], [R + 0.012, R + 0.012], "can_olive", sides=20, up=(1, 0, 0))
    # The stencil band — pale, so the can reads as smoke, not frag.
    can.tube([(0, 0, 0.04), (0, 0, 0.12)], [R + 0.004, R + 0.004], "can_band", sides=20, up=(1, 0, 0))
    # The fuze: a dark stepped cap on top.
    can.tube([(0, 0, z1), (0, 0, z1 + 0.05)], [0.09, 0.08], "fuze", sides=14, up=(1, 0, 0))
    can.tube([(0, 0, z1 + 0.05), (0, 0, z1 + 0.1)], [0.055, 0.05], "fuze", sides=12, up=(1, 0, 0))
    # The spoon: a steel strip from the fuze, over the shoulder and down the side.
    spoon = [(0.03, 0, z1 + 0.08), (0.12, 0, z1 + 0.06), (R + 0.03, 0, z1 - 0.02), (R + 0.03, 0, z1 - 0.2)]
    can.tube(spoon, [(0.012, 0.045)] * len(spoon), "spoon", sides=4, up=(0, 1, 0))
    # The pull ring, hanging off the fuze on the far side from the spoon.
    ring = []
    for k in range(17):
        a = 2 * math.pi * k / 16
        ring.append((-0.1 + math.cos(a) * 0.07, 0.0, z1 + 0.06 + math.sin(a) * 0.07))
    can.tube(ring, [0.014] * 17, "ring", sides=6, cap_start=False, cap_end=False)
    ob = can.build(col)
    ob.modifiers["Outline"].thickness = sprite_rig.OUTLINE_M * 0.8
    return ob


def setup_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sprite_rig.build_scene()
    scene = bpy.context.scene
    scene.name = "SmokeGrenade"
    cam = scene.camera
    cam.location = Vector((0, -20, 0))
    cam.data.ortho_scale = CELL / PX_PER_M
    scene.render.resolution_x = CELL
    scene.render.resolution_y = CELL
    col = bpy.data.collections.new("Prop")
    scene.collection.children.link(col)
    return scene, col


def tumble(i):
    """Frame i's orientation: the flip about a camera-leaning axis, times
    the can's roll about its own length."""
    t = i / FRAMES
    lean = math.radians(AXIS_LEAN_DEG)
    # The camera looks along +Y; clockwise on screen is +angle about +Y.
    axis = Vector((0, math.cos(lean), math.sin(lean))).normalized()
    flip = Matrix.Rotation(2 * math.pi * t, 4, axis)
    roll = Matrix.Rotation(2 * math.pi * t * ROLLS_PER_FLIP, 4, "Z")
    # Start with the can upright, facing a little to the viewer's left.
    base = Matrix.Rotation(math.radians(-30), 4, "Z")
    return flip @ base @ roll


def render_raw(scene, ob, out_dir):
    """Blender's bundled python has no PIL: render the cells to a folder and
    let the host python stitch them (`make-smoke-grenade-art.py`)."""
    os.makedirs(out_dir, exist_ok=True)
    for i in range(FRAMES):
        ob.matrix_world = tumble(i)
        scene.render.filepath = os.path.join(out_dir, f"{i:02d}.png")
        bpy.ops.render.render(write_still=True)


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    scene, col = setup_scene()
    ob = build_canister(col)
    if "--save" in argv:
        os.makedirs(os.path.dirname(BLEND), exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=BLEND)
    render_raw(scene, ob, argv[argv.index("--out") + 1])


if __name__ == "__main__":
    main()
