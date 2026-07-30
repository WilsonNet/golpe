import geckos from "@geckos.io/client";
import type { TrainingConfigMsg, TrainingStateMsg } from "../training/types";
import type {
	GameSnapshot,
	MatchMessage,
	MatchOverMsg,
	PlayerInput,
	RespawnMsg,
	RosterMsg,
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
}

export interface JoinOptions {
	/** Play this room against server-hosted bots instead of waiting for humans. */
	solo?: boolean;
	/** The second slot is a scriptable dummy rather than a bot. */
	training?: boolean;
	/** What the scoreboard should call this player. */
	name?: string;
	/** Bots to seat in a solo room. */
	bots?: number;
	/** Fighters a public deathmatch is topped up to with bots. */
	fill?: number;
	/** Shortened rules. Honoured in a private room only — see the server. */
	scoreLimit?: number;
	timeLimitMs?: number;
}

export class OnlineManager {
	private channel: ReturnType<typeof geckos> | null = null;
	private _connected = false;
	private _matched = false;
	private _myId = "";

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
			channel.emit("join", {
				solo: Boolean(join.solo),
				training: Boolean(join.training),
				...(join.name === undefined ? {} : { name: join.name }),
				...(join.bots === undefined ? {} : { bots: join.bots }),
				...(join.fill === undefined ? {} : { fill: join.fill }),
				...(join.scoreLimit === undefined
					? {}
					: { scoreLimit: join.scoreLimit }),
				...(join.timeLimitMs === undefined
					? {}
					: { timeLimitMs: join.timeLimitMs }),
			});
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
			handlers.onStatus("");
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

	sendTrainingConfig(msg: TrainingConfigMsg) {
		if (this.channel && this._connected) {
			this.channel.emit("training-config", msg);
		}
	}

	disconnect() {
		this.channel?.close();
		this._connected = false;
		this._matched = false;
	}
}
