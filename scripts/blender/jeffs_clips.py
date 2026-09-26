"""Jeffs' weapons, render scene and clips — on his rigged Tripo mesh.

Run in the live Blender with `art/jeffs/jeffs.blend` open (after
`jeffs_rig.rig()` and `jeffs_look.apply()`):

    import sys; sys.path.insert(0, "<repo>/scripts/blender")
    import importlib, jeffs_clips; importlib.reload(jeffs_clips); jeffs_clips.build()

Then `python3 scripts/make-hero-art.py jeffs` renders and packs his atlas.

He carries **the sword** (specs/jeffs.md), so every one of the shared clips
is his — the slash chain, the uppercut, the block, the Massive, the plunge —
carried into his reach (`rebase`: his shoulder is at z 2.02 with
0.7 m of arm, Lia's at 1.5 with 0.58). What is his:

- **The katana** his board draws (`unprocessed-sprites/jeffs-actions.jpeg`,
  "Katana Slashes"): a long two-hand grip, a round tsuba, a slim curved
  blade. `Sword` rides the `weapon` bone; `SwordBack` is the katana
  sheathed across his back for the gun stance and the tumble. The sword's
  reach and frame data are the sword's — only the look changed.
- **The pump shotgun**, `Shotgun`, for the gun clips.
- **The throw**: the smoke canister tossed out of his hand (the board's
  "Smoke Grenade" row), played by the game when his canister appears.

The primitive model this file was bootstrapped with (`jeffs_build.py`) is
kept in the `Jeffs.primitive` collection, hidden and never rendered.
"""

import math
import os
import sys

import bpy
from mathutils import Euler, Matrix, Vector

sys.path.insert(0, os.path.dirname(__file__))

import anands_clips  # noqa: E402
import sprite_rig  # noqa: E402
from sprite_rig import Part, parent_to_bone  # noqa: E402

HERO_COLLECTION = "Tripo"
# 3 m plus the ink line stands 102 px against the contract's 100; Anands'
# rig carries the same 0.97.
RIG_SCALE = 0.97
# The shotgun's size over the gun as first modelled (a rifle-sized pump).
SHOTGUN_SCALE = 1.45
NON_RENDER = ("Jeffs.primitive",)

sprite_rig.PALETTE.update(
    {
        "steel": ((0.80, 0.86, 0.94), (0.46, 0.52, 0.68), (1.00, 1.00, 1.00)),
        "gold": ((1.00, 0.82, 0.32), (0.78, 0.50, 0.16), (1.00, 0.96, 0.70)),
        "gunmetal": ((0.36, 0.38, 0.46), (0.18, 0.18, 0.26), (0.58, 0.62, 0.72)),
        "wood": ((0.62, 0.36, 0.22), (0.38, 0.20, 0.16), (0.78, 0.52, 0.32)),
        # The katana's black wrap with its oxblood diamonds, and the lacquered
        # saya — dark, like everything he wears.
        "tsuka": ((0.20, 0.17, 0.22), (0.10, 0.08, 0.13), (0.36, 0.32, 0.38)),
        "tsuka_diamond": ((0.62, 0.16, 0.18), (0.38, 0.08, 0.14), (0.80, 0.30, 0.30)),
        "tsuba": ((0.34, 0.32, 0.36), (0.18, 0.16, 0.22), (0.62, 0.58, 0.60)),
        "saya": ((0.16, 0.14, 0.18), (0.08, 0.06, 0.11), (0.42, 0.40, 0.48)),
    }
)
sprite_rig.SHINY.update({"steel", "gold", "tsuba", "saya"})

G = Vector((0, 0, 1.0))  # the weapon bone's head: the grip
BLADE_END = 1.62  # the old straight sword's reach, kept: the hitbox is the sword's
CURVE = 0.07  # the blade's rise at the point (sori)


def _katana_hilt(k):
    # The two-hand grip behind the fist, the pommel cap, the round guard.
    k.tube([G + Vector((-0.32, 0, 0)), G + Vector((0.03, 0, 0))], [(0.036, 0.046), (0.038, 0.048)], "tsuka",
           sides=8, up=(0, 0, 1))
    for x in (-0.26, -0.18, -0.1):
        k.box(G + Vector((x, 0, 0)), (0.035, 0.1, 0.035), "tsuka_diamond", rot=(45, 0, 0))
    k.ellipsoid(G + Vector((-0.33, 0, 0)), (0.025, 0.045, 0.052), "tsuba")
    k.tube([G + Vector((0.035, 0, 0)), G + Vector((0.06, 0, 0))], [(0.11, 0.12), (0.11, 0.12)], "tsuba", sides=16,
           up=(0, 0, 1))


