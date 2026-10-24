import geckos from "@geckos.io/client";
import type { PotgAnnounce } from "../potg/types";
import type { HeroId } from "../simulation/Heroes";
import type { MatchMode } from "../simulation/Teams";
import type { TilemapSpec } from "../simulation/Tilemap";
import type { TrainingConfigMsg, TrainingStateMsg } from "../training/types";
import { NetSim } from "./NetSim";
import {
	type ControlCapturedMsg,
	type ControlOvertimeMsg,
	type GameSnapshot,
	type MatchMessage,
	type MatchOverMsg,
	type NetReportMsg,
	type PingMsg,
	type PingsMsg,
	type PlayerInput,
	RELIABLE,
	type RespawnMsg,
	type RosterMsg,
	type RoundLiveMsg,
	type RoundWonMsg,
} from "./types";
import { packInputs } from "./wire";

type OnlineStateHandler = (state: GameSnapshot) => void;
type OnlineStatusHandler = (status: string) => void;
type OnlineResetHandler = () => void;
export type TrainingStateHandler = (state: TrainingStateMsg) => void;

/**
 * Everything the session wants to hear from the wire.
 *
 * One object rather than a growing positional argument list: the deathmatch
 * added four messages, and a fifth optional callback in the middle of a
 * parameter list is how a handler ends up silently bound to the wrong slot.
 */
export interface OnlineHandlers {
	onState: OnlineStateHandler;
	onStatus: OnlineStatusHandler;
	onRoundReset: OnlineResetHandler;
	onRoster: (msg: RosterMsg) => void;
	onRespawn: (msg: RespawnMsg) => void;
	onMatchOver: (msg: MatchOverMsg) => void;
	/**
	 * The match produced a Play of the Game.
	 *
	 * Sent just before `match-over` and handled separately, because the ceremony
	 * runs before the podium does. Absent when nobody scored all match — which is
	 * a real outcome and better said by silence than by an empty card.
	 */
	onPotg: (msg: PotgAnnounce) => void;
	/** A team deathmatch round was won by wipe-out. */
	onRoundWon: (msg: RoundWonMsg) => void;
	/** Freezetime is over: the round is live. */
	onRoundLive: (msg: RoundLiveMsg) => void;
	/** A control point changed hands. */
	onControlCaptured: (msg: ControlCapturedMsg) => void;
	/** The clock ran out with a capture in progress. */
	onControlOvertime: (msg: ControlOvertimeMsg) => void;
	/** Seated, in the room the server actually put us in. */
	onSeated: (
		roomId: string,
		screens: number,
		mode: MatchMode,
		map: TilemapSpec | null,
	) => void;
	/** The room asked for is full of humans. Nothing more will arrive. */
	onRoomFull: (roomId: string) => void;
	/**
	 * The room asked for has a password, and this join carried none that
	 * matched. Nothing more will arrive on this connection — the answer to a
	 * locked room is a new attempt with the key, not a wait.
	 */
	onRoomLocked: (roomId: string) => void;
	/** The server's view of this client's input stream. Diagnostics only. */
	onNet: (msg: NetReportMsg) => void;
	/** Round trips the server measured for everyone it can time. */
	onPings: (msg: PingsMsg) => void;
	/** The link died without this client asking it to. Nothing more will arrive. */
	onConnectionLost: () => void;
}

