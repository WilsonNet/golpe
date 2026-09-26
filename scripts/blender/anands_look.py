"""Give Anands' generated mesh Lia's look, in her boards' colours.

A Tripo mesh arrives with one blurry texture carrying baked, soft shading;
rendered at sprite size it averages into mud, and it has none of the SNES
reading the toon heroes get for free — a flat fill per part, a shade band
along the edge away from the light, a highlight on what shines, an ink line
where parts overlap. This turns the texture into that:

1. Every face samples the texture at its UV centre and joins the nearest of
   her **colour families** (skin, hair, lens, scarf, shirt, ...), each with the
   lit / shade / highlight colours of her boards.
2. Isolated faces (a family none of their neighbours share) take their
   neighbours' — the texture's noise, not a detail.
3. Each family is a shared `LiaToon` material (`sprite_rig.toon_material`),
   so an artist recolours her the way they recolour Lia: select a part, change
   Lit / Shade / Highlight on its node.
4. The ink hull (`sprite_rig.add_outline`) draws the lines between parts that
   overlap on screen — the arm over the body, the scarf over the shirt.

Run in the live Blender:

    import anands_look; anands_look.apply("Anands.tripo")
"""

import os
import sys

import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))

import sprite_rig  # noqa: E402

# name: (lit, shade, highlight), sRGB 0-255, measured off her boards.
FAMILIES = {
    "a_skin": ((250, 188, 146), (214, 136, 112), (255, 214, 180)),
    "a_hair": ((152, 86, 164), (92, 42, 102), (196, 136, 206)),
    "a_lens": ((124, 216, 204), (58, 150, 152), (226, 252, 244)),
    "a_goggle": ((168, 104, 56), (108, 58, 32), (206, 150, 96)),
    "a_brass": ((216, 162, 74), (150, 96, 40), (250, 214, 140)),
    "a_scarf": ((232, 112, 40), (170, 62, 26), (252, 168, 96)),
    "a_shirt": ((100, 164, 44), (56, 106, 22), (150, 206, 90)),
    "a_trousers": ((98, 80, 54), (58, 44, 30), (130, 110, 80)),
    "a_leather": ((154, 94, 46), (98, 54, 26), (190, 132, 78)),
    "a_boot": ((152, 84, 152), (92, 44, 98), (196, 132, 196)),
    "a_buckle": ((228, 216, 198), (170, 150, 142), (255, 250, 240)),
    "a_eye": ((40, 24, 46), (40, 24, 46), (40, 24, 46)),
}
SHINY = {"a_hair", "a_lens", "a_brass", "a_buckle"}


