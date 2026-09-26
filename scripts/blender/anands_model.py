"""Anands' game mesh — the starting point an artist refines in Blender.

Run inside a live Blender (the Blender MCP does this, or the Text Editor):

    import sys; sys.path.insert(0, "<repo>/scripts/blender")
    import importlib, anands_model; importlib.reload(anands_model); anands_model.build()

It (re)creates the `Anands` collection in the open file, fitted to the
turnaround blueprints in the `Reference` collection (her board's "Idle Stance
(Full 360)" row, `art/anands/reference/`). After the first hand edit the
.blend — `art/anands/anands.blend` — is the source of truth, not this script:
`build()` refuses to replace a collection that has been touched unless called
with `force=True`.

Conventions (the game's sprite contract — see art/README.md):

- 1 m = 32 sprite px; she stands 3 m tall, feet at z = 0.
- She faces +X. Her right side is -Y (the rig's `upperarm.R` is at y = -0.33).
- Every part is its own object, named for what it is, with low-poly quads and
  a live Subdivision modifier (and a Mirror across Y for the symmetric ones),
  so reshaping is moving a handful of vertices.
- Materials are flat colours sampled from her boards; one material per colour
  family, named for it (`skin`, `hair`, `shirt`, ...). The render style (the
  unlit/toon pass and the palette snap) is applied later and reads these.
"""

import math

import bmesh
import bpy
from mathutils import Matrix, Vector

COLLECTION = "Anands"

# Her colours, sampled from the boards (sRGB 0-255): (lit, shade).
PALETTE = {
    "skin": ((250, 186, 140), (214, 138, 110)),
    "hair": ((150, 84, 160), (92, 40, 98)),
    "goggle_leather": ((170, 104, 58), (110, 58, 30)),
    "goggle_brass": ((214, 160, 72), (150, 96, 40)),
    "lens": ((120, 214, 200), (60, 150, 150)),
    "scarf": ((222, 96, 32), (160, 58, 20)),
    "shirt": ((96, 162, 40), (56, 108, 20)),
    "stripe": ((214, 110, 40), (150, 66, 22)),
    "sleeve": ((206, 120, 50), (140, 72, 28)),
    "glove": ((190, 116, 58), (124, 64, 30)),
    "leather": ((138, 84, 40), (84, 46, 22)),
    "buckle": ((226, 214, 196), (170, 150, 140)),
    "trousers": ((84, 70, 48), (50, 40, 28)),
    "boot": ((150, 84, 150), (86, 40, 90)),
    "boot_sole": ((70, 36, 60), (40, 18, 36)),
    "eye": ((34, 20, 40), (34, 20, 40)),
    "eye_shine": ((255, 255, 255), (255, 255, 255)),
    "mouth": ((150, 70, 60), (150, 70, 60)),
}


def srgb(c):
    return tuple(((x / 255 + 0.055) / 1.055) ** 2.4 if x / 255 > 0.04045 else x / 255 / 12.92 for x in c)


def material(name):
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    lit, shade = PALETTE[name]
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (*srgb(lit), 1)
    bsdf.inputs["Roughness"].default_value = 1.0
    mat.diffuse_color = (*srgb(lit), 1)
    # The shade colour rides along for the render pass (and the artist).
    mat["shade"] = srgb(shade)
    return mat


