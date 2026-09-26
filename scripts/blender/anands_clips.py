"""Anands' weapons, render scene and clips — on her rigged Tripo mesh.

Run in the live Blender with `art/anands/anands.blend` open (after
`anands_rig.rig()`):

    import sys; sys.path.insert(0, "<repo>/scripts/blender")
    import importlib, anands_clips; importlib.reload(anands_clips); anands_clips.build()

Then `python3 scripts/make-hero-art.py anands` renders and packs her atlas
exactly as it does Lia's and Jeffs'.

What is hers and not the shared rig's:

- **Lia's shading, her colours.** `anands_look.apply()` turns the Tripo
  texture into per-face colour families on the shared LiaToon shader, with the
  ink hull (see that module); the weapons use the same shader.
- **The dagger**, not a sword: `Dagger` rides the `weapon` bone (grip at the
  bone's origin, point along +X), and `DaggerL`, the off-hand dagger her
  boards draw reverse-grip in her left fist, both shown for
  `lia_props = "sword"` clips. The machine gun is `Gun`, for `"rifle"` clips.
- **Her moves**: the stab, the shoryuken and the thrust (its reversed-grip
  anticipation and the dash), posed from her boards. Lia's sword-only clips
  (the chain, the uppercut, the block, the Massive, the plunge) are not hers
  and are not made.
"""

import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(__file__))

import sprite_rig  # noqa: E402
from sprite_rig import Part, add_outline, parent_to_bone, pose  # noqa: E402

MESH = "Anands.tripo"
HERO_COLLECTION = "Tripo"
# Everything else in the file is reference, and never renders.
NON_RENDER = ("Reference", "Anands", "Anands.parts")

sprite_rig.PALETTE.update(
    {
        "steel": ((0.82, 0.88, 0.94), (0.46, 0.54, 0.7), (1.0, 1.0, 1.0)),
        "dagger_grip": ((0.5, 0.3, 0.16), (0.3, 0.16, 0.12), (0.64, 0.42, 0.24)),
        "brass": ((0.9, 0.66, 0.3), (0.62, 0.38, 0.16), (1.0, 0.9, 0.6)),
        "gunmetal": ((0.34, 0.36, 0.42), (0.18, 0.18, 0.26), (0.56, 0.6, 0.7)),
        "gun_wood": ((0.56, 0.32, 0.18), (0.34, 0.18, 0.14), (0.72, 0.46, 0.28)),
    }
)
sprite_rig.SHINY.update({"steel", "brass"})


# ------------------------------------------------------------------ scene
def setup_scene():
    """The shared sprite camera and render settings, made once."""
    scene = bpy.context.scene
    if not bpy.data.objects.get("SpriteCam"):
        name = scene.name
        sprite_rig.build_scene()
        scene.name = name
    scene.camera = bpy.data.objects["SpriteCam"]
    for c in NON_RENDER:
        col = bpy.data.collections.get(c)
        if col:
            col.hide_render = True
    for n in ("CompareCam", "PoseCam"):
        ob = bpy.data.objects.get(n)
        if ob:
            ob.hide_render = True


# ------------------------------------------------------------------ weapons
G = Vector((0, 0, 1.0))  # the weapon bone's head: the grip


def _dagger_part(name):
    # A leaf blade as long as her forearm, a brass guard, a wrapped grip —
    # the board's dagger, pointing along +X from the fist.
    dg = Part(name)
    dg.tube([G + Vector((-0.12, 0, 0)), G + Vector((0.06, 0, 0))], [0.04, 0.04], "dagger_grip", sides=8)
    dg.ellipsoid(G + Vector((-0.14, 0, 0)), (0.045, 0.045, 0.045), "brass")
    dg.box(G + Vector((0.08, 0, 0)), (0.05, 0.08, 0.2), "brass", bevel=0.01)
    blade = [G + Vector((x, 0, 0)) for x in (0.1, 0.3, 0.46, 0.56)]
    dg.tube(blade, [(0.018, 0.07), (0.018, 0.075), (0.012, 0.045), (0.003, 0.005)], "steel", sides=4, up=(0, 0, 1))
    return dg


