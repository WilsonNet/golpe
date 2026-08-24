/**
 * The turn-away kill feed, top-right under the foe panel.
 *
 * CS's answer to "what just happened over there": `KILLER [icon] VICTIM`,
 * right-aligned, newest on top, gone after six seconds. The icon names the
 * means — which sword link, which gun, which ultimate — so a frag the player
 * never saw still tells them what to respect next fight.
 *
 * **Gameplay tier, not interrupt.** The feed sits on screen all match like the
 * fighter panels, so it wears their register (translucent strip, cyan
 * hairline, no gold frame); only the battle message window and the ceremony
 * get the codex. The one accent: a row the local fighter is in gets a
 * brighter hairline.
 *
 * **Data.** `Match` emits `hud-kill` with names and the killer's kit already
 * resolved — the feed owns only presentation: how long a row lives, which
 * icon the cause draws, which label it wears. Kills one-shot through the
 * snapshot like melee events, so a row can never claim a frag the server did
 * not award.
 */

import { type ReactNode, useEffect, useRef, useState } from "react";
import { EventBus } from "../game/EventBus";
import { HUD_EVENTS, type HudKillEvent } from "../game/hud";
import type { KillCause } from "../game/online/types";
import type { HeroId } from "../game/simulation/Heroes";

/** How many rows stay before the oldest is pushed off, like TF2's five. */
const KILL_FEED_KEEP = 5;
/** A row's whole life before it is removed. */
const KILL_FEED_HOLD_MS = 6000;
/** The fade-and-slide before it is removed. */
const KILL_FEED_OUT_MS = 420;

interface KillEntry extends HudKillEvent {
	id: number;
	exiting: boolean;
}

function useKillFeed(): [KillEntry[], (id: number) => void] {
	const [entries, setEntries] = useState<KillEntry[]>([]);
	const seq = useRef(0);
	useEffect(
		() =>
			EventBus.on(HUD_EVENTS.kill, ((event: HudKillEvent) => {
				const entry: KillEntry = {
					...event,
					id: ++seq.current,
					exiting: false,
				};
				setEntries((prev) => [entry, ...prev].slice(0, KILL_FEED_KEEP));
			}) as never),
		[],
	);
	const remove = (id: number) =>
		setEntries((prev) => prev.filter((e) => e.id !== id));
	return [entries, remove];
}

/**
 * The means, line-drawn for the HUD: one blade, one gun, one burst per thing
 * that can kill. Drawn via `currentColor`, so tinting an icon means tinting a
 * stroke — never painting a thing the colour already codes.
 */
function swordShape(): ReactNode {
	return (
		<>
			<path d="M12 3 L12 13.5" />
			<path d="M8.5 13.8 L15.5 13.8" />
			<path d="M12 13.8 L12 18.5" />
			<path d="M10.8 18.5 L13.2 18.5" />
		</>
	);
}

function daggerShape(): ReactNode {
	return (
		<>
			<path d="M12 5 L12 14.5" />
			<path d="M8.8 15 L15.2 15" />
			<path d="M12 15 L12 18.5" />
			<path d="M11 18.5 L13 18.5" />
		</>
	);
}

/** One petal of the blossom: an arc bowing out of the centre. */
function petalShape(): ReactNode {
	return <path d="M12 12 C12 8.6 9.6 6.2 8.2 6.9 C5.9 8 8.4 12 12 12" />;
}

