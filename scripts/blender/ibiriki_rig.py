"""Rig Ibiriki's generated mesh on the shared sprite skeleton.

Run in the live Blender with `art/ibiriki/ibiriki.blend` open (the Blender
MCP does this):

    import sys; sys.path.insert(0, "<repo>/scripts/blender")
    import importlib, ibiriki_rig; importlib.reload(ibiriki_rig)
    ibiriki_rig.import_tpose(); ibiriki_rig.rig()

**The mesh is a T-pose.** Ibiriki's first model was the Tripo figure posed
with his weapons in his fists, cut into rigid parts (see the history in
`art/README.md`): the arms had to be carved off the ball and swung down, the
holes patched from inside, and the face — painted on a ball — had to be
twisted toward the camera, so he stared at the player with both eyes while
running sideways. The fix was upstream: a T-pose turnaround from his Gemini
chat (`unprocessed-sprites/ibiriki-tpose-v1.jpeg`, the front and back views
only — its side views put a fist at the camera), through Tripo multi-view
(`art/ibiriki/generated/ibiriki-tripo-tpose.glb`, 31k quads). The procedure
is Anands' and Jeffs' (`anands_rig.rig(tpose=True)`): heat weights with the
arms away from the body, then the arms dropped and baked as the rest pose.

**The ball is rigid.** Heat weighting spreads a round body over the hips,
the chest and both arms; the face is painted on it and must never stretch.
Every vertex inside the ball (and its face) belongs to the chest alone; the
helmet and horns to the head; the arms keep their heat weights out past the
ball's surface, and the legs below it.

He faces +X after `import_tpose` (Tripo hands him over facing −X; the front
is measured from the face, not assumed — `jeffs_rig.import_glb`'s helmet-band
test was a coin flip on him).
"""

import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(__file__))

import anands_rig  # noqa: E402
import jeffs_rig  # noqa: E402

MESH = "Ibiriki.tripo"
COLLECTION = "Tripo"
GLB = os.path.join(os.path.dirname(__file__), "..", "..", "art", "ibiriki", "generated", "ibiriki-tripo-tpose.glb")

# Measured off the mesh's cross-sections (2026-10-03): the ball spans z
# 0.5-2.3 with its widest at z 1.4 (radius ~0.9); the T-pose arms leave it at
# y ±0.85 and reach y ±1.92 at z ~1.6; the helmet sits from z 2.0 and the
# horns top out at 3.0; the legs are short stubs at y ±0.45 below z 0.55.
BALL_CENTRE = Vector((0.0, 0.0, 1.4))
BALL_RADIUS = 0.92
NECK_Z = 2.02
CORE = (0.5, 2.3)

BONES = [
    ("root", (0, 0, 0), (0, 0, 0.3), None),
    ("hips", (0, 0, 0.55), (0, 0, 0.9), "root"),
    ("chest", (0, 0, 0.9), (0, 0, 1.95), "hips"),
    ("head", (0, 0, 2.0), (0, 0, 3.0), "chest"),
    ("upperarm.R", (0, -0.82, 1.62), (0, -1.32, 1.62), "chest"),
    ("forearm.R", (0, -1.32, 1.62), (0.02, -1.8, 1.6), "upperarm.R"),
    ("upperarm.L", (0, 0.82, 1.62), (0, 1.32, 1.62), "chest"),
    ("forearm.L", (0, 1.32, 1.62), (0.02, 1.8, 1.6), "upperarm.L"),
    ("thigh.R", (0.0, -0.42, 0.6), (0.0, -0.45, 0.32), "hips"),
    ("shin.R", (0.0, -0.45, 0.32), (0.0, -0.47, 0.12), "thigh.R"),
    ("foot.R", (0.0, -0.47, 0.12), (0.32, -0.47, 0.05), "shin.R"),
    ("thigh.L", (0.0, 0.42, 0.6), (0.0, 0.45, 0.32), "hips"),
    ("shin.L", (0.0, 0.45, 0.32), (0.0, 0.47, 0.12), "thigh.L"),
    ("foot.L", (0.0, 0.47, 0.12), (0.32, 0.47, 0.05), "shin.L"),
    ("cape", (-0.6, 0, 1.9), (-0.7, 0, 1.2), "chest"),
    ("pony", (-0.5, 0, 2.6), (-0.9, 0, 2.4), "head"),
    ("weapon", (0, 0, 1.0), (0.4, 0, 1.0), None),
    ("hand_ik.R", (0, 0, 1.0), (0.2, 0, 1.0), "weapon"),
    ("hand_ik.L", (0, 0, 1.0), (0.2, 0, 1.0), "weapon"),
]

# Ball-body arms hang out from the sides, not down a torso: dropped this far
# below the T-pose's horizontal they rest against the ball's flank.
ARM_DROP_DEG = 58


def import_tpose(path=GLB):
    """Import the T-pose GLB as `Ibiriki.tripo`, 3 m tall, feet at z 0, and
    turned so the face looks down +X (Tripo hands it over facing −X)."""
    r = jeffs_rig.import_glb(os.path.abspath(path), collection=COLLECTION, name=MESH)
    me = bpy.data.objects[MESH].data
    # import_glb's helmet-band test turns him the wrong way: checked by eye
    # against the painted face, he lands facing −X, so a half turn fixes it.
    me.transform(Matrix.Rotation(math.pi, 4, "Z"))
    me.update()
    return r


def rigidify_ball(mesh):
    """Everything inside the ball, face included, rides the chest alone; the
    helmet and the horns ride the head."""
    groups = {g.name: g for g in mesh.vertex_groups}
    chest = groups["chest"]
    head = groups["head"]
    for v in mesh.data.vertices:
        co = v.co
        inside = (co - BALL_CENTRE).length < BALL_RADIUS * 1.04 and abs(co.y) < 0.95
        if co.z > NECK_Z and abs(co.y) < 0.95:
            target = head
        elif inside and co.z > 0.55:
            target = chest
        else:
            continue
        for g in mesh.vertex_groups:
            g.remove([v.index])
        target.add([v.index], 1.0, "REPLACE")


def rig():
    anands_rig.CORE_HALF_W = 0.85
    arm = anands_rig.rig(
        BONES, tpose=False, mesh_name=MESH, collection=COLLECTION, neck_z=NECK_Z, core=CORE
    )
    mesh = bpy.data.objects[MESH]
    rigidify_ball(mesh)
    anands_rig.heal_weightless(mesh)
    arm.rotation_euler = (0, 0, 0)
    anands_rig.drop_arms(arm, mesh, ARM_DROP_DEG)
    import sprite_rig

    arm.rotation_euler = (0, 0, math.radians(sprite_rig.VIEW_YAW_DEG))
    return arm
