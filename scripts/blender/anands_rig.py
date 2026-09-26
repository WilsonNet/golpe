"""Rig Anands' base mesh on the shared sprite skeleton.

Run in the live Blender with `art/anands/anands.blend` open (the Blender MCP
does this):

    import sys; sys.path.insert(0, "<repo>/scripts/blender")
    import importlib, anands_rig; importlib.reload(anands_rig); anands_rig.rig()

Her skeleton has **the same bone names, hierarchy, IK and custom-property
contract as `sprite_rig.py`'s** — so every shared clip pose, the weapon-driven
IK and `hero_render.py` work on her unchanged — but the joints sit where *her*
joints are: the chibi head starts at the chin (z 1.9, not Lia's 1.66), the
arms hang against the body to gloves at hip height, the knees sit just above
the boot cuffs. Measured from the Tripo mesh's cross-sections and a front
render (2026-09-26).

The mesh is skinned with automatic (heat) weights, then two corrections that
automatic weights get wrong on a figure whose arms rest against its body:
everything above the neck belongs to the head (hair, goggles), and the torso
core never follows an arm.
"""

import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(__file__))

import sprite_rig  # noqa: E402

MESH = "Anands.tripo"
COLLECTION = "Tripo"

# (name, head, tail, parent) — sprite_rig.BONES' names and parents, her joints.
BONES = [
    ("root", (0, 0, 0), (0, 0, 0.3), None),
    ("hips", (0, 0, 0.92), (0, 0, 1.15), "root"),
    ("chest", (0, 0, 1.15), (0, 0, 1.86), "hips"),
    ("head", (0, 0, 1.88), (0, 0, 2.95), "chest"),
    ("upperarm.R", (-0.02, -0.38, 1.6), (-0.02, -0.52, 1.32), "chest"),
    ("forearm.R", (-0.02, -0.52, 1.32), (0.02, -0.6, 1.0), "upperarm.R"),
    ("upperarm.L", (-0.02, 0.38, 1.6), (-0.02, 0.52, 1.32), "chest"),
    ("forearm.L", (-0.02, 0.52, 1.32), (0.02, 0.6, 1.0), "upperarm.L"),
    ("thigh.R", (0.0, -0.2, 0.9), (0.01, -0.24, 0.52), "hips"),
    ("shin.R", (0.01, -0.24, 0.52), (0.0, -0.28, 0.18), "thigh.R"),
    ("foot.R", (0.0, -0.28, 0.18), (0.22, -0.29, 0.05), "shin.R"),
    ("thigh.L", (0.0, 0.2, 0.9), (0.01, 0.24, 0.52), "hips"),
    ("shin.L", (0.01, 0.24, 0.52), (0.0, 0.28, 0.18), "thigh.L"),
    ("foot.L", (0.0, 0.28, 0.18), (0.22, 0.29, 0.05), "shin.L"),
    # Kept for the shared contract (poses key them); nothing of hers is
    # weighted to them — her pack rides the chest, she has no ponytail.
    ("cape", (-0.3, 0, 1.56), (-0.4, 0, 0.92), "chest"),
    ("pony", (-0.28, 0, 2.42), (-0.8, 0, 2.22), "head"),
    ("weapon", (0, 0, 1.0), (0.4, 0, 1.0), None),
    ("hand_ik.R", (0, 0, 1.0), (0.2, 0, 1.0), "weapon"),
    ("hand_ik.L", (0, 0, 1.0), (0.2, 0, 1.0), "weapon"),
]

NECK_Z = 1.9          # above this, a vertex is the head's (hair, goggles, face)
CORE_HALF_W = 0.3     # |y| inside this, between hips and shoulders: torso only
HEAD_HALF_W = 10.0    # |y| inside this may be head (the T-pose rig narrows it: the arms sit at head height)

