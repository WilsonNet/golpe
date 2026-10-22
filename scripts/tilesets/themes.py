#!/usr/bin/env python3
"""
Map-maker themes: the Waterfront's hand-set tiles, recoloured.

A theme is a *palette*, not new geometry. Every tile and prop is the exact
pixel map `generate.py` draws for the Waterfront — the same 9-slice roles, the
same lip on the same row, the same mortar grid — with each pixel key mapped to
the theme's colour for that role. That is what keeps every theme seamless by
construction: the tiling gates the Waterfront passes are gates of the *maps*,
and a recolour cannot move a pixel.

The key roles (see `generate.py`'s KEY):

  0 1 2      mortar / outline / shadow
  a b c      the face's stone, dark → light
  d e f g    the standable top (moss on the quay), dark → light
  h i j k l  the lip under the top, light → dark
  m n o p q  the trim band, light → dark
  r s t u    flowers
  A B C D    wood (props)
  E F G      warm light (the lantern)

Generates, per theme in THEMES:

  public/assets/tilesets/<theme>-platforms.png
  public/assets/tilesets/<theme>-props.png
  public/assets/tilesets/<theme>-platforms.json

Run from the repository root:

    .venv/bin/python scripts/tilesets/themes.py
"""

from __future__ import annotations

import json
import re
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import generate as gen  # noqa: E402  (the path insert has to come first)

THEMES: dict[str, dict[str, str]] = {
    # A grey keep at dusk: pale flagstone on the walk, limestone lip, and a
    # crimson banner band where the quay had brass.
    "castle": {
        "0": "#1d1a29", "1": "#2a2638", "2": "#3a3550",
        "a": "#3f3f52", "b": "#56566c", "c": "#74748c",
        "d": "#8a8aa0", "e": "#a3a3b8", "f": "#bcbccc", "g": "#d6d6e0",
        "h": "#ece6d8", "i": "#d9d1c0", "j": "#c2b8a4", "k": "#a89d88", "l": "#8c826f",
        "m": "#f0707a", "n": "#d4434f", "o": "#b0303e", "p": "#8a2434", "q": "#641a2a",
        "r": "#ffe9a8", "s": "#f5c95a", "t": "#d9a23a", "u": "#a8742a",
    },
    # Open country: grass on top, a dark turf line, then packed earth.
    "meadow": {
        "0": "#2a1b16", "1": "#3b271e", "2": "#4d3426",
        "a": "#6b4430", "b": "#88583b", "c": "#a87149",
        "d": "#3f8f3a", "e": "#5cb04a", "f": "#86cf5a", "g": "#b7e57a",
        "h": "#4ea33f", "i": "#3f8c36", "j": "#33752e", "k": "#2b6127", "l": "#234f20",
        "m": "#7a5236", "n": "#5e3d28", "o": "#4a2f20", "p": "#3b2519", "q": "#2e1d14",
        "r": "#fff4b0", "s": "#ffd84f", "t": "#f5a23a", "u": "#e0703a",
    },
    # Packed snow on blue-grey rock, an ice band, winter berries.
    "snow": {
        "0": "#1b2338", "1": "#252f4a", "2": "#33405f",
        "a": "#3c5674", "b": "#527196", "c": "#7593b8",
        "d": "#cfe1f2", "e": "#e2eefa", "f": "#f1f7fd", "g": "#fbfdff",
        "h": "#d6e7f6", "i": "#bfd6ec", "j": "#a6c3e0", "k": "#8cadd2", "l": "#7396c0",
        "m": "#c4ecff", "n": "#9fdaf8", "o": "#7cc4ec", "p": "#5aa8d8", "q": "#3f88bd",
        "r": "#ffd6dc", "s": "#ef6f7f", "t": "#d24a5c", "u": "#a83448",
    },
}