def _texture(mesh):
    """Her base-colour texture as a (h, w, 3) sRGB array, downsized to 1K
    (each face samples it once; 4K would only be slower). The generator
    ships base colour, normal and roughness maps: only the base colour is
    her colours. `pixels` of an 8-bit image are the stored sRGB values."""
    # The mesh's own material names its texture (remembered on the mesh, since
    # `apply` replaces that material); fall back to any base colour.
    src = bpy.data.images.get(mesh.get("base_texture", ""))
    for mat in mesh.data.materials:
        for n in (mat.node_tree.nodes if mat and mat.node_tree else []):
            if not src and n.type == "TEX_IMAGE" and n.image and "basecolor" in n.image.name.lower():
                src = n.image
    src = src or next((i for i in bpy.data.images if "basecolor" in i.name.lower()), None)
    if src is None:
        raise RuntimeError(f"{mesh.name}: no base-colour texture to sample")
    mesh["base_texture"] = src.name
    src.use_fake_user = True  # keep it after the material that used it is gone
    img = src.copy()
    img.scale(1024, 1024)
    px = np.empty(1024 * 1024 * 4, np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    return px.reshape(1024, 1024, 4)[..., :3]


# The texture's stripes and seams are soft, and its lighting varies across a
# fill; sampled raw, neighbouring faces flicker between two families along
# every stripe (camouflage at sprite size). Every texel is classified first,
# then each takes the majority family of its neighbourhood — a vote, never an
# average: averaging green and orange makes brown, a family of its own.
VOTE_PX = 6


def _box_blur(a, r):
    """Separable box blur of radius r (numpy only: Blender ships no scipy)."""
    for axis in (0, 1):
        c = np.cumsum(np.pad(a, [(r + 1, r) if i == axis else (0, 0) for i in range(3)], mode="edge"), axis=axis)
        hi = np.take(c, range(2 * r + 1, c.shape[axis]), axis=axis)
        lo = np.take(c, range(0, c.shape[axis] - 2 * r - 1), axis=axis)
        a = (hi - lo) / (2 * r + 1)
    return a


def _nearest_family(rgb):
    """(..., 3) sRGB 0-255 -> index of the nearest family (lit or shade)."""
    names = list(FAMILIES)
    refs, owner = [], []
    for i, k in enumerate(names):
        lit, shade, _hi = FAMILIES[k]
        refs += [lit, shade]
        owner += [i, i]
    refs = np.array(refs, float)
    flat = rgb.reshape(-1, 3).astype(float)
    best = np.full(len(flat), np.inf)
    arg = np.zeros(len(flat), np.int64)
    for j, r in enumerate(refs):  # one ref at a time: 1M texels x 24 refs
        rm = (flat[:, 0] + r[0]) / 2
        d = (2 + rm / 256) * (flat[:, 0] - r[0]) ** 2 + 4 * (flat[:, 1] - r[1]) ** 2 + (2 + (255 - rm) / 256) * (flat[:, 2] - r[2]) ** 2
        better = d < best
        best[better] = d[better]
        arg[better] = owner[j]
    return arg.reshape(rgb.shape[:-1])


def _vote(labels, k, r):
    """Mode filter: each texel takes the family most common within r."""
    counts = np.stack([_box_blur((labels == i).astype(np.float32)[..., None], r)[..., 0] for i in range(k)])
    return counts.argmax(0)


def classify(mesh):
    """One family per face: the voted texture family at the face's UV centre."""
    names = list(FAMILIES)
    labels = _vote(_nearest_family(_texture(mesh) * 255), len(names), VOTE_PX)
    me = mesh.data
    uv = me.uv_layers.active.data
    fam = np.empty(len(me.polygons), np.int64)
    for p in me.polygons:
        u = sum(uv[i].uv[0] for i in p.loop_indices) / p.loop_total
        v = sum(uv[i].uv[1] for i in p.loop_indices) / p.loop_total
        x = min(1023, max(0, int(u % 1.0 * 1024)))
        y = min(1023, max(0, int(v % 1.0 * 1024)))
        fam[p.index] = labels[y, x]
    return names, fam


# Small, deliberate features: never overwritten by the majority, never spread.
PROTECT = ("a_eye", "a_lens", "a_buckle")


def despeckle(mesh, fam, names, passes=6, share=0.6):
    """Big flat regions, like the toon heroes' parts: a face whose edge
    neighbours mostly (`share`) agree on another family joins it. The
    texture's lighting scatters small patches of the neighbouring browns and
    greens across every part; this is what reads as camouflage at sprite
    size. The eyes, lenses and buckle are small on purpose and are kept."""
    me = mesh.data
    edge_faces = {}
    for p in me.polygons:
        for ek in p.edge_keys:
            edge_faces.setdefault(ek, []).append(p.index)
    nbrs = [[] for _ in me.polygons]
    for faces in edge_faces.values():
        for a in faces:
            for b in faces:
                if a != b:
                    nbrs[a].append(b)
    keep = {names.index(k) for k in PROTECT}
    for _ in range(passes):
        new = fam.copy()
        for i, ns in enumerate(nbrs):
            if not ns or fam[i] in keep:
                continue
            vals, cnt = np.unique(fam[ns], return_counts=True)
            top = vals[cnt.argmax()]
            if top != fam[i] and top not in keep and cnt.max() >= share * len(ns):
                new[i] = top
        if (new == fam).all():
            break
        fam = new
    return fam


LEG_BONES = ("thigh.R", "thigh.L", "shin.R", "shin.L")


def trousers_by_bone(mesh, names, fam):
    """Her trousers and the leather of her pack, belt and gloves are close
    browns, and the texture's lighting pushes the trousers into the leather.
    The skeleton knows better: a leather-coloured face that mostly follows a
    thigh or a shin is trousers (the pouches ride the hips, the gloves the
    forearms)."""
    groups = {g.index: g.name for g in mesh.vertex_groups}
    if not any(n in groups.values() for n in LEG_BONES):
        return fam
    verts = mesh.data.vertices
    leg = np.zeros(len(verts), np.float32)
    for v in verts:
        w = {groups.get(g.group): g.weight for g in v.groups}
        leg[v.index] = sum(w.get(n, 0.0) for n in LEG_BONES)
    browns = {names.index(k) for k in ("a_leather", "a_goggle", "a_brass")}
    t = names.index("a_trousers")
    for p in mesh.data.polygons:
        if fam[p.index] in browns and np.mean([leg[i] for i in p.vertices]) > 0.5:
            fam[p.index] = t
    return fam


def purple_by_bone(mesh, names, fam):
    """Her hair and her boots are the same purple. On the head it is hair;
    anywhere else it is boot."""
    groups = {g.index: g.name for g in mesh.vertex_groups}
    if "head" not in groups.values():
        return fam
    head = np.zeros(len(mesh.data.vertices), np.float32)
    for v in mesh.data.vertices:
        head[v.index] = sum(g.weight for g in v.groups if groups.get(g.group) == "head")
    hair, boot = names.index("a_hair"), names.index("a_boot")
    for p in mesh.data.polygons:
        if fam[p.index] in (hair, boot):
            fam[p.index] = hair if np.mean([head[i] for i in p.vertices]) > 0.5 else boot
    return fam


GOGGLE_LINE_Z = 2.45  # rest height: teal above is lens, below is her eyes


def eyes_below_goggles(mesh, names, fam):
    """Her irises and her goggle lenses are the same teal; the board draws her
    eyes dark. Teal below the goggles is eye."""
    lens, eye = names.index("a_lens"), names.index("a_eye")
    for p in mesh.data.polygons:
        if fam[p.index] == lens and p.center.z < GOGGLE_LINE_Z:
            fam[p.index] = eye
    return fam


SMOOTH_REPEAT = 40


def smooth_normals(mesh):
    """Shade the generated surface as if it were smooth.

    The toon shader draws its shade band where the normal turns away from the
    light; on a generated mesh every small bump in the surface flips a patch
    of it, and at sprite size that reads as mottling. Lia is built from smooth
    primitives and has none. A heavily smoothed copy of the mesh (hidden, never
    rendered) lends its normals to the real one — the silhouette stays exactly
    the generated one, only the shading reads as broad forms. The transfer runs
    before the armature, at rest, and the armature carries the normals along."""
    name = f"{mesh.name}.normals"
    old = bpy.data.objects.get(name)
    if old:
        bpy.data.objects.remove(old, do_unlink=True)
    src = bpy.data.objects.new(name, mesh.data.copy())
    for c in mesh.users_collection:
        c.objects.link(src)
    src.vertex_groups.clear()
    src.hide_render = True
    src.hide_viewport = True
    md = src.modifiers.new("Smooth", "SMOOTH")
    md.factor = 1.0
    md.iterations = SMOOTH_REPEAT
    deps = bpy.context.evaluated_depsgraph_get()
    baked = bpy.data.meshes.new_from_object(src.evaluated_get(deps))
    src.modifiers.clear()
    old_data = src.data
    src.data = baked
    bpy.data.meshes.remove(old_data)
    for m in [m for m in mesh.modifiers if m.type == "DATA_TRANSFER"]:
        mesh.modifiers.remove(m)
    dt = mesh.modifiers.new("SmoothNormals", "DATA_TRANSFER")
    dt.object = src
    dt.use_loop_data = True
    dt.data_types_loops = {"CUSTOM_NORMAL"}
    dt.loop_mapping = "POLYINTERP_NEAREST"
    bpy.context.view_layer.objects.active = mesh
    while mesh.modifiers.find("SmoothNormals") > 0:
        bpy.ops.object.modifier_move_up(modifier="SmoothNormals")


def apply(mesh_name):
    mesh = bpy.data.objects[mesh_name]
    names, fam = classify(mesh)
    fam = eyes_below_goggles(mesh, names, fam)
    fam = trousers_by_bone(mesh, names, fam)
    fam = purple_by_bone(mesh, names, fam)
    fam = despeckle(mesh, fam, names)
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
    sprite_rig.add_outline(mesh)  # appends the ink material after the families
    smooth_normals(mesh)
    counts = {names[i]: int((fam == i).sum()) for i in range(len(names))}
    return counts