def build_weapons(arm, col):
    for n in ("Dagger", "DaggerL", "Gun"):
        ob = bpy.data.objects.get(n)
        if ob:
            bpy.data.objects.remove(ob, do_unlink=True)
    dagger = _dagger_part("Dagger").build(col, smooth=False)

    # The off-hand dagger: her boards draw a second one, reverse grip in the
    # left fist, blade down along the forearm. It rides forearm.L.
    off = _dagger_part("DaggerL").build(col, smooth=False)
    bone = arm.data.bones["forearm.L"]
    tip = bone.tail_local
    d = (bone.tail_local - bone.head_local).normalized()
    rot = d.to_track_quat("X", "Z").to_matrix().to_4x4()
    off.parent = arm
    off.parent_type = "BONE"
    off.parent_bone = "forearm.L"
    tail = bone.matrix_local @ Matrix.Translation((0, bone.length, 0))
    off.matrix_parent_inverse = tail.inverted()
    off.matrix_basis = Matrix.Translation(tip) @ rot @ Matrix.Translation(-G)

    # The machine gun: a compact SMG — receiver, barrel with a shroud, a
    # stick magazine, a wooden stock and fore-grip.
    gn = Part("Gun")
    gn.box(G + Vector((0.14, 0, 0.07)), (0.4, 0.1, 0.16), "gunmetal", bevel=0.015)
    gn.tube([G + Vector((0.34, 0, 0.1)), G + Vector((0.82, 0, 0.1))], [0.04, 0.038], "gunmetal", sides=8)
    gn.tube([G + Vector((0.34, 0, 0.1)), G + Vector((0.6, 0, 0.1))], [0.06, 0.06], "gunmetal", sides=8)
    gn.box(G + Vector((0.2, 0, -0.1)), (0.07, 0.07, 0.24), "gunmetal", rot=(0, 12, 0))
    gn.box(G + Vector((-0.24, 0, 0.0)), (0.34, 0.08, 0.14), "gun_wood", rot=(0, 8, 0), bevel=0.02)
    gn.box(G + Vector((0.0, 0, -0.08)), (0.07, 0.07, 0.14), "gun_wood", rot=(0, -15, 0))
    gn.box(G + Vector((0.48, 0, 0.0)), (0.12, 0.08, 0.08), "gun_wood", bevel=0.01)
    gun = gn.build(col)
    parent_to_bone(dagger, arm, "weapon")
    parent_to_bone(gun, arm, "weapon")
    return dagger, gun


# ------------------------------------------------------------------ her reach
# The shared poses place the weapon grip in *Lia's* reach: her shoulder at
# z 1.5, 0.58 m of arm. Anands' chibi shoulder sits at z 1.88 with 0.72 m of
# arm, so a shared grip is out of her reach and the steel would float off her
# fist. Every shared pose's grip is carried into her reach: the same offset
# from the shoulder, scaled by the arm-length ratio.
LIA_SHOULDER = Vector((0.0, -0.33, 1.5))
LIA_ARM = 0.58


def _her_shoulder_and_arm(arm):
    b = arm.data.bones
    sh = b["upperarm.R"].head_local.copy()
    length = b["upperarm.R"].length + b["forearm.R"].length
    return sh, length


def adapt(poses, arm):
    sh, length = _her_shoulder_and_arm(arm)
    k = length / LIA_ARM
    out = []
    for p in poses:
        p = dict(p)
        pos, theta, depth, roll = p["weapon"]
        rel = Vector(pos) - LIA_SHOULDER
        p["weapon"] = (tuple(sh + rel * k), theta, depth, roll)
        out.append(p)
    return out


# ------------------------------------------------------------------ her moves
# Posed from her boards' key frames (unprocessed-sprites/anands-misc.jpeg), in
# her own reach: right shoulder at (0, -0.42, 1.88), 0.72 m of arm. The
# weapon bone is not parented to the root, so a pose that moves the root must
# move the grip with it. Timings mirror src/tweakables/melee.ts (stab
# 45/55/90, shoryuken 90/140/320, thrust 260/140/480); the game plays these
# clips on the clock at the fps below.