# Props get the theme's colours too, plus a few overrides where a role means
# something different off the platform: the snow's vine is an icicle, so its
# greens become ice rather than snow.
PROP_OVERRIDES: dict[str, dict[str, str]] = {
    "castle": {"d": "#3f6a46", "e": "#4f8256", "f": "#6aa06c", "g": "#8cbf84"},
    # Off the platform the meadow's trim band is soil; the lantern and the
    # hoops want their brass back.
    "meadow": {"m": "#ffe08a", "n": "#f7c85f", "o": "#e4a73f", "p": "#c9852f", "q": "#a36428"},
    "snow": {"d": "#7cc4ec", "e": "#a6dcf6", "f": "#cdeefc", "g": "#eef9ff"},
}


def rgb(hex_: str) -> tuple[int, int, int]:
    return tuple(int(hex_[i : i + 2], 16) for i in (1, 3, 5))  # type: ignore[return-value]


def recolour(mapping: dict[str, str]) -> None:
    """Point the generator's pixel keys at a theme's colours, in place."""
    for key, hex_ in mapping.items():
        assert key in gen.KEY_RGB, f"unknown key {key!r}"
        gen.KEY_RGB[key] = rgb(hex_)


def frames_json(doc: dict) -> str:
    text = json.dumps(doc, indent=2)
    return re.sub(
        r"\[\n\s+(-?\d+),\n\s+(-?\d+),\n\s+(-?\d+),\n\s+(-?\d+)\n\s+\]",
        r"[\1, \2, \3, \4]",
        text,
    )


def main() -> None:
    gen.check_frames()
    original = dict(gen.KEY_RGB)
    original_deep = gen.DEEP_RGB
    # The joint gate writes a QA sheet; the Waterfront's own sheet in
    # scripts/tilesets/ must not be overwritten by a theme's.
    gen.QA_DIR = Path(tempfile.mkdtemp(prefix="golpe-themes-"))
    for theme, mapping in THEMES.items():
        gen.KEY_RGB.clear()
        gen.KEY_RGB.update(original)
        recolour(mapping)
        gen.DEEP_RGB = gen.KEY_RGB["0"]
        platforms = gen.make_platform_atlas()
        recolour(PROP_OVERRIDES[theme])
        # `generate.py` draws its props once, at import, in Waterfront colours;
        # redraw them under the theme's keys before packing the atlas.
        gen.PROPS, gen.PROP_ANIMS, _ = gen.build_props()
        props = gen.make_prop_atlas()

        platform_path = gen.OUT_DIR / f"{theme}-platforms.png"
        props_path = gen.OUT_DIR / f"{theme}-props.png"
        platforms.save(platform_path, "PNG", compress_level=9)
        props.save(props_path, "PNG", compress_level=9)

        doc = {
            "name": f"{theme}-platforms",
            "image": f"assets/tilesets/{theme}-platforms.png",
            "version": gen.sha12(platform_path),
            "tileWidth": 8,
            "tileHeight": 8,
            "tiles": {n: gen.TILE_FRAMES[n] for row in gen.TILE_ROWS for n in row},
            "props": {
                "image": f"assets/tilesets/{theme}-props.png",
                "version": gen.sha12(props_path),
                "frames": {n: f for n, (f, _) in gen.PROPS.items()},
                "anims": gen.PROP_ANIMS,
            },
        }
        json_path = gen.OUT_DIR / f"{theme}-platforms.json"
        json_path.write_text(frames_json(doc) + "\n")
        # The same 3x3 joint gate the Waterfront passes, on the recoloured atlas.
        tiling = gen.check_tiling(platforms)
        print(
            f"{theme:8s} platforms {platforms.width}x{platforms.height} "
            f"props {props.width}x{props.height} version={doc['version']} "
            f"tiling joint={tiling['joint_width_px']}px PASS"
        )
    gen.KEY_RGB.clear()
    gen.KEY_RGB.update(original)
    gen.DEEP_RGB = original_deep


if __name__ == "__main__":
    main()
