import type {
	MatchEndReason,
	MatchPhase,
	ScoreEntry,
} from "../simulation/Deathmatch.js";
import type { HeroId } from "../simulation/Heroes.js";
import type {
	MeleeMove,
	MeleeOutcome,
	PlayerIntent,
} from "../simulation/Physics.js";
import type { MatchMode, TeamId } from "../simulation/Teams.js";
import type { PackedIntent, PackedState } from "./wire.js";

/**
 * Send this message until it arrives.
 *
 * Geckos datagrams are unreliable by default, which is right for everything that
 * repeats: a lost input is what the server's starvation freeze exists for, and a
 * lost snapshot is followed by another one 50ms later. It is wrong for a one-shot
 * control message with no second chance, and the failures are silent and
 * session-ruining rather than glitchy:
 *
 * - a lost `join` puts a player in **a different room** from the friend who
 *   invited them, because no `room` means "make a new one";
 * - a lost `match` means the client never learns the id the server scores it
 *   under, so it reads somebody else's scoreboard row;
 * - a lost `match-over` means no podium at the end of a match;
 * - a lost `training-state` hangs an agent awaiting `__training.set()`.
 *
 * Ten sends at 150ms, deduplicated by id on receipt, so a handler still runs
 * exactly once. Deliberately **not** used for `state`, `input`, `roster` (which
 * has its own 2s heartbeat) or `respawn` (which a >100px correction covers) — a
 * message that repeats or self-heals does not need paying for ten times.
 */
/** The Geckos signalling port — the number both the server binds and every client dials. */
export const GAME_SERVER_PORT = 9208;

export const RELIABLE = { reliable: true } as const;

/**
 * One tick of player intent. `seq` is what makes prediction work: the server
 * echoes back the last sequence it consumed so the client knows exactly which
 * of its predicted inputs are still unacknowledged and must be replayed.
 *
 * It extends `PlayerIntent` so the wire format cannot drift from what the
 * simulation actually consumes: adding a field to the simulation and forgetting
 * to send it would mean the server replays a different input than the client
 * predicted, which is invisible until it shows up as unexplained correction.
 *
 * Sent unpacked, unlike the snapshot: it is one small message per client per
 * tick, so the bandwidth is not worth a layer of encoding between the input a
 * player pressed and the input the server simulates.
 */
export interface PlayerInput extends PlayerIntent {
	seq: number;
	aimAngle: number;
}

/**
 * A melee impact that happened server-side, for the client to play effects from.
 *
 * Events, not state: they are one-shot and a client that misses a datagram loses
 * a spark rather than desyncing. Everything with lasting consequence — stun,
 * launch, knockback — travels in `PlayerPosition` instead.
 */
export interface MeleeEventMsg {
	attackerId: string;
	/** Who was hit, so the struck sprite is the one that takes the punch. */
	victimId: string;
	move: MeleeMove;
	outcome: MeleeOutcome;
	x: number;
	y: number;
	dir: number;
	/**
	 * The blast's reach, px. Only blast and bomb events carry it: the client
	 * draws the area of effect ring to exactly this radius, so the move's
	 * reach is visible even when it hits nobody.
	 */
	radiusPx?: number;
}

/**
 * An ultimate was denied, for the client to play the typography over the
 * denier.
 *
 * Two ways to deny, one event: kill a fighter while they are holding the
 * button, or block the thrown grenade with a sword guard. Both are one-shot
 * effects with a lasting consequence (the meter is gone), but the consequence
 * travels in the charge meter itself — this is only the "DENY" splash.
 */
export interface DenyEventMsg {
	/** The fighter who denied it — the killer, or the guard that blocked the throw. */
	denierId: string;
	/** Where the deny happened, in world body space, for the splash. */
	x: number;
	y: number;
}

/**
 * What dealt the killing blow, for the kill feed's icon and label.
 *
 * The melee moves name themselves; `"bullet"` is the killer's ranged weapon —
 * the HUD names it from the killer's hero (rifle, machine gun, shotgun).
 * `"bomb"` is the plunge, the airborne Massive Strike; `"massive"` the ground
 * slam. The rest are items and ultimates, each its own story in the feed.
 */
export type KillCause =
	| "slash"
	| "slash2"
	| "slash3"
	| "uppercut"
	| "massive"
	| "bomb"
	| "stab"
	| "thrust"
	| "shoryuken"
	| "bullet"
	| "grenade"
	| "trap"
	| "dragon"
	| "hole"
	| "blossom";

