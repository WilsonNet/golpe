/**
 * The Graphics submenu: the visual-comfort settings that are not controls.
 *
 * The skybox is the one that matters competitively. It is a presentation
 * choice, stored beside the bindings and the mixer, and it applies from the
 * next match — the current match keeps the backdrop it was built with.
 *
 * `?sky=off` is the same choice from a link: the original flat blue gradient,
 * with no scenery, waterfalls or moving actors. That is the low-distraction
 * setting a player picks when the fight, not the city, is the point.
 */

import { useState } from "react";
import {
	type SkyChoice,
	applySkyboxChoice,
	skyboxChoice,
	storeSkybox,
} from "../game/render/skyboxAssets";

const SKYBOXES: { value: SkyChoice; label: string; image: string; hint: string }[] = [
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

export function GraphicsSettings({ onClose }: { onClose: () => void }) {
	const [sky, setSky] = useState<SkyChoice>(() => skyboxChoice());
	const current = SKYBOXES.find((s) => s.value === sky) ?? SKYBOXES[0];

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
					{current?.hint} <strong>Off</strong> is the competitive
					low-distraction setting. The change applies immediately in a match —
					the backdrop swaps in place, without resetting the fight; from the
					menu it is used by the next match. A <strong>?sky=</strong> link can
					also pin it.
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
