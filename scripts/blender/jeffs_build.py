"""Bootstrap Jeffs' Blender source file on the shared sprite rig.

Run ONCE (or with --force to start over) — after that `art/jeffs/jeffs.blend`
is the source of truth and is edited by hand in Blender:

    blender -b --factory-startup -P scripts/blender/jeffs_build.py -- [--force]

This file is only Jeffs' *look* (see specs/jeffs.md): a middle-aged
executioner in a fancy trench coat — greying slicked-back hair with grey
temples, heavy brows over narrowed eyes, stubble on a square jaw, a white
shirt and a red tie, a charcoal coat with the collar up, gold buttons and a
gold-buckled belt; a sword and a pump shotgun. The rig, shader, camera and
every clip's poses are shared, in `sprite_rig.py` — the same skeleton as
Lia's, so every clip the game picks exists for him too. Render with
`python3 scripts/make-hero-art.py jeffs`; the editing guide is art/README.md.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

import bpy  # noqa: E402
from mathutils import Euler, Matrix, Vector  # noqa: E402

from sprite_rig import FLAT, PALETTE, SHINY, Part, add_outline, build, parent_to_bone  # noqa: E402

# (lit, shade, highlight) — shades hue-shifted toward violet, never grey.
PALETTE.update(
    {
        "skin": ((0.94, 0.74, 0.58), (0.74, 0.48, 0.42), (1.00, 0.86, 0.72)),
        "stubble": ((0.70, 0.56, 0.50), (0.52, 0.38, 0.40), (0.78, 0.64, 0.58)),
        "hair": ((0.38, 0.34, 0.38), (0.22, 0.18, 0.26), (0.62, 0.60, 0.66)),
        "temple": ((0.80, 0.80, 0.84), (0.54, 0.54, 0.64), (0.94, 0.94, 0.98)),
        "coat": ((0.26, 0.29, 0.38), (0.14, 0.14, 0.24), (0.40, 0.44, 0.56)),
        "shirt": ((0.96, 0.95, 0.90), (0.72, 0.70, 0.80), (1.00, 1.00, 1.00)),
        "tie": ((0.84, 0.16, 0.20), (0.52, 0.08, 0.20), (1.00, 0.44, 0.44)),
        "trousers": ((0.22, 0.20, 0.26), (0.12, 0.10, 0.16), (0.34, 0.32, 0.40)),
        "shoe": ((0.26, 0.18, 0.18), (0.12, 0.08, 0.12), (0.46, 0.34, 0.32)),
        "leather": ((0.40, 0.26, 0.22), (0.24, 0.14, 0.16), (0.56, 0.40, 0.32)),
        "gold": ((1.00, 0.82, 0.32), (0.78, 0.50, 0.16), (1.00, 0.96, 0.70)),
        "steel": ((0.80, 0.86, 0.94), (0.46, 0.52, 0.68), (1.00, 1.00, 1.00)),
        "gunmetal": ((0.36, 0.38, 0.46), (0.18, 0.18, 0.26), (0.58, 0.62, 0.72)),
        "wood": ((0.62, 0.36, 0.22), (0.38, 0.20, 0.16), (0.78, 0.52, 0.32)),
    }
)
SHINY.update({"hair", "steel", "gold"})
FLAT.update(
    {
        "eye_white": (1.0, 1.0, 1.0),
        "iris": (0.14, 0.10, 0.16),
        "mouth": (0.42, 0.20, 0.22),
    }
)


def build_model(arm, col):
    # ---- head: a longer face and a square, stubbled jaw ---------------------
    head = Part("Head")
    FACE_C = Vector((0.08, 0, 2.03))
    FACE_R = Vector((0.35, 0.36, 0.41))
    head.ellipsoid(FACE_C, FACE_R, "skin")
    # The jaw: square and heavy, wearing the stubble.
    head.ellipsoid((0.15, 0, 1.83), (0.28, 0.3, 0.2), "stubble")
    head.box((0.2, 0, 1.76), (0.36, 0.44, 0.1), "stubble", bevel=0.04)
    head.ellipsoid((0.43, 0, 1.99), (0.07, 0.05, 0.075), "skin")  # a proper nose
    for s in (-1, 1):
        head.ellipsoid((0.03, s * 0.355, 2.0), (0.06, 0.04, 0.085), "skin")  # ears
    head.build(col)

    # The face: narrowed eyes under heavy, frowning brows — the look of a man
    # who has already decided. Flat (unlit), no hull.
    face = Part("Face")

    def on_face(y, z, lift=0.0):
        dy = y / FACE_R.y
        dz = (z - FACE_C.z) / FACE_R.z
        x = FACE_C.x + FACE_R.x * math.sqrt(max(0.0, 1 - dy * dy - dz * dz))
        return Vector((x + lift, y, z))

    for s in (-1, 1):
        y = s * 0.13
        yaw = math.degrees(math.asin(y / FACE_R.y)) * 0.9
        face.ellipsoid(on_face(y, 2.06, -0.012), (0.03, 0.07, 0.05), "eye_white", rot=(0, 0, yaw), seg=12, rings=8)
        face.ellipsoid(on_face(y + s * 0.012, 2.055, 0.004), (0.028, 0.045, 0.045), "iris", rot=(0, 0, yaw), seg=12, rings=8)
        # The heavy brow, sloping down toward the nose: the frown.
        face.box(on_face(y * 1.02, 2.14, 0.02), (0.03, 0.13, 0.04), "hair", rot=(s * 14, 0, yaw))
    face.box(on_face(0.0, 1.87, 0.012), (0.02, 0.11, 0.02), "mouth", rot=(0, 0, 0))
    face.build(col, outline=False)

    # ---- hair: slicked straight back, grey at the temples -------------------
    hair = Part("Hair")
    CAP_C = Vector((-0.05, 0, 2.18))
    hair.ellipsoid(CAP_C, (0.41, 0.385, 0.38), "hair")
    # Swept-back locks: they start at the hairline and lie flat along the
    # skull toward the nape — nothing points up.
    for y, z0, r0 in [(0.0, 2.5, 0.16), (0.15, 2.45, 0.14), (-0.15, 2.45, 0.14), (0.27, 2.34, 0.12), (-0.27, 2.34, 0.12)]:
        hair.spike((0.28, y * 0.9, z0 - 0.02), (-0.62, y * 1.1, z0 - 0.3), r0, "hair", bend=(0.0, 0, 0.12))
    for s in (-1, 1):
        hair.ellipsoid((0.14, s * 0.33, 2.16), (0.09, 0.06, 0.08), "temple")
    hair.build(col)

    # ---- the coat -----------------------------------------------------------
    torso = Part("Torso")
    torso.tube(
        [(0, 0, 1.04), (0.01, 0, 1.3), (0.0, 0, 1.52), (-0.01, 0, 1.64)],
        [(0.37, 0.31), (0.39, 0.33), (0.37, 0.31), (0.24, 0.2)],
        "coat",
        up=(1, 0, 0),
    )
    torso.tube([(0, 0, 1.6), (0, 0, 1.76)], [0.1, 0.095], "skin", sides=10)  # neck
    # The shirt front and the tie, in the V the lapels leave open.
    torso.box((0.33, 0, 1.44), (0.1, 0.26, 0.34), "shirt", rot=(0, -8, 0), bevel=0.03)
    torso.box((0.39, 0, 1.4), (0.04, 0.07, 0.3), "tie", rot=(0, -8, 0))
    torso.box((0.4, 0, 1.56), (0.04, 0.09, 0.06), "tie")
    for s in (-1, 1):
        torso.box((0.35, s * 0.16, 1.42), (0.06, 0.08, 0.4), "coat", rot=(s * 18, -8, 0), bevel=0.02)  # lapels
        torso.ellipsoid((0.36, s * 0.1, 1.18), (0.03, 0.03, 0.03), "gold")  # buttons
        torso.ellipsoid((0.37, s * 0.1, 1.28), (0.03, 0.03, 0.03), "gold")
    # The collar, turned up.
    collar = []
    for k in range(17):
        a = 2 * math.pi * k / 16
        collar.append((math.cos(a) * 0.19 - 0.02, math.sin(a) * 0.22, 1.7 - 0.05 * math.cos(a)))
    torso.tube(collar, [0.07] * 17, "coat", sides=6, cap_start=False, cap_end=False)
    torso.tube([(0, 0, 1.0), (0, 0, 1.1)], [(0.39, 0.33), (0.39, 0.33)], "leather", up=(1, 0, 0))
    torso.box((0.335, 0, 1.05), (0.05, 0.14, 0.11), "gold", bevel=0.01)
    torso.build(col)

    # The skirt of the coat: long, ending above the knee — a trench covers
    # the thigh, so the run animates the shins, the shoes and the hem.
    skirt = Part("Skirt")
    skirt.tube(
        [(0, 0, 1.08), (0.02, 0, 0.84), (0.06, 0, 0.6)],
        [(0.38, 0.32), (0.44, 0.38), (0.5, 0.45)],
        "coat",
        up=(1, 0, 0),
    )
    skirt.build(col)

    # Coat tails at the back, on the cape bone so they flap with the stride.
    tails = Part("Cape")
    tails.box((-0.34, 0, 0.82), (0.1, 0.56, 0.62), "coat", rot=(0, 12, 0), bevel=0.03)
    tails.build(col)

    # ---- limbs: coat sleeves, white cuffs, bare hands; trousers and shoes ---
    parts = {}
    for side, s in (("R", -1), ("L", 1)):
        up = Part(f"UpperArm.{side}")
        up.tube([(0, s * 0.33, 1.5), (-0.05, s * 0.38, 1.2)], [0.13, 0.12], "coat", sides=10)
        up.ellipsoid((0.0, s * 0.35, 1.52), (0.16, 0.14, 0.12), "coat")  # the shoulder
        parts[f"upperarm.{side}"] = up
        fo = Part(f"Forearm.{side}")
        fo.ellipsoid((-0.05, s * 0.38, 1.2), (0.12, 0.12, 0.12), "coat")
        fo.tube([(-0.04, s * 0.385, 1.17), (0.01, s * 0.398, 1.02)], [0.115, 0.125], "coat", sides=10)
        fo.tube([(0.01, s * 0.398, 1.03), (0.02, s * 0.4, 0.98)], [0.12, 0.12], "shirt", sides=10)  # cuff
        fo.ellipsoid((0.03, s * 0.4, 0.89), (0.13, 0.12, 0.13), "skin")  # hand
        parts[f"forearm.{side}"] = fo
        th = Part(f"Thigh.{side}")
        th.tube([(0, s * 0.15, 0.95), (0.02, s * 0.16, 0.55)], [0.16, 0.14], "trousers", sides=10)
        parts[f"thigh.{side}"] = th
        sh = Part(f"Shin.{side}")
        sh.ellipsoid((0.02, s * 0.16, 0.55), (0.14, 0.14, 0.14), "trousers")
        sh.tube([(0.02, s * 0.16, 0.5), (0, s * 0.16, 0.16)], [0.14, 0.13], "trousers", sides=10)
        parts[f"shin.{side}"] = sh
        ft = Part(f"Shoe.{side}")
        ft.ellipsoid((0.12, s * 0.16, 0.1), (0.25, 0.14, 0.11), "shoe")
        ft.box((0.12, s * 0.16, 0.0), (0.5, 0.28, 0.04), "leather", bevel=0.01)
        parts[f"foot.{side}"] = ft
    objs = {k: p.build(col) for k, p in parts.items()}

    # ---- weapons --------------------------------------------------------------
    sword = Part("Sword")
    G = Vector((0, 0, 1.0))
    sword.tube([G + Vector((-0.13, 0, 0)), G + Vector((0.08, 0, 0))], [0.045, 0.045], "leather", sides=8)
    sword.ellipsoid(G + Vector((-0.16, 0, 0)), (0.055, 0.055, 0.055), "gold")
    sword.box(G + Vector((0.11, 0, 0)), (0.07, 0.09, 0.36), "gold", bevel=0.015)
    blade_pts = [G + Vector((x, 0, 0)) for x in (0.14, 0.6, 1.2, 1.5, 1.66)]
    blade_r = [(0.022, 0.085), (0.022, 0.082), (0.02, 0.075), (0.016, 0.05), (0.004, 0.006)]
    sword.tube(blade_pts, blade_r, "steel", sides=4, up=(0, 0, 1))
    sword_ob = sword.build(col, smooth=False)

    # The pump shotgun: a short fat barrel over its magazine tube, a wooden
    # pump grip under it and a wooden stock — stubbier than Lia's rifle.
    gun = Part("Shotgun")
    gun.box(G + Vector((0.12, 0, 0.07)), (0.34, 0.11, 0.17), "gunmetal", bevel=0.015)
    gun.tube([G + Vector((0.28, 0, 0.12)), G + Vector((0.98, 0, 0.12))], [0.05, 0.048], "gunmetal", sides=8)
    gun.tube([G + Vector((0.28, 0, 0.03)), G + Vector((0.88, 0, 0.03))], [0.035, 0.035], "gunmetal", sides=8)
    gun.box(G + Vector((0.55, 0, 0.03)), (0.26, 0.12, 0.1), "wood", bevel=0.02)
    gun.box(G + Vector((-0.27, 0, -0.03)), (0.42, 0.1, 0.17), "wood", rot=(0, 10, 0), bevel=0.02)
    gun.box(G + Vector((0.02, 0, -0.07)), (0.07, 0.08, 0.16), "wood", rot=(0, -15, 0))
    gun.box(G + Vector((0.96, 0, 0.18)), (0.03, 0.02, 0.04), "gold")
    gun_ob = gun.build(col)

    # ---- parent everything to its bone ----------------------------------------
    for name, bone in [
        ("Head", "head"),
        ("Face", "head"),
        ("Hair", "head"),
        ("Torso", "chest"),
        ("Skirt", "hips"),
        ("Cape", "cape"),
    ]:
        parent_to_bone(bpy.data.objects[name], arm, bone)
    for bone, ob in objs.items():
        parent_to_bone(ob, arm, bone)
    parent_to_bone(sword_ob, arm, "weapon")
    parent_to_bone(gun_ob, arm, "weapon")

    # The sword on his back, for the gun stance: the same mesh, linked.
    back = bpy.data.objects.new("SwordBack", sword_ob.data)
    col.objects.link(back)
    add_outline(back)
    rot = Euler((0.0, math.radians(-128), 0.0)).to_matrix().to_4x4()
    m = Matrix.Translation((-0.34, -0.05, 1.05)) @ rot @ Matrix.Translation(-G)
    back.parent = arm
    back.parent_type = "BONE"
    back.parent_bone = "chest"
    bone = arm.data.bones["chest"]
    tail = bone.matrix_local @ Matrix.Translation((0, bone.length, 0))
    back.matrix_parent_inverse = tail.inverted()
    back.matrix_basis = m


build("jeffs", build_model)
