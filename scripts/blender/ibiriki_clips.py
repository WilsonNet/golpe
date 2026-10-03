"""Ibiriki's weapons, render scene and clips — on his rigid-part rig.

Run in the live Blender with `art/ibiriki/ibiriki.blend` open (after
`ibiriki_rig.rig()`, `ibiriki_remesh.rebuild_all()` and `ibiriki_look.apply()`):

    import ibiriki_clips; ibiriki_clips.build()

Then `python3 scripts/make-hero-art.py ibiriki` renders and packs his atlas.

His weapons are the Tripo model's own (specs/ibiriki.md): the **viking
sword** (`Sword`, three segmentation pieces joined, a leather grip modelled
into the gap the fist left) and the **throwing axe** — `Gun` on the weapon
bone for the gun stance, and `AxeOff` in his left fist for the berserk
dual wield. The props modes are `hero_render.PROPS`: `sword`, `rifle` (the
axe in hand), `none`, and `dual` (sword *and* the off-hand axe).

The shared clips are carried into his reach (`rebase`, from Jeffs: his
shoulder sits out on the ball at y -0.82, 0.76 m of arm). His own:

- the **hews** — the slash chain's poses on the hew chain's frame data and
  arcs (`src/tweakables/melee.ts`, `SWING` in `MeleeFx.ts`);
- **sunder** — the Massive's overhead, on the Sunder's timing;
- the **frenzy** (`rend`, `rend2`, `rend3`) dual-wielding: the sword cut,
  the off-hand axe's backhand, then both in an X;
- **berserk** / **berserk-walk** — the idle and run with the axe out;
- **axe-windup** — the axe drawn back over the head while the throw charges
  (move-driven by the charge's progress), and the gun clips as the axe held
  ready and thrown;
- **stomp** — Rupture's cast: both weapons raised, then the ground slammed.
"""

import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(__file__))

import anands_clips  # noqa: E402
import jeffs_clips  # noqa: E402
import sprite_rig  # noqa: E402
from sprite_rig import parent_to_bone, pose  # noqa: E402

# 3 m plus the heavy outline and the horns stood 101 px against the
# contract's 100: a hair smaller than the others (0.89 on the T-pose mesh,
# whose horns stand a full 3 m).
RIG_SCALE = 0.89
LIA_SHOULDER = (0.0, -0.33, 1.5)
LIA_ARM = 0.58
G = Vector((0, 0, 1.0))

# Frame data and arcs, mirrored from src/tweakables/melee.ts and SWING in
# src/game/render/MeleeFx.ts so the drawn steel follows the trail.
sprite_rig.MOVES.update(
    {
        "hew": dict(startup=120, active=95, recovery=230, arc=(-1.35, 2.2, 0.85, -6)),
        "hew2": dict(startup=120, active=95, recovery=230, arc=(-2.3, 1.1, -0.85, -4)),
        "hew3": dict(startup=140, active=110, recovery=460, arc=(-1.62, 1.57, 0.45, -12)),
        "sunder": dict(startup=110, active=140, recovery=420, arc=(-2.7, 1.4, 0.3, -10)),
        "rend": dict(startup=55, active=70, recovery=120, arc=(-1.1, 1.9, 0.7, -4)),
        "rend2": dict(startup=55, active=70, recovery=120, arc=(-2.0, 0.9, -0.7, -2)),
        "rend3": dict(startup=70, active=90, recovery=260, arc=(-1.9, 1.9, 0.4, -8)),
    }
)


def ms(move):
    m = sprite_rig.MOVES[move]
    return m["startup"] + m["active"] + m["recovery"]


# **A ball does not twist.** The shared poses turn Lia's chest and hips into
# every cut; on Ibiriki the chest carries the whole ball — the face with it —
# so a full twist swung his face away from the viewer mid-swing. His torso
# keeps a fraction of every rotation: enough lean to read the effort, never
# enough to turn the face.
TORSO_DAMP = 0.3
CHEST_TURN_DEG = -8.0
HEAD_DAMP = 0.5
# **The weapon sits on the near side of the ball.** His shoulder is on the
# ball's surface (y -0.82), so a grip carried into his reach lands under the
# skin — the sword was inside his body. Every grip is pushed this far toward
# the camera (−Y), clear of the ball's 0.9 m radius.
GRIP_FORWARD_Y = -0.42


