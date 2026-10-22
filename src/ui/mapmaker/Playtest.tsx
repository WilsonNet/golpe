/**
 * Play the map you are making, against bots, without leaving the editor.
 *
 * Mario Maker's loop — build, press play, die, press stop, fix — is the whole
 * reason a level editor is fun, so the play-test is one button and one Esc away.
 * It is not a simulation of the game: it is the game. The editor writes the
 * map into the play-test slot and boots `?map=draft` in a frame on the same
 * origin, which creates a real room on the real server with real bots, through
 * the same netcode every match uses. A map that plays here plays in a match.
 *
 * The same frame is filmed (see `capture.ts`): the first take starts by itself
 * and snapshots are taken on a timer, so a player who only wanted to try their
 * map still walks away with the video and screenshots a pull request needs.
 */

import { useEffect, useRef, useState } from "react";
import { PLAYTEST_MAP_ID, storePlaytestMap } from "../../game/maps/library";
import {
	type LaunchParams,
	serializeLaunchParams,
} from "../../game/online/launch";
import { HEROES, type HeroId } from "../../game/simulation/Heroes";
import type { MatchMode } from "../../game/simulation/Teams";
import { Capture, clipMime, MAX_CLIP_SECONDS } from "./capture";
import { type EditorMap, playableSpec, uid } from "./model";
import { type MediaItem, putMedia } from "./storage";

export interface PlaytestSettings {
	bots: number;
	mode: MatchMode;
	hero: HeroId;
	/** AI vs AI: your fighter is a bot too, and you watch. */
	watch: boolean;
	/** Film the first seconds for the pull request. */
	record: boolean;
}

/** The message the game in the frame sends when its Esc menu says "exit". */
export const PLAYTEST_EXIT = "golpe:mapmaker:exit";

/** Seconds into the session the automatic snapshots are taken. */
const AUTO_SHOTS = [5, 11, 17];
/** Wait out the FIGHT banner before the first take rolls. */
const RECORD_DELAY_MS = 2500;
const ATTACH_POLL_MS = 250;

function playtestUrl(s: PlaytestSettings): string {
	const params: LaunchParams = {
		room: null,
		server: null,
		region: null,
		ai: s.watch,
		online: false,
		offline: false,
		training: false,
		tutorial: false,
		hero: s.hero,
		botHero: null,
		bots: s.bots,
		fill: undefined,
		scoreLimit: undefined,
		timeLimitSec: undefined,
		ultCharge: undefined,
		mode: s.mode === "ffa" ? null : s.mode,
		freezeTime: s.mode === "tdm" ? 2 : undefined,
		capTime: undefined,
		screens: undefined,
		map: PLAYTEST_MAP_ID,
		password: null,
		isPrivate: true,
	};
	const own = new URLSearchParams(window.location.search);
	// A silent editor (a probe, or `?mute`) makes a silent play-test.
	const mute = own.has("mute") ? "&mute=1" : "";
	return `${window.location.pathname}?${serializeLaunchParams(params)}${mute}`;
}

interface Props {
	map: EditorMap;
	settings: PlaytestSettings;
	onClose: () => void;
	/** A shot or clip was saved; the publish panel re-reads the library. */
	onMedia: () => void;
}

