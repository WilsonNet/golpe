/**
 * The Sound menu: the mixer.
 *
 * Three channels — master, music, sfx — each a slider and a mute, plus reset.
 * Persisted by the `audioMixer` store; nothing here touches the simulation.
 *
 * **The React Compiler rule** (docs/invariants.md): the store is a module
 * singleton, so a live mid-render read is invisible to the memoisation and
 * freezes at first render. The snapshot goes into `useState` and every
 * predicate (`isDefaultAudio`) is asked of the snapshot, exactly like the
 * controls dialog asks its bindings snapshot.
 *
 * One component serves both the Esc menu and the root menu's options — same
 * component, same store, same persistence, so a player who sets it at the
 * menu gets the same setting in the match and vice versa.
 */

import { useEffect, useState } from "react";
import { sound } from "../game/sound/facade";
import {
	AUDIO_CHANNELS,
	type AudioChannel,
	type AudioPreferences,
	isDefaultAudio,
} from "../game/sound/mixer";

const CHANNEL_LABELS: Record<AudioChannel, string> = {
	master: "Master",
	music: "Music",
	sfx: "Sound effects",
};

export function SoundMixer() {
	const [prefs, setPrefs] = useState<AudioPreferences>(() =>
		sound.mixer.snapshot(),
	);
	useEffect(
		() => sound.mixer.subscribe(() => setPrefs(sound.mixer.snapshot())),
		[],
	);

	const setVolume = (channel: AudioChannel, value: number) => {
		sound.mixer.setVolume(channel, value);
		if (!prefs.muted[channel]) sound.play("ui-click");
	};
	const toggleMute = (channel: AudioChannel) => {
		sound.mixer.setMuted(channel, !prefs.muted[channel]);
		sound.play("ui-click");
	};

	return (
		<div className="gd-sound">
			{AUDIO_CHANNELS.map((channel) => {
				const label = CHANNEL_LABELS[channel];
				return (
					<div className="gd-sound-row" key={channel}>
						<span className="gd-sound-row-label">{label}</span>
						<input
							type="range"
							className="gd-sound-slider"
							min={0}
							max={100}
							value={Math.round(prefs.volumes[channel] * 100)}
							aria-label={`${label} volume`}
							onChange={(e) => setVolume(channel, Number(e.target.value) / 100)}
						/>
						<span className="gd-sound-val">
							{Math.round(prefs.volumes[channel] * 100)}
						</span>
						<button
							type="button"
							className={`gd-sound-btn${prefs.muted[channel] ? " gd-sound-btn-on" : ""}`}
							aria-pressed={prefs.muted[channel]}
							aria-label={`${label} mute`}
							onClick={() => toggleMute(channel)}
						>
							{prefs.muted[channel] ? "MUTED" : "MUTE"}
						</button>
					</div>
				);
			})}
			<div className="gd-setting-hint">
				The master slider also affects the menus and matches everywhere; music
				and effects are balanced here. Everything is remembered between
				sessions.
			</div>
			<div className="gd-sound-foot">
				<button
					type="button"
					className="gd-btn"
					onClick={() => {
						sound.mixer.reset();
						sound.play("ui-click");
					}}
					disabled={isDefaultAudio(prefs)}
				>
					{isDefaultAudio(prefs) ? "Defaults" : "Reset"}
				</button>
				<button
					type="button"
					className="gd-btn"
					onClick={() => sound.play("hit-heavy")}
				>
					Test effect
				</button>
			</div>
		</div>
	);
}
