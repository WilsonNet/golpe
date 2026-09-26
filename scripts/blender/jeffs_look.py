"""Give Jeffs' generated mesh Lia's look, in his boards' colours.

The same idea as `anands_look.py` — every face joins a colour family, each
family is a shared `LiaToon` material, the ink hull, smoothed normals — but
Jeffs is dressed almost entirely in near-black, and on his Tripo texture the
coat, the shirt, the trousers and the boots are all the same dark grey
(measured: 12 of the texture's 14 k-means clusters sit between luminance 20
and 65). The texture cannot tell them apart; the skeleton can:

- **The texture decides only what is not cloth**: skin (warm) and, on the
  head, grey hair (light) against black hair (dark) — the salt and pepper.
- **Geometry decides the clothes**: below the boot cuff is boot; a face that
  follows a leg bone and hugs its line is trouser (the coat's skirt follows
  the legs too, but hangs away from them); a dark face in the V between the
  lapels is the shirt; everything else is the coat.
- On the face, the dark marks (brows, eyes, the stubble line) take the ink
  family instead of black hair.

The back of the head is painted as hair whatever the texture says there: a
Janus-faced generation (a second face textured on the back of the skull —
Jeffs' first mesh had one) must never show it on a sprite that turns.

Run in the live Blender after `jeffs_rig.rig()`:

    import jeffs_look; jeffs_look.apply()
"""

import os
import sys

import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))

import anands_look  # noqa: E402
import sprite_rig  # noqa: E402

MESH = "Jeffs.tripo"

# name: (lit, shade, highlight), sRGB 0-255, from his boards
# (unprocessed-sprites/jeffs-actions.jpeg, jeffs-apose-v3.jpeg) — lifted a step
# off black so the coat does not melt into the ink line at sprite size, and
# the shades hue-shifted toward violet like every other hero's.
FAMILIES = {
    "j_skin": ((228, 172, 142), (178, 118, 102), (248, 204, 176)),
    "j_hair_grey": ((192, 194, 200), (128, 128, 142), (234, 236, 242)),
    "j_hair_black": ((62, 60, 68), (34, 32, 42), (100, 100, 112)),
    "j_brow": ((44, 34, 40), (44, 34, 40), (44, 34, 40)),
    "j_coat": ((86, 80, 78), (52, 48, 56), (118, 112, 110)),
    "j_shirt": ((40, 38, 46), (24, 22, 32), (70, 68, 80)),
    "j_trousers": ((64, 66, 76), (40, 40, 52), (92, 94, 106)),
    "j_boot": ((44, 42, 48), (24, 22, 30), (104, 102, 114)),
}
SHINY = {"j_hair_grey", "j_hair_black", "j_boot"}
PROTECT = ("j_brow",)

# How much of the generated surface's own normal survives in the capsule
# normal: enough to keep a lapel's edge, not enough for a fold to flip the
# shade band.
SURFACE_NORMAL_SHARE = 0.2

# Landmarks, measured on the A-pose mesh (rest pose, facing +X).
NECK_Z = 2.16
BOOT_Z = 0.24  # the boot cuff, under the coat's hem
LEG_BONES = ("thigh.R", "thigh.L", "shin.R", "shin.L")
TROUSER_R = 0.2  # a leg face this close to its bone line is trouser, not coat skirt
# The shirt's V between the lapels: narrow at the belt, open to the collar.
SHIRT_Z = (1.5, 2.12)
SHIRT_HALF_W = (0.05, 0.17)
BACK_OF_HEAD_NX = -0.2  # a head face turned this far toward -X is the back
FACE_Z = (2.3, 2.72)  # below the hairline: brows, eyes, stubble


def _lum(rgb):
    return rgb @ np.array([0.299, 0.587, 0.114])


def _face_colours(mesh):
    """Each face's texture colour (sRGB 0-255) at its UV centre, after a
    small majority smoothing in texture space (a mean, here: every family the
    texture decides is far apart in colour, so an average is safe)."""
    tex = anands_look._box_blur(anands_look._texture(mesh), 2) * 255
    me = mesh.data
    uv = me.uv_layers.active.data
    out = np.empty((len(me.polygons), 3))
    for p in me.polygons:
        u = sum(uv[i].uv[0] for i in p.loop_indices) / p.loop_total
        v = sum(uv[i].uv[1] for i in p.loop_indices) / p.loop_total
        x = min(1023, max(0, int(u % 1.0 * 1024)))
        y = min(1023, max(0, int(v % 1.0 * 1024)))
        out[p.index] = tex[y, x]
    return out