def _katana_blade_points(n=7):
    pts, radii = [], []
    for i in range(n):
        t = i / (n - 1)
        x = 0.07 + (BLADE_END - 0.07) * t
        pts.append(G + Vector((x, 0, CURVE * t * t)))
        # Thin spine, tall edge, tapering into the kissaki.
        h = 0.052 * (1 - 0.25 * t) if t < 0.92 else 0.03 * (1 - t) / 0.08 + 0.004
        radii.append((0.012 * (1 - 0.5 * t) + 0.003, h))
    return pts, radii


def build_weapons(arm, col):
    for n in ("Sword", "SwordBack", "Shotgun"):
        ob = bpy.data.objects.get(n)
        if ob:
            bpy.data.objects.remove(ob, do_unlink=True)

    k = Part("Sword")
    _katana_hilt(k)
    k.tube([G + Vector((0.06, 0, 0)), G + Vector((0.11, 0, 0))], [(0.022, 0.06), (0.02, 0.058)], "gold", sides=6,
           up=(0, 0, 1))  # the habaki
    pts, radii = _katana_blade_points()
    k.tube(pts, radii, "steel", sides=4, up=(0, 0, 1))
    sword = k.build(col, smooth=False)

    # The pump shotgun, big: his arms are the thickest in the game and a
    # rifle-sized gun in those fists read as a toy (the user's call). A
    # heavy receiver, a fat barrel over its magazine tube, a chunky wooden
    # pump and stock, a brass bead — then the whole gun scaled up about the
    # grip, so the fist stays on it.
    gun = Part("Shotgun")
    gun.box(G + Vector((0.12, 0, 0.07)), (0.38, 0.13, 0.2), "gunmetal", bevel=0.02)
    gun.tube([G + Vector((0.3, 0, 0.13)), G + Vector((1.0, 0, 0.13))], [0.058, 0.056], "gunmetal", sides=10)
    gun.tube([G + Vector((0.96, 0, 0.13)), G + Vector((1.0, 0, 0.13))], [0.066, 0.066], "gunmetal", sides=10)
    gun.tube([G + Vector((0.3, 0, 0.03)), G + Vector((0.9, 0, 0.03))], [0.042, 0.042], "gunmetal", sides=8)
    gun.box(G + Vector((0.56, 0, 0.03)), (0.3, 0.14, 0.12), "wood", bevel=0.025)
    gun.box(G + Vector((-0.28, 0, -0.04)), (0.46, 0.12, 0.2), "wood", rot=(0, 10, 0), bevel=0.025)
    gun.box(G + Vector((0.02, 0, -0.08)), (0.08, 0.09, 0.18), "wood", rot=(0, -15, 0))
    gun.box(G + Vector((0.98, 0, 0.2)), (0.03, 0.02, 0.04), "gold")
    shotgun = gun.build(col)
    shotgun.data.transform(Matrix.Translation(G) @ Matrix.Scale(SHOTGUN_SCALE, 4) @ Matrix.Translation(-G))
    parent_to_bone(sword, arm, "weapon")
    parent_to_bone(shotgun, arm, "weapon")

    # The katana sheathed across his back, hilt over the right shoulder: the
    # same hilt, the blade inside a lacquered saya.
    sb = Part("SwordBack")
    _katana_hilt(sb)
    pts, _r = _katana_blade_points()
    sb.tube(pts, [(0.03, 0.075)] * (len(pts) - 1) + [(0.025, 0.05)], "saya", sides=6, up=(0, 0, 1))
    back = sb.build(col, smooth=False)
    chest = arm.data.bones["chest"]
    back.parent = arm
    back.parent_type = "BONE"
    back.parent_bone = "chest"
    tail = chest.matrix_local @ Matrix.Translation((0, chest.length, 0))
    back.matrix_parent_inverse = tail.inverted()
    # Hilt up behind the right shoulder, the saya slanting down across the
    # coat to the left hip.
    rot = Euler((math.radians(-28), math.radians(112), 0.0)).to_matrix().to_4x4()
    back.matrix_basis = Matrix.Translation((-0.3, -0.18, 2.28)) @ rot @ Matrix.Translation(-G)
    return sword, shotgun, back


