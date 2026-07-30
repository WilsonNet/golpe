import { randomUUID } from "node:crypto";
import geckos, { type ServerChannel } from "@geckos.io/server";
import { RELIABLE } from "../src/game/online/types.js";
import { GameRoom } from "./GameRoom.js";

const io = geckos({ iceServers: [] });

/**
 * Every live room, by id.
 *
 * **A room is identified, not searched for.** There is no matchmaking queue: a
 * client names the room it wants and gets it, or creates it by being first. That
 * replaced a shared waiting room, which meant everybody who opened the game
 * landed in the same match whether they meant to or not — and made two probes
 * running back to back interfere with each other, because the second one joined
 * the room the first had not finished leaving.
 */
const rooms = new Map<string, GameRoom>();

/**
 * How long to wait for a client's `join` before placing it anyway.
 * Keeps older clients that never send `join` working.
 */
const JOIN_GRACE_MS = 1500;

/** Default size of a deathmatch: full, with bots making up the numbers. */
const DEFAULT_FILL = 16;

/**
 * What a room id may look like.
 *
 * It arrives from a client, becomes a `Map` key and is logged, so it is checked
 * rather than trusted. Anything else is replaced with a fresh id — and the id the
 * server actually used comes back in the `match` message, so the client can put
 * the real one in its address bar rather than the one it asked for.
 */
const ROOM_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

interface JoinMsg {
	/**
	 * Which room to play in. Absent or malformed means "make me a new one".
	 *
	 * This is the whole of matchmaking: to play together, share the link.
	 */
	room?: string;
	solo?: boolean;
	training?: boolean;
	name?: string;
	/** Bots to seat in a solo room. */
	bots?: number;
	/** Fighters a deathmatch is topped up to with bots. */
	fill?: number;
	/**
	 * Shortened rules.
	 *
	 * A five-minute match is the right length to play and the wrong length to
	 * measure: a probe that has to wait out the clock to see a winner is a probe
	 * nobody runs. These make the win condition testable in seconds.
	 *
	 * **Honoured only by the client that creates the room.** Otherwise the last
	 * person through the door could shorten a match everybody else was already
	 * playing.
	 */
	scoreLimit?: number;
	timeLimitMs?: number;
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

function roomId(raw: unknown): string {
	return typeof raw === "string" && ROOM_ID_RE.test(raw) ? raw : randomUUID();
}

/** Create a room and register it. Its rules and size are fixed here, for good. */
function createRoom(
	id: string,
	rules: { scoreLimit?: number; timeLimitMs?: number; fillTarget?: number },
): GameRoom {
	const room = new GameRoom(id, rules);
	rooms.set(id, room);
	console.log(`[MATCH] Created room ${id} (fill ${room.fillTarget})`);
	return room;
}

/**
 * Tell one client it is in. Per-channel rather than broadcast, because `youId`
 * is the whole point of the message: a client that assumed its own channel id
 * matched the id the server scores it under would read somebody else's row on
 * the scoreboard the day those two ever differ.
 *
 * `roomId` is the id the server *used*, which is not always the one the client
 * asked for — so the client rewrites its address bar from this rather than from
 * what it proposed.
 */
function seated(room: GameRoom, channel: ServerChannel) {
	// Reliable: there is no second one. Lose it and the client never learns the id
	// the server scores it under — so it reads somebody else's scoreboard row — and
	// never puts the room in its address bar, so it cannot invite anybody.
	channel.emit(
		"match",
		{
			roomId: room.id,
			playerCount: room.playerCount,
			youId: String(channel.id),
		},
		RELIABLE,
	);
}

io.onConnection((channel) => {
	console.log(`[MATCH] New connection: ${channel.id}`);

	let placed = false;

	const place = (msg: JoinMsg) => {
		if (placed) return;
		placed = true;

		const name = msg.name;

		/**
		 * A training room is single-human by construction.
		 *
		 * It always gets a fresh id and ignores the one it was given: it is created
		 * here, filled with a dummy immediately, and therefore already full. Seating
		 * a stranger in somebody's practice session would be a bug with no upside —
		 * the second slot is the thing under the practising player's control.
		 */
		if (msg.training) {
			const room = createRoom(randomUUID(), {});
			room.addPlayer(channel, name);
			room.addDummy();
			console.log(
				`[MATCH] Player ${channel.id} in training room ${room.id} vs dummy`,
			);
			seated(room, channel);
			return;
		}

		const id = roomId(msg.room);
		let room = rooms.get(id);
		if (!room) {
			// First one through the door sets the rules and the size. `bots=0` is
			// allowed and useful: an empty room is still a fully served, predicted,
			// reconciled match, and it is the only way to measure something about the
			// local fighter — aim, facing, a shot's heading — without a bot closing to
			// melee range and turning the measurement into noise.
			const fillTarget = msg.solo
				? 1 + clamp(msg.bots, 0, 15, 1)
				: clamp(msg.fill, 1, DEFAULT_FILL, DEFAULT_FILL);
			room = createRoom(id, {
				fillTarget,
				...(msg.scoreLimit === undefined
					? {}
					: { scoreLimit: clamp(msg.scoreLimit, 1, 999, 21) }),
				...(msg.timeLimitMs === undefined
					? {}
					: { timeLimitMs: clamp(msg.timeLimitMs, 5000, 3_600_000, 300_000) }),
			});
		}

		if (room.addPlayer(channel, name)) {
			// Back to the size the room was created at, never the size this client
			// asked for — a latecomer must not be able to resize a match in progress.
			room.rebalanceBots(room.fillTarget);
			console.log(
				`[MATCH] Player ${channel.id} joined ${room.id} (${room.playerCount} fighters, ${room.humanCount} human)`,
			);
			seated(room, channel);
			return;
		}

		console.log(`[MATCH] Room ${room.id} is full — ${channel.id} turned away`);
		// Reliable: losing this leaves a client connected, receiving nothing, with no
		// way to tell a full room from a broken one.
		channel.emit("room-full", { roomId: room.id }, RELIABLE);
	};

	channel.on("join", (data: unknown) => {
		place((data as JoinMsg | null) ?? {});
	});

	setTimeout(() => place({}), JOIN_GRACE_MS);
});

function loop(time: number) {
	for (const room of rooms.values()) {
		room.tick(time);
	}
	// Reap rooms once every human has left; a room of bots has no reason to run.
	// The id is released with it, so the same link creates a fresh room later.
	// Collected before deleting rather than deleted mid-iteration: that happens to
	// be defined for a Map and is still the sort of thing that stops being safe the
	// day somebody adds a second reason to remove a room.
	const dead: string[] = [];
	for (const [id, room] of rooms) {
		if (room.humanCount === 0) dead.push(id);
	}
	for (const id of dead) rooms.delete(id);
	setTimeout(() => loop(performance.now()), 16);
}

const PORT = 9208;
io.listen(PORT);
console.log(`[SERVER] Vento Aureo server listening on port ${PORT}`);
console.log(
	"[SERVER] rooms are addressed by id — share the link to share a room",
);
loop(performance.now());