/**
 * A frag, for the turn-away kill feed.
 *
 * Events, not state: the scores themselves already travel in the snapshot, and
 * this is only the "who beat whom, with what" narration — the single one-shot
 * of a fight that already changed the whole scoreboard. Effects only, exactly
 * like `melee` events: a dropped datagram costs a feed entry, never a frag.
 */
export interface KillEventMsg {
	/** The fighter who dealt the killing blow, or null when nobody did. */
	killerId: string | null;
	victimId: string;
	/** What actually killed the victim. */
	cause: KillCause;
}

export interface SnapshotPlayer {
	id: string;
	hp: number;
	/** Highest input sequence from this player already folded into `state`. */
	lastSeq: number;
	/** Full authoritative simulation state, packed. See `wire.ts`. */
	state: PackedState;
	/**
	 * The intent this fighter's state was advanced with on this snapshot's tick.
	 *
	 * This is what makes rollback possible for a fighter the client does not
	 * control: the client carries this input forward to predict the fighter at the
	 * present instant, instead of drawing it 150ms in the past. `null` means the
	 * server froze the fighter that tick (a starved input queue), which the client
	 * must reproduce rather than invent motion for.
	 */
	input: PackedIntent | null;
	kills: number;
	deaths: number;
	/**
	 * The scoreboard's stat columns, server-counted like the scores: damage
	 * dealt, ultimate denies and damage the guard turned away.
	 *
	 * In the snapshot for the same reason `kills` is: only the server sees a
	 * hit land, so a client cannot derive any of these from prediction — and a
	 * scoreboard row that quietly stayed at zero would be worse than no row.
	 */
	damage: number;
	denies: number;
	blocked: number;
	alive: boolean;
	/**
	 * Which side this fighter is on, or `null` in a free-for-all.
	 *
	 * **In the snapshot, not the roster**, and that is load-bearing. Teams are an
	 * input to `tickPlayer`: the black hole's friendly-fire rule is applied on the
	 * client for every fighter it predicts, and replayed on every reconciliation.
	 * The roster is sent on change with a 2s heartbeat, so a client that lost one
	 * would spend up to two seconds dragging its own teammates into a hole the
	 * server is not pulling them into — a divergence nothing else could explain.
	 * Twenty times a second, beside `hp`, it simply cannot drift.
	 */
	team: TeamId | null;
	/**
	 * Which hero this fighter plays. Beside `team`, and for the same reason:
	 * the hero decides which weapons `tickPlayer` simulates with, so it is an
	 * input to the simulation the client replays on every reconciliation. A
	 * hero that arrived on the slow roster channel could not be rolled back
	 * with the state that depends on it.
	 */
	hero: HeroId;
	/**
	 * Ultimate charge, 0..100.
	 *
	 * Beside `hp` and the scores rather than inside `state`, and for the same
	 * reason they are: it is paid out of damage, and only the server knows a hit
	 * landed. Putting it in `PlayerPosition` would oblige the client to predict a
	 * number it has no way to compute, and would put it on the replay path for no
	 * benefit — the simulation never reads it.
	 */
	ult: number;
	/**
	 * Item charges left this life. Server-counted like the ultimate's charge:
	 * only the server knows a use spent one. Resets to the kit's maximum on
	 * respawn and on a round reset — see specs/items.md.
	 */
	itemCharges: number;
}

export interface SnapshotBullet {
	id: number;
	ownerId: string;
	x: number;
	y: number;
	/** Carried so the client can dead-reckon between 20Hz snapshots. */
	vx: number;
	vy: number;
	/**
	 * One round of a shotgun's fan: drawn smaller and dimmer than a full
	 * shot. Absent (a stale server) means an ordinary bullet.
	 */
	pellet?: boolean;
}

/**
 * The match clock and scores, as they stand.
 *
 * Deliberately *not* the ranked standings. Ranking is a pure function of these
 * numbers and the roster, so it is computed on the client from
 * `rankScores` — the same function the server uses — rather than being sent
 * sixteen names deep at 20Hz.
 */
export interface MatchStatus {
	phase: MatchPhase;
	elapsedMs: number;
	scoreLimit: number;
	timeLimitMs: number;
	endReason: MatchEndReason;
	/** Who won, once `phase` is "over". */
	winnerId: string | null;
	/** ms until the next match starts, while the podium is up. */
	nextMatchInMs: number;
	/**
	 * Which ruleset this room plays. `"ffa"` for an ordinary deathmatch.
	 *
	 * Sent every snapshot rather than only in the `match` message, for the same
	 * reason `scoreLimit` is: a client that lost one datagram must not spend a
	 * whole match drawing the wrong HUD, and one word at 20Hz costs nothing.
	 */
	mode: MatchMode;
	/** The round scoreboard, in team deathmatch. `null` in a free-for-all. */
	teams: TeamStatus | null;
}