def _damp(p):
    p = dict(p)
    for k in ("chest", "hips"):
        p[k] = tuple(v * TORSO_DAMP for v in p[k])
    # The face looks where he is going, a hair toward the viewer: at 0 the
    # far eye vanishes and he reads as a back-of-the-head; at 20 both eyes
    # stare out of the sprite (the user's "staring at me" — measured on the
    # T-pose mesh, 2026-10-03). Eight degrees: the near eye leads.
    pitch, yaw, roll = p["chest"]
    p["chest"] = (pitch, yaw + CHEST_TURN_DEG, roll)
    # His face is painted on the ball, which rides the chest — so the shared
    # head turn toward the viewer (`HEAD_TO_VIEWER_DEG`, added by
    # `apply_pose`) is cancelled: it would only twist the helmet off the face,
    # and a face turned to the camera is what made him stare at the player.
    pitch, yaw, roll = (v * HEAD_DAMP for v in p["head"])
    p["head"] = (pitch, yaw - sprite_rig.HEAD_TO_VIEWER_DEG, roll)
    p["root_pitch"] = p["root_pitch"] * HEAD_DAMP
    pos, theta, depth, roll = p["weapon"]
    p["weapon"] = ((pos[0], pos[1] + GRIP_FORWARD_Y, pos[2]), theta, depth, roll)
    return p


def rebase(poses):
    arm = bpy.data.objects[sprite_rig.RIG_NAME]
    return [_damp(p) for p in jeffs_clips.rebase(poses, arm, LIA_SHOULDER, LIA_ARM)]


# ---------------------------------------------------------------- weapons
def build_weapons(arm):
    """Parent the sword and the axe to the weapon bone, and make the off-hand
    axe for the berserk: a copy of the axe in his left fist, haft forward and
    up, riding the left forearm."""
    sword = bpy.data.objects["Sword"]
    gun = bpy.data.objects["Gun"]
    for ob in (sword, gun):
        if ob.parent is None:
            parent_to_bone(ob, arm, "weapon")
    old = bpy.data.objects.get("AxeOff")
    if old:
        bpy.data.objects.remove(old, do_unlink=True)
    off = gun.copy()
    off.data = gun.data.copy()
    off.name = off.data.name = "AxeOff"
    for c in gun.users_collection:
        c.objects.link(off)
    off.parent = None
    off.matrix_world = Matrix.Identity(4)
    # Grip in the left fist, the haft pointing forward and a little up.
    fist = arm.data.bones["forearm.L"].tail_local
    R = Matrix.Rotation(math.radians(-35), 4, "Y")
    off.data.transform(Matrix.Translation(fist) @ R @ Matrix.Translation(-G))
    parent_to_bone(off, arm, "forearm.L")
    return sword, gun, off


# ---------------------------------------------------------------- clips
def _shared(name):
    fn = next(c[1] for c in sprite_rig.CLIPS if c[0] == name)
    return fn()


def hew_clip():
    return sprite_rig.swing_clip("hew", 6, _keys("slash"))


def hew2_clip():
    return sprite_rig.swing_clip("hew2", 6, _keys("slash2"))


def hew3_clip():
    return sprite_rig.swing_clip("hew3", 8, _keys("slash3"))


def sunder_clip():
    return sprite_rig.swing_clip("sunder", 8, _keys("massive"))


SLASH_KEYS = {}


def _keys(shared):
    """The body keys a shared swing uses, read back off its clip function's
    source pose list — kept here as the shared table so the hews move like
    the slashes they are heavier versions of."""
    return SLASH_KEYS[shared]