export interface JoinOptions {
	/**
	 * Which room to play in.
	 *
	 * A proposal: the server validates it and answers with the id it used. Absent
	 * means "make me a new one", which is also what a malformed one gets.
	 */
	room?: string;
	/** Play this room against server-hosted bots instead of waiting for humans. */
	solo?: boolean;
	/**
	 * An authored map (`?map=`), resolved to its spec on this client.
	 *
	 * Creator-only like `screens`: the server sanitises it, builds the room's
	 * world from it, and sends the sanitised copy back in the `match` message —
	 * which is what every client, the creator included, then simulates.
	 */
	map?: TilemapSpec;
	/** The second slot is a scriptable dummy rather than a bot. */
	training?: boolean;
	/**
	 * This client's fighter is brain-driven (`?ai=true`) — a probe, not a person.
	 *
	 * The server uses it to mark a room this client creates as a probe room, so
	 * quick match never sends a stranger into the middle of a diagnostic.
	 */
	ai?: boolean;
	/** What the scoreboard should call this player. */
	name?: string;
	/** Bots to seat. `0` is a legitimate empty room. */
	bots?: number;
	/** Fighters the room is topped up to with bots. */
	fill?: number;
	/**
	 * Shortened rules. Along with `fill`, honoured only for the client that
	 * *creates* the room — a latecomer cannot resize or shorten a match already in
	 * progress.
	 */
	scoreLimit?: number;
	timeLimitMs?: number;
	/**
	 * How many 800px screens wide this client wants the arena.
	 *
	 * Also honoured only by the room's creator: the arena's size is part of the
	 * room, and the server says what it actually is in the `match` message.
	 */
	screens?: number;
	/**
	 * Starting ultimate charge for everybody in the room, 0..100.
	 *
	 * `?ultCharge=N`, and creator-only like the rest of this block. The meter
	 * takes ~71s of passive charge to fill, which is unmeasurable in a probe and
	 * tedious to practise a throw against.
	 */
	ultCharge?: number;
	/**
	 * Which ruleset to play: `"tdm"` for team deathmatch.
	 *
	 * Creator-only server-side, like the rest of this block — and the server
	 * answers with the mode the room actually plays in the `match` message, so a
	 * client joining somebody else's room learns which game it is in rather than
	 * assuming its own URL.
	 */
	mode?: MatchMode;
	/** Freezetime in seconds, for a team room. Creator-only, like the rest. */
	freezeTime?: number;
	/**
	 * The middle point's capture time in seconds, in a control room.
	 * Creator-only, like the rest — the practice-room flag a probe shortens a
	 * round with.
	 */
	capTime?: number;
	/**
	 * Which hero this client's own fighter plays. **Per-client, not
	 * creator-only** — it is the answer to "who do you want to be", and the
	 * last person through the door still gets to pick.
	 */
	hero?: HeroId;
	/**
	 * The hero the room's bots play, when the creator asks for one.
	 * Creator-only: a probe that wants sixteen daggers on the floor is the
	 * only caller.
	 */
	botHero?: HeroId;
	/**
	 * The room's password.
	 *
	 * For the client that creates the room it is the door — the server hashes
	 * it and the room becomes locked and unlisted. For everybody after it is
	 * the key, compared server-side; a wrong or missing one answers
	 * `room-locked`.
	 */
	password?: string;
	/**
	 * Create the room unlisted (`?private=true`). Creator-only, like the other
	 * room properties — ignored by a room that already exists.
	 */
	isPrivate?: boolean;
}

export class OnlineManager {
	private channel: ReturnType<typeof geckos> | null = null;
	private _connected = false;
	private _matched = false;
	private _myId = "";
	private _roomId = "";
	/** `disconnect` was asked for, so the close that follows is not a loss. */
	private closing = false;
	/** `?netsim=` — a shaped, lossy link for the probes. Null on a real one. */
	readonly netsim = NetSim.fromLocation();

	constructor(
		private serverUrl: string,
		private serverPort: number,
	) {}

	get connected() {
		return this._connected;
	}

	get matched() {
		return this._matched;
	}

	/**
	 * The id the *server* scores this client under.
	 *
	 * Seeded from the channel id and then replaced by whatever the `match` message
	 * says, because that is the id the snapshot uses. Assuming the two always agree
	 * would put the local player on somebody else's scoreboard row the day they
	 * ever differ.
	 */
	get myId() {
		return this._myId;
	}

	/** The room the server put us in — not necessarily the one we asked for. */
	get roomId() {
		return this._roomId;
	}

	private onTrainingState: TrainingStateHandler | null = null;

