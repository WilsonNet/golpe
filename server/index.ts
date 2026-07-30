import geckos, { type ServerChannel } from "@geckos.io/server";
import { GameRoom } from "./GameRoom.js";

const io = geckos({ iceServers: [] });
const waitingRoom: GameRoom[] = [];
const activeRooms: GameRoom[] = [];
let nextRoomId = 1;

/**
 * How long to wait for a client's `join` before assuming it wants public
 * matchmaking. Keeps older clients that never send `join` working.
 */
const JOIN_GRACE_MS = 1500;

/** Default size of a public deathmatch: full, with bots making up the numbers. */
const DEFAULT_FILL = 16;

interface JoinMsg {
	solo?: boolean;
	training?: boolean;
	name?: string;
	/** Bots to seat in a solo room. */
	bots?: number;
	/** Fighters a public deathmatch is topped up to with bots. */
	fill?: number;
	/**
	 * Shortened rules, for a private room only.
	 *
	 * A five-minute match is the right length to play and the wrong length to
	 * measure: a probe that has to wait out the clock to see a winner is a probe
	 * nobody runs. These make the win condition testable in seconds, which is why
	 * they are refused on a public room — one client must not be able to end
	 * everybody else's match early.
	 */
	scoreLimit?: number;
	timeLimitMs?: number;
}

function newRoom(rules: { scoreLimit?: number; timeLimitMs?: number } = {}) {
	const room = new GameRoom(`room-${nextRoomId++}`, rules);
	activeRooms.push(room);
	console.log(`[MATCH] Created room ${room.id}`);
	return room;
}

function clamp(
	value: unknown,
	lo: number,
	hi: number,
	fallback: number,
): number {
	const n =
		typeof value === "number" && Number.isFinite(value) ? value : fallback;
	return Math.max(lo, Math.min(hi, Math.round(n)));
}

/**
 * Tell one client it is in. Per-channel rather than broadcast, because `youId`
 * is the whole point of the message: a client that assumed its own channel id
 * matched the id the server scores it under would read somebody else's row on
 * the scoreboard the day those two ever differ.
 */
function seated(room: GameRoom, channel: ServerChannel) {
	channel.emit("match", {
		roomId: room.id,
		playerCount: room.playerCount,
		youId: String(channel.id),
	});
}

io.onConnection((channel) => {
	console.log(`[MATCH] New connection: ${channel.id}`);

	let placed = false;

	/**
	 * `solo` puts the client in its own room against server-hosted bots.
	 *
	 * This is what makes a single-player match a genuine online match: it runs
	 * the same rooms, the same authoritative tick and the same reconciliation as
	 * PvP, so the netcode is exercised every time anyone plays.
	 */
	const place = (msg: JoinMsg) => {
		if (placed) return;
		placed = true;

		const name = msg.name;

		/**
		 * A training room is single-human by construction.
		 *
		 * It is never offered to matchmaking — it is created here, filled with a
		 * dummy immediately, and therefore already full. Seating a stranger in
		 * somebody's practice session would be a bug with no upside: the second
		 * slot is the thing under the practising player's control.
		 */
		if (msg.training) {
			const room = newRoom();
			room.addPlayer(channel, name);
			room.addDummy();
			console.log(
				`[MATCH] Player ${channel.id} in training room ${room.id} vs dummy`,
			);
			seated(room, channel);
			return;
		}

		if (msg.solo) {
			const room = newRoom({
				...(msg.scoreLimit === undefined
					? {}
					: { scoreLimit: clamp(msg.scoreLimit, 1, 999, 21) }),
				...(msg.timeLimitMs === undefined
					? {}
					: { timeLimitMs: clamp(msg.timeLimitMs, 5000, 3_600_000, 300_000) }),
			});
			room.addPlayer(channel, name);
			// Zero is allowed, and useful: an empty room is still a fully served,
			// predicted, reconciled match, and it is the only way to measure something
			// about the local fighter — aim, facing, a shot's heading — without a bot
			// closing to melee range and turning the measurement into noise.
			const bots = clamp(msg.bots, 0, 15, 1);
			room.rebalanceBots(1 + bots);
			console.log(
				`[MATCH] Player ${channel.id} in solo room ${room.id} vs ${bots} bot(s)`,
			);
			seated(room, channel);
			return;
		}

		// Public deathmatch. Bots make up the numbers so the arena is never empty,
		// and a bot gives up its seat the moment a human wants it — which is why
		// `hasHumanSlot` counts a bot-occupied slot as available.
		const fill = clamp(msg.fill, 1, DEFAULT_FILL, DEFAULT_FILL);
		let room = waitingRoom.find((r) => r.hasHumanSlot);
		if (!room) {
			room = newRoom();
			waitingRoom.push(room);
		}

		if (room.addPlayer(channel, name)) {
			room.rebalanceBots(fill);
			console.log(
				`[MATCH] Player ${channel.id} joined ${room.id} (${room.playerCount} fighters, ${room.humanCount} human)`,
			);
			seated(room, channel);
		}
	};

	channel.on("join", (data: unknown) => {
		place((data as JoinMsg | null) ?? {});
	});

	setTimeout(() => place({}), JOIN_GRACE_MS);
});

function loop(time: number) {
	for (const room of activeRooms) {
		room.tick(time);
	}
	// Reap rooms once every human has left; a room of bots has no reason to run.
	const deadRooms = activeRooms.filter((r) => r.humanCount === 0);
	for (const r of deadRooms) {
		const idx = activeRooms.indexOf(r);
		if (idx !== -1) activeRooms.splice(idx, 1);
		const widx = waitingRoom.indexOf(r);
		if (widx !== -1) waitingRoom.splice(widx, 1);
	}
	setTimeout(() => loop(performance.now()), 16);
}

const PORT = 9208;
io.listen(PORT);
console.log(`[SERVER] Vento Aureo server listening on port ${PORT}`);
console.log(
	"[SERVER] public rooms are 16-fighter deathmatches, filled with bots",
);
loop(performance.now());
