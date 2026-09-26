"""Render every clip in a hero's .blend to raw PNG frames.

    blender -b art/<hero>/<hero>.blend -P scripts/blender/hero_render.py -- OUT_DIR [--only clip.slash,...]

Builds nothing — the .blend is the source of truth. For each Action named
`clip.*` it assigns the action to the rig, shows the weapon objects its
`lia_props` asks for, and renders every keyframed frame. Output:

    OUT_DIR/<action>/<nnn>.png   one per keyed frame, the full raw canvas
    OUT_DIR/manifest.json        the clips' game metadata, in order

`scripts/make-hero-art.py` turns that into the shipped sheet. The portrait
action is rendered at `lia_portrait_scale`x the pixel density.
"""

import json
import os
import sys

import bpy

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
OUT = os.path.abspath(argv[0]) if argv else os.path.abspath("lia-frames")
ONLY = None
if "--only" in argv:
    ONLY = set(argv[argv.index("--only") + 1].split(","))

scene = bpy.context.scene
arm = next(ob for ob in bpy.data.objects if ob.type == "ARMATURE")
cam = scene.camera
canvas = int(scene.get("lia_canvas_px", 320))
px_per_m = float(scene.get("lia_px_per_m", 32))
portrait_scale = int(scene.get("lia_portrait_scale", 4))

# Which objects each weapon mode shows. Anything not listed is always shown.
GUNS = ("Rifle", "Shotgun", "Gun")
# `Dagger` is Anands' melee weapon: in hand for her melee clips, put away
# (hidden — she has no scabbard on her back) for the gun and the tumble.
PROPS = {
    "sword": {"Sword": True, "SwordBack": False, "Dagger": True, **dict.fromkeys(GUNS, False)},
    "rifle": {"Sword": False, "SwordBack": True, "Dagger": False, **dict.fromkeys(GUNS, True)},
    "none": {"Sword": False, "SwordBack": True, "Dagger": False, **dict.fromkeys(GUNS, False)},
}


def keyed_frames(action):
    frames = set()
    for layer in action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                for fc in bag.fcurves:
                    for kp in fc.keyframe_points:
                        frames.add(int(round(kp.co.x)))
    return sorted(frames)


def set_props(mode):
    for name, shown in PROPS.get(mode, PROPS["sword"]).items():
        ob = bpy.data.objects.get(name)
        if ob:
            ob.hide_render = not shown


def render_to(path, scale=1):
    scene.render.resolution_x = canvas * scale
    scene.render.resolution_y = canvas * scale
    cam.data.ortho_scale = canvas / px_per_m
    # The ink hull is ~1px at sprite scale; keep it ~1px-per-scale at the
    # portrait's density too (thicker in metres would swallow the face).
    for ob in bpy.data.objects:
        mod = ob.modifiers.get("Outline")
        if mod:
            if "lia_outline_m" not in ob:
                ob["lia_outline_m"] = mod.thickness
            mod.thickness = ob["lia_outline_m"] * (1.0 if scale == 1 else 0.5)
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


manifest = {"canvas": canvas, "pxPerM": px_per_m, "bodyH": int(scene.get("lia_body_h_px", 96)), "clips": []}
os.makedirs(OUT, exist_ok=True)
actions = sorted((a for a in bpy.data.actions if a.name.startswith("clip.")), key=lambda a: a.name)
for act in actions:
    if ONLY and act.name not in ONLY:
        continue
    arm.animation_data.action = act
    if act.slots:
        arm.animation_data.action_slot = act.slots[0]
    set_props(act.get("lia_props", "sword"))
    frames = keyed_frames(act)
    portrait = act.get("lia_right") == "portrait"
    files = []
    for i, f in enumerate(frames):
        scene.frame_set(f)
        path = os.path.join(OUT, act.name, f"{i:03d}.png")
        render_to(path, portrait_scale if portrait else 1)
        files.append(os.path.relpath(path, OUT))
    manifest["clips"].append(
        {
            "action": act.name,
            "right": act.get("lia_right", ""),
            "left": act.get("lia_left", ""),
            "fps": act.get("lia_fps", 10),
            "loop": bool(act.get("lia_loop", True)),
            "drive": act.get("lia_drive", ""),
            "bands": int(act.get("lia_bands", 0)),
            "files": files,
            "scale": portrait_scale if portrait else 1,
        }
    )
    print(f"rendered {act.name}: {len(files)} frames")

with open(os.path.join(OUT, "manifest.json"), "w") as fh:
    json.dump(manifest, fh, indent=1)