def _bone_weights(mesh, names):
    groups = {g.index: g.name for g in mesh.vertex_groups}
    w = np.zeros((len(mesh.data.vertices), len(names)), np.float32)
    col = {n: i for i, n in enumerate(names)}
    for v in mesh.data.vertices:
        for g in v.groups:
            n = groups.get(g.group)
            if n in col:
                w[v.index, col[n]] = g.weight
    return w


def _dist_to_segment(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
    return (a + ab * t - p).length


def _shirt_half_w(z):
    t = (z - SHIRT_Z[0]) / (SHIRT_Z[1] - SHIRT_Z[0])
    return SHIRT_HALF_W[0] + (SHIRT_HALF_W[1] - SHIRT_HALF_W[0]) * t


def classify(mesh):
    names = list(FAMILIES)
    idx = {n: i for i, n in enumerate(names)}
    rgb = _face_colours(mesh)
    lum = _lum(rgb)
    warm = (rgb[:, 0] - rgb[:, 2] > 28) & (rgb[:, 0] > 95)
    bones = ["head", *LEG_BONES, "forearm.R", "forearm.L"]
    w = _bone_weights(mesh, bones)
    arm = bpy.data.objects[sprite_rig.RIG_NAME].data
    legs = {n: (arm.bones[n].head_local, arm.bones[n].tail_local) for n in LEG_BONES}
    me = mesh.data
    fam = np.empty(len(me.polygons), np.int64)
    for p in me.polygons:
        i = p.index
        c = p.center
        vw = w[list(p.vertices)].mean(0)
        head = vw[0] > 0.5 or c.z > NECK_Z
        if head and c.x < 0 and p.normal.x < BACK_OF_HEAD_NX:
            fam[i] = idx["j_hair_grey"] if lum[i] > 95 and not warm[i] else idx["j_hair_black"]
        elif warm[i] and (head or c.z > NECK_Z - 0.12 or vw[5:].sum() > 0.6):
            # Skin is his face, his neck and his hands; a warm fleck on the
            # coat is the texture's noise.
            fam[i] = idx["j_skin"]
        elif head:
            on_face = FACE_Z[0] < c.z < FACE_Z[1] and p.normal.x > 0.3 and c.x > 0.05
            if on_face and lum[i] < 70:
                fam[i] = idx["j_brow"]
            else:
                fam[i] = idx["j_hair_grey"] if lum[i] > 95 else idx["j_hair_black"]
        elif c.z < BOOT_Z:
            fam[i] = idx["j_boot"]
        elif vw[1:5].sum() > 0.5 and c.z < 1.0 and min(_dist_to_segment(c, *legs[n]) for n in LEG_BONES) < TROUSER_R:
            fam[i] = idx["j_trousers"]
        elif SHIRT_Z[0] < c.z < SHIRT_Z[1] and c.x > 0.05 and p.normal.x > 0.3 and abs(c.y) < _shirt_half_w(c.z):
            fam[i] = idx["j_shirt"]
        else:
            fam[i] = idx["j_coat"]
    return names, fam


def capsule_normals(mesh):
    """Shade him like Lia's primitives: every vertex's normal points away
    from its bones' axis lines (weight-blended), so the shade band runs down
    the far side of each limb and of the coat, as a tube's would.

    Anands' smoothed-copy normals (`anands_look.smooth_normals`) were tried
    first, at 40 and at 160 passes, and changed nothing measurable: the
    coat's generated folds are broad geometry, not noise, and a smoothed
    fold is still a fold — the shade band broke into horizontal stripes down
    the whole coat (55% of it shade). A bone's axis has no folds."""
    for m in [m for m in mesh.modifiers if m.type == "DATA_TRANSFER"]:
        mesh.modifiers.remove(m)
    old = bpy.data.objects.get(f"{mesh.name}.normals")
    if old:
        bpy.data.objects.remove(old, do_unlink=True)
    arm = bpy.data.objects[sprite_rig.RIG_NAME].data
    groups = {g.index: g.name for g in mesh.vertex_groups}
    segs = {b.name: (b.head_local, b.tail_local) for b in arm.bones if b.name in groups.values()}
    me = mesh.data
    normals = []
    for v in me.vertices:
        n = v.normal * SURFACE_NORMAL_SHARE
        for g in v.groups:
            seg = segs.get(groups.get(g.group))
            if seg is None or g.weight <= 0:
                continue
            a, b = seg
            ab = b - a
            t = max(0.0, min(1.0, (v.co - a).dot(ab) / ab.length_squared))
            d = v.co - (a + ab * t)
            if d.length > 1e-6:
                n = n + d.normalized() * g.weight
        normals.append(n.normalized() if n.length > 1e-6 else v.normal.copy())
    me.normals_split_custom_set_from_vertices(normals)
    me.update()


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
    capsule_normals(mesh)
    return {names[i]: int((fam == i).sum()) for i in range(len(names))}
