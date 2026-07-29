import geckos from "@geckos.io/server";
import { GameRoom } from "./GameRoom.js";

const io = geckos({ iceServers: [] });
const waitingRoom: GameRoom[] = [];
const activeRooms: GameRoom[] = [];
let nextRoomId = 1;

/**
 * How long to wait for a client's `join` before assuming it wants human
 * matchmaking. Keeps older clients that never send `join` working.
 */
const JOIN_GRACE_MS = 1500;

function newRoom(): GameRoom {
	const room = new GameRoom(`room-${nextRoomId++}`);
	activeRooms.push(room);
	console.log(`[MATCH] Created room ${room.id}`);
	return room;
}

function startMatch(room: GameRoom) {
	room.broadcast("match", { roomId: room.id, playerCount: room.playerCount });
	const idx = waitingRoom.indexOf(room);
	if (idx !== -1) waitingRoom.splice(idx, 1);
	console.log(`[MATCH] Room ${room.id} is full — match started!`);
}

io.onConnection((channel) => {
	console.log(`[MATCH] New connection: ${channel.id}`);

	let placed = false;

	/**
	 * `solo` puts the client in its own room against a server-hosted bot.
	 *
	 * This is what makes a single-player match a genuine online match: it runs
	 * the same rooms, the same authoritative tick and the same reconciliation as
	 * PvP, so the netcode is exercised every time anyone plays.
	 */
	const place = (solo: boolean, training = false) => {
		if (placed) return;
		placed = true;

		/**
		 * A training room is single-human by construction.
		 *
		 * It is never offered to matchmaking — it is created here, filled with a
		 * dummy immediately, and therefore already full. Seating a stranger in
		 * somebody's practice session would be a bug with no upside: the second
		 * slot is the thing under the practising player's control.
		 */
		if (training) {
			const room = newRoom();
			room.addPlayer(channel);
			room.addDummy();
			console.log(
				`[MATCH] Player ${channel.id} in training room ${room.id} vs dummy`,
			);
			startMatch(room);
			return;
		}

		if (solo) {
			const room = newRoom();
			room.addPlayer(channel);
			room.addBot();
			console.log(
				`[MATCH] Player ${channel.id} in solo room ${room.id} vs bot`,
			);
			startMatch(room);
			return;
		}

		let room = waitingRoom.find((r) => !r.isFull);
		if (!room) {
			room = newRoom();
			waitingRoom.push(room);
		}

		if (room.addPlayer(channel)) {
			console.log(
				`[MATCH] Player ${channel.id} joined room ${room.id} (${room.playerCount}/2)`,
			);
			if (room.playerCount >= 2) startMatch(room);
		}
	};

	channel.on("join", (data: unknown) => {
		const msg = data as { solo?: boolean; training?: boolean } | null;
		place(Boolean(msg?.solo), Boolean(msg?.training));
	});

	setTimeout(() => place(false), JOIN_GRACE_MS);
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
console.log("[SERVER] solo matches play against a server-hosted bot");
loop(performance.now());