# ---------------------------------------------------------------- geometry
class Mesh:
    """A low-poly part built in bmesh, one material index per colour."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.mats = []

    def _mat(self, name):
        if name not in self.mats:
            self.mats.append(name)
        return self.mats.index(name)

    def _tag(self, geom_faces, mat):
        i = self._mat(mat)
        for f in geom_faces:
            f.material_index = i

    def blob(self, centre, radii, mat, rot=(0, 0, 0), u=8, v=6):
        """A low-poly ellipsoid cage (subdivides into a smooth form)."""
        m = (
            Matrix.Translation(Vector(centre))
            @ _euler(rot)
            @ Matrix.Diagonal((*radii, 1))
        )
        r = bmesh.ops.create_uvsphere(self.bm, u_segments=u, v_segments=v, radius=1.0, matrix=m)
        self._tag({f for vv in r["verts"] for f in vv.link_faces}, mat)
        return r["verts"]

    def box(self, centre, size, mat, rot=(0, 0, 0)):
        m = Matrix.Translation(Vector(centre)) @ _euler(rot) @ Matrix.Diagonal((*size, 1))
        r = bmesh.ops.create_cube(self.bm, size=1.0, matrix=m)
        self._tag({f for vv in r["verts"] for f in vv.link_faces}, mat)
        return r["verts"]

    def loft(self, rings, mat, sides=8, cap=(True, True), mats=None):
        """A tube through `rings` = [(centre, (ry, rx)), ...] stacked along a
        path; each ring an ellipse in the plane across the path. `mats`, if
        given, names the material of each segment (len(rings) - 1)."""
        pts = [Vector(c) for c, _ in rings]
        verts = []
        for i, (c, (ry, rx)) in enumerate(rings):
            t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
            side = t.cross(Vector((1, 0, 0)))
            if side.length < 1e-3:
                side = t.cross(Vector((0, 1, 0)))
            side.normalize()
            fwd = side.cross(t).normalized()
            ring = []
            for k in range(sides):
                a = 2 * math.pi * k / sides
                ring.append(self.bm.verts.new(Vector(c) + side * math.cos(a) * ry + fwd * math.sin(a) * rx))
            verts.append(ring)
        for i in range(len(verts) - 1):
            seg_mat = mats[i] if mats else mat
            fs = []
            for k in range(sides):
                a, b = verts[i][k], verts[i][(k + 1) % sides]
                c, d = verts[i + 1][(k + 1) % sides], verts[i + 1][k]
                fs.append(self.bm.faces.new((a, b, c, d)))
            self._tag(fs, seg_mat)
        if cap[0]:
            self._tag([self.bm.faces.new(list(reversed(verts[0])))], mat)
        if cap[-1]:
            self._tag([self.bm.faces.new(verts[-1])], mat)

    def build(self, col, subsurf=2, mirror=False, smooth=True, bevel=0.0, solidify=0.0):
        me = bpy.data.meshes.new(self.name)
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)
        self.bm.to_mesh(me)
        self.bm.free()
        for n in self.mats:
            me.materials.append(material(n))
        ob = bpy.data.objects.new(self.name, me)
        col.objects.link(ob)
        if smooth:
            me.shade_smooth()
        if mirror:
            md = ob.modifiers.new("Mirror", "MIRROR")
            md.use_axis = (False, True, False)
            md.use_clip = True
        if solidify:
            md = ob.modifiers.new("Thickness", "SOLIDIFY")
            md.thickness = solidify
            md.offset = -1.0
        if bevel:
            # Hard-surface parts (the pack, pouches, buckle, soles) keep their
            # corners: a bevel, not a subdivision that rounds them to pebbles.
            md = ob.modifiers.new("Bevel", "BEVEL")
            md.width = bevel
            md.segments = 2
            md.limit_method = "ANGLE"
        if subsurf:
            md = ob.modifiers.new("Subdivision", "SUBSURF")
            md.levels = subsurf
            md.render_levels = subsurf
        return ob


def _euler(rot):
    from mathutils import Euler

    return Euler([math.radians(a) for a in rot]).to_matrix().to_4x4()


# ---------------------------------------------------------------- the model
def build_head(col):
    # The face: a big chibi head, a little wider than deep, chin at z 1.97.
    head = Mesh("Head")
    head.blob((0.02, 0, 2.3), (0.40, 0.44, 0.40), "skin", u=10, v=8)
    head.build(col)

    ears = Mesh("Ears")
    ears.blob((-0.02, 0.44, 2.2), (0.06, 0.05, 0.1), "skin", u=6, v=4)
    ears.build(col, mirror=True)

    # Big SNES eyes on the face plane: dark ovals with one hard shine.
    face = Mesh("Eyes")
    for s in (1,):
        face.blob((0.39, s * 0.15, 2.25), (0.03, 0.065, 0.1), "eye", u=8, v=6)
        face.blob((0.415, s * 0.13, 2.29), (0.01, 0.022, 0.03), "eye_shine", u=6, v=4)
    face.build(col, mirror=True, subsurf=1)

    mouth = Mesh("Mouth")
    mouth.blob((0.405, 0, 2.08), (0.01, 0.05, 0.015), "mouth", u=6, v=4)
    mouth.build(col, subsurf=1)

    # The hair: one helmet shell — a mushroom cap of purple that sits low
    # over the brow, falls to the jaw at the sides and to the nape at the back,
    # with a window cut for the face. Bangs and a few clumps break the
    # silhouette the way her drawn hair does.
    hair = Mesh("Hair")
    cap_c = Vector((-0.03, 0, 2.43))
    verts = hair.blob(cap_c, (0.53, 0.55, 0.58), "hair", u=16, v=12)
    bm = hair.bm
    for vv in verts:
        d = vv.co - cap_c
        # Flare the lower half outward a little: the mushroom's rim.
        if d.z < 0:
            k = 1.0 + 0.12 * min(1.0, -d.z / 0.4)
            vv.co.x = cap_c.x + d.x * k
            vv.co.y = cap_c.y + d.y * k
    face_window = []
    for f in bm.faces:
        c = f.calc_center_median()
        # The face shows from the ear forward: in profile the hair covers
        # only the crown and the back half of the head.
        front = (c.x > 0.12 and c.z < 2.5) or (c.x > -0.02 and c.z < 2.36)
        chin = c.z < 2.0
        if front or chin:
            face_window.append(f)
    bmesh.ops.delete(bm, geom=face_window, context="FACES")
    for y, z, r in ((0.0, 2.44, 0.14), (0.2, 2.41, 0.12), (-0.2, 2.41, 0.12), (0.34, 2.3, 0.1), (-0.34, 2.3, 0.1)):
        hair.blob((0.36 - abs(y) * 0.3, y, z), (0.09, r, 0.13), "hair", rot=(0, 25, 0), u=6, v=4)
    for s in (1, -1):
        # Locks framing the face, down to the jaw.
        hair.blob((0.18, s * 0.47, 2.1), (0.14, 0.09, 0.2), "hair", rot=(s * -6, -10, 0), u=6, v=4)
    hair.build(col, solidify=0.04)

    # Goggles pushed up on the forehead: a leather strap round the head, two
    # brass-rimmed teal lenses in front.
    strap = Mesh("GoggleStrap")
    rings = []
    for k in range(13):
        a = 2 * math.pi * k / 12
        rings.append(((math.cos(a) * 0.54 - 0.03, math.sin(a) * 0.56, 2.64 + 0.05 * math.cos(a)), (0.07, 0.025)))
    strap.loft(rings, "goggle_leather", sides=6, cap=(False, False))
    strap.build(col, subsurf=1)

    goggles = Mesh("Goggles")
    goggles.loft(
        [((0.44, 0.2, 2.64), (0.15, 0.14)), ((0.56, 0.2, 2.64), (0.15, 0.14)), ((0.6, 0.2, 2.64), (0.13, 0.12))],
        "goggle_brass",
        sides=10,
    )
    goggles.loft([((0.59, 0.2, 2.64), (0.11, 0.1)), ((0.62, 0.2, 2.64), (0.11, 0.1))], "lens", sides=10)
    goggles.box((0.55, 0.0, 2.64), (0.06, 0.12, 0.06), "goggle_leather")
    goggles.build(col, mirror=True, subsurf=1)


def build_body(col):
    # Scarf: a thick orange wrap at the neck, a tail hanging at the front.
    scarf = Mesh("Scarf")
    # A cowl, not a ring: wide and flat where it drapes over the shoulders and
    # chest, gathering tight under the chin.
    scarf.loft(
        [((0.02, 0, 1.64), (0.46, 0.36)), ((0.03, 0, 1.76), (0.47, 0.37)), ((0.03, 0, 1.88), (0.4, 0.33)), ((0.02, 0, 1.97), (0.3, 0.27)), ((0.0, 0, 2.02), (0.2, 0.19))],
        "scarf",
        sides=12,
    )
    # The knot's tail, hanging off-centre at the front.
    scarf.box((0.36, -0.12, 1.6), (0.08, 0.16, 0.26), "scarf", rot=(8, -14, 0))
    scarf.build(col)

    # Torso: a green shirt with orange stripes, shoulders squared.
    torso = Mesh("Torso")
    z = [1.2, 1.3, 1.38, 1.44, 1.5, 1.56, 1.66, 1.76]
    w = [(0.38, 0.28), (0.38, 0.28), (0.39, 0.29), (0.4, 0.3), (0.42, 0.3), (0.44, 0.3), (0.45, 0.3), (0.34, 0.26)]
    # Stripes: alternating bands across the chest, the board's two orange rows.
    bands = ["shirt", "shirt", "stripe", "shirt", "stripe", "shirt", "shirt"]
    torso.loft([((0.02, 0, zz), ww) for zz, ww in zip(z, w)], "shirt", sides=10, mats=bands)
    # The neck, under the scarf: it joins the head to the body.
    torso.loft([((0.02, 0, 1.7), (0.13, 0.12)), ((0.03, 0, 2.02), (0.12, 0.11))], "skin", sides=8)
    torso.build(col)

    # Backpack straps over the shoulders, and the belt with its pouches.
    straps = Mesh("Straps")
    straps.loft(
        [((0.28, 0.2, 1.22), (0.05, 0.02)), ((0.3, 0.22, 1.5), (0.05, 0.02)), ((0.18, 0.26, 1.74), (0.05, 0.02)), ((-0.12, 0.26, 1.78), (0.05, 0.02)), ((-0.3, 0.24, 1.6), (0.05, 0.02))],
        "leather",
        sides=4,
    )
    straps.build(col, mirror=True, subsurf=1)

    belt = Mesh("Belt")
    belt.loft([((0.02, 0, 1.1), (0.43, 0.32)), ((0.02, 0, 1.23), (0.43, 0.32))], "leather", sides=12, cap=(False, False))
    belt.box((0.35, 0, 1.165), (0.05, 0.18, 0.12), "buckle")
    belt.build(col, subsurf=1)

    pouches = Mesh("Pouches")
    for x, y in ((0.26, 0.24), (0.08, 0.42)):
        pouches.box((x, y, 1.04), (0.16, 0.16, 0.22), "leather", rot=(0, 0, 25))
        pouches.box((x + 0.01, y, 1.14), (0.18, 0.18, 0.06), "goggle_leather", rot=(0, 0, 25))
    pouches.build(col, mirror=True, subsurf=0, bevel=0.02)

    # The backpack: a squat brown pack riding high.
    pack = Mesh("Backpack")
    pack.box((-0.46, 0, 1.5), (0.32, 0.7, 0.62), "leather")
    pack.box((-0.6, 0, 1.66), (0.06, 0.66, 0.32), "goggle_leather")  # the flap
    pack.box((-0.64, 0, 1.54), (0.04, 0.14, 0.1), "buckle")
    pack.box((-0.44, 0, 1.86), (0.2, 0.5, 0.12), "goggle_leather")  # the bedroll on top
    pack.build(col, subsurf=0, bevel=0.04)


def build_limbs(col):
    # Arms: orange shoulder sleeves, bare forearms, big brown gauntlets.
    arm = Mesh("Arm")
    arm.loft(
        [((0.0, 0.45, 1.66), (0.14, 0.14)), ((-0.02, 0.52, 1.52), (0.15, 0.14)), ((-0.04, 0.56, 1.38), (0.12, 0.12))],
        "sleeve",
        sides=8,
    )
    arm.loft(
        [((-0.04, 0.56, 1.38), (0.1, 0.1)), ((-0.02, 0.58, 1.22), (0.1, 0.1)), ((0.0, 0.6, 1.14), (0.1, 0.1))],
        "skin",
        sides=8,
    )
    arm.loft(
        [((0.0, 0.6, 1.16), (0.14, 0.14)), ((0.02, 0.62, 1.04), (0.16, 0.15)), ((0.04, 0.63, 0.92), (0.14, 0.13))],
        "glove",
        sides=8,
    )
    arm.build(col, mirror=True)

    # Trousers: two legs with a little flare at the ankle, dark olive-brown.
    legs = Mesh("Legs")
    legs.loft(
        [((0.02, 0.1, 1.3), (0.2, 0.26)), ((0.02, 0.18, 1.1), (0.2, 0.26)), ((0.02, 0.2, 1.0), (0.2, 0.26)), ((0.02, 0.22, 0.7), (0.18, 0.22)), ((0.02, 0.23, 0.46), (0.19, 0.23))],
        "trousers",
        sides=8,
    )
    legs.build(col, mirror=True)

    # Boots: chunky purple, with a folded cuff and a dark sole.
    boots = Mesh("Boots")
    boots.loft(
        [((0.0, 0.23, 0.5), (0.2, 0.22)), ((0.0, 0.23, 0.4), (0.19, 0.2)), ((0.04, 0.23, 0.14), (0.2, 0.24))],
        "boot",
        sides=8,
    )
    boots.blob((0.14, 0.23, 0.12), (0.24, 0.19, 0.13), "boot", u=8, v=6)
    boots.box((0.08, 0.23, 0.02), (0.56, 0.36, 0.05), "boot_sole")
    boots.build(col, mirror=True)


VIEWS = {
    # name: (camera direction the camera looks FROM, reference image)
    "front": ((1, 0, 0), "front"),
    "side": ((0, -1, 0), "side-a"),
    "back": ((-1, 0, 0), "back"),
}


def compare(out_dir, px=384, color="MATERIAL", light="STUDIO"):
    """Render the model from the reference directions with a flat-lit ortho
    camera and write `<view>.png`; the caller composites them against
    `art/anands/reference/`. Nothing in the scene is left changed."""
    import os

    scene = bpy.context.scene
    cam = bpy.data.objects.get("CompareCam")
    if not cam:
        cam = bpy.data.objects.new("CompareCam", bpy.data.cameras.new("CompareCam"))
        scene.collection.objects.link(cam)
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = 3.3
    cam.hide_viewport = True
    saved = (scene.camera, scene.render.resolution_x, scene.render.resolution_y, scene.render.film_transparent, scene.render.filepath)
    engine = scene.render.engine
    # Workbench, studio-lit with the material colours: the shape and the
    # colour blocking are what is being compared, not the final shading.
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = light
    scene.display.shading.color_type = color  # "TEXTURE" for a textured (generated) mesh
    scene.display.render_aa = "OFF"
    scene.camera = cam
    scene.render.resolution_x = scene.render.resolution_y = px
    scene.render.film_transparent = True
    hidden = []
    for ob in bpy.data.collections["Reference"].objects:
        hidden.append((ob, ob.hide_render))
        ob.hide_render = True
    os.makedirs(out_dir, exist_ok=True)
    for name, (d, _) in VIEWS.items():
        d = Vector(d)
        cam.location = Vector((0, 0, 1.5)) + d * 20
        cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = os.path.join(out_dir, f"{name}.png")
        bpy.ops.render.render(write_still=True)
    scene.camera, scene.render.resolution_x, scene.render.resolution_y, scene.render.film_transparent, scene.render.filepath = saved
    scene.render.engine = engine
    for ob, h in hidden:
        ob.hide_render = h


# The parts fused into her one skinned body; everything else stays a
# separate accessory object (hair, goggles, eyes, scarf, belt, pack...),
# the usual split for a game character.
BODY_PARTS = ("Head", "Ears", "Mouth", "Torso", "Arm", "Legs", "Boots")
VOXEL_M = 0.018   # ~0.6 sprite px: fine enough to keep the fingers of a glove
BODY_FACES = 9000


def fuse_body(col):
    """Merge the body parts into one watertight mesh, `Body`.

    The parts are applied (mirror, subdivision), joined, voxel-remeshed so
    every overlap becomes one surface, then retopologised to clean quads, and
    each new face takes the material of the nearest face of the parts it came
    from. The source parts move to a hidden `Anands.parts` collection — kept,
    so a part can be reshaped and the body fused again.
    """
    from mathutils.bvhtree import BVHTree

    parts_col = bpy.data.collections.get("Anands.parts") or bpy.data.collections.new("Anands.parts")
    if parts_col.name not in bpy.context.scene.collection.children:
        bpy.context.scene.collection.children.link(parts_col)
    deps = bpy.context.evaluated_depsgraph_get()
    src = bmesh.new()
    mats = []
    for name in BODY_PARTS:
        ob = bpy.data.objects[name]
        me = bpy.data.meshes.new_from_object(ob.evaluated_get(deps))
        remap = []
        for m in me.materials:
            if m.name == "outline":
                remap.append(0)
                continue
            if m not in mats:
                mats.append(m)
            remap.append(mats.index(m))
        for p in me.polygons:
            p.material_index = remap[p.material_index] if p.material_index < len(remap) else 0
        me.transform(ob.matrix_world)
        src.from_mesh(me)
        bpy.data.meshes.remove(me)
        for c in ob.users_collection:
            c.objects.unlink(ob)
        parts_col.objects.link(ob)
    parts_col.hide_viewport = True
    parts_col.hide_render = True

    me = bpy.data.meshes.new("Body")
    src.to_mesh(me)
    body = bpy.data.objects.new("Body", me)
    col.objects.link(body)
    for m in mats:
        me.materials.append(m)
    ref_bm = src.copy()
    ref_bm.faces.ensure_lookup_table()
    tree = BVHTree.FromBMesh(ref_bm)
    src.free()

    bpy.context.view_layer.objects.active = body
    for o in bpy.context.selected_objects:
        o.select_set(False)
    body.select_set(True)
    me.remesh_voxel_size = VOXEL_M
    me.use_remesh_preserve_volume = True
    bpy.ops.object.voxel_remesh()
    bpy.ops.object.quadriflow_remesh(target_faces=BODY_FACES, use_preserve_sharp=True)
    me = body.data
    for m in mats:
        if m.name not in me.materials:
            me.materials.append(m)
    for p in me.polygons:
        loc, _n, idx, _d = tree.find_nearest(p.center)
        if idx is not None:
            p.material_index = ref_bm.faces[idx].material_index
    ref_bm.free()
    me.shade_smooth()
    md = body.modifiers.new("Subdivision", "SUBSURF")
    md.levels = md.render_levels = 1
    return body


def build(force=False):
    col = bpy.data.collections.get(COLLECTION)
    if col:
        if col.get("hand_edited") and not force:
            raise RuntimeError("Anands has been edited by hand — the .blend is the source now. Pass force=True to rebuild.")
        for ob in list(col.objects):
            bpy.data.objects.remove(ob, do_unlink=True)
    else:
        col = bpy.data.collections.new(COLLECTION)
        bpy.context.scene.collection.children.link(col)
    parts = bpy.data.collections.get("Anands.parts")
    if parts:
        for ob in list(parts.objects):
            bpy.data.objects.remove(ob, do_unlink=True)
    build_head(col)
    build_body(col)
    build_limbs(col)
    fuse_body(col)
    return col