function iconFor(cause: KillCause): ReactNode {
	switch (cause) {
		// The three chain links: the same blade, three rotations, so the chain
		// reads at a glance by how the blade sits.
		case "slash":
			return <g transform="rotate(-45 12 12)">{swordShape()}</g>;
		case "slash2":
			return <g transform="rotate(45 12 12)">{swordShape()}</g>;
		case "slash3":
			// The overhead finisher: blade down, meeting the floor.
			return <g transform="rotate(180 12 12)">{swordShape()}</g>;
		case "uppercut":
			// Blade rising, with the two speed dashes of the launch.
			return (
				<>
					{swordShape()}
					<path d="M8 7.5 L8 10" />
					<path d="M16 7.5 L16 10" />
				</>
			);
		case "massive":
			// The slam: eight rays off the ground where it broke.
			return (
				<>
					<circle cx="12" cy="12" r="2.2" />
					<path d="M12 12 L12 3.5" />
					<path d="M12 12 L12 20.5" />
					<path d="M12 12 L3.5 12" />
					<path d="M12 12 L20.5 12" />
					<path d="M12 12 L6 6" />
					<path d="M12 12 L18 6" />
					<path d="M12 12 L6 18" />
					<path d="M12 12 L18 18" />
				</>
			);
		case "bomb":
			// The plunge: the blade brought down onto the crater.
			return (
				<>
					<g transform="rotate(180 12 12)">{swordShape()}</g>
					<path d="M6.5 19.5 Q12 22.5 17.5 19.5" />
				</>
			);
		case "stab":
			return daggerShape();
		case "thrust":
			// The lunge: blade to the side, motion streak at its heel.
			return (
				<>
					<g transform="rotate(90 12 12)">{daggerShape()}</g>
					<path d="M5.5 9.5 L8 12 L5.5 14.5" />
				</>
			);
		case "shoryuken":
			// The anti-air: blade high, the chevron of the sweep above it.
			return (
				<>
					<g transform="translate(0 1)">{daggerShape()}</g>
					<path d="M8.7 8.4 L12 5 L15.3 8.4" />
				</>
			);
		case "bullet":
			// The gun: barrel and grip, one silhouette.
			return (
				<>
					<rect x="3.5" y="8.7" width="13" height="2.8" rx="0.8" />
					<path d="M14.5 8.7 l0 7.3 l-4.2 0 l-0.6 -6.9" />
				</>
			);
		case "grenade":
			// The cook-off: body, neck, and the fuse spark.
			return (
				<>
					<circle cx="12" cy="14" r="4.6" />
					<path d="M10 11.2 L14 11.2" />
					<path d="M12 11.2 L12 8.4" />
					<path d="M12 8.4 L14.6 6.8" />
				</>
			);
		case "trap":
			// The mine on the floor: a circle with its spikes ring.
			return (
				<>
					<circle cx="12" cy="12" r="3.4" />
					<path d="M12 8.6 L12 4.5" />
					<path d="M12 15.4 L12 19.5" />
					<path d="M8.6 12 L4.5 12" />
					<path d="M15.4 12 L19.5 12" />
					<path d="M9.6 9.6 L6.8 6.8" />
					<path d="M14.4 9.6 L17.2 6.8" />
					<path d="M9.6 14.4 L6.8 17.2" />
					<path d="M14.4 14.4 L17.2 17.2" />
				</>
			);
		case "dragon":
			// The bolt is the ride: nobody blocks a lightning stroke.
			return (
				<path d="M13.5 3 L7.5 13 L12.5 13 L10 21 L16.8 10.5 L12.2 10.5 Z" />
			);
		case "hole":
			// The two held arms of gravity, and the singular point at the core.
			return (
				<>
					<circle cx="12" cy="12" r="2.6" />
					<path d="M12 4.2 A7.8 7.8 0 0 1 19.8 12" />
					<path d="M12 19.8 A7.8 7.8 0 0 1 4.2 12" />
				</>
			);
		case "blossom":
			// Four petal arcs about a heart, the storm as a flower.
			return (
				<>
					<circle cx="12" cy="12" r="1.8" />
					<g transform="rotate(0 12 12)">{petalShape()}</g>
					<g transform="rotate(90 12 12)">{petalShape()}</g>
					<g transform="rotate(180 12 12)">{petalShape()}</g>
					<g transform="rotate(270 12 12)">{petalShape()}</g>
				</>
			);
	}
}

/** The dead fall: the plunge arrow of "nobody did it, the arena did". */
function arenaShape(): ReactNode {
	return (
		<>
			<path d="M12 3.5 L12 14.5" />
			<path d="M8.2 11 L12 15.5 L15.8 11" />
		</>
	);
}

/** What the means is called, so a row reads even at a glance. */
function meansLabel(cause: KillCause, hero: HeroId | null): string {
	switch (cause) {
		case "slash":
			return "SLASH";
		case "slash2":
			return "SLASH II";
		case "slash3":
			return "SLASH III";
		case "uppercut":
			return "UPPERCUT";
		case "massive":
			return "MASSIVE";
		case "bomb":
			return "PLUNGE";
		case "stab":
			return "STAB";
		case "thrust":
			return "THRUST";
		case "shoryuken":
			return "SHORYUKEN";
		case "bullet":
			// The gun is the hero's gun: the feed says which, the way the
			// HUD's stance badge does.
			return hero === "anands"
				? "MACHINE GUN"
				: hero === "jeffs"
					? "SHOTGUN"
					: hero === "lia"
						? "RIFLE"
						: "GUN";
		case "grenade":
			return "HE GRENADE";
		case "trap":
			return "TRAP";
		case "dragon":
			return "DRAGON THRUST";
		case "hole":
			return "BLACK HOLE";
		case "blossom":
			return "DEATH BLOSSOM";
	}
}

function KillFeedRow({
	entry,
	onRemoved,
}: {
	entry: KillEntry;
	onRemoved: (id: number) => void;
}) {
	const [exiting, setExiting] = useState(false);
	useEffect(() => {
		const out = window.setTimeout(
			() => setExiting(true),
			KILL_FEED_HOLD_MS - KILL_FEED_OUT_MS,
		);
		const gone = window.setTimeout(
			() => onRemoved(entry.id),
			KILL_FEED_HOLD_MS,
		);
		return () => {
			window.clearTimeout(out);
			window.clearTimeout(gone);
		};
	}, [entry.id, onRemoved]);

	const fall = entry.killerId === null;
	return (
		<div
			className={`vdh-kill-row${exiting ? " vdh-kill-out" : ""}${
				entry.mine ? " vdh-kill-mine" : ""
			}`}
		>
			<span className="vdh-kill-name" title={entry.killer}>
				{fall ? "" : entry.killer}
			</span>
			<span className="vdh-kill-means">
				<svg
					className="vdh-kill-icon"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					<title>{meansLabel(entry.cause, entry.hero)}</title>
					{fall ? arenaShape() : iconFor(entry.cause)}
				</svg>
				<span className="vdh-kill-label">
					{meansLabel(entry.cause, entry.hero)}
				</span>
			</span>
			<span className="vdh-kill-victim" title={entry.victim}>
				{entry.victim}
			</span>
		</div>
	);
}

export function KillFeed() {
	const [entries, remove] = useKillFeed();
	if (entries.length === 0) return null;
	return (
		<div className="vdh-killfeed" role="log" aria-label="Kill feed">
			{entries.map((entry) => (
				<KillFeedRow key={entry.id} entry={entry} onRemoved={remove} />
			))}
		</div>
	);
}
