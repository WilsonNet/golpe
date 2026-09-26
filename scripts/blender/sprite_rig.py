"""The shared sprite rig: everything a Blender-rendered hero has in common.

Each hero's build module (`lia_build.py`, `jeffs_build.py`) supplies only its
look — a palette and a `build_model(arm, collection)` — and calls `build`.
Everything else is here and identical for every hero, because it is the
game's contract, not the character's:

- Units: 1 Blender metre = 32 sprite pixels. The fighter's collider (32x48
  world px, drawn 2x as 64x96 art px) is a 2m x 3m "body box" with its feet
  at z=0 and its centre at (0, 0, 1.5). The sprite camera is centred on that
  point, and the game centres the sprite on the collider — so anything that
  pokes out (a raised sword) grows the cell, never the fighter.
- The skeleton, the weapon-driven IK, the SNES shader (`LiaToon`), the ink
  hull, the camera and every clip's poses. A hero built on this rig plays
  every clip the animation system can pick.
- Every clip is an Action whose custom properties carry the game metadata:
  `lia_right` / `lia_left` (the game clip names), `lia_fps`, `lia_loop`,
  `lia_drive` ("move" = frame picked by progress through the melee move,
  "aim" = frames banded by aim elevation, `lia_bands` of them), `lia_props`
  ("sword" | "rifle" | "none": which weapon objects are shown). Every keyed
  frame of the action is one rendered sprite frame.

Weapon objects are found by name: `Sword`, `SwordBack`, `Dagger`, and the gun —
`Rifle`, `Shotgun` or `Gun`.
"""

import math
import os
import sys

import bmesh
import bpy
from mathutils import Euler, Matrix, Quaternion, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

PX_PER_M = 32
BODY_CENTRE = Vector((0.0, 0.0, 1.5))
# The armature object every hero file carries; the renderer finds it by type.
RIG_NAME = "Rig"
# The 3/4 view: how far the fighter is turned toward the camera.
VIEW_YAW_DEG = -20.0
# A flat front elevation, like a drawn sprite: no tilt, so nothing reads as
# a solid seen from above.
CAM_TILT_DEG = 0.0
# How far the head turns toward the camera on top of any pose.
HEAD_TO_VIEWER_DEG = -22.0
# The blade's travel through the screen, in degrees per unit of SWING depth:
# kept small, because pixel art swings in the picture plane.
SWING_DEPTH_DEG = 10.0
# ~1 px of ink at the sprite scale.
OUTLINE_M = 0.034

# Move timings (ms) and blade arcs, mirrored from src/tweakables/melee.ts and
# SWING in src/game/render/MeleeFx.ts so the drawn blade follows the trail.
MOVES = {
    "slash": dict(startup=75, active=85, recovery=170, arc=(-1.25, 2.1, 0.85, -6)),
    "slash2": dict(startup=75, active=85, recovery=170, arc=(-2.24, 1.05, -0.85, -4)),
    "slash3": dict(startup=85, active=100, recovery=420, arc=(-1.62, 1.57, 0.45, -12)),
    "uppercut": dict(startup=110, active=100, recovery=340, arc=(1.5, -1.5, 0.0, 0)),
    "massive": dict(startup=90, active=130, recovery=460, arc=(-2.55, 1.35, 0.3, -6)),
}

# Per-hero look, filled in by the hero's build module before `build` runs:
# material name -> (lit, shade, highlight) sRGB, the unlit flat colours, and
# which materials get a highlight band.
PALETTE = {}
FLAT = {"ink": (0.09, 0.06, 0.13)}
SHINY = set()

# ================================================================ helpers
def srgb_to_linear(c):
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


# The light, in *camera* space (+X right, +Y up, +Z toward the viewer): from
# the upper left and mostly from the front, the SNES convention.
LIGHT_CAM = (-0.5, 0.55, 0.67)


def toon_group():
    """The shared SNES shader: a flat fill, a shade band on the far edge.

    Pixel art does not shade *form* — a sphere is not a gradient of bands
    wrapping around it — it fills a shape flat and runs a darker band along
    the edge that faces away from the light. So the normal is taken in camera
    space and **flattened toward the viewer** (`Flatten` adds that much +Z)
    before it is lit: everything facing the camera reads as one lit fill, and
    only surfaces turning away at the silhouette cross into shade. The light
    is a fixed camera-space direction, not a scene lamp, so a sprite is lit
    the same way whatever pose it is in.

    Edit a material's colours on its group node; edit the look for everyone
    here (`Flatten` up = flatter, `Shade Below` up = more shade).
    """
    ng = bpy.data.node_groups.get("LiaToon")
    if ng:
        return ng
    ng = bpy.data.node_groups.new("LiaToon", "ShaderNodeTree")
    iface = ng.interface
    iface.new_socket("Lit", in_out="INPUT", socket_type="NodeSocketColor")
    iface.new_socket("Shade", in_out="INPUT", socket_type="NodeSocketColor")
    iface.new_socket("Highlight", in_out="INPUT", socket_type="NodeSocketColor")
    sk = iface.new_socket("Shade Below", in_out="INPUT", socket_type="NodeSocketFloat")
    sk.default_value = 0.3
    sk = iface.new_socket("Highlight Above", in_out="INPUT", socket_type="NodeSocketFloat")
    sk.default_value = 1.01
    sk = iface.new_socket("Flatten", in_out="INPUT", socket_type="NodeSocketFloat")
    sk.default_value = 0.9
    iface.new_socket("Shader", in_out="OUTPUT", socket_type="NodeSocketShader")
    n = ng.nodes
    ln = ng.links
    gi = n.new("NodeGroupInput")
    go = n.new("NodeGroupOutput")
    geo = n.new("ShaderNodeNewGeometry")
    to_cam = n.new("ShaderNodeVectorTransform")
    to_cam.vector_type = "NORMAL"
    to_cam.convert_from = "WORLD"
    to_cam.convert_to = "CAMERA"
    flat = n.new("ShaderNodeCombineXYZ")
    add = n.new("ShaderNodeVectorMath")
    add.operation = "ADD"
    norm = n.new("ShaderNodeVectorMath")
    norm.operation = "NORMALIZE"
    dot = n.new("ShaderNodeVectorMath")
    dot.operation = "DOT_PRODUCT"
    lx, ly, lz = LIGHT_CAM
    k = (lx * lx + ly * ly + lz * lz) ** 0.5
    dot.inputs[1].default_value = (lx / k, ly / k, lz / k)
    gt1 = n.new("ShaderNodeMath")
    gt1.operation = "GREATER_THAN"
    gt2 = n.new("ShaderNodeMath")
    gt2.operation = "GREATER_THAN"
    mix1 = n.new("ShaderNodeMix")
    mix1.data_type = "RGBA"
    mix2 = n.new("ShaderNodeMix")
    mix2.data_type = "RGBA"
    em = n.new("ShaderNodeEmission")
    ln.new(geo.outputs["Normal"], to_cam.inputs[0])
    ln.new(gi.outputs["Flatten"], flat.inputs["Z"])
    ln.new(to_cam.outputs[0], add.inputs[0])
    ln.new(flat.outputs[0], add.inputs[1])
    ln.new(add.outputs[0], norm.inputs[0])
    ln.new(norm.outputs[0], dot.inputs[0])
    ln.new(dot.outputs["Value"], gt1.inputs[0])
    ln.new(gi.outputs["Shade Below"], gt1.inputs[1])
    ln.new(dot.outputs["Value"], gt2.inputs[0])
    ln.new(gi.outputs["Highlight Above"], gt2.inputs[1])
    ln.new(gt1.outputs[0], mix1.inputs[0])
    ln.new(gi.outputs["Shade"], mix1.inputs[6])
    ln.new(gi.outputs["Lit"], mix1.inputs[7])
    ln.new(gt2.outputs[0], mix2.inputs[0])
    ln.new(mix1.outputs[2], mix2.inputs[6])
    ln.new(gi.outputs["Highlight"], mix2.inputs[7])
    ln.new(mix2.outputs[2], em.inputs["Color"])
    ln.new(em.outputs[0], go.inputs[0])
    for idx, node in enumerate([gi, geo, to_cam, flat, add, norm, dot, gt1, gt2, mix1, mix2, em, go]):
        node.location = (idx * 170, 0)
    return ng