/**
 * The state of a team deathmatch: the round score, who is still standing, and
 * whether the arena is between rounds.
 *
 * Everything here is derived from state the server already owns, and it is sent
 * rather than derived on the client for one reason: **the round is a server
 * decision**. A client that counted the living itself would announce a wipe on a
 * frame where its own prediction had killed somebody the server had not.
 */
export interface TeamStatus {
	/** Rounds won, indexed by team id. */
	scores: number[];
	/** Fighters still standing, indexed by team id. */
	alive: number[];
	/** Fighters seated, indexed by team id — including the dead ones. */
	seated: number[];
	/** 1-based round number, so the HUD can say "ROUND 4". */
	round: number;
	/**
	 * ms until the arena resets, while a wipe is being shown. Zero while the
	 * round is live.
	 */
	resetInMs: number;
	/**
	 * ms of freezetime left before the round goes live. Zero once it is.
	 *
	 * The HUD's countdown reads this rather than counting locally: it is the same
	 * number the fighters are carrying in their own state, so the banner and the
	 * moment they can actually move cannot drift apart.
	 */
	freezeMs: number;
	/** Who took the last round: a side, or `null` for a draw or a fresh match. */
	lastRoundWinner: TeamId | null;
	/** The side that won the match, once `phase` is "over". */
	winnerTeam: TeamId | null;
}

/** A black hole grenade in flight. Server-owned, like a bullet. */
export interface SnapshotGrenade {
	id: number;
	ownerId: string;
	/** The caster's side, so a client tints the arc and skips its own team. */
	ownerTeam: TeamId | null;
	x: number;
	y: number;
	/** Carried so the client can dead-reckon the arc between 20Hz snapshots. */
	vx: number;
	vy: number;
}

/**
 * The open singularity, if there is one. At most one per room.
 *
 * Sent in full every snapshot rather than announced once: it is what the client
 * feeds into `tickPlayer` for every fighter it predicts, so a lost datagram must
 * not be able to leave a client pulling people into a hole that has closed — or
 * worse, not pulling them into one that is open.
 */
interface SnapshotSingularity {
	id: number;
	ownerId: string;
	/**
	 * The caster's side. Travels with the field rather than being looked up per
	 * fighter, because this object is handed straight to `tickPlayer` — see
	 * `Singularity` in the simulation.
	 */
	ownerTeam: TeamId | null;
	x: number;
	y: number;
	remainingMs: number;
}

/**
 * The room is frozen for an ultimate cast.
 *
 * Present for exactly the ticks the server is not simulating. A client that
 * sees this stops running fixed steps — see specs/netcode.md for why that is
 * the *only* safe way to freeze a networked game, and why it is nothing like
 * the hitstop that is banned everywhere else.
 */
export interface SnapshotCinematic {
	casterId: string;
	/** ms of freeze left, for the overlay's own progress. */
	remainingMs: number;
	/** Total length, so the overlay can animate a fraction without a second constant. */
	totalMs: number;
}

