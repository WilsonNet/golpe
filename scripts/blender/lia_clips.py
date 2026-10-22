"""Lia's weapons, render scene and clips — on her rigged Tripo mesh.

Run in the live Blender with `art/lia/lia.blend` open (after `lia_rig.rig()`
and `lia_look.apply()`):

    import lia_clips; lia_clips.build()

Then `python3 scripts/make-hero-art.py lia` renders and packs her atlas.

Every shared clip is hers (they were posed for her), carried from the
primitive model's reach into the generated one's by `jeffs_clips.rebase`: her
shoulder now sits at z 2.25 (the primitive's at 1.5), the arm 0.78 m. Her
sword and rifle are the primitive model's (`Sword.primitive`,
`Rifle.primitive`) re-linked to the new rig. There is no `SwordBack`: the
generated mesh wears its own sheath across her back. She also gets the item
throw (her HE grenade), which the primitive never had, and Jeffs' shoulder-
relative block and portrait grips (`jeffs_clips.OVERRIDES`).
"""

import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(__file__))

import anands_clips  # noqa: E402
import jeffs_clips  # noqa: E402
import sprite_rig  # noqa: E402
from sprite_rig import add_outline, parent_to_bone  # noqa: E402

HERO_COLLECTION = "Tripo"
NON_RENDER = ("Lia.primitive",)
RIG_SCALE = 0.97  # 3 m plus the ink line against the contract's 100 px, as Anands' and Jeffs'


def setup_scene():
    scene = bpy.context.scene
    scene.camera = bpy.data.objects["SpriteCam"]
    for c in NON_RENDER:
        bpy.data.collections[c].hide_render = True
    ob = bpy.data.objects.get("PoseCam")
    if ob:
        ob.hide_render = True


def build_weapons(arm, col):
    out = []
    for name in ("Sword", "Rifle"):
        ob = bpy.data.objects.get(name)
        if ob:
            bpy.data.objects.remove(ob, do_unlink=True)
        src = bpy.data.objects[f"{name}.primitive"]
        ob = bpy.data.objects.new(name, src.data)
        col.objects.link(ob)
        if not ob.modifiers.get("Outline"):
            add_outline(ob)
        parent_to_bone(ob, arm, "weapon")
        out.append(ob)
    return out


def _shared(name, arm):
    fn = next(c[1] for c in sprite_rig.CLIPS if c[0] == name)
    return jeffs_clips.rebase(fn(), arm, jeffs_clips.LIA_SHOULDER, jeffs_clips.LIA_ARM)


def build():
    setup_scene()
    arm = bpy.data.objects[sprite_rig.RIG_NAME]
    col = bpy.data.collections[HERO_COLLECTION]
    build_weapons(arm, col)
    for act in [a for a in bpy.data.actions if a.name.startswith("clip.")]:
        bpy.data.actions.remove(act)
    arm.animation_data_create()
    arm.scale = (RIG_SCALE,) * 3
    clips = [
        (c[0], jeffs_clips.OVERRIDES.get(c[0]) or (lambda n=c[0]: _shared(n, arm)), *c[2:])
        for c in sprite_rig.CLIPS
    ]
    clips.append(
        ("throw", lambda: jeffs_clips.rebase(anands_clips.throw_clip(), arm, jeffs_clips.ANANDS_SHOULDER,
                                             jeffs_clips.ANANDS_ARM), "throw", "throw-left", 10, False, "", "none")
    )
    for name, fn, right, left, fps, loop, drive, props in clips:
        sprite_rig.make_clip(
            arm, name, fn(), right, left, fps=fps, loop=loop, drive=drive, props=props,
            ground=name not in sprite_rig.AIRBORNE,
        )
    idle = bpy.data.actions["clip.idle"]
    arm.animation_data.action = idle
    arm.animation_data.action_slot = idle.slots[0]
    return [c[0] for c in clips]