def stab_clip():
    """'Dagger Combat (Basic)': the near arm snaps out straight at shoulder
    height, blade level, over a deep lunge — front knee bent, back leg long."""
    stance = dict(thighR=(26, 6), kneeR=34, footR=-10, thighL=(-24, 6), kneeL=12, footL=12, cape=6)
    lunge_legs = dict(thighR=(46, 6), kneeR=58, footR=-18, thighL=(-40, 6), kneeL=6, footL=20, cape=16)
    wind = pose(root=(0, 0, -0.08), chest=(-6, 18, 0), hips=(0, 8, 0), armL=(-20, 20), elbowL=40,
                weapon=((0.18, -0.5, 1.56), 0.25, -6, 0), **stance)
    lunge = pose(root=(0.14, 0, -0.16), chest=(10, -18, 0), hips=(4, -10, 0), head=(-6, 0, 0), armL=(-40, 25), elbowL=30,
                 weapon=((0.84, -0.4, 1.7), 0.0, -4, 0), **lunge_legs)
    hold = dict(lunge)
    hold["weapon"] = ((0.8, -0.4, 1.68), 0.03, -4, 0)
    back = pose(root=(0.06, 0, -0.1), chest=(4, -6, 0), armL=(-10, 18), elbowL=30,
                weapon=((0.46, -0.46, 1.58), 0.2, -4, 0), **stance)
    return [wind, lunge, hold, back]


def shoryuken_clip():
    """'Abilities: Shoryuken': the fist cocked above the head, blade angled up
    and forward, then the arm straight up as she rises."""
    crouch = pose(root=(0, 0, -0.24), chest=(20, 10, 0), head=(-6, 0, 0), thighR=(54, 6), kneeR=92, footR=-10,
                  thighL=(-8, 6), kneeL=70, footL=20, armL=(20, 20), elbowL=40, cape=12,
                  weapon=((0.36, -0.44, 1.42), -0.8, 6, 0))
    rise = pose(root=(0.04, 0, 0.12), chest=(-14, -8, 0), head=(-16, 0, 0), thighR=(30, 6), kneeR=24,
                thighL=(-18, 6), kneeL=50, footL=30, armL=(-20, 30), elbowL=30, cape=-10,
                weapon=((0.34, -0.44, 2.54), -1.15, 6, 0))
    peak = pose(root=(0.02, 0, 0.24), chest=(-20, -10, 0), head=(-20, 0, 0), thighR=(24, 6), kneeR=20,
                thighL=(-10, 6), kneeL=60, footL=30, armL=(-30, 40), elbowL=30, cape=-16,
                weapon=((0.12, -0.44, 2.8), -1.55, 8, 0))
    return [crouch, rise, peak]


def thrust_windup_clip():
    """'Thrust: Anticipated Hold' (first frame): arm out in front, the dagger
    turned over in a reverse grip, blade pointing down — the tell."""
    out = []
    for b in (0.0, 1.0):
        out.append(
            pose(root=(0, 0, -0.1 - 0.02 * b), chest=(6, 10, 0), hips=(0, 6, 0), head=(-6, 0, 0),
                 thighR=(30, 6), kneeR=40, footR=-10, thighL=(-26, 6), kneeL=14, footL=12,
                 armL=(-16, 18), elbowL=40, cape=6 + 4 * b,
                 weapon=((0.62, -0.44, 1.62 - 0.02 * b), math.pi / 2, 6, 0))
        )
    return out