SLASH_KEYS.update(
    {
        "slash": [
            (0.15, dict(chest=(-6, 22, 0), hips=(0, 10, 0), thighR=(20, 6), kneeR=28, thighL=(-18, 6), kneeL=14, armL=(-10, 30))),
            (0.42, dict(chest=(18, -26, 0), hips=(6, -14, 0), thighR=(34, 6), kneeR=40, footR=-14, thighL=(-30, 6), kneeL=10, footL=14, armL=(-30, 25))),
            (0.8, dict(chest=(8, -8, 0), thighR=(22, 6), kneeR=24, thighL=(-18, 6), kneeL=12, armL=(10, 16))),
        ],
        "slash2": [
            (0.15, dict(chest=(-8, -22, 0), hips=(0, -10, 0), thighR=(22, 6), kneeR=30, thighL=(-18, 6), kneeL=14, armL=(30, 20), elbowL=60)),
            (0.42, dict(chest=(16, 24, 0), hips=(6, 12, 0), thighR=(34, 6), kneeR=40, footR=-14, thighL=(-30, 6), kneeL=10, footL=14, armL=(-35, 35))),
            (0.8, dict(chest=(8, 6, 0), thighR=(22, 6), kneeR=24, thighL=(-18, 6), kneeL=12)),
        ],
        "slash3": [
            (0.1, dict(root=(0, 0, 0.04), chest=(-18, 0, 0), head=(-10, 0, 0), thighR=(26, 6), kneeR=30, thighL=(-10, 6), kneeL=20)),
            (0.3, dict(root=(0, 0, -0.14), chest=(30, 0, 0), head=(-12, 0, 0), thighR=(50, 6), kneeR=70, footR=-20, thighL=(-36, 6), kneeL=16, footL=20)),
            (0.7, dict(root=(0, 0, -0.1), chest=(22, 0, 0), thighR=(44, 6), kneeR=60, thighL=(-32, 6), kneeL=16)),
        ],
        "massive": [
            (0.08, dict(root=(0, 0, 0.02), chest=(-20, 0, 0), head=(-12, 0, 0), thighR=(20, 6), kneeR=20, thighL=(-12, 6), kneeL=14)),
            (0.3, dict(root=(0.12, 0, -0.24), chest=(42, 0, 0), head=(-20, 0, 0), thighR=(64, 6), kneeR=90, footR=-24, thighL=(-44, 6), kneeL=10, footL=30)),
            (0.75, dict(root=(0.08, 0, -0.18), chest=(34, 0, 0), head=(-14, 0, 0), thighR=(56, 6), kneeR=80, thighL=(-40, 6), kneeL=12, footL=24)),
        ],
    }
)

# The off-hand axe raised: the left arm cocked up and forward.
AXE_UP = dict(armL=(70, 20), elbowL=40)


def _with(poses, **kw):
    out = []
    for p in poses:
        p = dict(p)
        p.update(kw)
        out.append(p)
    return out


def rend_clip():
    return _with(sprite_rig.swing_clip("rend", 5, _keys("slash")), **AXE_UP)


def rend2_clip():
    """The axe's backhand: the left arm sweeps from cocked high behind to low
    in front while the sword is held back at the ready."""
    out = []
    n = 5
    for i in range(n):
        t = sprite_rig.smoothstep((i + 0.5) / n)
        out.append(
            pose(
                chest=(10 * t - 6, 26 - 50 * t, 0),
                hips=(4, 10 - 20 * t, 0),
                thighR=(20, 6),
                kneeR=26,
                thighL=(-18, 6),
                kneeL=12,
                armL=(130 - 150 * t, 30),
                elbowL=60 - 50 * t,
                weapon=((0.2, -0.4, 1.3), 2.4, -6, 0),
            )
        )
    return out


def rend3_clip():
    """Both weapons in an X: the sword's overhead with the axe coming across."""
    frames = sprite_rig.swing_clip("rend3", 6, _keys("slash3"))
    n = len(frames)
    for i, p in enumerate(frames):
        t = sprite_rig.smoothstep((i + 0.5) / n)
        p["armL"] = (140 - 160 * t, 20)
        p["elbowL"] = 30
    return frames


def berserk_clip():
    return _with(_shared("idle"), armL=(60, 22), elbowL=50)