export function Playtest({ map, settings, onClose, onMedia }: Props) {
	const frameRef = useRef<HTMLIFrameElement>(null);
	const capture = useRef<Capture | null>(null);
	const [src] = useState(() => {
		const spec = playableSpec(map);
		if (spec) storePlaytestMap(spec);
		return playtestUrl(settings);
	});
	const [live, setLive] = useState(false);
	const [recording, setRecording] = useState(false);
	const [elapsed, setElapsed] = useState(0);
	const [shots, setShots] = useState(0);
	const [clips, setClips] = useState(0);
	const [toast, setToast] = useState<string | null>(null);
	const sessionStart = useRef(performance.now());
	const canRecord = clipMime() !== null;

	const say = (text: string) => {
		setToast(text);
		window.setTimeout(() => setToast((t) => (t === text ? null : t)), 2400);
	};

	const saveClip = async (clip: { blob: Blob; seconds: number } | null) => {
		setRecording(false);
		if (!clip) return;
		const item: MediaItem = {
			id: uid("v"),
			mapId: map.localId,
			kind: "video",
			blob: clip.blob,
			seconds: Math.round(clip.seconds * 10) / 10,
			createdAt: Date.now(),
			selected: true,
		};
		await putMedia(item);
		setClips((n) => n + 1);
		onMedia();
		say(`Clip saved — ${item.seconds}s`);
	};

	const takeShot = async (manual: boolean) => {
		const blob = await capture.current?.snapshot();
		if (!blob) {
			if (manual) say("The game has not drawn a frame yet");
			return;
		}
		await putMedia({
			id: uid("i"),
			mapId: map.localId,
			kind: "shot",
			blob,
			seconds:
				Math.round((performance.now() - sessionStart.current) / 100) / 10,
			createdAt: Date.now(),
			selected: true,
		});
		setShots((n) => n + 1);
		onMedia();
		if (manual) say("Screenshot saved");
	};

	const startTake = () => {
		const c = capture.current;
		if (!c?.attached) return;
		if (c.start(saveClip)) {
			setRecording(true);
			say(`Recording — up to ${MAX_CLIP_SECONDS}s`);
		}
	};

	const stopTake = async () => {
		const clip = await capture.current?.stop();
		await saveClip(clip ?? null);
	};

	// Find the game's canvas inside the frame and film it.
	// biome-ignore lint/correctness/useExhaustiveDependencies: one capture per mounted play-test.
	useEffect(() => {
		const c = new Capture();
		capture.current = c;
		let alive = true;
		const timers: number[] = [];
		const poll = window.setInterval(async () => {
			const doc = frameRef.current?.contentDocument;
			const canvas = doc?.querySelector<HTMLCanvasElement>(
				"#game-container canvas, canvas",
			);
			if (!canvas || c.attached) return;
			await c.attach(canvas);
			if (!alive) return;
			setLive(true);
			sessionStart.current = performance.now();
			for (const s of AUTO_SHOTS)
				timers.push(window.setTimeout(() => void takeShot(false), s * 1000));
			if (settings.record && canRecord)
				timers.push(window.setTimeout(startTake, RECORD_DELAY_MS));
		}, ATTACH_POLL_MS);
		const tick = window.setInterval(() => setElapsed(c.elapsed), 200);
		return () => {
			alive = false;
			window.clearInterval(poll);
			window.clearInterval(tick);
			for (const t of timers) window.clearTimeout(t);
			c.dispose();
		};
	}, []);

	// The game's own Esc menu "exit" lands here instead of on the root menu.
	useEffect(() => {
		const onMessage = (e: MessageEvent) => {
			if (e.origin === window.location.origin && e.data?.type === PLAYTEST_EXIT)
				void close();
		};
		window.addEventListener("message", onMessage);
		return () => window.removeEventListener("message", onMessage);
	});

	const close = async () => {
		if (capture.current?.recording) await stopTake();
		onClose();
	};

	return (
		<div className="mm-playtest" data-testid="mapmaker-playtest">
			<div className="mm-playtest-bar">
				<button
					type="button"
					className="mm-btn mm-btn-primary"
					onClick={() => void close()}
					data-testid="playtest-back"
				>
					◀ Back to editor
				</button>
				<span className="mm-playtest-title">
					Testing <b>{map.name}</b> · {settings.bots} bot
					{settings.bots === 1 ? "" : "s"} ·{" "}
					{settings.mode === "tdm" ? "Team deathmatch" : "Free-for-all"}
					{settings.watch
						? " · watching AI vs AI"
						: ` · you are ${HEROES[settings.hero].name}`}
				</span>
				<span className="mm-spacer" />
				{canRecord ? (
					recording ? (
						<button
							type="button"
							className="mm-btn mm-rec on"
							onClick={() => void stopTake()}
							data-testid="playtest-rec"
						>
							■ Stop {Math.floor(elapsed)}s / {MAX_CLIP_SECONDS}s
						</button>
					) : (
						<button
							type="button"
							className="mm-btn mm-rec"
							disabled={!live}
							onClick={startTake}
							data-testid="playtest-rec"
						>
							● Record clip
						</button>
					)
				) : (
					<span className="mm-muted">This browser cannot record video</span>
				)}
				<button
					type="button"
					className="mm-btn"
					disabled={!live}
					onClick={() => void takeShot(true)}
					data-testid="playtest-shot"
				>
					📷 Screenshot
				</button>
				<span className="mm-muted" data-testid="playtest-media">
					{clips} clip{clips === 1 ? "" : "s"} · {shots} shot
					{shots === 1 ? "" : "s"}
				</span>
			</div>
			<iframe
				ref={frameRef}
				className="mm-playtest-frame"
				src={src}
				title="Play-test"
				allow="autoplay; gamepad"
			/>
			{toast ? <div className="mm-toast">{toast}</div> : null}
		</div>
	);
}
