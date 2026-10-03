"""Ibiriki's sword and axe, cut from his first Tripo model.

The model he was first generated as held a viking sword in his left fist
and an axe raised in his right. Tripo's segmentation ("Dividir", Equilibrio)
split it into 13 parts — `art/ibiriki/generated/ibiriki-tripo-parts.glb` —
and the weapons came out as their own pieces: the sword in three
(`tripo_part_3`, `_9`, `_12`), the axe in two (`_2`, `_11`). This rebuilds
`Sword` and `Gun` (the axe in hand; `AxeOff` is copied from it by
`ibiriki_clips.build_weapons`) in the rig's weapon convention: the grip at
the weapon bone's head `G`, the blade along +X, the flat of the blade facing
the camera (−Y), the axe's edge down.

Run once in the live Blender with `art/ibiriki/ibiriki.blend` open:

    import ibiriki_weapons; ibiriki_weapons.build()

The fists hid the grips, so each weapon has a gap where the hand was; a
leather grip tube is modelled into it.
"""

import math
import os

import bpy
import numpy as np
from mathutils import Matrix, Vector

GLB = os.path.join(os.path.dirname(__file__), "..", "..", "art", "ibiriki", "generated", "ibiriki-tripo-parts.glb")
G = np.array([0.0, 0.0, 1.0])
SWORD = (["tripo_part_3", "tripo_part_9", "tripo_part_12"], "tripo_part_6", None, 0.7)
AXE = (["tripo_part_2", "tripo_part_11"], "tripo_part_5", "-Z", 0.62)
# The empty grips, measured along each weapon's own axis after orienting.
SWORD_GRIP = (-0.22, 0.2, 1.0, 0.048)
AXE_GRIP = (-0.15, 0.28, 1.03, 0.045)


def _import():
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(GLB))
    new = [o for o in bpy.data.objects if o not in before]
    for o in new:
        if o.type == "MESH":
            mw = o.matrix_world.copy()
            o.parent = None
            o.data.transform(mw)
            o.matrix_world = Matrix.Identity(4)
    for o in new:
        if o.type != "MESH":
            bpy.data.objects.remove(o, do_unlink=True)
    return {o.name.split(".")[0]: o for o in new if o.name in bpy.data.objects}


def _orient(o, fist, edge_to):
    """Grip at the fist → G, the long axis → +X, the thin axis → Y."""
    V = np.array([v.co[:] for v in o.data.vertices])
    c = V.mean(0)
    _u, _s, W = np.linalg.svd(V - c, full_matrices=False)
    a = W[0]
    pf = (fist - c) @ a
    proj = (V - c) @ a
    if proj.max() - pf < pf - proj.min():
        a = -a
    g = c + a * ((fist - c) @ a)
    w, thin = W[1], W[2]
    if edge_to is not None:
        top = V[((V - c) @ a) > np.percentile((V - c) @ a, 70)]
        if ((top - c) @ w).mean() < 0:
            w = -w
        z = -w if edge_to == "-Z" else w
    else:
        z = np.cross(a, thin)
    y = np.cross(z, a)
    y /= np.linalg.norm(y)
    z = np.cross(a, y)
    R = np.array([a, y, z])
    for v, nv in zip(o.data.vertices, (V - g) @ R.T + G):
        v.co = Vector(nv)
    o.data.update()


def _grip(o, x0, x1, z, r):
    bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=r, depth=x1 - x0, location=((x0 + x1) / 2, 0, z),
                                        rotation=(0, math.radians(90), 0))
    c = bpy.context.active_object
    leather = bpy.data.materials.get("grip_leather") or bpy.data.materials.new("grip_leather")
    c.data.materials.append(leather)
    for s in bpy.context.selected_objects:
        s.select_set(False)
    c.select_set(True)
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.join()


def _make(parts, names, fist, edge_to, scale, grip, name):
    obs = [parts[n] for n in names]
    for s in bpy.context.selected_objects:
        s.select_set(False)
    for o in obs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = obs[0]
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = ob.data.name = name
    fist_c = np.array([v.co[:] for v in parts[fist].data.vertices]).mean(0)
    _orient(ob, fist_c, edge_to)
    Gv = Vector(G)
    ob.data.transform(Matrix.Translation(Gv) @ Matrix.Scale(scale, 4) @ Matrix.Translation(-Gv))
    _grip(ob, *grip)
    return ob


def build():
    for n in ("Sword", "Gun"):
        old = bpy.data.objects.get(n)
        if old:
            bpy.data.objects.remove(old, do_unlink=True)
    parts = _import()
    sword = _make(parts, *SWORD[:2], SWORD[2], SWORD[3], SWORD_GRIP, "Sword")
    axe = _make(parts, *AXE[:2], AXE[2], AXE[3], AXE_GRIP, "Gun")
    for o in list(parts.values()):
        if o.name in bpy.data.objects and o.name not in ("Sword", "Gun"):
            bpy.data.objects.remove(o, do_unlink=True)
    return sword.name, axe.name


AXE_SPRITE = os.path.join(os.path.dirname(__file__), "..", "..", "public", "assets", "ibiriki-axe.png")


def render_axe_sprite(path=AXE_SPRITE):
    """The thrown axe's world sprite, rendered from `Gun` in his toon look:
    128 px over 1.6 m, haft along +X with the head at the right and the edge
    up, so `IbirikiFx` rotating it to the flight heading leads with the head
    (anchor 0.78, 0.45 is the head's centre)."""
    s = bpy.context.scene
    src = bpy.data.objects["Gun"]
    ax = src.copy()
    ax.data = src.data.copy()
    ax.name = "AxeSprite"
    for c in src.users_collection:
        c.objects.link(ax)
    ax.parent = None
    ax.matrix_world = Matrix.Identity(4)
    ax.data.transform(Matrix.Rotation(math.pi, 4, "X") @ Matrix.Translation((0, 0, -1.0)))
    hidden = {}
    for o in bpy.data.objects:
        if o.type == "MESH":
            hidden[o.name] = o.hide_render
            o.hide_render = o is not ax
    cam = s.camera
    old = (cam.location.copy(), cam.data.ortho_scale, s.render.resolution_x, s.render.resolution_y, s.render.filepath)
    cam.location = (0.3, -20, 0.0)
    cam.data.ortho_scale = 1.6
    s.render.resolution_x = s.render.resolution_y = 128
    s.render.filepath = os.path.abspath(path)
    try:
        bpy.ops.render.render(write_still=True)
    finally:
        cam.location, cam.data.ortho_scale, s.render.resolution_x, s.render.resolution_y, s.render.filepath = old
        for n, h in hidden.items():
            if n in bpy.data.objects:
                bpy.data.objects[n].hide_render = h
        bpy.data.objects.remove(ax, do_unlink=True)