# The T-pose mesh (anands-tripo-tpose.glb): skinned in its T-pose — a T-pose
# is what heat weighting separates cleanly, arms away from the body — then the
# arms are posed down and that pose becomes the rest pose, so the shared clip
# poses (which assume arms hanging at the sides) apply to her unchanged.
BONES_TPOSE = [
    ("root", (0, 0, 0), (0, 0, 0.3), None),
    ("hips", (0, 0, 0.85), (0, 0, 1.15), "root"),
    ("chest", (0, 0, 1.15), (0, 0, 1.9), "hips"),
    ("head", (0, 0, 1.96), (0, 0, 2.95), "chest"),
    ("upperarm.R", (0, -0.42, 1.88), (0, -0.8, 1.9), "chest"),
    ("forearm.R", (0, -0.8, 1.9), (0.02, -1.14, 1.9), "upperarm.R"),
    ("upperarm.L", (0, 0.42, 1.88), (0, 0.8, 1.9), "chest"),
    ("forearm.L", (0, 0.8, 1.9), (0.02, 1.14, 1.9), "upperarm.L"),
    ("thigh.R", (0.0, -0.2, 0.85), (0.02, -0.22, 0.48), "hips"),
    ("shin.R", (0.02, -0.22, 0.48), (0.0, -0.24, 0.18), "thigh.R"),
    ("foot.R", (0.0, -0.24, 0.18), (0.22, -0.25, 0.05), "shin.R"),
    ("thigh.L", (0.0, 0.2, 0.85), (0.02, 0.22, 0.48), "hips"),
    ("shin.L", (0.02, 0.22, 0.48), (0.0, 0.24, 0.18), "thigh.L"),
    ("foot.L", (0.0, 0.24, 0.18), (0.22, 0.25, 0.05), "shin.L"),
    ("cape", (-0.3, 0, 1.56), (-0.4, 0, 0.92), "chest"),
    ("pony", (-0.28, 0, 2.42), (-0.8, 0, 2.22), "head"),
    ("weapon", (0, 0, 1.0), (0.4, 0, 1.0), None),
    ("hand_ik.R", (0, 0, 1.0), (0.2, 0, 1.0), "weapon"),
    ("hand_ik.L", (0, 0, 1.0), (0.2, 0, 1.0), "weapon"),
]
ARM_DROP_DEG = 72     # how far below horizontal the arms hang at rest


def rig(bones=None, tpose=False):
    global HEAD_HALF_W
    HEAD_HALF_W = 0.4 if tpose else 10.0
    bones = bones or (BONES_TPOSE if tpose else BONES)
    col = bpy.data.collections[COLLECTION]
    old = bpy.data.objects.get(sprite_rig.RIG_NAME)
    if old:
        bpy.data.objects.remove(old, do_unlink=True)
    mesh = bpy.data.objects[MESH]
    mesh.parent = None
    for md in [m for m in mesh.modifiers if m.type == "ARMATURE"]:
        mesh.modifiers.remove(md)
    mesh.vertex_groups.clear()

    saved = sprite_rig.BONES
    sprite_rig.BONES = bones
    try:
        arm = sprite_rig.build_armature(col)
    finally:
        sprite_rig.BONES = saved

    # Skin at rest, unrotated; the armature's 3/4 view yaw is applied after,
    # and the mesh follows it as a child.
    arm.rotation_euler = (0, 0, 0)
    bpy.context.view_layer.update()
    for o in bpy.context.selected_objects:
        o.select_set(False)
    mesh.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    fix_weights(mesh)
    if tpose:
        drop_arms(arm, mesh)
    arm.rotation_euler = (0, 0, math.radians(sprite_rig.VIEW_YAW_DEG))
    arm.animation_data_create()
    return arm