export interface GameSnapshot {
	/** Server time the snapshot was taken, for clock sync and dead reckoning. */
	t: number;
	/**
	 * The server tick this snapshot describes.
	 *
	 * The rollback anchor: the client rewinds every fighter to this tick and
	 * re-simulates forward to the present.
	 */
	tick: number;
	players: SnapshotPlayer[];
	bullets: SnapshotBullet[];
	/** Melee impacts since the previous snapshot. Effects only. */
	melee: MeleeEventMsg[];
	/** Ultimate denies since the previous snapshot. Effects only. */
	denies: DenyEventMsg[];
	/** Frags since the previous snapshot. Effects only, like `melee`. */
	kills: KillEventMsg[];
	match: MatchStatus;
	/** Black hole grenades in flight. Usually empty; at most one per cast. */
	grenades: SnapshotGrenade[];
	/** The open black hole, or null. At most one per room. */
	singularity: SnapshotSingularity | null;
	/** The open Death Blossom, or null. At most one per room. */
	blossom: SnapshotBlossom | null;
	/** Set only while the room is frozen for a cast. */
	cinematic: SnapshotCinematic | null;
	/** Anands' floor traps, as they stand. Cleared on a round reset. */
	traps: SnapshotTrap[];
	/**
	 * Anands' trap canisters in flight. Server-owned, dead-reckoned like
	 * bullets: the client anchors one on first sight and runs the shared
	 * `tickTrapCanister` until the snapshot says it planted (the canister is
	 * gone and an armed trap sits where it landed).
	 */
	trapCanisters: SnapshotTrapCanister[];
	/** HE grenades in flight. Server-owned, dead-reckoned like bullets. */
	heGrenades: SnapshotHeGrenade[];
	/** Jeffs' smoke canisters in flight. Server-owned, dead-reckoned like bullets. */
	smokeGrenades: SnapshotSmokeGrenade[];
	/** Jeffs' smoke clouds, as they stand. Vision only; cleared on a round reset. */
	smokeClouds: SnapshotSmokeCloud[];
	/** HE blasts since the previous snapshot. Effects only. */
	explosions: ExplosionMsg[];
	/** A trap just rooted somebody, for the caption. Effects only. */
	rooted: RootedMsg[];
	/**
	 * Bullets the guard turned away since the previous snapshot. Effects only —
	 * the charge it earned already travels in the meter — so a dropped datagram
	 * costs the purple sparks, never the reward.
	 */
	blockedBullets: BlockedBulletMsg[];
}

/**
 * A floor trap, as both sides see it.
 *
 * Sent in full every snapshot (like the singularity) because the client feeds
 * it into `tickPlayer` for every fighter it predicts: a lost datagram must not
 * leave a client walking a fighter through a trap the server is locking it in.
 * A trap is single-use — the server removes it from the world the tick it
 * springs, so a trap that is in the list is armed, and one that is gone caught
 * somebody.
 */
export interface SnapshotTrap {
	id: number;
	ownerId: string;
	/** The owner's side, for the client's friendly-fire filter. */
	ownerTeam: TeamId | null;
	/** Centre, in world coordinates. */
	x: number;
	y: number;
}

/** A trap canister in flight. Server-owned, like a bullet. */
export interface SnapshotTrapCanister {
	id: number;
	ownerId: string;
	/** The thrower's side — the planted trap inherits it. */
	ownerTeam: TeamId | null;
	x: number;
	y: number;
	/** Carried so the client can dead-reckon the arc between snapshots. */
	vx: number;
	vy: number;
}

/** An HE grenade in flight. Server-owned, like a bullet. */
export interface SnapshotHeGrenade {
	id: number;
	ownerId: string;
	/** The thrower's side, so a client tints the arc and skips its own team. */
	ownerTeam: TeamId | null;
	x: number;
	y: number;
	/** Carried so the client can dead-reckon the arc between snapshots. */
	vx: number;
	vy: number;
}

/**
 * The open Death Blossom, as both sides see it.
 *
 * Sent in full every snapshot (like the singularity) even though the renderer
 * is its only consumer: the caster's channel already travels in their packed
 * state, and this field is the area — the ring the storm draws and the one
 * thing the two sides must agree a fighter is standing inside of.
 */
interface SnapshotBlossom {
	id: number;
	ownerId: string;
	/** The caster's side, so a client tints the storm and skips its own team. */
	ownerTeam: TeamId | null;
	/** Centre, in world coordinates. */
	x: number;
	y: number;
	/** ms of storm left. Presentation only; never scales the storm. */
	remainingMs: number;
}

/** A smoke canister in flight. Server-owned, like a bullet. */
export interface SnapshotSmokeGrenade {
	id: number;
	ownerId: string;
	/** The thrower's side — the bloom inherits it. */
	ownerTeam: TeamId | null;
	x: number;
	y: number;
	/** Carried so the client can dead-reckon the lob between snapshots. */
	vx: number;
	vy: number;
}

/**
 * A smoke cloud, as both sides see it.
 *
 * Sent in full every snapshot even though no `tickPlayer` ever reads it: the
 * concealment is re-derived from this list on every frame, so a lost datagram
 * costs a puff at most and never a false clear. Position and owner never
 * change once the cloud blooms.
 */
export interface SnapshotSmokeCloud {
	id: number;
	ownerId: string;
	/** The owner's side, for the client's per-side drawing. */
	ownerTeam: TeamId | null;
	/** Centre, in world coordinates. */
	x: number;
	y: number;
	/** ms of cloud left. Presentation only. */
	remainingMs: number;
}

