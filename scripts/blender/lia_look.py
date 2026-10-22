"""Give Lia's generated mesh the toon look, in her texture's colours.

Her Tripo texture is colourful, so — unlike Jeffs' near-black one — the
texture decides the parts, the way it did for Anands (`anands_look.classify`
with her families: every texel voted into the nearest family, one family per
face). Then two corrections the texture cannot make, and the shading:

- **Purple is hair on the head, jacket anywhere else.** Her hair and her navy
  jacket sit close in colour; the skeleton knows which is which.
- **Dark on the face is eyes.** Her gloves, socks and sheath are the same
  near-black as her eyes; on the head, below the hairline and facing
  forward, it is eye.
- **Bone-capsule normals** (`jeffs_look.capsule_normals`): the shade band
  runs down the far side of each limb like a primitive's, not across every
  generated fold.

The families are her texture's k-means clusters (2026-09-26), lifted brighter
and more saturated so she reads at 96 px — the shades hue-shifted toward
violet like every hero's.

Run in the live Blender after `lia_rig.rig()`:

    import lia_look; lia_look.apply()
"""

import os
import sys

import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))

import anands_look  # noqa: E402
import jeffs_look  # noqa: E402
import sprite_rig  # noqa: E402

MESH = "Lia.tripo"

# name: (lit, shade, highlight), sRGB 0-255.
FAMILIES = {
    "l_skin": ((236, 170, 128), (190, 118, 96), (250, 204, 168)),
    "l_hair": ((120, 78, 150), (74, 46, 102), (168, 124, 196)),
    "l_scarf": ((196, 48, 70), (132, 28, 58), (236, 96, 104)),
    "l_jacket": ((66, 60, 98), (40, 34, 66), (96, 92, 136)),
    "l_trousers": ((214, 196, 170), (160, 140, 132), (238, 226, 204)),
    "l_leather": ((140, 86, 62), (92, 52, 48), (184, 124, 90)),
    "l_dark": ((52, 44, 56), (30, 24, 36), (84, 76, 92)),
    "l_metal": ((150, 146, 156), (96, 90, 108), (210, 206, 216)),
    "l_eye": ((30, 20, 34), (30, 20, 34), (30, 20, 34)),
}
# What the texture is matched against: its own measured clusters, each
# pointing at the family it belongs to (the families above are brightened,
# and matching the texture to brightened colours would mis-sort it).
TEXTURE_CLUSTERS = {
    "l_skin": ((211, 142, 98), (179, 106, 71)),
    "l_hair": ((83, 49, 95), (60, 41, 73)),
    "l_scarf": ((121, 33, 57), (104, 27, 48)),
    "l_jacket": ((48, 40, 54), (64, 57, 62)),
    "l_trousers": ((172, 151, 134), (153, 134, 120)),
    "l_leather": ((99, 62, 55), (79, 48, 49)),
    "l_dark": ((39, 31, 37), (23, 19, 23)),
    "l_metal": ((119, 103, 105), (91, 79, 83)),
    "l_eye": ((12, 8, 14), (12, 8, 14)),
}
SHINY = {"l_hair", "l_metal", "l_leather"}
PROTECT = ("l_eye", "l_metal")

NECK_Z = 2.37
FACE_Z = (2.45, 2.75)  # below the hairline: eyes


def classify(mesh):
    clusters = {k: (lit, shade, lit) for k, (lit, shade) in TEXTURE_CLUSTERS.items()}
    names, fam = anands_look.classify(mesh, clusters)
    idx = {n: i for i, n in enumerate(names)}
    groups = {g.index: g.name for g in mesh.vertex_groups}
    head = np.zeros(len(mesh.data.vertices), np.float32)
    for v in mesh.data.vertices:
        head[v.index] = sum(g.weight for g in v.groups if groups.get(g.group) == "head")
    for p in mesh.data.polygons:
        on_head = head[list(p.vertices)].mean() > 0.5 or p.center.z > NECK_Z
        f = fam[p.index]
        if f in (idx["l_hair"], idx["l_jacket"]):
            fam[p.index] = idx["l_hair"] if on_head else idx["l_jacket"]
        elif f == idx["l_dark"] and on_head:
            front = FACE_Z[0] < p.center.z < FACE_Z[1] and p.normal.x > 0.3 and p.center.x > 0.05
            fam[p.index] = idx["l_eye"] if front else idx["l_hair"]
    return names, fam


def apply(mesh_name=MESH):
    mesh = bpy.data.objects[mesh_name]
    names, fam = classify(mesh)
    fam = anands_look.despeckle(mesh, fam, names, protect=PROTECT)
    for k, (lit, shade, hi) in FAMILIES.items():
        sprite_rig.PALETTE[k] = tuple(tuple(c / 255 for c in col) for col in (lit, shade, hi))
    sprite_rig.SHINY.update(SHINY)
    me = mesh.data
    me.materials.clear()
    for k in names:
        old = bpy.data.materials.get(k)
        if old:
            bpy.data.materials.remove(old)
        me.materials.append(sprite_rig.toon_material(k))
    me.polygons.foreach_set("material_index", fam.astype(np.int32))
    me.update()
    old = mesh.modifiers.get("Outline")
    if old:
        mesh.modifiers.remove(old)
    sprite_rig.add_outline(mesh)
    jeffs_look.capsule_normals(mesh)
    return {names[i]: int((fam == i).sum()) for i in range(len(names))}
