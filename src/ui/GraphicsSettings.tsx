/**
 * The Graphics submenu: the visual-comfort settings that are not controls.
 *
 * Two independent choices live here. The **skybox** is the backdrop; the
 * **platforms** are the surfaces a fighter stands on. Turning the sky off must
 * not also turn the arena into flat blocks, and choosing the painted arena must
 * not bring the city back — so they are separate stores with separate previews.
 *
 * Both apply **immediately** in a match: the skybox rebuilds only its own
 * container, and the platform layer redraws only `stage.arena`. The simulation,
 * camera and fighters keep running through either switch.
 */

import { useState } from "react";
import {
	applySkyboxChoice,
	type SkyChoice,
	skyboxChoice,
	storeSkybox,
} from "../game/render/skyboxAssets";
import {
	applyTileStyle,
	type TileStyle,
	tileStyleChoice,
} from "../game/render/tileStyle";

const SKYBOXES: {
	value: SkyChoice;
	label: string;
	image: string;
	hint: string;
}[] = [
	{
		value: "hand",
		label: "Waterfront",
		image: "assets/skybox/hand/contact.png",
		hint: "The hand-painted canal city: aqueduct, tree, quay, people, birds and boats.",
	},
	{
		value: "off",
		label: "Off — plain blue",
		image: "assets/sky.png",
		hint: "The original flat blue gradient. No scenery, waterfalls, birds or boats — the low-distraction background.",
	},
];

const TILE_STYLES: {
	value: TileStyle;
	label: string;
	image: string;
	hint: string;
}[] = [
	{
		value: "art",
		label: "Waterfront art",
		image: "assets/tilesets/waterfront-preview.png",
		hint: "Mossy stone quay tiles: cream and brass lips, deep green faces, vines under the ledges. The surfaces match the painted city.",
	},
	{
		value: "flat",
		label: "Flat — competitive",
		image: "assets/platform.png",
		hint: "The original monochrome green blocks. Every collider is identical; only the surface art is removed.",
	},
];

export function GraphicsSettings({ onClose }: { onClose: () => void }) {
	const [sky, setSky] = useState<SkyChoice>(() => skyboxChoice());
	const [tiles, setTiles] = useState<TileStyle>(() => tileStyleChoice());
	const currentSky = SKYBOXES.find((s) => s.value === sky) ?? SKYBOXES[0];
	const currentTiles =
		TILE_STYLES.find((s) => s.value === tiles) ?? TILE_STYLES[0];

	return (
		<>
			<div className="gd-setting">
				<div className="gd-setting-head">
					<span>Skybox</span>
					<span className="gd-team-alive">tap a preview</span>
				</div>
				<div className="gd-sky-grid">
					{SKYBOXES.map((s) => (
						<button
							key={s.value}
							type="button"
							aria-pressed={sky === s.value}
							className={`gd-sky-card${sky === s.value ? " gd-sky-card-on" : ""}`}
							onClick={() => {
								storeSkybox(s.value);
								setSky(s.value);
								void applySkyboxChoice();
							}}
						>
							<img src={s.image} alt="" />
							<span>{s.label}</span>
						</button>
					))}
				</div>
				<p className="gd-setting-hint">
					{currentSky?.hint} <strong>Off</strong> is the competitive
					low-distraction background. The change applies immediately in a match
					— the backdrop swaps in place, without resetting the fight; from the
					menu it is used by the next match. A <strong>?sky=</strong> link can
					also pin it.
				</p>
			</div>

			<div className="gd-setting">
				<div className="gd-setting-head">
					<span>Platforms</span>
					<span className="gd-team-alive">tap a preview</span>
				</div>
				<div className="gd-tile-grid">
					{TILE_STYLES.map((s) => (
						<button
							key={s.value}
							type="button"
							aria-pressed={tiles === s.value}
							className={`gd-sky-card gd-tile-card${tiles === s.value ? " gd-sky-card-on" : ""}`}
							onClick={() => {
								setTiles(s.value);
								applyTileStyle(s.value);
							}}
						>
							<img src={s.image} alt="" />
							<span>{s.label}</span>
						</button>
					))}
				</div>
				<p className="gd-setting-hint">
					{currentTiles?.hint} The collider does not change. The arena style is{" "}
					<strong>independent of the skybox</strong>: Off keeps whichever
					platform art you choose, and the change is live in a match. A{" "}
					<strong>?tiles=</strong> link can pin it.
				</p>
			</div>

			<div className="gd-row-actions">
				<button className="gd-btn" type="button" onClick={onClose}>
					Back
				</button>
			</div>
		</>
	);
}
