"""Anands' weapons, render scene and clips — on her rigged Tripo mesh.

Run in the live Blender with `art/anands/anands.blend` open (after
`anands_rig.rig()`):

    import sys; sys.path.insert(0, "<repo>/scripts/blender")
    import importlib, anands_clips; importlib.reload(anands_clips); anands_clips.build()

Then `python3 scripts/make-hero-art.py anands` renders and packs her atlas
exactly as it does Lia's and Jeffs'.

What is hers and not the shared rig's:

- **Her pixels, unlit.** Her mesh's texture is painted flat colour (Tripo,
  lighting removed, from her boards); it is rendered as emission, so the
  colours on screen are the texture's, not a shader's. The weapons use the
  shared LiaToon shader.
- **The dagger**, not a sword: `Dagger` rides the `weapon` bone (grip at the
  bone's origin, point along +X), shown for `lia_props = "sword"` clips. The
  machine gun is `Gun`, shown for `"rifle"` clips.
- **Her moves**: the stab, the shoryuken and the thrust (its reversed-grip
  anticipation and the dash), posed from her boards. Lia's sword-only clips
  (the chain, the uppercut, the block, the Massive, the plunge) are not hers
  and are not made.
"""

import math
import os
import sys

import bpy
from mathutils import Vector

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


def unlit_mesh():
    """Her texture as emission: flat colour in, the same flat colour out."""
    mesh = bpy.data.objects[MESH]
    for mat in mesh.data.materials:
        nt = mat.node_tree
        if nt.nodes.get("Unlit"):
            continue
        bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
        link = bsdf.inputs["Base Color"].links
        src = link[0].from_socket if link else None
        out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
        em = nt.nodes.new("ShaderNodeEmission")
        em.name = "Unlit"
        em.location = (bsdf.location.x, bsdf.location.y - 400)
        if src:
            nt.links.new(src, em.inputs["Color"])
        else:
            em.inputs["Color"].default_value = bsdf.inputs["Base Color"].default_value
        nt.links.new(em.outputs[0], out.inputs["Surface"])


# ------------------------------------------------------------------ weapons
G = Vector((0, 0, 1.0))  # the weapon bone's head: the grip


def build_weapons(arm, col):
    for n in ("Dagger", "Gun"):
        ob = bpy.data.objects.get(n)
        if ob:
            bpy.data.objects.remove(ob, do_unlink=True)
    # The dagger: a leaf blade as long as her forearm, a brass guard, a
    # wrapped grip — the board's dagger, pointing along +X from the fist.
    dg = Part("Dagger")
    dg.tube([G + Vector((-0.12, 0, 0)), G + Vector((0.06, 0, 0))], [0.04, 0.04], "dagger_grip", sides=8)
    dg.ellipsoid(G + Vector((-0.14, 0, 0)), (0.045, 0.045, 0.045), "brass")
    dg.box(G + Vector((0.08, 0, 0)), (0.05, 0.08, 0.2), "brass", bevel=0.01)
    blade = [G + Vector((x, 0, 0)) for x in (0.1, 0.3, 0.46, 0.56)]
    dg.tube(blade, [(0.018, 0.07), (0.018, 0.075), (0.012, 0.045), (0.003, 0.005)], "steel", sides=4, up=(0, 0, 1))
    dagger = dg.build(col, smooth=False)

    # The machine gun: a compact SMG — receiver, barrel with a shroud, a
    # drum-less stick magazine, a wooden stock and fore-grip.
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


# ------------------------------------------------------------------ her moves
# Timings mirror src/tweakables/melee.ts (stab 45/55/90, shoryuken 90/140/320,
# thrust 260 startup / 140 active / 480 recovery). The game plays these clips
# on the clock at the fps below, over the part of the move they cover.


def stab_clip():
    """The dagger arm snaps out to full extension at shoulder height and
    comes back — the board's 'Dagger Combat (Basic)' row."""
    base = dict(thighR=(24, 6), kneeR=30, footR=-10, thighL=(-22, 6), kneeL=16, footL=12, cape=6)
    wind = pose(root=(0, 0, -0.06), chest=(-6, 16, 0), hips=(0, 8, 0), armL=(-20, 20), elbowL=50,
                weapon=((0.18, -0.36, 1.36), 0.15, -6, 0), **base)
    lunge = pose(root=(0.12, 0, -0.1), chest=(12, -20, 0), hips=(4, -10, 0), head=(-4, 0, 0), armL=(-40, 25), elbowL=60,
                 weapon=((0.86, -0.3, 1.44), 0.0, -4, 0),
                 **{**base, "thighR": (40, 6), "kneeR": 46, "thighL": (-30, 6)})
    hold = dict(lunge)
    hold["weapon"] = ((0.82, -0.3, 1.42), 0.04, -4, 0)
    back = pose(root=(0.04, 0, -0.06), chest=(4, -6, 0), armL=(-10, 18), elbowL=40,
                weapon=((0.5, -0.34, 1.34), 0.2, -4, 0), **base)
    return [wind, lunge, hold, back]