	connect(handlers: OnlineHandlers, join: JoinOptions = {}) {
		const channel = geckos({ url: this.serverUrl, port: this.serverPort });
		this.channel = channel;
		if (this.netsim) shapeChannel(channel, this.netsim);

		channel.onConnect((error) => {
			if (error) {
				this._connected = false;
				handlers.onStatus(`Connection failed: ${error.message}`);
				return;
			}
			this._connected = true;
			this._myId = channel.id as string;
			// The server holds placement until it knows which kind of match we want.
			//
			// Reliable, because this one has no second chance: lose it and the server
			// falls back to placing this client with no `room` at all, which now means
			// a brand-new room — so a player who followed an invitation ends up alone
			// in a different match, with nothing on screen to say why.
			channel.emit(
				"join",
				{
					solo: Boolean(join.solo),
					training: Boolean(join.training),
					...(join.ai ? { ai: true } : {}),
					...(join.room === undefined ? {} : { room: join.room }),
					...(join.name === undefined ? {} : { name: join.name }),
					...(join.bots === undefined ? {} : { bots: join.bots }),
					...(join.fill === undefined ? {} : { fill: join.fill }),
					...(join.scoreLimit === undefined
						? {}
						: { scoreLimit: join.scoreLimit }),
					...(join.timeLimitMs === undefined
						? {}
						: { timeLimitMs: join.timeLimitMs }),
					...(join.screens === undefined ? {} : { screens: join.screens }),
					...(join.map === undefined ? {} : { map: join.map }),
					...(join.ultCharge === undefined
						? {}
						: { ultCharge: join.ultCharge }),
					...(join.mode === undefined ? {} : { mode: join.mode }),
					...(join.freezeTime === undefined
						? {}
						: { freezeTime: join.freezeTime }),
					...(join.capTime === undefined ? {} : { capTime: join.capTime }),
					...(join.hero === undefined ? {} : { hero: join.hero }),
					...(join.botHero === undefined ? {} : { botHero: join.botHero }),
					...(join.password === undefined ? {} : { password: join.password }),
					...(join.isPrivate === undefined ? {} : { private: join.isPrivate }),
				},
				RELIABLE,
			);
			handlers.onStatus(
				join.training
					? "Connected — training room..."
					: join.solo
						? "Connected — starting match..."
						: "Connected — entering deathmatch...",
			);
		});

		channel.on("match", (data: unknown) => {
			const msg = data as MatchMessage;
			this._matched = true;
			if (msg?.youId) this._myId = msg.youId;
			if (msg?.roomId) {
				this._roomId = msg.roomId;
				handlers.onSeated(
					msg.roomId,
					msg.screens ?? 1,
					msg.mode ?? "ffa",
					msg.map ?? null,
				);
			}
			handlers.onStatus("");
		});

		// Sixteen humans already. Said out loud rather than left as a client that
		// connects, receives nothing and looks broken.
		channel.on("room-full", (data: unknown) => {
			const msg = data as { roomId?: string } | null;
			handlers.onRoomFull(msg?.roomId ?? "");
		});

		// The room has a password and this attempt carried none that matched.
		// Reliable, like room-full: it is the only answer this connection will
		// ever get, and a client that missed it would sit on "Connecting…" with
		// nothing to show for it.
		channel.on("room-locked", (data: unknown) => {
			const msg = data as { roomId?: string } | null;
			handlers.onRoomLocked(msg?.roomId ?? "");
		});

		channel.on("state", (data: unknown) => {
			handlers.onState(data as GameSnapshot);
		});

		channel.on("net", (data: unknown) => {
			handlers.onNet(data as NetReportMsg);
		});

		// The scoreboard's latency probe. Echoed straight back and unreliably,
		// like the probe itself: there is nothing to queue, nothing to persist
		// and nothing the simulation may see. A dropped echo costs one sample
		// that the next second replaces. See `online/ping.ts` for why this is
		// not an HTTP request.
		channel.on("ping", (data: unknown) => {
			const probe = data as PingMsg | null;
			if (typeof probe?.t !== "number") return;
			channel.emit("pong", probe);
		});

		channel.on("pings", (data: unknown) => {
			handlers.onPings(data as PingsMsg);
		});

		channel.on("round-reset", () => {
			handlers.onRoundReset();
		});

		channel.on("roster", (data: unknown) => {
			handlers.onRoster(data as RosterMsg);
		});

		// One fighter, not the whole arena. A deathmatch respawn is announced for
		// the same reason a round reset is: guessing it from a distance threshold
		// works until two fighters legitimately move a long way at once.
		channel.on("respawn", (data: unknown) => {
			handlers.onRespawn(data as RespawnMsg);
		});

		channel.on("match-over", (data: unknown) => {
			handlers.onMatchOver(data as MatchOverMsg);
		});

		// The highlight reel's announcement. Reliable server-side, like the podium
		// and for the same reason: it happens once, it is the thing everybody looks
		// up for, and there is no second one to heal a lost datagram with.
		channel.on("potg", (data: unknown) => {
			handlers.onPotg(data as PotgAnnounce);
		});

		// A side was wiped out. The arena reset that follows arrives separately as
		// `round-reset`, which is what actually breaks prediction continuity — this
		// is only the announcement.
		channel.on("round-won", (data: unknown) => {
			handlers.onRoundWon(data as RoundWonMsg);
		});

		channel.on("round-live", (data: unknown) => {
			handlers.onRoundLive(data as RoundLiveMsg);
		});

		// A control point changed hands. The snapshot carries ownership 20 times
		// a second; this is the announcement the sound and the caption ride, for
		// the same reason `round-won` exists — a moment the room reacts to
		// should not depend on a client noticing a change between snapshots.
		channel.on("control-captured", (data: unknown) => {
			handlers.onControlCaptured(data as ControlCapturedMsg);
		});

		channel.on("control-overtime", (data: unknown) => {
			handlers.onControlOvertime(data as ControlOvertimeMsg);
		});

		// The training room echoes its resolved config back, so the UI and the
		// agent API reflect what the room actually is rather than what they asked
		// for. Sent on change, never per tick.
		channel.on("training-state", (data: unknown) => {
			this.onTrainingState?.(data as TrainingStateMsg);
		});

		channel.onDisconnect(() => {
			const wasSeated = this._matched;
			this._connected = false;
			this._matched = false;
			handlers.onStatus("Disconnected from server");
			// Only a seat that was lost: a refused join (room full, locked) has
			// its own prompt, and a deliberate `disconnect` is not a loss.
			if (wasSeated && !this.closing) handlers.onConnectionLost();
		});
	}