/** An HE grenade just went off. Effects only, exactly like `melee` events. */
export interface ExplosionMsg {
	x: number;
	y: number;
	/** The blast's reach, so the client draws the ring to the true radius. */
	radius: number;
}

/** A trap just rooted somebody. Effects only, exactly like `denies`. */
export interface RootedMsg {
	/** Who got rooted, so the caption pops over the right fighter. */
	victimId: string;
	/** Where, in world body space, for the splash. */
	x: number;
	y: number;
}

/**
 * A bullet the sword guard turned away. Effects only, exactly like a melee
 * impact: a dropped datagram costs the purple sparks, never the reward, which
 * travels in the meter itself.
 */
export interface BlockedBulletMsg {
	/** The fighter whose guard stopped it, so the sparks play on the right body. */
	victimId: string;
	/** Where the bullet died, in world body space. */
	x: number;
	y: number;
}

/**
 * Who is in the room, by name.
 *
 * Its own message, sent only when the roster changes. Names are stable strings
 * and there are sixteen of them; putting them in the snapshot would spend
 * bandwidth every 50ms restating something that changes when somebody connects.
 */
export interface RosterEntry {
	id: string;
	name: string;
	/** A server-hosted bot, so the scoreboard can say so. */
	bot: boolean;
	/** Which side in team deathmatch, or null in a free-for-all. */
	team?: TeamId | null;
	/** True if this fighter can manage bots mid-match. */
	admin?: boolean;
	/** True for the room's creator (the first human to join). */
	creator?: boolean;
}

export interface RosterMsg {
	players: RosterEntry[];
}

export interface MatchMessage {
	roomId: string;
	playerCount: number;
	/** The id the server knows this client by — never assume the channel id. */
	youId: string;
	/**
	 * How many 800px screens wide the room's arena is.
	 *
	 * Set by the client that created the room (`?screen=N`) and authoritative
	 * from then on — a latecomer's `?screen=` is ignored, exactly like the
	 * shortened rules. The client builds its world from this rather than from
	 * its own URL, so every client in a room simulates the same geometry.
	 */
	screens?: number;
	/**
	 * Which ruleset the room plays, decided by whoever created it.
	 *
	 * Like `screens`, a latecomer's `?mode=` is ignored — a room is one match, and
	 * the last person through the door does not get to change what everybody else
	 * is playing. The snapshot repeats it; this is only so a client knows before
	 * the first one lands.
	 */
	mode?: MatchMode;
}

/** A single fighter returning to the arena. Announced, never inferred. */
export interface RespawnMsg {
	id: string;
	t: number;
}

/**
 * Freezetime is over — the round is live. Sent once, reliably.
 *
 * The countdown is in every snapshot, so this carries no information a client
 * could not derive. It exists so "FIGHT" lands on the same moment on every
 * screen instead of each client racing its own copy of the clock to zero.
 */
export interface RoundLiveMsg {
	round: number;
}

/**
 * A team deathmatch round ended in a wipe-out. Sent once, reliably.
 *
 * The snapshot carries the same numbers 20 times a second, so this is redundant
 * by construction — deliberately, exactly like `match-over`. A round ending is
 * the one moment in the mode everybody looks up for, and the banner announcing it
 * should not depend on a client having kept up with the datagram that happened to
 * carry the change.
 */
export interface RoundWonMsg {
	/** The side left standing, or `null` when both were wiped on the same tick. */
	team: TeamId | null;
	/** The round that just ended, 1-based. */
	round: number;
	/** Rounds won, indexed by team id, after this one. */
	scores: number[];
	/** ms until the arena resets and the next round starts. */
	resetInMs: number;
}

/**
 * The final standings, sent once when the match ends.
 *
 * The live scoreboard rebuilds the same ranking from the snapshot every frame,
 * so this is redundant by construction — deliberately. The podium is the one
 * screen a player will stare at and remember, and it should not depend on a
 * client having kept up with the last snapshot of a match.
 */
export interface MatchOverMsg {
	reason: MatchEndReason;
	winnerId: string | null;
	standings: ScoreEntry[];
	/**
	 * The winning side in a team deathmatch, or `null` — in a free-for-all, and
	 * in the drawn team match a clock can produce.
	 *
	 * `winnerId` is still sent in TDM and still names the top individual: the
	 * podium leads with the side that won and names the fighter who carried it,
	 * because both are things people argue about afterwards.
	 */
	winnerTeam?: TeamId | null;
	/** Final round score, indexed by team id. Absent in a free-for-all. */
	teamScores?: number[];
}
