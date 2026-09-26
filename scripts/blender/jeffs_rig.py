"""Rig Jeffs' generated mesh on the shared sprite skeleton.

Run in the live Blender with `art/jeffs/jeffs.blend` open (the Blender MCP
does this):

    import sys; sys.path.insert(0, "<repo>/scripts/blender")
    import importlib, jeffs_rig; importlib.reload(jeffs_rig); jeffs_rig.rig()

The mesh is a Tripo multi-view generation from his Gemini A-pose turnaround
(`unprocessed-sprites/jeffs-apose-v3.jpeg`, cut by `scripts/cut-turnaround.py
--prefix=apose --mirror-side` → `art/jeffs/generated/jeffs-tripo-apose.glb`),
brought in by `import_glb()` as `Jeffs.tripo`: 3 m tall, feet at z 0, facing
+X, merged by distance. The procedure is Anands' (`anands_rig.rig` with
`tpose=True`): heat weights with the arms away from the body, then the arms
are dropped and that pose becomes the rest pose. Only the joints are his.

His proportions are his board's: a head 27% of his height (z 2.18–3.0),
broad shoulders, thick arms in an A-pose (~49° below horizontal, hands at
z ~1.0), a trench coat to the boot cuffs (z ~0.35) with a wide stance under
it (boot centres at y ±0.3). Measured from the mesh's cross-sections
(2026-09-26).
"""

import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

import anands_rig  # noqa: E402

MESH = "Jeffs.tripo"
COLLECTION = "Tripo"
NECK_Z = 2.16
# The torso core that never follows an arm: between the hips and the armpit.
CORE = (1.2, 1.95)
# The A-pose arms hang ~49 degrees below horizontal; this much more brings
# them down the coat's sides.
ARM_DROP_DEG = 25

BONES = [
    ("root", (0, 0, 0), (0, 0, 0.3), None),
    ("hips", (0, 0, 0.95), (0, 0, 1.2), "root"),
    ("chest", (0, 0, 1.2), (0, 0, 2.12), "hips"),
    ("head", (0, 0, 2.18), (0, 0, 3.0), "chest"),
    ("upperarm.R", (-0.08, -0.42, 2.02), (-0.1, -0.78, 1.6), "chest"),
    ("forearm.R", (-0.1, -0.78, 1.6), (0.0, -1.06, 1.18), "upperarm.R"),
    ("upperarm.L", (-0.08, 0.42, 2.02), (-0.1, 0.78, 1.6), "chest"),
    ("forearm.L", (-0.1, 0.78, 1.6), (0.0, 1.06, 1.18), "upperarm.L"),
    ("thigh.R", (0.0, -0.22, 0.95), (0.0, -0.28, 0.5), "hips"),
    ("shin.R", (0.0, -0.28, 0.5), (0.0, -0.3, 0.16), "thigh.R"),
    ("foot.R", (0.0, -0.3, 0.16), (0.22, -0.3, 0.05), "shin.R"),
    ("thigh.L", (0.0, 0.22, 0.95), (0.0, 0.28, 0.5), "hips"),
    ("shin.L", (0.0, 0.28, 0.5), (0.0, 0.3, 0.16), "thigh.L"),
    ("foot.L", (0.0, 0.3, 0.16), (0.22, 0.3, 0.05), "shin.L"),
    # The coat is one skinned surface; nothing is weighted to these, they
    # are kept for the shared poses.
    ("cape", (-0.3, 0, 1.9), (-0.4, 0, 1.0), "chest"),
    ("pony", (-0.28, 0, 2.8), (-0.8, 0, 2.6), "head"),
    ("weapon", (0, 0, 1.0), (0.4, 0, 1.0), None),
    ("hand_ik.R", (0, 0, 1.0), (0.2, 0, 1.0), "weapon"),
    ("hand_ik.L", (0, 0, 1.0), (0.2, 0, 1.0), "weapon"),
]


def import_glb(path, collection=COLLECTION, name=MESH):
    """Bring a Tripo GLB in as `name`: transforms baked, 3 m tall, feet at
    z 0, centred, facing +X, UV-seam splits merged (heat weighting fails on
    them). The front is measured, never assumed (the importer's facing
    differs run to run): the arms span the lateral axis, and of the other
    axis's two sides the front is the one the nose sticks out of. (Boot toes
    were tried first and fooled by a wide stance.)"""
    import math

    import bmesh
    import bpy
    from mathutils import Matrix

    bpy.context.view_layer.active_layer_collection = bpy.context.view_layer.layer_collection.children[collection]
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    ob = next(o for o in new if o.type == "MESH")
    mw = ob.matrix_world.copy()
    ob.parent = None
    ob.matrix_world = mw
    for o in new:
        if o is not ob:
            bpy.data.objects.remove(o, do_unlink=True)
    ob.name = ob.data.name = name
    me = ob.data
    me.transform(ob.matrix_world)
    ob.matrix_world = Matrix.Identity(4)
    vs = [v.co for v in me.vertices]
    lo = [min(v[i] for v in vs) for i in range(3)]
    hi = [max(v[i] for v in vs) for i in range(3)]
    k = 3.0 / (hi[2] - lo[2])
    me.transform(Matrix.Scale(k, 4) @ Matrix.Translation((-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -lo[2])))
    co = [v.co for v in me.vertices]
    wide_x = (max(v.x for v in co) - min(v.x for v in co)) > (max(v.y for v in co) - min(v.y for v in co))
    face = [v for v in co if 0.74 * 3.0 < v.z < 0.87 * 3.0]
    if wide_x:
        reach = {"+Y": max(v.y for v in face), "-Y": -min(v.y for v in face)}
    else:
        reach = {"+X": max(v.x for v in face), "-X": -min(v.x for v in face)}
    front = max(reach, key=reach.get)
    turn = {"+X": 0, "+Y": -90, "-X": 180, "-Y": 90}[front]
    me.transform(Matrix.Rotation(math.radians(turn), 4, "Z"))
    bm = bmesh.new()
    bm.from_mesh(me)
    n0 = len(bm.verts)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0005)
    bm.to_mesh(me)
    bm.free()
    me.update()
    return {"front_was": front, "reach": reach, "verts": (n0, len(me.vertices))}


def rig():
    return anands_rig.rig(
        BONES, tpose=True, mesh_name=MESH, collection=COLLECTION, neck_z=NECK_Z, core=CORE, arm_drop_deg=ARM_DROP_DEG
    )
