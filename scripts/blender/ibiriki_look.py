"""Give Ibiriki's generated mesh the SNES toon look — with thick ink lines.

Run in the live Blender after `ibiriki_rig.rig()`:

    import ibiriki_look; ibiriki_look.apply_tpose()

Anands' look classifies every face into a colour family, which works on a
dense mesh whose features span many faces. Ibiriki's eyes do not: his face
is *painted* on the ball, and at a sprite-sized mesh density an eye is a
handful of faces — a per-face vote erases it. So the families stay in the
**texture**: the mesh's base colour drives the shared `LiaToon` node (Lit =
the texture, Shade = the texture multiplied toward purple, Highlight = the
texture screened toward white), sampled linearly (mipmapped — closest
filtering was texel noise at sprite size). Every fill is still flat and every shade band still runs
along the edge away from the light; only the colour comes per texel.

**Thick lines.** The user's direction (2026-10-03): Tripo's cartoon preview
of him "looked cool" because of its heavy outline, so his inverted hull is
`OUTLINE_TPOSE_M` — nearly double the shared 0.034 m — and the packer's
selective silhouette line is 2 px wide on top of it.
"""

import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(__file__))

import sprite_rig  # noqa: E402

# The ball is a big sphere: the shared shade threshold (0.3) laid half of it
# in shade. His fills are lit unless they truly turn away, and the normal is
# flattened harder toward the viewer.
SHADE_BELOW = 0.0
FLATTEN = 1.3

# Shade: the texture multiplied by this — darker and pulled toward violet,
# the hue-shifted shadow every hero uses, never a plain grey.
SHADE_TINT = (0.56, 0.5, 0.74)
# Highlight: the texture screened toward white by this much (shiny parts only).
HIGHLIGHT_MIX = 0.38
# A little more colour than the generator's texture carries: at sprite size a
# soft texture reads washed out.
SATURATION = 1.18

def _basecolor(mat):
    if not mat or not mat.node_tree:
        return None
    for n in mat.node_tree.nodes:
        if n.type == "TEX_IMAGE" and n.image and "basecolor" in n.image.name:
            return n.image
    return mat.get("ibi_basecolor") and bpy.data.images.get(mat["ibi_basecolor"])


def texture_toon(img, shiny):
    """A LiaToon material whose colours are this texture's, per texel."""
    name = f"ibi.{img.name.split('_tripo_')[-1].replace('_basecolor.jpg', '')}"
    old = bpy.data.materials.get(name)
    if old:
        return old
    mat = bpy.data.materials.new(name)
    mat["ibi_basecolor"] = img.name
    img.use_fake_user = True
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    # Linear (mipmapped): a 1K texture sampled per sprite pixel with closest
    # filtering is texel noise.
    tex.interpolation = "Linear"
    hsv = nt.nodes.new("ShaderNodeHueSaturation")
    hsv.inputs["Saturation"].default_value = SATURATION
    nt.links.new(tex.outputs["Color"], hsv.inputs["Color"])
    shade = nt.nodes.new("ShaderNodeMix")
    shade.data_type = "RGBA"
    shade.blend_type = "MULTIPLY"
    shade.inputs[0].default_value = 1.0
    nt.links.new(hsv.outputs[0], shade.inputs[6])
    shade.inputs[7].default_value = (*sprite_rig.srgb_to_linear(SHADE_TINT), 1)
    hi = nt.nodes.new("ShaderNodeMix")
    hi.data_type = "RGBA"
    hi.blend_type = "SCREEN"
    hi.inputs[0].default_value = HIGHLIGHT_MIX
    nt.links.new(hsv.outputs[0], hi.inputs[6])
    hi.inputs[7].default_value = (1, 1, 1, 1)
    g = nt.nodes.new("ShaderNodeGroup")
    g.node_tree = sprite_rig.toon_group()
    nt.links.new(hsv.outputs[0], g.inputs["Lit"])
    nt.links.new(shade.outputs[2], g.inputs["Shade"])
    nt.links.new(hi.outputs[2], g.inputs["Highlight"])
    g.inputs["Highlight Above"].default_value = 0.97 if shiny else 1.01
    g.inputs["Shade Below"].default_value = SHADE_BELOW
    g.inputs["Flatten"].default_value = FLATTEN
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(g.outputs[0], out.inputs["Surface"])
    for i, node in enumerate((tex, hsv, shade, hi, g, out)):
        node.location = (i * 220, 0)
    return mat


def apply_tpose(mesh_name="Ibiriki.tripo"):
    """The look on the T-pose mesh: one texture-driven LiaToon material, the
    heavy ink hull, and smoothed normals (Anands' transfer) so the shade band
    follows the ball and the helmet instead of the generated surface's bumps."""
    sys.path.insert(0, os.path.dirname(__file__))
    import anands_look

    ob = bpy.data.objects[mesh_name]
    me = ob.data
    for i, mat in enumerate(me.materials):
        img = _basecolor(mat)
        if img is not None:
            me.materials[i] = texture_toon(img, False)
    for p in me.polygons:
        p.use_smooth = True
    old = ob.modifiers.get("Outline")
    if old:
        ob.modifiers.remove(old)
    sprite_rig.add_outline(ob, thickness=OUTLINE_TPOSE_M)
    anands_look.smooth_normals(ob, repeat=30)
    return [m.name for m in me.materials]


# The heavy cartoon ink, ~2 sprite px against the shared 1 (the user's call:
# Tripo's cartoon preview of him "looked cool" for its thick outline). The
# T-pose mesh is one clean generated surface, so a hull this thick sits on it
# without poking through; the packer's 2 px silhouette line
# (`art/ibiriki/palette.json` `outline_px`) thickens the outer contour.
OUTLINE_TPOSE_M = 0.06