def berserk_walk_clip():
    out = []
    for p in _shared("run"):
        p = dict(p)
        fwd = p["armL"][0]
        p["armL"] = (50 + 0.3 * fwd, 20)
        p["elbowL"] = 50
        out.append(p)
    return out


# The axe held ready to throw, over the right shoulder.
AXE_READY = ((0.05, -0.4, 1.55), -2.0, 8, 0)


def gun_hold_clip():
    p = sprite_rig.gun_legs()
    p.update(chest=(4, -6, 0), armL=(20, 18), elbowL=40, ikL=0.0, weapon=AXE_READY)
    return [p]


def gun_run_clip():
    out = []
    for p in _shared("run"):
        p = dict(p)
        p["weapon"] = AXE_READY
        out.append(p)
    return out


def gun_fire_clip():
    """The throw's follow-through: the arm whipped forward and down, empty —
    the axe is already in the air. Then the next one comes to hand."""
    follow = sprite_rig.gun_legs()
    follow.update(root=(0.08, 0, -0.08), chest=(24, -14, 0), armL=(-30, 20), elbowL=40,
                  weapon=((0.95, -0.4, 1.05), 0.9, -6, 0))
    back = sprite_rig.gun_legs()
    back.update(chest=(10, -8, 0), armL=(0, 18), elbowL=40, weapon=((0.5, -0.4, 1.5), -1.0, 4, 0))
    return [follow, back]


def axe_windup_clip():
    """The charge: the axe drawn back behind the head as the throw fills —
    move-driven, so the last frame is the full charge."""
    out = []
    n = 4
    for i in range(n):
        t = (i + 0.5) / n
        p = sprite_rig.gun_legs()
        p.update(
            root=(-0.04 * t, 0, -0.06 * t),
            chest=(-6 - 14 * t, 10 * t, 0),
            head=(-6, 0, 0),
            armL=(40 + 20 * t, 20),
            elbowL=40,
            thighR=(20, 6),
            kneeR=24,
            thighL=(-24, 6),
            kneeL=14,
            weapon=((-0.15 - 0.35 * t, -0.4, 1.95 + 0.15 * t), -2.4 - 0.5 * t, 8, 0),
        )
        out.append(p)
    return out


def stomp_clip():
    """Rupture's cast: both weapons thrown up, then the stomp — the body
    dropped, one leg slammed down, the weapons driven at the ground."""
    up = pose(root=(0, 0, 0.12), chest=(-16, 0, 0), head=(-12, 0, 0), thighR=(50, 6), kneeR=80,
              thighL=(-6, 6), kneeL=10, armL=(150, 30), elbowL=20,
              weapon=((-0.05, -0.5, 2.6), -1.7, 6, 0))
    slam = pose(root=(0.04, 0, -0.18), chest=(30, 0, 0), head=(-10, 0, 0), thighR=(10, 8), kneeR=10,
                thighL=(-14, 8), kneeL=30, armL=(40, 30), elbowL=10,
                weapon=((0.7, -0.5, 1.0), 1.2, 0, 0))
    hold = dict(slam)
    hold["root"] = (0.04, 0, -0.14)
    return [up, up, slam, hold]


def portrait_pose():
    """The hero shot: face to the viewer, sword up by the shoulder, the axe in
    the other fist."""
    p = pose(root_yaw=-40.0, chest=(-4, 10, 0), head=(-4, 12, 0), thighR=(10, 10), kneeR=6,
             thighL=(-6, 10), kneeL=6, armL=(50, 30), elbowL=50,
             weapon=((0.4, -0.5, 1.8), -1.2, 14, 0))
    return [p]


def throw_clip():
    return anands_clips.throw_clip()


def block_clip():
    """The guard with the sword across his front at chest height: the shared
    block's upright blade, raised from his shoulder on the ball, stood over
    his horns (the scale contract measured 108 px)."""
    p = sprite_rig.block_clip()[0]
    p["weapon"] = ((0.5, -0.3, 1.25), -1.0, 10, 0)
    return [p]