def toon_material(name):
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    lit, shade, hi = PALETTE[name]
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    g = nt.nodes.new("ShaderNodeGroup")
    g.node_tree = toon_group()
    g.inputs["Lit"].default_value = (*srgb_to_linear(lit), 1)
    g.inputs["Shade"].default_value = (*srgb_to_linear(shade), 1)
    g.inputs["Highlight"].default_value = (*srgb_to_linear(hi), 1)
    # Only the shiny things get a highlight band; cloth and skin stay two-tone.
    g.inputs["Highlight Above"].default_value = 0.97 if name in SHINY else 1.01
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(g.outputs[0], out.inputs["Surface"])
    out.location = (300, 0)
    mat.diffuse_color = (*srgb_to_linear(lit), 1)
    return mat


def flat_material(name, backface_cull=False):
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (*srgb_to_linear(FLAT[name]), 1)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(em.outputs[0], out.inputs["Surface"])
    mat.use_backface_culling = backface_cull
    mat.diffuse_color = (*srgb_to_linear(FLAT[name]), 1)
    return mat


class Part:
    """One mesh object under construction: geometry in armature space, by material."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.mats = []

    def mat(self, name):
        if name not in self.mats:
            self.mats.append(name)
        return self.mats.index(name)

    def ellipsoid(self, centre, radii, mat, rot=(0, 0, 0), seg=18, rings=12):
        before = set(self.bm.verts)
        m = (
            Matrix.Translation(Vector(centre))
            @ Euler([math.radians(a) for a in rot]).to_matrix().to_4x4()
            @ Matrix.Diagonal((*radii, 1))
        )
        bmesh.ops.create_uvsphere(self.bm, u_segments=seg, v_segments=rings, radius=1.0, matrix=m)
        self._assign(before, mat)

    def box(self, centre, size, mat, rot=(0, 0, 0), bevel=0.0):
        before = set(self.bm.verts)
        m = (
            Matrix.Translation(Vector(centre))
            @ Euler([math.radians(a) for a in rot]).to_matrix().to_4x4()
            @ Matrix.Diagonal((*size, 1))
        )
        res = bmesh.ops.create_cube(self.bm, size=1.0, matrix=m)
        if bevel > 0:
            edges = list({e for v in res["verts"] for e in v.link_edges})
            bmesh.ops.bevel(self.bm, geom=edges, offset=bevel, segments=2, affect="EDGES", profile=0.5)
        self._assign(before, mat)

    def tube(self, points, radii, mat, sides=12, cap_start=True, cap_end=True, up=(0, 0, 1)):
        """A swept tube along `points`; each radius is a float or (rx, ry).

        rx runs along the frame's 'side' axis, ry along its 'up' axis, so an
        elliptical section (a torso, a flat blade) keeps its orientation.
        """
        before = set(self.bm.verts)
        pts = [Vector(p) for p in points]
        n = len(pts)
        rings = []
        upv = Vector(up)
        for i, p in enumerate(pts):
            if i == 0:
                t = pts[1] - pts[0]
            elif i == n - 1:
                t = pts[-1] - pts[-2]
            else:
                t = pts[i + 1] - pts[i - 1]
            t.normalize()
            side = t.cross(upv)
            if side.length < 1e-4:
                side = t.cross(Vector((1, 0, 0)))
            side.normalize()
            u = side.cross(t).normalized()
            r = radii[i]
            rx, ry = (r, r) if isinstance(r, (int, float)) else r
            ring = []
            for k in range(sides):
                a = 2 * math.pi * k / sides
                ring.append(self.bm.verts.new(p + side * (math.cos(a) * rx) + u * (math.sin(a) * ry)))
            rings.append(ring)
        for i in range(n - 1):
            for k in range(sides):
                a, b = rings[i][k], rings[i][(k + 1) % sides]
                c, d = rings[i + 1][(k + 1) % sides], rings[i + 1][k]
                self.bm.faces.new((a, b, c, d))
        if cap_start:
            c = self.bm.verts.new(pts[0])
            for k in range(sides):
                self.bm.faces.new((rings[0][(k + 1) % sides], rings[0][k], c))
        if cap_end:
            c = self.bm.verts.new(pts[-1])
            for k in range(sides):
                self.bm.faces.new((rings[-1][k], rings[-1][(k + 1) % sides], c))
        self._assign(before, mat)

    def spike(self, base, tip, r0, mat, bend=(0, 0, 0), steps=6, sides=8):
        """A Toriyama hair clump: a fat base tapering to a point along a curve."""
        b = Vector(base)
        t = Vector(tip)
        mid = (b + t) / 2 + Vector(bend)
        pts = []
        radii = []
        for i in range(steps + 1):
            s = i / steps
            p = (1 - s) ** 2 * b + 2 * (1 - s) * s * mid + s**2 * t
            pts.append(p)
            # Fat for most of the length, then a quick point: a clump, not a strand.
            radii.append(max(0.006, r0 * (1 - s**1.6) ** 0.9))
        self.tube(pts, radii, mat, sides=sides, cap_start=True, cap_end=True)

    def _assign(self, before, mat):
        """Give every face made since `before` (a vertex snapshot) this material."""
        idx = self.mat(mat)
        for f in self.bm.faces:
            if f.verts[0] not in before:
                f.material_index = idx

    def build(self, collection, outline=True, smooth=True):
        me = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(me)
        self.bm.free()
        for name in self.mats:
            me.materials.append(toon_material(name) if name in PALETTE else flat_material(name))
        if smooth:
            me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
        ob = bpy.data.objects.new(self.name, me)
        collection.objects.link(ob)
        if outline:
            add_outline(ob)
        return ob


def add_outline(ob, thickness=OUTLINE_M):
    """Inverted hull: a flipped, back-face-culled shell drawn in ink."""
    me = ob.data
    ink = bpy.data.materials.get("outline") or flat_material_named("outline", FLAT["ink"])
    if ink.name not in [m.name for m in me.materials if m]:
        me.materials.append(ink)
    mod = ob.modifiers.new("Outline", "SOLIDIFY")
    mod.thickness = thickness
    mod.offset = 1.0
    mod.use_flip_normals = True
    mod.use_rim = False
    mod.material_offset = len(me.materials) - 1
    mod.material_offset_rim = len(me.materials) - 1


def flat_material_named(name, colour):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (*srgb_to_linear(colour), 1)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(em.outputs[0], out.inputs["Surface"])
    mat.use_backface_culling = True
    mat.diffuse_color = (*srgb_to_linear(colour), 1)
    return mat


def parent_to_bone(ob, arm, bone_name):
    """Parent keeping the armature-space geometry exactly where it was built."""
    bone = arm.data.bones[bone_name]
    ob.parent = arm
    ob.parent_type = "BONE"
    ob.parent_bone = bone_name
    tail = bone.matrix_local @ Matrix.Translation((0, bone.length, 0))
    ob.matrix_parent_inverse = tail.inverted()
    ob.matrix_basis = Matrix.Identity(4)


# ================================================================ the rig
BONES = [
    # name, head, tail, parent
    ("root", (0, 0, 0), (0, 0, 0.3), None),
    ("hips", (0, 0, 0.95), (0, 0, 1.12), "root"),
    ("chest", (0, 0, 1.12), (0, 0, 1.62), "hips"),
    ("head", (0, 0, 1.66), (0, 0, 2.45), "chest"),
    ("upperarm.R", (0, -0.33, 1.5), (-0.05, -0.38, 1.2), "chest"),
    ("forearm.R", (-0.05, -0.38, 1.2), (0.02, -0.4, 0.94), "upperarm.R"),
    ("upperarm.L", (0, 0.33, 1.5), (-0.05, 0.38, 1.2), "chest"),
    ("forearm.L", (-0.05, 0.38, 1.2), (0.02, 0.4, 0.94), "upperarm.L"),
    ("thigh.R", (0, -0.15, 0.95), (0.02, -0.16, 0.55), "hips"),
    ("shin.R", (0.02, -0.16, 0.55), (0, -0.16, 0.16), "thigh.R"),
    ("foot.R", (0, -0.16, 0.16), (0.2, -0.16, 0.08), "shin.R"),
    ("thigh.L", (0, 0.15, 0.95), (0.02, 0.16, 0.55), "hips"),
    ("shin.L", (0.02, 0.16, 0.55), (0, 0.16, 0.16), "thigh.L"),
    ("foot.L", (0, 0.16, 0.16), (0.2, 0.16, 0.08), "shin.L"),
    ("cape", (-0.2, 0, 1.56), (-0.3, 0, 0.92), "chest"),
    ("pony", (-0.28, 0, 2.42), (-0.8, 0, 2.22), "head"),
    # The weapon is free (no parent): poses place it in armature space, and
    # the sword hand reaches it by IK — so a swing's blade angle is exactly
    # the angle the game's trail is drawn at.
    ("weapon", (0, 0, 1.0), (0.4, 0, 1.0), None),
    ("hand_ik.R", (0, 0, 1.0), (0.2, 0, 1.0), "weapon"),
    ("hand_ik.L", (0, 0, 1.0), (0.2, 0, 1.0), "weapon"),
]


def build_armature(collection):
    arm_data = bpy.data.armatures.new(RIG_NAME)
    arm = bpy.data.objects.new(RIG_NAME, arm_data)
    collection.objects.link(arm)
    arm.rotation_euler = (0, 0, math.radians(VIEW_YAW_DEG))
    arm_data.display_type = "STICK"
    arm.show_in_front = True
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm_data.edit_bones
    for name, h, t, parent in BONES:
        b = eb.new(name)
        b.head = h
        b.tail = t
        b.roll = 0
        if parent:
            b.parent = eb[parent]
    bpy.ops.object.mode_set(mode="POSE")
    for side in ("R", "L"):
        pb = arm.pose.bones[f"forearm.{side}"]
        ik = pb.constraints.new("IK")
        ik.name = "IK"
        ik.target = arm
        ik.subtarget = f"hand_ik.{side}"
        ik.chain_count = 2
        ik.influence = 1.0 if side == "R" else 0.0
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
    bpy.ops.object.mode_set(mode="OBJECT")
    return arm


# ================================================================ posing
def rest_matrix(arm, name):
    return arm.data.bones[name].matrix_local


def rot3(pitch=0.0, yaw=0.0, roll=0.0):
    """A rotation in armature axes: pitch about +Y (lateral), yaw about +Z, roll about +X."""
    return (
        Matrix.Rotation(math.radians(yaw), 4, "Z")
        @ Matrix.Rotation(math.radians(pitch), 4, "Y")
        @ Matrix.Rotation(math.radians(roll), 4, "X")
    )


def set_bone(arm, name, R):
    pb = arm.pose.bones[name]
    L = rest_matrix(arm, name)
    basis = L.inverted() @ R @ L
    # Pure rotation about the bone's own head: drop the translation the
    # conjugation introduces for bones whose head is off the origin.
    pb.rotation_quaternion = basis.to_quaternion()
    pb.location = (0, 0, 0)


def set_root(arm, off=(0, 0, 0), pitch=0.0, yaw=0.0, pivot=(0, 0, 0)):
    pb = arm.pose.bones["root"]
    L = rest_matrix(arm, "root")
    pv = Vector(pivot)
    M = Matrix.Translation(pv + Vector(off)) @ rot3(pitch=pitch, yaw=yaw) @ Matrix.Translation(-pv)
    basis = L.inverted() @ M @ L
    pb.location = basis.to_translation()
    pb.rotation_quaternion = basis.to_quaternion()


def set_weapon(arm, pos, theta, depth_deg=0.0, roll_deg=0.0):
    """Place the weapon's grip at `pos`, blade at screen angle `theta`.

    `theta` follows MeleeFx's SWING convention: radians, 0 = forward, negative
    = up. `depth_deg` yaws the blade through the screen (the swing's depth).
    """
    pb = arm.pose.bones["weapon"]
    L = rest_matrix(arm, "weapon")
    R = (
        Matrix.Rotation(math.radians(depth_deg), 4, "Z")
        @ Matrix.Rotation(theta, 4, "Y")
        @ Matrix.Rotation(math.radians(roll_deg), 4, "X")
    )
    M = Matrix.Translation(Vector(pos)) @ R @ L.to_3x3().to_4x4()
    basis = L.inverted() @ M
    pb.location = basis.to_translation()
    pb.rotation_quaternion = basis.to_quaternion()


def set_offhand(arm, along=0.0, side=0.0, up=0.0):
    """Where the off hand grips the weapon, along its own axis (metres)."""
    pb = arm.pose.bones["hand_ik.L"]
    # hand_ik.L's rest frame: +Y along the blade, +Z = armature up at rest.
    pb.location = (up * 0 + side, along, up)
    pb.rotation_quaternion = Quaternion()


NEUTRAL = dict(
    root=(0, 0, 0),
    root_pitch=0.0,
    root_yaw=0.0,
    root_pivot=(0, 0, 1.1),
    hips=(0, 0, 0),
    chest=(0, 0, 0),
    head=(0, 0, 0),
    # limbs: (forward swing deg, outward deg)
    armL=(10, 8),
    elbowL=25,
    armR=(10, 8),
    elbowR=25,
    thighR=(0, 2),
    kneeR=0,
    footR=0,
    thighL=(0, 2),
    kneeL=0,
    footL=0,
    cape=0,
    pony=0,
    weapon=((0.36, -0.36, 1.02), 0.55, 4, 0),
    ikR=1.0,
    ikL=0.0,
    offhand=(-0.14, 0.0, 0.0),
)


def lerp(a, b, t):
    if isinstance(a, (int, float)):
        return a + (b - a) * t
    return tuple(lerp(x, y, t) for x, y in zip(a, b))


def mix_pose(a, b, t):
    return {k: lerp(a[k], b[k], t) for k in a}


def pose(**kw):
    p = dict(NEUTRAL)
    p.update(kw)
    return p


def apply_pose(arm, p):
    set_root(arm, off=p["root"], pitch=p["root_pitch"], yaw=p["root_yaw"], pivot=p["root_pivot"])
    set_bone(arm, "hips", rot3(pitch=p["hips"][0], yaw=p["hips"][1], roll=p["hips"][2]))
    set_bone(arm, "chest", rot3(pitch=p["chest"][0], yaw=p["chest"][1], roll=p["chest"][2]))
    # The SNES convention: the body goes side-on, the face stays turned to the
    # viewer, so both eyes read at sprite size.
    set_bone(arm, "head", rot3(pitch=p["head"][0], yaw=p["head"][1] + HEAD_TO_VIEWER_DEG, roll=p["head"][2]))
    for side, s in (("R", -1), ("L", 1)):
        fwd, out = p[f"arm{side}"]
        set_bone(arm, f"upperarm.{side}", rot3(pitch=-fwd, roll=s * out))
        set_bone(arm, f"forearm.{side}", rot3(pitch=-p[f"elbow{side}"]))
        tf, to = p[f"thigh{side}"]
        set_bone(arm, f"thigh.{side}", rot3(pitch=-tf, roll=s * to))
        set_bone(arm, f"shin.{side}", rot3(pitch=p[f"knee{side}"]))
        set_bone(arm, f"foot.{side}", rot3(pitch=p[f"foot{side}"]))
    set_bone(arm, "cape", rot3(pitch=-p["cape"]))
    set_bone(arm, "pony", rot3(pitch=p["pony"]))
    pos, theta, depth, roll = p["weapon"]
    set_weapon(arm, pos, theta, depth, roll)
    set_offhand(arm, *p["offhand"])
    arm.pose.bones["forearm.R"].constraints["IK"].influence = p["ikR"]
    arm.pose.bones["forearm.L"].constraints["IK"].influence = p["ikL"]


WEAPONS = {"Sword", "SwordBack", "Dagger", "DaggerL", "Rifle", "Shotgun", "Gun"}


def lowest_point(arm):
    """The lowest point of the drawn body (weapons excluded), in armature z —
    *as posed and as drawn*: the evaluated mesh, so a skinned body (Anands')
    is measured deformed rather than at rest, and the ink hull is included,
    because the hull is the sprite's bottom edge."""
    bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get()
    low = math.inf
    inv = arm.matrix_world.inverted()
    for ob in bpy.data.objects:
        # Only the fighter: a file may also hold reference meshes (Anands'
        # blockout and generated guides), which are not on the floor line.
        if ob.type != "MESH" or ob.name in WEAPONS or ob.parent != arm:
            continue
        ev = ob.evaluated_get(deps)
        me = ev.to_mesh()
        m = inv @ ev.matrix_world
        for v in me.vertices:
            low = min(low, (m @ v.co).z)
        ev.to_mesh_clear()
    return low


def key_pose(arm, p, frame, ground=False):
    apply_pose(arm, p)
    if ground:
        # Plant the lowest sole on the floor: a crouch bends the knees, it
        # does not sink the feet through the collider's bottom edge.
        # (Measured by make-hero-art.py: feet must land on the floor line.)
        p = dict(p)
        rx, ry, rz = p["root"]
        # `lowest_point` includes the ink hull, which hangs below the sole:
        # it is the sprite's bottom edge, so it is what touches the floor.
        p["root"] = (rx, ry, rz - lowest_point(arm))
        apply_pose(arm, p)
    for pb in arm.pose.bones:
        pb.keyframe_insert("rotation_quaternion", frame=frame)
        pb.keyframe_insert("location", frame=frame)
    for side in ("R", "L"):
        arm.pose.bones[f"forearm.{side}"].constraints["IK"].keyframe_insert("influence", frame=frame)


FRAME_STEP = 4


def make_clip(arm, name, poses, right, left, fps=10, loop=True, drive="", props="sword", ms=0, ground=True):
    act = bpy.data.actions.new(f"clip.{name}")
    act.use_fake_user = True
    act["lia_right"] = right
    act["lia_left"] = left or ""
    act["lia_fps"] = fps
    act["lia_loop"] = loop
    act["lia_drive"] = drive
    act["lia_props"] = props
    if ms:
        act["lia_ms"] = ms
    arm.animation_data.action = act
    if act.slots:
        arm.animation_data.action_slot = act.slots[0]
    act["lia_ground"] = ground
    if drive == "aim":
        act["lia_bands"] = AIM_BANDS_RUN if name == "gun-run" else AIM_BANDS_HOLD
    for i, p in enumerate(poses):
        key_pose(arm, p, 1 + i * FRAME_STEP, ground=ground)
    # Constant interpolation: every key is a drawn frame (pose-to-pose).
    for layer in act.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                for fc in bag.fcurves:
                    for kp in fc.keyframe_points:
                        kp.interpolation = "CONSTANT"
    return act


# ================================================================ the clips
def smoothstep(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def sword_ready():
    return pose()


def idle_clip():
    frames = []
    for i in range(4):
        b = math.sin(i / 4 * 2 * math.pi)
        frames.append(
            pose(
                root=(0, 0, -0.02 - 0.02 * b),
                chest=(4 + 1.5 * b, 0, 0),
                head=(-3 - 1.5 * b, 0, 0),
                thighR=(8, 4),
                kneeR=10 + 3 * (1 + b),
                footR=-6,
                thighL=(-10, 4),
                kneeL=6 + 3 * (1 + b),
                footL=6,
                armL=(18, 14),
                elbowL=38 + 4 * b,
                cape=3 + 3 * b,
                pony=-4 * b,
                weapon=((0.4, -0.38, 1.02 - 0.02 * b), 0.62, 4, 0),
            )
        )
    return frames


def run_pose(t, upper=None):
    """One frame of the run cycle at phase t in [0, 1)."""
    a = 2 * math.pi * t
    s = math.sin(a)
    c = math.cos(a)
    # The knee folds as the leg swings through (high knee at the pass), kicks
    # up behind, and is nearly straight when the leg reaches out in front —
    # the extended-stride silhouette a drawn run is built on.
    kR = 15 + 80 * max(0.0, math.cos(a + 0.5))
    kL = 15 + 80 * max(0.0, math.cos(a + math.pi + 0.5))
    p = pose(
        root=(0, 0, -0.03 + 0.09 * abs(math.cos(a))),
        chest=(18, 4 * s, 0),
        hips=(4, -8 * s, 0),
        head=(-8, -4 * s, 0),
        thighR=(56 * s, 4),
        kneeR=kR,
        footR=-14 * s + 10,
        thighL=(-56 * s, 4),
        kneeL=kL,
        footL=14 * s + 10,
        armL=(55 * s, 8),
        elbowL=85,
        cape=18 + 6 * c,
        pony=-12 - 5 * c,
        # The sword trails low and back, riding the right arm's swing.
        weapon=((0.05 - 0.22 * s, -0.4, 1.08 + 0.05 * abs(c)), 2.45, -8, 0),
    )
    if upper:
        p.update(upper)
    return p


def run_clip(upper=None):
    return [run_pose(i / 8, upper) for i in range(8)]


def charge_upper(b=0.0):
    return dict(
        weapon=((0.12, -0.12, 2.28 + 0.03 * b), -2.45, 6, 0),
        ikL=1.0,
        offhand=(-0.13, 0.0, 0.0),
        head=(-10, 0, 0),
    )


def charge_clip():
    out = []
    for i in range(2):
        b = 1 if i else -1
        p = pose(
            root=(0, 0, -0.06),
            chest=(-8, 0, 0),
            thighR=(16, 6),
            kneeR=24,
            thighL=(-18, 6),
            kneeL=16,
            footL=10,
            cape=6 + 3 * b,
            pony=-6,
        )
        p.update(charge_upper(b))
        out.append(p)
    return out


def jump_clip():
    up = pose(
        root=(0, 0, 0.04),
        chest=(4, 0, 0),
        head=(-6, 0, 0),
        thighR=(55, 6),
        kneeR=95,
        footR=20,
        thighL=(-8, 6),
        kneeL=40,
        footL=25,
        armL=(-30, 30),
        elbowL=40,
        cape=-10,
        pony=18,
        weapon=((0.1, -0.5, 1.2), 2.2, -10, 0),
    )
    up2 = dict(up)
    up2.update(thighR=(48, 6), kneeR=85, cape=-14, pony=22)
    return [up, up2]


def fall_clip():
    f = pose(
        root=(0, 0, 0.02),
        chest=(-4, 0, 0),
        head=(4, 0, 0),
        thighR=(30, 8),
        kneeR=55,
        footR=10,
        thighL=(5, 8),
        kneeL=30,
        footL=20,
        armL=(20, 55),
        elbowL=30,
        cape=28,
        pony=-22,
        weapon=((0.2, -0.55, 1.35), 1.2, -10, 0),
    )
    f2 = dict(f)
    f2.update(cape=34, pony=-28, armL=(24, 60))
    return [f, f2]


def block_clip():
    return [
        pose(
            root=(0, 0, -0.08),
            chest=(-6, -10, 0),
            head=(-6, 0, 0),
            thighR=(22, 8),
            kneeR=30,
            footR=-10,
            thighL=(-20, 8),
            kneeL=22,
            footL=12,
            armL=(55, 5),
            elbowL=70,
            cape=6,
            pony=-4,
            # The blade upright across the body: the guard is the sword.
            weapon=((0.46, -0.2, 1.42), -1.35, 10, 0),
        )
    ]


def swing_clip(move, samples, body_keys):
    """Sample a sword move at `samples` evenly spaced instants.

    The blade follows the SWING arc exactly the way MeleeFx draws it
    (smoothstep over startup+active, from → to, depth through the screen),
    then eases back to the ready pose over the recovery. `body_keys` is a
    list of (fraction of the move, partial pose) the body lerps through.
    """
    m = MOVES[move]
    frm, to, depth, lift = m["arc"]
    total = m["startup"] + m["active"] + m["recovery"]
    swing_ms = m["startup"] + m["active"]
    ready = sword_ready()
    out = []
    for i in range(samples):
        t_ms = (i + 0.5) / samples * total
        # Body: interpolate through the key poses.
        keys = [(0.0, {})] + body_keys + [(1.0, {})]
        for (ta, pa), (tb, pb) in zip(keys, keys[1:]):
            if ta <= t_ms / total <= tb:
                u = (t_ms / total - ta) / max(1e-6, tb - ta)
                a = pose(**pa)
                b = pose(**pb)
                body = mix_pose(a, b, smoothstep(u))
                break
        if t_ms <= swing_ms:
            e = smoothstep(t_ms / swing_ms)
            theta = frm + (to - frm) * e
            z = depth * (e * 2 - 1)
            hand = body_keys_hand(move, e, z, lift)
            body["weapon"] = (hand, theta, z * SWING_DEPTH_DEG, 0)
        else:
            r = smoothstep((t_ms - swing_ms) / m["recovery"])
            e = 1.0
            z = depth
            hand_end = body_keys_hand(move, 1.0, z, lift)
            r_pos, r_theta, r_depth, _ = ready["weapon"]
            body["weapon"] = (
                lerp(hand_end, r_pos, r),
                to + (r_theta - to) * r,
                z * SWING_DEPTH_DEG + (r_depth - z * SWING_DEPTH_DEG) * r,
                0,
            )
        out.append(body)
    return out


def body_keys_hand(move, e, z, lift):
    """Where the hand is in armature space, following MeleeFx's hand path.

    MeleeFx puts the hand at (cx + dir*(10 + 7z + reach*e), cy + lift +
    drop*e) in world px from the body centre; 1 world px = 1/16 m here.
    """
    reach = {"massive": 30}.get(move, 0)
    drop = {"massive": 12}.get(move, 0)
    x = (10 + 7 * z + reach * e) / 16 * 0.85
    zc = 1.5 - (lift + drop * e) / 16
    return (min(x, 0.95), -0.3, zc)


def slash_clip():
    return swing_clip(
        "slash",
        6,
        [
            (0.15, dict(chest=(-6, 22, 0), hips=(0, 10, 0), thighR=(20, 6), kneeR=28, thighL=(-18, 6), kneeL=14, armL=(-10, 30), cape=4)),
            (0.42, dict(chest=(18, -26, 0), hips=(6, -14, 0), thighR=(34, 6), kneeR=40, footR=-14, thighL=(-30, 6), kneeL=10, footL=14, armL=(-30, 25), cape=22, pony=-18)),
            (0.8, dict(chest=(8, -8, 0), thighR=(22, 6), kneeR=24, thighL=(-18, 6), kneeL=12, armL=(10, 16), cape=10, pony=-8)),
        ],
    )


def slash2_clip():
    return swing_clip(
        "slash2",
        6,
        [
            (0.15, dict(chest=(-8, -22, 0), hips=(0, -10, 0), thighR=(22, 6), kneeR=30, thighL=(-18, 6), kneeL=14, armL=(30, 20), elbowL=60, cape=4)),
            (0.42, dict(chest=(16, 24, 0), hips=(6, 12, 0), thighR=(34, 6), kneeR=40, footR=-14, thighL=(-30, 6), kneeL=10, footL=14, armL=(-35, 35), cape=22, pony=-18)),
            (0.8, dict(chest=(8, 6, 0), thighR=(22, 6), kneeR=24, thighL=(-18, 6), kneeL=12, cape=10, pony=-8)),
        ],
    )


def slash3_clip():
    frames = swing_clip(
        "slash3",
        8,
        [
            (0.1, dict(root=(0, 0, 0.04), chest=(-18, 0, 0), head=(-10, 0, 0), thighR=(26, 6), kneeR=30, thighL=(-10, 6), kneeL=20, cape=-4, pony=10, ikL=1.0)),
            (0.3, dict(root=(0, 0, -0.14), chest=(30, 0, 0), head=(-12, 0, 0), thighR=(50, 6), kneeR=70, footR=-20, thighL=(-36, 6), kneeL=16, footL=20, cape=30, pony=-26, ikL=1.0)),
            (0.7, dict(root=(0, 0, -0.1), chest=(22, 0, 0), thighR=(44, 6), kneeR=60, thighL=(-32, 6), kneeL=16, cape=18, pony=-12, ikL=0.6)),
        ],
    )
    return frames


def uppercut_clip():
    return swing_clip(
        "uppercut",
        7,
        [
            (0.18, dict(root=(0, 0, -0.22), chest=(26, 0, 0), thighR=(52, 6), kneeR=90, footR=-10, thighL=(-10, 6), kneeL=70, footL=20, armL=(20, 20), cape=14)),
            (0.36, dict(root=(0, 0, 0.12), chest=(-22, 0, 0), head=(-18, 0, 0), thighR=(20, 6), kneeR=10, thighL=(-24, 6), kneeL=30, footL=30, armL=(-40, 40), cape=-10, pony=24)),
            (0.7, dict(root=(0, 0, 0.02), chest=(-6, 0, 0), thighR=(14, 6), kneeR=16, thighL=(-12, 6), kneeL=16, cape=0, pony=6)),
        ],
    )


def massive_clip():
    return swing_clip(
        "massive",
        8,
        [
            (0.08, dict(root=(0, 0, 0.02), chest=(-20, 0, 0), head=(-12, 0, 0), thighR=(20, 6), kneeR=20, thighL=(-12, 6), kneeL=14, cape=-6, pony=14, ikL=1.0)),
            (0.3, dict(root=(0.12, 0, -0.24), chest=(42, 0, 0), head=(-20, 0, 0), thighR=(64, 6), kneeR=90, footR=-24, thighL=(-44, 6), kneeL=10, footL=30, cape=40, pony=-30, ikL=1.0)),
            (0.75, dict(root=(0.08, 0, -0.18), chest=(34, 0, 0), head=(-14, 0, 0), thighR=(56, 6), kneeR=80, thighL=(-40, 6), kneeL=12, footL=24, cape=26, pony=-16, ikL=0.8)),
        ],
    )


# The rifle follows the aim. Banded clips: the frames are laid out band-major,
# one band per aim elevation from straight up (-90 deg) to straight down
# (+90 deg), and the game picks the band from the fighter's aim relative to
# its facing (see `lia_bands` and `animationSystem`).
AIM_BANDS_HOLD = 9
AIM_BANDS_RUN = 5


def aim_elevations(bands):
    return [-math.pi / 2 + math.pi * i / (bands - 1) for i in range(bands)]


def gun_upper(recoil=0.0, b=0.0, e=0.0):
    """Arms and rifle aimed at elevation `e` (radians, negative = up).

    The rifle pivots about the shoulder line rather than its own grip, so
    aiming up lifts it past the face and aiming down tucks it to the hip —
    the way a body actually shoulders a gun — and the chest and head lean
    into the aim a little so the whole figure points, not just the barrel.
    """
    pivot = Vector((0.02, -0.24, 1.42))
    reach = 0.28 - 0.06 * recoil
    steep = abs(math.sin(e))
    # Steep aims carry the rifle out in front of the face and chest, or the
    # head and hair swallow it exactly when the aim matters most.
    grip = pivot + Vector((math.cos(e) * reach + 0.2 * steep, -0.1 * steep, -math.sin(e) * reach + b))
    return dict(
        weapon=(tuple(grip), e - 0.05 * recoil, 3 + 8 * steep, 0),
        ikL=1.0,
        offhand=(0.48, 0.0, 0.0),
        chest=(4 - 4 * recoil + math.degrees(e) * 0.3, -6, 0),
        head=(-4 + math.degrees(e) * 0.35, 6, 0),
    )


def gun_legs(r=0.0):
    return pose(
        root=(-0.02 * r, 0, -0.04),
        thighR=(14, 6),
        kneeR=14,
        footR=-6,
        thighL=(-14, 6),
        kneeL=10,
        footL=8,
        cape=4 + 4 * r,
        pony=-4 + 6 * r,
    )


def gun_hold_clip():
    frames = []
    for e in aim_elevations(AIM_BANDS_HOLD):
        p = gun_legs()
        p.update(gun_upper(e=e))
        frames.append(p)
    return frames


def gun_fire_clip():
    frames = []
    for e in aim_elevations(AIM_BANDS_HOLD):
        for r in (1.0, 0.0):
            p = gun_legs(r)
            p.update(gun_upper(recoil=r, e=e))
            frames.append(p)
    return frames


def gun_run_clip():
    frames = []
    for e in aim_elevations(AIM_BANDS_RUN):
        for i in range(8):
            t = i / 8
            p = run_pose(t)
            p.update(gun_upper(b=0.03 * abs(math.cos(2 * math.pi * t)), e=e))
            frames.append(p)
    return frames


def roll_clip():
    frames = []
    for i in range(8):
        a = i / 8 * 360
        tuck = math.sin(math.radians(min(180, a * 1.0))) if a <= 180 else math.sin(math.radians(a))
        frames.append(
            pose(
                root=(0, 0, -0.35),
                root_pitch=a + 20,
                root_pivot=(0, 0, 1.05),
                chest=(40, 0, 0),
                head=(30, 0, 0),
                hips=(10, 0, 0),
                thighR=(110, 10),
                kneeR=130,
                footR=30,
                thighL=(100, 10),
                kneeL=125,
                footL=30,
                armL=(70, 20),
                elbowL=100,
                armR=(70, 20),
                elbowR=100,
                ikR=0.0,
                cape=30 + 10 * abs(tuck),
                pony=-30,
                weapon=((0.2, -0.3, 1.0), 0.0, 0, 0),
            )
        )
    return frames


def disabled_clip():
    out = []
    for i in range(2):
        b = 1 if i else 0
        out.append(
            pose(
                root=(-0.06 * b, 0, -0.06),
                chest=(-24 - 6 * b, 8, -6),
                head=(-22 - 8 * b, 10, -8),
                hips=(-6, 0, 0),
                thighR=(-6, 10),
                kneeR=26,
                thighL=(26, 10),
                kneeL=40,
                footL=-10,
                armL=(-30 - 10 * b, 60),
                elbowL=30,
                armR=(-20 - 10 * b, 50),
                elbowR=40,
                ikR=0.0,
                cape=24,
                pony=18 + 6 * b,
                weapon=((0.2, -0.3, 1.0), 0.0, 0, 0),
            )
        )
    return out


def helpless_clip():
    out = []
    for i in range(2):
        b = 1 if i else 0
        out.append(
            pose(
                root=(-0.02, 0, 0.0),
                chest=(-26, 0, 0),
                head=(-28 - 6 * b, 0, 0),
                thighR=(4, 8),
                kneeR=8,
                thighL=(-4, 8),
                kneeL=8,
                armL=(150 - 10 * b, 20),
                elbowL=10,
                cape=-4,
                pony=24,
                # The sword up in the air, useless.
                weapon=((-0.02, -0.3, 2.3 - 0.04 * b), -1.9 - 0.15 * b, 10, 0),
            )
        )
    return out


def downed_clip():
    return [
        pose(
            root=(-0.1, 0, -0.62),
            root_pitch=-88,
            root_pivot=(0, 0, 0.7),
            chest=(-4, 0, 0),
            head=(-10, 20, 0),
            thighR=(20, 6),
            kneeR=40,
            footR=0,
            thighL=(4, 10),
            kneeL=10,
            armL=(120, 40),
            elbowL=20,
            armR=(40, 60),
            elbowR=20,
            ikR=0.0,
            cape=-20,
            pony=40,
        )
    ]


def launched_clip():
    return [
        pose(
            root=(0.0, 0, 0.0),
            root_pitch=-80,
            root_pivot=(0, 0, 1.3),
            chest=(-10, 0, 0),
            head=(-20, 10, 0),
            thighR=(30, 8),
            kneeR=40,
            thighL=(10, 12),
            kneeL=20,
            armL=(150, 30),
            elbowL=30,
            armR=(140, 40),
            elbowR=30,
            ikR=0.0,
            cape=-30,
            pony=40,
        )
    ]


def plunge_clip():
    out = []
    for i in range(2):
        b = 1 if i else 0
        out.append(
            pose(
                root=(0, 0, 0.1),
                chest=(18, 0, 0),
                head=(18, 0, 0),
                thighR=(70, 6),
                kneeR=110,
                footR=20,
                thighL=(40, 6),
                kneeL=120,
                footL=30,
                cape=-40 - 6 * b,
                pony=60 + 8 * b,
                weapon=((0.22, -0.18, 0.95), math.pi / 2, 0, 0),
                ikL=1.0,
                offhand=(-0.13, 0.0, 0.0),
            )
        )
    return out


def stuck_clip():
    return [
        pose(
            root=(0, 0, -0.34),
            chest=(52, 0, 0),
            head=(-16, 0, 0),
            hips=(20, 0, 0),
            thighR=(60, 8),
            kneeR=100,
            footR=-30,
            thighL=(-10, 8),
            kneeL=60,
            footL=40,
            cape=50,
            pony=-20,
            weapon=((0.72, -0.2, 0.62), 1.35, 0, 0),
            ikL=1.0,
            offhand=(-0.13, 0.0, 0.0),
        )
    ]


def turn_clip():
    p = pose(root_yaw=-65.0, armL=(4, 14), elbowL=10, cape=0)
    p["weapon"] = ((0.34, -0.42, 1.0), 0.75, -30, 0)
    return [p]


def portrait_pose():
    """The hero shot: face-on, sword resting on the shoulder."""
    p = pose(
        root_yaw=-45.0,
        chest=(-4, 10, 0),
        head=(-4, 18, 0),
        thighR=(10, 10),
        kneeR=6,
        thighL=(-6, 10),
        kneeL=6,
        armL=(10, 25),
        elbowL=80,
        cape=8,
        pony=-6,
        weapon=((0.18, -0.46, 1.62), -2.3, 14, 0),
    )
    return [p]


# Clips drawn in the air: centred on the body, never planted on the floor.
AIRBORNE = {"jump", "fall", "plunge", "launched"}

CLIPS = [
    # name, poses, right, left, fps, loop, drive, props
    ("idle", idle_clip, "right-idle", "left-idle", 6, True, "", "sword"),
    ("run", run_clip, "right", "left", 16, True, "", "sword"),
    ("turn", turn_clip, "turn", "", 1, False, "", "sword"),
    ("jump", jump_clip, "jump", "jump-left", 10, True, "", "sword"),
    ("fall", fall_clip, "fall", "fall-left", 10, True, "", "sword"),
    ("block", block_clip, "block", "block-left", 1, False, "", "sword"),
    ("charge", charge_clip, "charge", "charge-left", 8, True, "", "sword"),
    ("charge-run", lambda: run_clip(charge_upper()), "charge-walk", "charge-walk-left", 16, True, "", "sword"),
    ("slash", slash_clip, "slash", "slash-left", 0, False, "move", "sword"),
    ("slash2", slash2_clip, "slash2", "slash2-left", 0, False, "move", "sword"),
    ("slash3", slash3_clip, "slash3", "slash3-left", 0, False, "move", "sword"),
    ("uppercut", uppercut_clip, "uppercut", "uppercut-left", 0, False, "move", "sword"),
    ("massive", massive_clip, "slam", "slam-left", 0, False, "move", "sword"),
    ("plunge", plunge_clip, "plunge", "plunge-left", 12, True, "", "sword"),
    ("stuck", stuck_clip, "stuck", "stuck-left", 1, False, "", "sword"),
    ("gun-hold", gun_hold_clip, "gun-hold", "gun-hold-left", 1, False, "aim", "rifle"),
    ("gun-fire", gun_fire_clip, "gun-fire", "gun-fire-left", 12, True, "aim", "rifle"),
    ("gun-run", gun_run_clip, "gun-run", "gun-run-left", 16, True, "aim", "rifle"),
    ("roll", roll_clip, "roll-right", "roll-left", 25, True, "", "none"),
    ("disabled", disabled_clip, "disabled", "disabled-left", 8, True, "", "none"),
    ("helpless", helpless_clip, "helpless", "helpless-left", 6, True, "", "sword"),
    ("downed", downed_clip, "downed", "downed-left", 1, False, "", "none"),
    ("launched", launched_clip, "launched", "launched-left", 1, False, "", "none"),
    ("portrait", portrait_pose, "portrait", "", 1, False, "", "sword"),
]


# ================================================================ scene
def build_scene():
    scene = bpy.context.scene
    scene.name = "Lia"
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.film_transparent = True
    scene.render.filter_size = 0.0
    scene.eevee.taa_render_samples = 1
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.fps = 60
    scene.render.resolution_percentage = 100
    world = bpy.data.worlds.new("Void")
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs["Strength"].default_value = 0.0
    scene.world = world

    # The key light: upper left, in front — the SNES convention.
    sun_data = bpy.data.lights.new("Key", "SUN")
    sun_data.energy = math.pi
    sun_data.use_shadow = False
    sun = bpy.data.objects.new("Key", sun_data)
    scene.collection.objects.link(sun)
    d = Vector((0.55, 0.75, -0.55)).normalized()
    sun.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()

    cam_data = bpy.data.cameras.new("SpriteCam")
    cam_data.type = "ORTHO"
    cam = bpy.data.objects.new("SpriteCam", cam_data)
    scene.collection.objects.link(cam)
    tilt = math.radians(CAM_TILT_DEG)
    dist = 20.0
    cam.location = BODY_CENTRE + Vector((0, -math.cos(tilt) * dist, math.sin(tilt) * dist))
    cam.rotation_euler = (math.radians(90) - tilt, 0, 0)
    cam_data.clip_end = 100
    scene.camera = cam
    # The raw render canvas; make-hero-art.py crops it to the frames' union.
    scene["lia_px_per_m"] = PX_PER_M
    scene["lia_canvas_px"] = 320
    scene["lia_body_h_px"] = 96
    scene["lia_portrait_scale"] = 4
    scene.render.resolution_x = 320
    scene.render.resolution_y = 320
    cam_data.ortho_scale = 320 / PX_PER_M



def build(hero, build_model):
    """Build `art/<hero>/<hero>.blend` from scratch — refuses to overwrite
    without `--force`, because once anyone has edited it the .blend, not the
    script, is the source of truth."""
    blend = os.path.join(ROOT, "art", hero, f"{hero}.blend")
    if os.path.exists(blend) and "--force" not in sys.argv:
        print(f"{blend} exists — it is the source of truth now. Pass --force to rebuild it from scratch.")
        return
    bpy.ops.wm.read_factory_settings(use_empty=True)
    build_scene()
    col = bpy.data.collections.new(hero.capitalize())
    bpy.context.scene.collection.children.link(col)
    arm = build_armature(col)
    build_model(arm, col)
    arm.animation_data_create()
    for name, fn, right, left, fps, loop, drive, props in CLIPS:
        ms = 0
        if drive == "move":
            m = MOVES[name]
            ms = m["startup"] + m["active"] + m["recovery"]
        make_clip(
            arm, name, fn(), right, left, fps=fps, loop=loop, drive=drive, props=props, ms=ms, ground=name not in AIRBORNE
        )
    idle = bpy.data.actions["clip.idle"]
    arm.animation_data.action = idle
    arm.animation_data.action_slot = idle.slots[0]
    os.makedirs(os.path.dirname(blend), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=blend, compress=True)
    print(f"wrote {blend}")
