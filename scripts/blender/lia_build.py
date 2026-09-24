"""Bootstrap Lia's Blender source file on the shared sprite rig.

Run ONCE (or with --force to start over) — after that `art/lia/lia.blend` is
the source of truth and is edited by hand in Blender:

    blender -b --factory-startup -P scripts/blender/lia_build.py -- [--force]

This file is only Lia's *look*: her palette and her model (a Toriyama chibi
swordswoman — teal spiked ponytail, circlet, crimson tunic, cream cape,
sword and rifle). The rig, shader, camera and every clip's poses are shared,
in `sprite_rig.py`. Render with `python3 scripts/make-hero-art.py lia`;
the editing guide is art/README.md.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

import bpy  # noqa: E402
from mathutils import Euler, Matrix, Vector  # noqa: E402

from sprite_rig import FLAT, PALETTE, SHINY, Part, add_outline, build, parent_to_bone  # noqa: E402

# ---------------------------------------------------------------- palette
# (lit, shade, highlight) — hue-shifted shadows, the pixel-art rule: shade
# moves toward purple/red, never toward grey.
PALETTE.update({
    "skin": ((1.00, 0.84, 0.68), (0.90, 0.58, 0.50), (1.00, 0.93, 0.84)),
    "hair": ((0.22, 0.80, 0.74), (0.10, 0.45, 0.56), (0.62, 0.98, 0.88)),
    "tunic": ((0.86, 0.18, 0.24), (0.52, 0.09, 0.26), (1.00, 0.46, 0.44)),
    "cape": ((0.98, 0.94, 0.84), (0.72, 0.66, 0.78), (1.00, 1.00, 1.00)),
    "leather": ((0.62, 0.36, 0.20), (0.38, 0.19, 0.14), (0.80, 0.52, 0.30)),
    "belt": ((0.45, 0.27, 0.17), (0.27, 0.14, 0.12), (0.60, 0.40, 0.26)),
    "tights": ((0.20, 0.22, 0.40), (0.10, 0.10, 0.24), (0.34, 0.36, 0.58)),
    "gold": ((1.00, 0.82, 0.32), (0.78, 0.50, 0.16), (1.00, 0.96, 0.70)),
    "steel": ((0.80, 0.86, 0.94), (0.46, 0.52, 0.68), (1.00, 1.00, 1.00)),
    "gunmetal": ((0.36, 0.38, 0.46), (0.18, 0.18, 0.26), (0.58, 0.62, 0.72)),
    "wood": ((0.66, 0.40, 0.22), (0.42, 0.22, 0.16), (0.82, 0.56, 0.34)),
    "gem": ((0.72, 0.44, 1.00), (0.42, 0.18, 0.82), (0.95, 0.85, 1.00)),
})
SHINY.update({"hair", "steel", "gold", "gem"})
FLAT.update({
    "ink": (0.09, 0.06, 0.13),
    "eye_white": (1.0, 1.0, 1.0),
    "iris": (0.16, 0.11, 0.26),
    "mouth": (0.55, 0.20, 0.22),
})



# ================================================================ the model
def build_model(arm, col):
    # ---- head -----------------------------------------------------------
    head = Part("Head")
    FACE_C = Vector((0.07, 0, 2.02))
    FACE_R = Vector((0.37, 0.39, 0.39))
    head.ellipsoid(FACE_C, FACE_R, "skin")
    head.ellipsoid((0.13, 0, 1.84), (0.25, 0.27, 0.2), "skin")  # soft jaw
    head.ellipsoid((0.46, 0, 1.96), (0.035, 0.03, 0.03), "skin")  # button nose
    for s in (-1, 1):
        head.ellipsoid((0.02, s * 0.385, 2.0), (0.06, 0.04, 0.08), "skin")  # ears
    head.build(col)

    # The face: Toriyama eyes — tall ovals, dark iris, one hard shine — a
    # lash line on top and determined brows. Flat (unlit), no hull: they are
    # already ink.
    face = Part("Face")

    def on_face(y, z, lift=0.0):
        dy = y / FACE_R.y
        dz = (z - FACE_C.z) / FACE_R.z
        x = FACE_C.x + FACE_R.x * math.sqrt(max(0.0, 1 - dy * dy - dz * dz))
        return Vector((x + lift, y, z))

    for s in (-1, 1):
        y = s * 0.14
        yaw = math.degrees(math.asin(y / FACE_R.y)) * 0.9
        face.ellipsoid(on_face(y, 2.02, -0.012), (0.03, 0.075, 0.12), "eye_white", rot=(0, 0, yaw), seg=12, rings=8)
        face.ellipsoid(on_face(y + s * 0.01, 1.995, 0.004), (0.028, 0.066, 0.108), "iris", rot=(0, 0, yaw), seg=12, rings=8)
        face.ellipsoid(on_face(y - s * 0.012, 2.05, 0.02), (0.012, 0.024, 0.03), "eye_white", seg=8, rings=6)
        # Lash line, heavy, with a flick at the outer corner — the one mark
        # that says "her" at 5 pixels.
        face.box(on_face(y, 2.14, 0.012), (0.024, 0.16, 0.036), "ink", rot=(s * -6, 0, yaw))
        face.box(on_face(y + s * 0.085, 2.15, 0.0), (0.02, 0.05, 0.03), "ink", rot=(s * -35, 0, yaw))
        face.box(on_face(y * 1.02, 2.235, 0.02), (0.016, 0.1, 0.014), "ink", rot=(s * -10, 0, yaw))  # brow, arched
    face.box(on_face(0.0, 1.85, 0.0), (0.02, 0.1, 0.022), "mouth")
    face.build(col, outline=False)

    # ---- hair: spiky clumps around a cap, and a circlet ------------------
    hair = Part("Hair")
    CAP_C = Vector((-0.04, 0, 2.17))
    hair.ellipsoid(CAP_C, (0.42, 0.41, 0.4), "hair")

    def on_cap(az, el, r=0.36):
        a, e = math.radians(az), math.radians(el)
        return CAP_C + Vector((math.cos(e) * math.cos(a) * r, math.cos(e) * math.sin(a) * r, math.sin(e) * r))

    # Bangs: forward and down over the forehead, stopping above the eyes.
    for az, el, tip, r0 in [
        (0, 55, (0.52, 0.02, 2.2), 0.16),
        (-28, 45, (0.47, -0.22, 2.14), 0.15),
        (28, 45, (0.47, 0.22, 2.14), 0.15),
        (-55, 30, (0.34, -0.4, 1.98), 0.13),
        (55, 30, (0.34, 0.4, 1.98), 0.13),
    ]:
        hair.spike(on_cap(az, el), tip, r0, "hair", bend=(0.04, 0, 0.08))
    # Crown: up and back, the silhouette's flame.
    for az, el, tip, r0 in [
        (150, 70, (-0.4, 0.12, 2.7), 0.18),
        (-150, 70, (-0.4, -0.12, 2.7), 0.18),
        (30, 75, (0.26, 0.08, 2.68), 0.17),
        (-30, 75, (0.26, -0.08, 2.68), 0.17),
    ]:
        hair.spike(on_cap(az, el), tip, r0, "hair", bend=(0.0, 0, 0.1))
    # Back and side locks: down past the ears.
    for az, el, tip, r0 in [
        (180, 20, (-0.6, 0.0, 1.92), 0.18),
        (140, 15, (-0.46, 0.32, 1.84), 0.16),
        (-140, 15, (-0.46, -0.32, 1.84), 0.16),
        (85, 15, (0.12, 0.46, 1.66), 0.12),
        (-85, 15, (0.12, -0.46, 1.66), 0.12),
        (110, 5, (-0.14, 0.5, 1.7), 0.11),
        (-110, 5, (-0.14, -0.5, 1.7), 0.11),
    ]:
        hair.spike(on_cap(az, el), tip, r0, "hair", bend=(0.0, 0, -0.04))
    # The circlet: a gold band across the brow, a violet gem at the front
    # (the black hole's colour — the one hint of what she carries).
    band = []
    for k in range(13):
        a = math.radians(-100 + k * (200 / 12))
        band.append(CAP_C + Vector((math.cos(a) * 0.455, math.sin(a) * 0.44, 0.02 + 0.03 * math.cos(a))))
    hair.tube(band, [0.036] * len(band), "gold", sides=6)
    hair.ellipsoid(CAP_C + Vector((0.445, 0, 0.065)), (0.04, 0.05, 0.055), "gem")
    hair.build(col)

    pony = Part("Ponytail")
    PB = Vector((-0.3, 0, 2.42))
    pony.ellipsoid(PB, (0.09, 0.1, 0.09), "gold")  # hair tie
    for tip, r0, bend in [
        ((-1.08, 0.0, 2.12), 0.18, (-0.05, 0, 0.2)),
        ((-1.02, 0.12, 1.72), 0.16, (-0.05, 0, 0.14)),
        ((-0.9, -0.12, 1.5), 0.15, (0.0, 0, 0.1)),
        ((-1.0, -0.06, 2.46), 0.13, (0, 0, 0.12)),
        ((-0.7, 0.08, 1.36), 0.12, (0.05, 0, 0.05)),
    ]:
        pony.spike(PB + Vector((-0.04, 0, 0)), tip, r0, "hair", bend=bend)
    pony.build(col)

    # ---- torso ------------------------------------------------------------
    torso = Part("Torso")
    torso.tube(
        [(0, 0, 1.06), (0.01, 0, 1.3), (0.0, 0, 1.52), (-0.01, 0, 1.64)],
        [(0.36, 0.3), (0.38, 0.31), (0.35, 0.28), (0.22, 0.19)],
        "tunic",
        up=(1, 0, 0),
    )
    torso.tube([(0, 0, 1.6), (0, 0, 1.76)], [0.085, 0.08], "skin", sides=10)  # neck
    # The scarf collar, the same orange as the cape it becomes.
    collar = []
    for k in range(17):
        a = 2 * math.pi * k / 16
        collar.append((math.cos(a) * 0.2, math.sin(a) * 0.23, 1.64 - 0.02 * math.cos(a)))
    torso.tube(collar, [0.07] * 17, "cape", sides=8, cap_start=False, cap_end=False)
    torso.tube([(0, 0, 1.0), (0, 0, 1.11)], [(0.38, 0.32), (0.38, 0.32)], "belt", up=(1, 0, 0))
    torso.box((0.325, 0, 1.055), (0.05, 0.13, 0.11), "gold", bevel=0.01)
    torso.box((0.05, -0.29, 1.03), (0.14, 0.06, 0.12), "leather", bevel=0.01)  # pouch
    # The pauldron on the sword arm's shoulder.
    torso.ellipsoid((0.0, -0.35, 1.54), (0.15, 0.12, 0.08), "steel", rot=(22, 0, 0))
    torso.tube([(0.0, -0.37, 1.5), (0.0, -0.39, 1.47)], [0.13, 0.13], "gold", sides=10)
    torso.ellipsoid((0.0, 0.36, 1.53), (0.13, 0.11, 0.1), "tunic", rot=(-18, 0, 0))
    torso.build(col)

    skirt = Part("Skirt")
    skirt.tube(
        [(0, 0, 1.08), (0.02, 0, 0.9), (0.05, 0, 0.72)],
        [(0.37, 0.31), (0.41, 0.36), (0.46, 0.43)],
        "tunic",
        up=(1, 0, 0),
    )
    skirt.tube([(0.05, 0, 0.745), (0.05, 0, 0.7)], [(0.465, 0.435), (0.47, 0.44)], "gold", up=(1, 0, 0))
    skirt.build(col)

    cape = Part("Cape")
    rows = []
    for j in range(6):
        t = j / 5
        z = 1.58 - t * 0.78
        half = 0.26 + t * 0.14
        xback = -0.2 - t * 0.12
        row = []
        for k in range(7):
            u = k / 6 * 2 - 1
            row.append(cape.bm.verts.new((xback + 0.12 * (1 - u * u) * -1 + 0.1 * abs(u), u * half, z)))
        rows.append(row)
    for j in range(5):
        for k in range(6):
            cape.bm.faces.new((rows[j][k], rows[j][k + 1], rows[j + 1][k + 1], rows[j + 1][k]))
    cape._assign(set(), "cape")
    cape_ob = cape.build(col, outline=False)
    sol = cape_ob.modifiers.new("Thickness", "SOLIDIFY")
    sol.thickness = 0.03
    add_outline(cape_ob)

    # ---- limbs --------------------------------------------------------------
    parts = {}
    for side, s in (("R", -1), ("L", 1)):
        up = Part(f"UpperArm.{side}")
        # Bare upper arms: skin against the crimson tunic is what lets an arm
        # read in front of the body at sprite size.
        up.tube([(0, s * 0.33, 1.5), (-0.05, s * 0.38, 1.2)], [0.12, 0.11], "skin", sides=10)
        parts[f"upperarm.{side}"] = up
        fo = Part(f"Forearm.{side}")
        fo.ellipsoid((-0.05, s * 0.38, 1.2), (0.115, 0.115, 0.115), "skin")
        fo.tube([(-0.04, s * 0.385, 1.17), (0.02, s * 0.4, 0.98)], [0.11, 0.12], "leather", sides=10)
        fo.tube([(0.0, s * 0.395, 1.08), (0.01, s * 0.398, 1.03)], [0.135, 0.135], "gold", sides=10)
        fo.ellipsoid((0.03, s * 0.4, 0.89), (0.14, 0.13, 0.14), "leather")  # mitten hand
        parts[f"forearm.{side}"] = fo
        th = Part(f"Thigh.{side}")
        th.tube([(0, s * 0.15, 0.95), (0.02, s * 0.16, 0.55)], [0.16, 0.14], "tights", sides=10)
        parts[f"thigh.{side}"] = th
        sh = Part(f"Shin.{side}")
        sh.ellipsoid((0.02, s * 0.16, 0.55), (0.14, 0.14, 0.14), "tights")
        sh.tube([(0.02, s * 0.16, 0.5), (0, s * 0.16, 0.16)], [0.165, 0.155], "leather", sides=10)
        sh.tube([(0.02, s * 0.16, 0.51), (0.02, s * 0.16, 0.45)], [0.185, 0.185], "gold", sides=10)
        parts[f"shin.{side}"] = sh
        ft = Part(f"Boot.{side}")
        ft.ellipsoid((0.11, s * 0.16, 0.11), (0.25, 0.16, 0.13), "leather")
        ft.box((0.11, s * 0.16, 0.0), (0.48, 0.3, 0.04), "belt", bevel=0.01)
        parts[f"foot.{side}"] = ft
    objs = {k: p.build(col) for k, p in parts.items()}

    # ---- weapons ------------------------------------------------------------
    sword = Part("Sword")
    G = Vector((0, 0, 1.0))
    sword.tube([G + Vector((-0.13, 0, 0)), G + Vector((0.08, 0, 0))], [0.045, 0.045], "belt", sides=8)
    sword.ellipsoid(G + Vector((-0.16, 0, 0)), (0.055, 0.055, 0.055), "gold")
    sword.box(G + Vector((0.11, 0, 0)), (0.07, 0.09, 0.4), "gold", bevel=0.015)
    sword.ellipsoid(G + Vector((0.11, 0, 0)), (0.05, 0.07, 0.05), "gem")
    # The blade: a flat diamond section, wide in the screen plane.
    blade_pts = [G + Vector((x, 0, 0)) for x in (0.14, 0.6, 1.2, 1.5, 1.66)]
    blade_r = [(0.022, 0.085), (0.022, 0.082), (0.02, 0.075), (0.016, 0.05), (0.004, 0.006)]
    sword.tube(blade_pts, blade_r, "steel", sides=4, up=(0, 0, 1))
    sword_ob = sword.build(col, smooth=False)

    rifle = Part("Rifle")
    rifle.box(G + Vector((0.14, 0, 0.07)), (0.46, 0.1, 0.16), "gunmetal", bevel=0.015)
    rifle.tube([G + Vector((0.36, 0, 0.1)), G + Vector((1.08, 0, 0.1))], [0.032, 0.03], "gunmetal", sides=8)
    rifle.box(G + Vector((0.52, 0, 0.04)), (0.34, 0.11, 0.1), "wood", bevel=0.015)
    rifle.box(G + Vector((-0.28, 0, -0.02)), (0.44, 0.09, 0.15), "wood", rot=(0, 8, 0), bevel=0.02)
    rifle.box(G + Vector((0.02, 0, -0.07)), (0.07, 0.08, 0.16), "wood", rot=(0, -15, 0))
    rifle.tube([G + Vector((0.04, 0, 0.21)), G + Vector((0.34, 0, 0.21))], [0.04, 0.04], "gunmetal", sides=8)
    rifle.ellipsoid(G + Vector((0.35, 0, 0.21)), (0.012, 0.035, 0.035), "gem")
    rifle.box(G + Vector((1.08, 0, 0.15)), (0.03, 0.02, 0.05), "gunmetal")
    rifle_ob = rifle.build(col)

    # ---- parent everything to its bone --------------------------------------
    for name, bone in [
        ("Head", "head"),
        ("Face", "head"),
        ("Hair", "head"),
        ("Ponytail", "pony"),
        ("Torso", "chest"),
        ("Skirt", "hips"),
        ("Cape", "cape"),
    ]:
        parent_to_bone(bpy.data.objects[name], arm, bone)
    for bone, ob in objs.items():
        parent_to_bone(ob, arm, bone)
    parent_to_bone(sword_ob, arm, "weapon")
    parent_to_bone(rifle_ob, arm, "weapon")

    # The sword on her back, for the gun stance: the same mesh, linked.
    back = bpy.data.objects.new("SwordBack", sword_ob.data)
    col.objects.link(back)
    add_outline(back)
    # Build the transform in armature space: grip behind the right hip, blade
    # up across the back.
    rot = Euler((math.radians(0), math.radians(-128), math.radians(0))).to_matrix().to_4x4()
    m = Matrix.Translation((-0.3, -0.05, 1.05)) @ rot @ Matrix.Translation(-G)
    back.parent = arm
    back.parent_type = "BONE"
    back.parent_bone = "chest"
    bone = arm.data.bones["chest"]
    tail = bone.matrix_local @ Matrix.Translation((0, bone.length, 0))
    back.matrix_parent_inverse = tail.inverted()
    back.matrix_basis = m



build("lia", build_model)