# name, poses, right, left, fps, loop, drive, props, ms
HIS_CLIPS = [
    ("hew", hew_clip, "hew", "hew-left", 0, False, "move", "sword", ms("hew")),
    ("hew2", hew2_clip, "hew2", "hew2-left", 0, False, "move", "sword", ms("hew2")),
    ("hew3", hew3_clip, "hew3", "hew3-left", 0, False, "move", "sword", ms("hew3")),
    ("sunder", sunder_clip, "sunder", "sunder-left", 0, False, "move", "sword", ms("sunder")),
    ("rend", rend_clip, "rend", "rend-left", 0, False, "move", "dual", ms("rend")),
    ("rend2", rend2_clip, "rend2", "rend2-left", 0, False, "move", "dual", ms("rend2")),
    ("rend3", rend3_clip, "rend3", "rend3-left", 0, False, "move", "dual", ms("rend3")),
    ("berserk", berserk_clip, "berserk", "berserk-left", 6, True, "", "dual", 0),
    ("berserk-walk", berserk_walk_clip, "berserk-walk", "berserk-walk-left", 16, True, "", "dual", 0),
    ("gun-hold", gun_hold_clip, "gun-hold", "gun-hold-left", 1, False, "", "rifle", 0),
    ("gun-run", gun_run_clip, "gun-run", "gun-run-left", 16, True, "", "rifle", 0),
    ("gun-fire", gun_fire_clip, "gun-fire", "gun-fire-left", 12, False, "", "none", 0),
    ("axe-windup", axe_windup_clip, "axe-windup", "axe-windup-left", 0, False, "move", "rifle", 1200),
    ("stomp", stomp_clip, "stomp", "stomp-left", 0, False, "move", "dual", 650),
    ("throw", throw_clip, "throw", "throw-left", 10, False, "", "none", 0),
    ("block", block_clip, "block", "block-left", 1, False, "", "sword", 0),
    ("portrait", portrait_pose, "portrait", "", 1, False, "", "dual", 0),
]
# The shared clips he plays as they are (carried into his reach). The Massive,
# the plunge and the stuck are the katana's and never his; the gun clips are
# his own (the axe is not aimed like a rifle).
SHARED = ("idle", "run", "turn", "jump", "fall", "charge", "charge-run",
          "uppercut", "roll", "disabled", "helpless", "downed", "launched")
AIRBORNE = sprite_rig.AIRBORNE


def setup_scene():
    scene = bpy.context.scene
    scene.camera = bpy.data.objects["SpriteCam"]
    scene.render.engine = "BLENDER_EEVEE"
    for n in ("CompareCam", "PoseCam"):
        ob = bpy.data.objects.get(n)
        if ob:
            ob.hide_render = True
    for ob in bpy.data.objects:
        if ob.name.endswith(".src"):
            ob.hide_render = True
            ob.hide_set(True)


def build():
    setup_scene()
    arm = bpy.data.objects[sprite_rig.RIG_NAME]
    build_weapons(arm)
    for act in [a for a in bpy.data.actions if a.name.startswith("clip.")]:
        bpy.data.actions.remove(act)
    arm.animation_data_create()
    arm.scale = (RIG_SCALE,) * 3
    clips = []
    for c in sprite_rig.CLIPS:
        if c[0] in SHARED:
            clips.append((c[0], (lambda fn=c[1]: rebase(fn())), *c[2:], 0))
    clips += [(c[0], (lambda fn=c[1]: rebase(fn())), *c[2:]) for c in HIS_CLIPS]
    made = []
    for name, fn, right, left, fps, loop, drive, props, dur in clips:
        if drive == "move" and not dur and name in sprite_rig.MOVES:
            dur = ms(name)
        sprite_rig.make_clip(
            arm, name, fn(), right, left, fps=fps, loop=loop, drive=drive, props=props, ms=dur,
            ground=name not in AIRBORNE,
        )
        made.append(name)
    idle = bpy.data.actions["clip.idle"]
    arm.animation_data.action = idle
    arm.animation_data.action_slot = idle.slots[0]
    return made