def thrust_dash_clip():
    """'Thrust: Anticipated Hold' (second frame): the lunge — front fist
    driving forward, the dagger reversed behind her, pointing back."""
    out = []
    for b in (0.0, 1.0):
        out.append(
            pose(root=(0.16, 0, -0.2), root_pitch=14, root_pivot=(0, 0, 1.0), chest=(8, -14, 0), head=(-14, 0, 0),
                 thighR=(46, 6), kneeR=50, footR=-16, thighL=(-46, 6), kneeL=10 + 10 * b, footL=24,
                 armL=(84, 12), elbowL=6, cape=26,
                 weapon=((-0.3, -0.5, 1.52), math.pi - 0.05, -6, 0))
        )
    return out


def throw_clip():
    """Her item use: the trap tossed out underhand in front of her ('Item Use'
    on her boards; specs/items.md). The client only learns of a throw when the
    trap appears, so this is the release and the follow-through, not a wind-up."""
    step = dict(thighR=(34, 6), kneeR=40, footR=-12, thighL=(-24, 6), kneeL=14, footL=14)
    release = pose(root=(0.04, 0, -0.1), chest=(12, -10, 0), head=(-4, 0, 0), armL=(-30, 20), elbowL=40, cape=10, ikR=1.0,
                   weapon=((0.62, -0.46, 1.62), -0.4, 0, 0), **step)
    follow = pose(root=(0.06, 0, -0.06), chest=(4, -14, 0), head=(-8, 0, 0), armL=(-36, 24), elbowL=40, cape=6, ikR=1.0,
                  weapon=((0.56, -0.46, 2.1), -1.0, 0, 0), **step)
    recover = pose(root=(0.02, 0, -0.06), chest=(4, -4, 0), armL=(-10, 18), elbowL=30, cape=4, ikR=1.0,
                   weapon=((0.4, -0.48, 1.62), 0.3, 0, 0), **step)
    return [release, follow, recover]


def portrait_pose():
    """The hero shot: face-on, dagger held up by the chest."""
    p = pose(root_yaw=-45.0, chest=(-4, 10, 0), head=(-4, 18, 0), thighR=(10, 10), kneeR=6,
             thighL=(-6, 10), kneeL=6, armL=(10, 25), elbowL=40,
             weapon=((0.34, -0.46, 1.78), -1.2, 14, 0))
    return [p]


# name, poses, right, left, fps, loop, drive, props
HER_CLIPS = [
    ("stab", stab_clip, "stab", "stab-left", 20, False, "", "sword"),
    ("shoryuken", shoryuken_clip, "shoryuken", "shoryuken-left", 14, False, "", "sword"),
    ("thrust-windup", thrust_windup_clip, "thrust-windup", "thrust-windup-left", 6, True, "", "sword"),
    ("thrust-dash", thrust_dash_clip, "thrust-dash", "thrust-dash-left", 12, True, "", "sword"),
    ("throw", throw_clip, "throw", "throw-left", 10, False, "", "none"),
]
SHARED = ("idle", "run", "turn", "jump", "fall", "gun-hold", "gun-fire", "gun-run", "roll",
          "disabled", "helpless", "downed", "launched")
AIRBORNE = sprite_rig.AIRBORNE | {"shoryuken"}


def build():
    setup_scene()
    arm = bpy.data.objects[sprite_rig.RIG_NAME]
    col = bpy.data.collections[HERO_COLLECTION]
    build_weapons(arm, col)
    for act in [a for a in bpy.data.actions if a.name.startswith("clip.")]:
        bpy.data.actions.remove(act)
    arm.animation_data_create()
    clips = [(c[0], (lambda fn=c[1]: adapt(fn(), arm)), *c[2:]) for c in sprite_rig.CLIPS if c[0] in SHARED]
    clips += HER_CLIPS
    clips.append(("portrait", portrait_pose, "portrait", "", 1, False, "", "sword"))
    for name, fn, right, left, fps, loop, drive, props in clips:
        sprite_rig.make_clip(
            arm, name, fn(), right, left, fps=fps, loop=loop, drive=drive, props=props, ground=name not in AIRBORNE
        )
    idle = bpy.data.actions["clip.idle"]
    arm.animation_data.action = idle
    arm.animation_data.action_slot = idle.slots[0]
    return [c[0] for c in clips]