	/** The unacknowledged input window. Unreliable on purpose: see `InputBundle`. */
	sendInputs(inputs: readonly PlayerInput[]) {
		if (this.channel && this._connected && inputs.length > 0) {
			this.channel.emit("inputs", packInputs(inputs));
		}
	}

	/**
	 * The Esc menu's hero select. Reliable — it is a one-shot control message
	 * with no second chance, like `join`: a lost hero request would leave the
	 * player fighting the old hero with no error to show for it.
	 */
	sendHero(hero: HeroId) {
		if (this.channel && this._connected) {
			this.channel.emit("hero", { hero }, { reliable: true });
		}
	}

	sendTeam(team: number) {
		if (this.channel && this._connected) {
			this.channel.emit("team", { team }, RELIABLE);
		}
	}

	sendBots(op: "add" | "remove", team?: number | null) {
		if (this.channel && this._connected) {
			this.channel.emit("bots", { op, team: team ?? null }, RELIABLE);
		}
	}

	sendAdmin(targetId: string, admin: boolean) {
		if (this.channel && this._connected) {
			this.channel.emit("admin", { targetId, admin }, RELIABLE);
		}
	}

	onTraining(handler: TrainingStateHandler) {
		this.onTrainingState = handler;
	}

	/**
	 * Reliable: an agent's `__training.set()` returns a promise that resolves on
	 * the server's echo, so a lost config message does not degrade a scenario — it
	 * hangs the caller.
	 */
	sendTrainingConfig(msg: TrainingConfigMsg) {
		if (this.channel && this._connected) {
			this.channel.emit("training-config", msg, RELIABLE);
		}
	}

	disconnect() {
		this.closing = true;
		this.channel?.close();
		this._connected = false;
		this._matched = false;
	}
}

/**
 * The server's unreliable messages — the ones a real link can lose. Everything
 * else it sends is reliable and is only delayed by the shaper.
 */
const LOSSY_INCOMING = new Set([
	"state",
	"roster",
	"respawn",
	"net",
	// The latency probe and its summary are unreliable by design: a lost one is
	// replaced by the next second's, and a retransmit would measure the retry
	// rather than the link.
	"ping",
	"pings",
]);

/**
 * Route every message this channel sends or hears through the shaper.
 *
 * Done by wrapping `on` and `emit` once, before any handler is registered, so
 * no message can take a path around it and nothing downstream knows the link
 * is simulated.
 */
function shapeChannel(channel: ReturnType<typeof geckos>, sim: NetSim) {
	const on = channel.on.bind(channel);
	channel.on = ((event: string, cb: (data: unknown) => void) =>
		on(event, (data: unknown) =>
			sim.deliver(() => cb(data), LOSSY_INCOMING.has(event)),
		)) as typeof channel.on;
	const emit = channel.emit.bind(channel);
	channel.emit = ((
		event: string,
		data: unknown,
		options?: { reliable?: boolean },
	) =>
		sim.deliver(
			() => emit(event, data as never, options),
			!options?.reliable,
		)) as typeof channel.emit;
}