# ------------------------------------------------------------------ his reach
# His arm is 1.07 m to Lia's 0.58: carried by the full ratio (x1.84) a
# shared pose's grip flew off to where his fist covered his face in the
# portrait and the swings reached past the sword's hitbox. The shared poses
# keep the elbow bent; this much of his reach is what they use.
REACH_MAX = 1.3
LIA_SHOULDER = (0.0, -0.33, 1.5)
LIA_ARM = 0.58


def rebase(poses, arm, from_shoulder, from_arm):
    """Carry grips posed in another hero's reach into his."""
    b = arm.data.bones
    sh = b["upperarm.R"].head_local.copy()
    k = min(REACH_MAX, (b["upperarm.R"].length + b["forearm.R"].length) / from_arm)
    out = []
    for p in poses:
        p = dict(p)
        pos, theta, depth, roll = p["weapon"]
        p["weapon"] = (tuple(sh + (Vector(pos) - Vector(from_shoulder)) * k), theta, depth, roll)
        out.append(p)
    return out


def throw_clip():
    """The smoke canister tossed out underhand — Anands' item throw, which
    the board's "Smoke Grenade" row also draws (arm back, then the release),
    carried into his reach."""
    return anands_clips.throw_clip()


def _shared(name):
    fn = next(c[1] for c in sprite_rig.CLIPS if c[0] == name)
    return rebase(fn(), bpy.data.objects[sprite_rig.RIG_NAME], LIA_SHOULDER, LIA_ARM)


def block_clip():
    """Lia's guard with the grip at his chest: his shoulder sits 0.5 m higher
    than hers, and her upright blade carried there stood 13 px over his head
    (the scale contract measured it) — a raised sword, not a block."""
    p = _shared("block")[0]
    p["weapon"] = ((0.5, -0.3, 1.55), -1.2, 10, 0)
    return [p]


def portrait_pose():
    """The hero shot with the katana held at his chest, off to the side —
    Lia's grip, carried to his shoulder height, put his fist over his face."""
    p = _shared("portrait")[0]
    p["weapon"] = ((0.42, -0.62, 1.7), -1.1, 14, 0)
    return [p]


OVERRIDES = {"block": block_clip, "portrait": portrait_pose}

ANANDS_SHOULDER = (0.0, -0.42, 1.88)
ANANDS_ARM = 0.72

# name, poses, right, left, fps, loop, drive, props
HIS_CLIPS = [
    ("throw", throw_clip, "throw", "throw-left", 10, False, "", "none"),
]


def setup_scene():
    """The shared sprite camera (already in the file), with the primitive
    model and the preview cameras kept out of every render."""
    scene = bpy.context.scene
    scene.camera = bpy.data.objects["SpriteCam"]
    for c in NON_RENDER:
        bpy.data.collections[c].hide_render = True
    for n in ("CompareCam", "PoseCam"):
        ob = bpy.data.objects.get(n)
        if ob:
            ob.hide_render = True


def build():
    setup_scene()
    arm = bpy.data.objects[sprite_rig.RIG_NAME]
    col = bpy.data.collections[HERO_COLLECTION]
    build_weapons(arm, col)
    for act in [a for a in bpy.data.actions if a.name.startswith("clip.")]:
        bpy.data.actions.remove(act)
    arm.animation_data_create()
    arm.scale = (RIG_SCALE,) * 3
    clips = [
        (c[0], OVERRIDES.get(c[0]) or (lambda fn=c[1]: rebase(fn(), arm, LIA_SHOULDER, LIA_ARM)), *c[2:])
        for c in sprite_rig.CLIPS
    ]
    clips += [
        (c[0], (lambda fn=c[1]: rebase(fn(), arm, ANANDS_SHOULDER, ANANDS_ARM)), *c[2:]) for c in HIS_CLIPS
    ]
    for name, fn, right, left, fps, loop, drive, props in clips:
        sprite_rig.make_clip(
            arm, name, fn(), right, left, fps=fps, loop=loop, drive=drive, props=props,
            ground=name not in sprite_rig.AIRBORNE,
        )
    idle = bpy.data.actions["clip.idle"]
    arm.animation_data.action = idle
    arm.animation_data.action_slot = idle.slots[0]
    return [c[0] for c in clips]
