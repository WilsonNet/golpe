import geckos from "@geckos.io/client";
import type { TrainingConfigMsg, TrainingStateMsg } from "../training/types";
import type { GameSnapshot, MatchMessage, PlayerInput } from "./types";

export type OnlineStateHandler = (state: GameSnapshot) => void;
export type OnlineStatusHandler = (status: string) => void;
export type OnlineResetHandler = () => void;
export type TrainingStateHandler = (state: TrainingStateMsg) => void;

export class OnlineManager {
	private channel: ReturnType<typeof geckos> | null = null;
	private onState: OnlineStateHandler | null = null;
	private onStatus: OnlineStatusHandler | null = null;
	private onRoundReset: OnlineResetHandler | null = null;
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

	get myId() {
		return this._myId;
	}

	private onTrainingState: TrainingStateHandler | null = null;

	connect(
		onState: OnlineStateHandler,
		onStatus: OnlineStatusHandler,
		onRoundReset?: OnlineResetHandler,
		/** Solo: play this room against a server-hosted bot instead of waiting for a human. */
		solo = false,
		/** Training: the second slot is a scriptable dummy rather than a bot. */
		training = false,
	) {
		this.onState = onState;
		this.onStatus = onStatus;
		this.onRoundReset = onRoundReset ?? null;
		const channel = geckos({ url: this.serverUrl, port: this.serverPort });
		this.channel = channel;

		channel.onConnect((error) => {
			if (error) {
				this._connected = false;
				this.onStatus?.(`Connection failed: ${error.message}`);
				return;
			}
			this._connected = true;
			this._myId = channel.id as string;
			// The server holds placement until it knows which kind of match we want.
			channel.emit("join", { solo, training });
			this.onStatus?.(
				training
					? "Connected — training room..."
					: solo
						? "Connected — starting match..."
						: "Connected — waiting for opponent...",
			);
		});

		this.channel.on("match", (data: unknown) => {
			const msg = data as MatchMessage;
			this._matched = true;
			this.onStatus?.(`Matched in room ${msg.roomId}!`);
		});

		this.channel.on("state", (data: unknown) => {
			const snap = data as GameSnapshot;
			this.onState?.(snap);
		});

		this.channel.on("round-reset", () => {
			this.onRoundReset?.();
		});

		// The training room echoes its resolved config back, so the UI and the
		// agent API reflect what the room actually is rather than what they asked
		// for. Sent on change, never per tick.
		this.channel.on("training-state", (data: unknown) => {
			this.onTrainingState?.(data as TrainingStateMsg);
		});

		this.channel.onDisconnect(() => {
			this._connected = false;
			this._matched = false;
			this.onStatus?.("Disconnected from server");
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