def shoryuken_clip():
    """Crouch, then the rising cut: dagger arm swept overhead, body lifting
    — the board's 'Abilities: Shoryuken' row."""
    crouch = pose(root=(0, 0, -0.26), chest=(24, 10, 0), head=(-6, 0, 0), thighR=(56, 6), kneeR=96, footR=-10,
                  thighL=(-8, 6), kneeL=74, footL=20, armL=(20, 20), elbowL=70, cape=12,
                  weapon=((0.34, -0.32, 0.98), 0.9, 6, 0))
    rise = pose(root=(0.04, 0, 0.14), chest=(-14, -8, 0), head=(-16, 0, 0), thighR=(30, 6), kneeR=24,
                thighL=(-18, 6), kneeL=50, footL=30, armL=(-20, 40), elbowL=40, cape=-10,
                weapon=((0.4, -0.3, 1.98), -1.1, 6, 0))
    peak = pose(root=(0.02, 0, 0.26), chest=(-22, -10, 0), head=(-20, 0, 0), thighR=(24, 6), kneeR=20,
                thighL=(-10, 6), kneeL=60, footL=30, armL=(-30, 50), elbowL=30, cape=-16,
                weapon=((0.2, -0.3, 2.36), -1.6, 8, 0))
    return [crouch, rise, peak]


def thrust_windup_clip():
    """The anticipation: the dagger held reversed behind her, body coiled
    forward — the tell a foe jumps. Two frames of a held breath."""
    out = []
    for b in (0.0, 1.0):
        out.append(
            pose(root=(-0.04, 0, -0.2 - 0.02 * b), chest=(22, 24, 0), hips=(6, 12, 0), head=(-10, -10, 0),
                 thighR=(46, 6), kneeR=70, footR=-14, thighL=(-34, 6), kneeL=30, footL=18,
                 armL=(50, 10), elbowL=70, cape=10 + 4 * b,
                 weapon=((-0.36, -0.4, 1.28 - 0.02 * b), math.pi - 0.2, 8, 0))
        )
    return out


def thrust_dash_clip():
    """The dash: body flat forward along the line, arm and dagger extended."""
    out = []
    for b in (0.0, 1.0):
        out.append(
            pose(root=(0.1, 0, -0.34), root_pitch=26, root_pivot=(0, 0, 1.0), chest=(10, -12, 0), head=(-24, 0, 0),
                 thighR=(20, 6), kneeR=30, thighL=(-50, 6), kneeL=40 + 10 * b, footL=20,
                 armL=(-60, 20), elbowL=40, cape=30,
                 weapon=((0.95, -0.28, 1.34), 0.0, 0, 0))
        )
    return out


def portrait_pose():
    """The hero shot: face-on, dagger held up by the chest."""
    p = pose(root_yaw=-45.0, chest=(-4, 10, 0), head=(-4, 18, 0), thighR=(10, 10), kneeR=6,
             thighL=(-6, 10), kneeL=6, armL=(10, 25), elbowL=70,
             weapon=((0.34, -0.4, 1.46), -1.2, 14, 0))
    return [p]


# name, poses, right, left, fps, loop, drive, props
HER_CLIPS = [
    ("stab", stab_clip, "stab", "stab-left", 20, False, "", "sword"),
    ("shoryuken", shoryuken_clip, "shoryuken", "shoryuken-left", 14, False, "", "sword"),
    ("thrust-windup", thrust_windup_clip, "thrust-windup", "thrust-windup-left", 6, True, "", "sword"),
    ("thrust-dash", thrust_dash_clip, "thrust-dash", "thrust-dash-left", 12, True, "", "sword"),
]
SHARED = ("idle", "run", "turn", "jump", "fall", "gun-hold", "gun-fire", "gun-run", "roll",
          "disabled", "helpless", "downed", "launched")
AIRBORNE = sprite_rig.AIRBORNE | {"shoryuken"}


def build():
    setup_scene()
    unlit_mesh()
    arm = bpy.data.objects[sprite_rig.RIG_NAME]
    col = bpy.data.collections[HERO_COLLECTION]
    build_weapons(arm, col)
    for act in [a for a in bpy.data.actions if a.name.startswith("clip.")]:
        bpy.data.actions.remove(act)
    arm.animation_data_create()
    clips = [c for c in sprite_rig.CLIPS if c[0] in SHARED] + HER_CLIPS
    clips.append(("portrait", portrait_pose, "portrait", "", 1, False, "", "sword"))
    for name, fn, right, left, fps, loop, drive, props in clips:
        sprite_rig.make_clip(
            arm, name, fn(), right, left, fps=fps, loop=loop, drive=drive, props=props, ground=name not in AIRBORNE
        )
    idle = bpy.data.actions["clip.idle"]
    arm.animation_data.action = idle
    arm.animation_data.action_slot = idle.slots[0]
    return [c[0] for c in clips]