def drop_arms(arm, mesh):
    """Pose the T-pose arms down to hang at her sides, bake that into the
    mesh, and make it the rest pose — the shared poses rotate arms that hang."""
    import math

    from mathutils import Matrix

    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    # The sword hand's IK is live at rest; it would drag the arm to the
    # weapon bone while the pose is baked.
    iks = {side: arm.pose.bones[f"forearm.{side}"].constraints["IK"] for side in ("R", "L")}
    saved = {k: c.influence for k, c in iks.items()}
    for c in iks.values():
        c.influence = 0.0
    for side, s in (("L", 1), ("R", -1)):
        pb = arm.pose.bones[f"upperarm.{side}"]
        pb.rotation_mode = "QUATERNION"
        # About the armature's X axis, expressed in the bone's rest frame.
        R = Matrix.Rotation(math.radians(-s * ARM_DROP_DEG), 4, "X")
        L = arm.data.bones[pb.name].matrix_local
        pb.rotation_quaternion = (L.inverted() @ R @ L).to_quaternion()
    bpy.context.view_layer.update()
    bpy.ops.object.mode_set(mode="OBJECT")
    # Bake the pose into the mesh, keeping the vertex groups.
    bpy.context.view_layer.objects.active = mesh
    md = next(m for m in mesh.modifiers if m.type == "ARMATURE")
    bpy.ops.object.modifier_apply(modifier=md.name)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    bpy.ops.pose.armature_apply(selected=False)
    for k, c in iks.items():
        c.influence = saved[k]
    bpy.ops.object.mode_set(mode="OBJECT")
    md = mesh.modifiers.new("Armature", "ARMATURE")
    md.object = arm
    # The deform comes first: the ink hull must follow the posed body.
    bpy.context.view_layer.objects.active = mesh
    while mesh.modifiers.find("Armature") > 0:
        bpy.ops.object.modifier_move_up(modifier="Armature")


def fix_weights(mesh):
    groups = {g.name: g for g in mesh.vertex_groups}
    deform = [n for n, *_ in BONES if n not in ("weapon", "hand_ik.R", "hand_ik.L", "cape", "pony", "root")]
    for g in list(mesh.vertex_groups):
        if g.name not in deform:
            mesh.vertex_groups.remove(g)
    groups = {g.name: g for g in mesh.vertex_groups}
    for n in deform:
        if n not in groups:
            groups[n] = mesh.vertex_groups.new(name=n)
    arms = [groups[n] for n in ("upperarm.R", "forearm.R", "upperarm.L", "forearm.L")]
    for v in mesh.data.vertices:
        co = v.co
        if co.z > NECK_Z and abs(co.y) < HEAD_HALF_W:
            for g in groups.values():
                g.remove([v.index])
            groups["head"].add([v.index], 1.0, "REPLACE")
            continue
        if abs(co.y) < CORE_HALF_W and 1.15 < co.z < 1.75:
            had = sum(g.weight(v.index) for g in arms if _has(g, v.index))
            if had:
                for g in arms:
                    g.remove([v.index])
                groups["chest"].add([v.index], had, "ADD")
        if not v.groups:
            groups["chest" if co.z > 0.92 else "hips"].add([v.index], 1.0, "REPLACE")
    heal_weightless(mesh)


def heal_weightless(mesh, floor=0.05):
    """Heat weighting leaves some vertices (the pack's flap and buckle, 290 of
    them) in groups whose weights sum to ~0; the armature then leaves them at
    rest while the body moves, and a knocked-down Anands grew a strand of
    stretched faces back up to where she stood. Each takes the weights of the
    nearest properly weighted vertex, and every vertex is normalised."""
    from mathutils.kdtree import KDTree

    verts = mesh.data.vertices
    total = [sum(g.weight for g in v.groups) for v in verts]
    good = [v.index for v in verts if total[v.index] >= floor]
    tree = KDTree(len(good))
    for i in good:
        tree.insert(verts[i].co, i)
    tree.balance()
    groups = mesh.vertex_groups
    for v in verts:
        if total[v.index] >= floor:
            continue
        _co, src, _d = tree.find(v.co)
        for g in groups:
            g.remove([v.index])
        for ge in verts[src].groups:
            groups[ge.group].add([v.index], ge.weight, "REPLACE")
    for v in verts:
        s = sum(ge.weight for ge in v.groups)
        if s > 0:
            for ge in v.groups:
                ge.weight /= s


def _has(group, index):
    try:
        group.weight(index)
        return True
    except RuntimeError:
        return False


def test_pose(arm, **kw):
    """Apply one of the shared poses (e.g. `sprite_rig.run_pose(0.25)`)."""
    sprite_rig.apply_pose(arm, kw.get("pose") or sprite_rig.pose())
    bpy.context.view_layer.update()
