import geckos from "@geckos.io/client";
import type { MatchMode } from "../simulation/Teams";
import type { TrainingConfigMsg, TrainingStateMsg } from "../training/types";
import {
	type GameSnapshot,
	type MatchMessage,
	type MatchOverMsg,
	type PlayerInput,
	RELIABLE,
	type RespawnMsg,
	type RosterMsg,
	type RoundLiveMsg,
	type RoundWonMsg,
} from "./types";

export type OnlineStateHandler = (state: GameSnapshot) => void;
export type OnlineStatusHandler = (status: string) => void;
export type OnlineResetHandler = () => void;
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
	/** A team deathmatch round was won by wipe-out. */
	onRoundWon: (msg: RoundWonMsg) => void;
	/** Freezetime is over: the round is live. */
	onRoundLive: (msg: RoundLiveMsg) => void;
	/** Seated, in the room the server actually put us in. */
	onSeated: (roomId: string, screens: number, mode: MatchMode) => void;
	/** The room asked for is full of humans. Nothing more will arrive. */
	onRoomFull: (roomId: string) => void;
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
	/** The second slot is a scriptable dummy rather than a bot. */
	training?: boolean;
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
}

export class OnlineManager {
	private channel: ReturnType<typeof geckos> | null = null;
	private _connected = false;
	private _matched = false;
	private _myId = "";
	private _roomId = "";

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
					...(join.ultCharge === undefined
						? {}
						: { ultCharge: join.ultCharge }),
					...(join.mode === undefined ? {} : { mode: join.mode }),
					...(join.freezeTime === undefined
						? {}
						: { freezeTime: join.freezeTime }),
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
				handlers.onSeated(msg.roomId, msg.screens ?? 1, msg.mode ?? "ffa");
			}
			handlers.onStatus("");
		});

		// Sixteen humans already. Said out loud rather than left as a client that
		// connects, receives nothing and looks broken.
		channel.on("room-full", (data: unknown) => {
			const msg = data as { roomId?: string } | null;
			handlers.onRoomFull(msg?.roomId ?? "");
		});

		channel.on("state", (data: unknown) => {
			handlers.onState(data as GameSnapshot);
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

		// A side was wiped out. The arena reset that follows arrives separately as
		// `round-reset`, which is what actually breaks prediction continuity — this
		// is only the announcement.
		channel.on("round-won", (data: unknown) => {
			handlers.onRoundWon(data as RoundWonMsg);
		});

		channel.on("round-live", (data: unknown) => {
			handlers.onRoundLive(data as RoundLiveMsg);
		});

		// The training room echoes its resolved config back, so the UI and the
		// agent API reflect what the room actually is rather than what they asked
		// for. Sent on change, never per tick.
		channel.on("training-state", (data: unknown) => {
			this.onTrainingState?.(data as TrainingStateMsg);
		});

		channel.onDisconnect(() => {
			this._connected = false;
			this._matched = false;
			handlers.onStatus("Disconnected from server");
		});
	}

	sendInput(input: PlayerInput) {
		if (this.channel && this._connected) {
			this.channel.emit("input", input);
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
		this.channel?.close();
		this._connected = false;
		this._matched = false;
	}
}
