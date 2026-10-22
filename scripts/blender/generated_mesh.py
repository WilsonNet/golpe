"""Bring an image-to-3D GLB (Tripo) into the live Blender as a hero's base mesh.

    import generated_mesh; generated_mesh.import_glb("<repo>/art/<hero>/generated/<file>.glb", "Tripo", "<Hero>.tripo")

Shared by every generated hero (Jeffs, Lia); Anands' mesh was brought in by
hand the same way before this existed.
"""


def import_glb(path, collection, name):
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
