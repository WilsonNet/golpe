"""Rig Lia's generated mesh on the shared sprite skeleton.

Run in the live Blender with `art/lia/lia.blend` open (the Blender MCP does
this):

    import sys; sys.path.insert(0, "<repo>/scripts/blender")
    import generated_mesh, lia_rig
    generated_mesh.import_glb("<repo>/art/lia/generated/lia-tripo.glb", "Tripo", "Lia.tripo")
    lia_rig.rig()

The mesh is a Tripo generation the user made (2026-09-26,
`art/lia/generated/lia-tripo.glb`): a new look for Lia — purple hair, a red
scarf trailing off her left shoulder, a navy jacket, cream trousers, brown
boots, a sheathed sword across her back and a knife at her hip, all one
fused surface. The procedure is Anands' (`anands_rig.rig`, `tpose=True`);
only the joints are hers, measured from the mesh's cross-sections: arms
level at z 2.25 from the shoulder (y ±0.42) to the hand's end (±1.46), the
head from z 2.38, legs apart from z 1.1 down, boot centres at y ±0.3.

The procedural model she shipped with (`lia_build.py`) is kept in the hidden
`Lia.primitive` collection.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

import anands_rig  # noqa: E402

MESH = "Lia.tripo"
COLLECTION = "Tripo"
NECK_Z = 2.37
CORE = (1.3, 2.15)
ARM_DROP_DEG = 75
# The scarf's tail hangs beside her left arm in the T-pose; heat weighting
# hands it to the arm and it would swing with every sword stroke. Below the
# arms and out past the body, a vertex is scarf (or sheath), and rides the chest.
SCARF_Z = (0.65, 2.12)  # the tail ends at 0.77; below that, past 0.5, is boot sole
SCARF_OUT_Y = 0.5
# The sheathed sword across her back, hilt behind her right ear, tip at her
# left thigh (measured: the mesh's rearmost points by height). Heat weighting
# gave its tip to the thigh, and the run stretched it down to her foot.
SHEATH = ((-0.26, 0.6, 0.7), (-0.3, -0.45, 2.6))  # tip, mouth
SHEATH_R = 0.1
# The grip stands above the sheath's mouth, over her right shoulder — above
# the T-pose arm and outside the head, where heat weighting split it between
# the head and the arm, and dropping the arm bent it flat. In the T-pose,
# anything this high, this far out and not in front of her is the grip.
GRIP_ABOVE_Z = 2.4
GRIP_OUT_Y = 0.36

BONES = [
    ("root", (0, 0, 0), (0, 0, 0.3), None),
    ("hips", (0, 0, 1.05), (0, 0, 1.3), "root"),
    ("chest", (0, 0, 1.3), (0, 0, 2.33), "hips"),
    ("head", (0, 0, 2.38), (0, 0, 3.0), "chest"),
    ("upperarm.R", (0, -0.42, 2.25), (0, -0.8, 2.25), "chest"),
    ("forearm.R", (0, -0.8, 2.25), (0.02, -1.2, 2.25), "upperarm.R"),
    ("upperarm.L", (0, 0.42, 2.25), (0, 0.8, 2.25), "chest"),
    ("forearm.L", (0, 0.8, 2.25), (0.02, 1.2, 2.25), "upperarm.L"),
    ("thigh.R", (0.0, -0.2, 1.05), (0.01, -0.27, 0.58), "hips"),
    ("shin.R", (0.01, -0.27, 0.58), (0.0, -0.3, 0.18), "thigh.R"),
    ("foot.R", (0.0, -0.3, 0.18), (0.25, -0.3, 0.05), "shin.R"),
    ("thigh.L", (0.0, 0.2, 1.05), (0.01, 0.27, 0.58), "hips"),
    ("shin.L", (0.01, 0.27, 0.58), (0.0, 0.3, 0.18), "thigh.L"),
    ("foot.L", (0.0, 0.3, 0.18), (0.25, 0.3, 0.05), "shin.L"),
    ("cape", (-0.3, 0, 2.1), (-0.4, 0, 1.3), "chest"),
    ("pony", (-0.28, 0, 2.8), (-0.8, 0, 2.6), "head"),
    ("weapon", (0, 0, 1.0), (0.4, 0, 1.0), None),
    ("hand_ik.R", (0, 0, 1.0), (0.2, 0, 1.0), "weapon"),
    ("hand_ik.L", (0, 0, 1.0), (0.2, 0, 1.0), "weapon"),
]


def pin_scarf(mesh):
    """Give the scarf's tail (anything hanging out past the body below the
    T-pose arms) and the sheath on her back to the chest alone. Runs before
    the arms drop."""
    from mathutils import Vector
    from mathutils.geometry import intersect_point_line

    a, b = Vector(SHEATH[0]), Vector(SHEATH[1])
    groups = {g.name: g for g in mesh.vertex_groups}
    for v in mesh.data.vertices:
        p, t = intersect_point_line(v.co, a, b)
        on_sheath = (-0.05 <= t <= 1.25 and (p - v.co).length < SHEATH_R) or (
            v.co.z > GRIP_ABOVE_Z and abs(v.co.y) > GRIP_OUT_Y and v.co.x < 0.05
        )
        if on_sheath or (SCARF_Z[0] < v.co.z < SCARF_Z[1] and abs(v.co.y) > SCARF_OUT_Y):
            for g in groups.values():
                g.remove([v.index])
            groups["chest"].add([v.index], 1.0, "REPLACE")


def rig():
    return anands_rig.rig(
        BONES, tpose=True, mesh_name=MESH, collection=COLLECTION, neck_z=NECK_Z, core=CORE,
        arm_drop_deg=ARM_DROP_DEG, after_weights=pin_scarf,
    )
