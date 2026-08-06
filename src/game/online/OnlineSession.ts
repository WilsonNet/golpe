import type { Container, Sprite, Texture } from "pixi.js";
import type { BulletSample } from "../diagnostics/PhysicsDiagnostics";
import type { PotgAnnounce } from "../potg/types";
import { SpritePool } from "../render/SpritePool";
import {
	DEFAULT_WORLD,
	pointInAnyPlatform,
	type World,
} from "../simulation/Arena";
import {
	rankScores,
	type ScoreEntry,
	type Standing,
} from "../simulation/Deathmatch";
import { type HeroId, kitFor } from "../simulation/Heroes";
import {
	fieldFor,
	isBulletOutOfBounds,
	MAX_HP,
	MS_PER_SECOND,
	type PlayerIntent,
	type PlayerPosition,
	type Singularity,
} from "../simulation/Physics";
import { hostile, type MatchMode, type TeamId } from "../simulation/Teams";
import { TINT, teamTint } from "../teamPalette";
import type { TrainingConfigMsg, TrainingStateMsg } from "../training/types";
import { ServerClock } from "./Interpolation";
import { type JoinOptions, OnlineManager } from "./OnlineManager";
import {
	PredictedPlayer,
	type ReconcileResult,
	RenderSmoother,
} from "./Prediction";
import {
	legaliseDrawn,
	RemoteFighter,
	type RollbackResult,
	RollbackStats,
} from "./Rollback";
import type {
	DenyEventMsg,
	GameSnapshot,
	MatchOverMsg,
	MatchStatus,
	MeleeEventMsg,
	RosterEntry,
	RoundLiveMsg,
	RoundWonMsg,
	SnapshotBullet,
	SnapshotCinematic,
	SnapshotGrenade,
	SnapshotPlayer,
} from "./types";
import { GAME_SERVER_PORT } from "./types";
import { unpackIntent, unpackState } from "./wire";

/** Cap on ballistic extrapolation, so a bad clock estimate cannot fling a bullet. */
const MAX_EXTRAPOLATION_MS = 250;
/** The server broadcasts snapshots at this rate; used for byte-per-second math. */
const SNAPSHOT_HZ = 20;
/** How many snapshot sizes the byte-history window keeps. */
const SNAPSHOT_BYTE_WINDOW = 200;
/** How many seen singularity ids the client remembers. */
const MAX_SEEN_SINGULARITIES = 64;

/** Fixed step, matching the server's tick. Rollback depth is counted in these. */
const PHYSICS_DT = 1 / 60;

/** What the snapshot says about one fighter, minus its simulation state. */
interface FighterInfo {
	hp: number;
	kills: number;
	deaths: number;
	/** The scoreboard's stat columns: damage dealt, denies, guard-blocked. */
	damage: number;
	denies: number;
	blocked: number;
	alive: boolean;
	/** Ultimate charge, 0..100. Server-owned; the client only draws it. */
	ult: number;
	/**
	 * Which side, or `null` in a free-for-all.
	 *
	 * Read on every fixed step — the black hole's friendly-fire rule is an
	 * argument to `tickPlayer` for every fighter this client predicts — which is
	 * exactly why it arrives in the snapshot beside `hp` and not in the roster.
	 */
	team: TeamId | null;
	/** Which hero, for the kit that `tickPlayer` replays every fighter with. */
	hero: HeroId;
}

function newInfo(): FighterInfo {
	return {
		hp: 100,
		kills: 0,
		deaths: 0,
		damage: 0,
		denies: 0,
		blocked: 0,
		alive: true,
		ult: 0,
		team: null,
		hero: "lia",
	};
}

export interface OnlineCallbacks {
	onStatus: (msg: string) => void;
	onLocalHp: (hp: number) => void;
	/**
	 * The local fighter's hero changed — the echo of the Esc menu's hero select
	 * (or the hero the URL asked for, arriving on the first snapshot). The
	 * client swaps the sheet and the HUD reads the new name from this.
	 */
	onLocalHero: (hero: HeroId) => void;
	/**
	 * The whole reconciliation result, for the diagnostic.
	 *
	 * One object rather than four positional arguments, because the fourth — the
	 * divergence detail — was declared here and never actually passed at the call
	 * site. It was captured, dropped on the floor, and the `[DESYNC]` log that
	 * exists to make a rare divergence diagnosable could only ever print nothing.
	 */
	onReconcile: (result: ReconcileResult) => void;
	/** A discontinuity that is expected — so it is not counted as jitter. */
	onTeleport: (frames?: number) => void;
	/** The server reset the whole arena: all continuity is legitimately broken. */
	onRoundReset: () => void;
	/** A sword impact the server judged, for effects only. */
	onMeleeEvent: (event: MeleeEventMsg) => void;
	/** An ultimate was denied, for the "DENY" splash over the denier. */
	onDeny: (event: DenyEventMsg) => void;
	/** A fighter appeared in the snapshot for the first time. */
	onFighterAdded: (id: string) => void;
	/** A fighter is no longer in the room. */
	onFighterRemoved: (id: string) => void;
	/**
	 * An ultimate was cast: freeze, and put the portrait up.
	 *
	 * Fired once per cast, on the first snapshot that carries the cinematic —
	 * the snapshot repeats it for the whole freeze precisely so a client that
	 * lost the first datagram still joins the freeze one tick late instead of
	 * playing on alone through a cutscene everybody else is watching.
	 */
	onUltimateCast: (casterId: string) => void;
	/** A grenade collapsed. Position and owner of the new hole, for effects. */
	onSingularityOpened: (field: Singularity) => void;
	/** The match clock, scores or phase changed. */
	onMatch: (status: MatchStatus, standings: Standing[]) => void;
	/** The match ended. Final standings, sent once. */
	onMatchOver: (msg: MatchOverMsg) => void;
	/**
	 * The match produced a Play of the Game: who, what, and how good.
	 *
	 * Everything the splash card needs is in this message. The footage is fetched
	 * separately over HTTP and may not arrive at all — see `potg/types.ts` — so
	 * the ceremony is driven from here and the replay is the optional part.
	 */
	onPotg: (msg: PotgAnnounce) => void;
	/**
	 * A team deathmatch round ended in a wipe-out.
	 *
	 * Announced separately from the arena reset that follows it: the banner goes
	 * up the instant the last fighter falls, and the survivors keep playing for
	 * the couple of seconds before everybody respawns.
	 */
	onRoundWon: (msg: RoundWonMsg) => void;
	/**
	 * Freezetime ended: the round is live.
	 *
	 * The countdown itself is in every snapshot; this is the one moment that has
	 * to land together on every screen.
	 */
	onRoundLive: (msg: RoundLiveMsg) => void;
	/**
	 * Seated, in the room the server chose.
	 *
	 * Not always the room that was asked for, which is why it is reported: the
	 * address bar follows this rather than the proposal, so the link a player copies
	 * is the room they are actually in.
	 *
	 * `screens` is the room's authoritative arena width, which is also not always
	 * what the URL asked for — a latecomer's `?screen=` is ignored, so the world
	 * must be rebuilt from this number.
	 */
	onSeated: (roomId: string, screens: number, mode: MatchMode) => void;
	/** The room asked for is full of humans. */
	onRoomFull: (roomId: string) => void;
}

/**
 * Owns everything networked: the channel, the predicted local player, the
 * rolled-back remote fighters, and server-owned bullets.
 *
 * The scene talks to this in terms of intent, not packets.
 *
 * **Every fighter is simulated at the present instant.** The local one is
 * predicted and replayed; the rest are predicted from their last known input and
 * rolled back on every snapshot (see `Rollback.ts`). Nothing is drawn in the
 * past any more, which is what makes a sixteen-fighter arena readable: a swing
 * you see 150ms late is a swing you cannot react to.
 */
export class OnlineSession {
	readonly manager: OnlineManager;
	readonly predicted: PredictedPlayer;
	readonly rollbackStats = new RollbackStats();

	private readonly clock = new ServerClock();
	private readonly smoother = new RenderSmoother();
	private readonly bulletPool: SpritePool;
	/** Ballistic anchor per bullet: position and velocity at a known local time. */
	private readonly bulletFlights = new Map<
		number,
		{ x0: number; y0: number; vx: number; vy: number; t0: number }
	>();
	/** Bullets already known to have hit geometry; never drawn again. */
	private readonly bulletDead = new Set<number>();
	/** Bullet id -> sprite, so a sprite never changes which bullet it represents. */
	private readonly bulletSprites = new Map<number, Sprite>();
	/** Where projectiles were drawn this frame, for the diagnostic. */
	private readonly renderedBullets: BulletSample[] = [];

	/** Every fighter but the local one, predicted forward and rolled back. */
	private readonly fighters = new Map<string, RemoteFighter>();
	/** Scores and HP for every fighter, the local one included. */
	private readonly info = new Map<string, FighterInfo>();
	/** Names, from the roster message. */
	private readonly nameById = new Map<string, RosterEntry>();
	/**
	 * The last authoritative state per fighter, exactly as the server sent it.
	 *
	 * Kept alongside the predicted one because the diagnostic's melee frame-data
	 * tracker must judge the *server's* state machine, not this client's guess at
	 * it. Judging the predicted state reported a normal misprediction — an uppercut
	 * the client started and the next snapshot did not have — as the state machine
	 * ending an uncancellable move 500ms early. Sampled at 20Hz, unpredicted, which
	 * is what that metric was designed around.
	 */
	private readonly authoritative = new Map<string, PlayerPosition>();
	/** Fighters whose next snapshot must be adopted outright, not predicted onto. */
	private readonly pendingTeleports = new Set<string>();

	private latestSnapshot: GameSnapshot | undefined;
	private _matchStatus: MatchStatus | undefined;
	private _matched = false;

	// ---- the ultimate ----
	//
	/**
	 * The room's open black hole, mirrored from the snapshot.
	 *
	 * Fed into every `tickPlayer` this client runs — its own prediction, its own
	 * replays, and every remote's rollback — so what a player watches the hole do
	 * is the same computation the server is doing. `remainingMs` is decayed
	 * locally between snapshots and corrected by each one; nothing else about it
	 * ever changes while it is open, which is what makes replaying through it
	 * safe. See specs/ultimate.md.
	 */
	private field: Singularity | null = null;
	/** Ids of holes already announced, so the detonation FX fires exactly once. */
	private seenSingularities = new Set<number>();
	/**
	 * The cast currently freezing the room, or null.
	 *
	 * While this is set, `Match` runs no fixed steps at all: no local prediction,
	 * no input sent, no remote advanced. See `GameRoom.tickCinematic` for why
	 * that keeps the two sides exactly as far apart as they were before.
	 */
	private _cinematic: SnapshotCinematic | null = null;
	private announcedCast: string | null = null;

	/**
	 * Wire size of recent snapshots, in bytes.
	 *
	 * Measured rather than assumed, because it is what forced the packed wire
	 * format: sixteen fighters of verbatim JSON is ~6KB a snapshot, 20 times a
	 * second, in a datagram no MTU wants. A number nobody watches is a number that
	 * quietly grows back, so it is reported alongside the physics.
	 */
	private snapshotBytes: number[] = [];
	private snapshotsSeen = 0;

	constructor(
		layer: Container,
		bulletTexture: Texture,
		private readonly startX: number,
		private readonly startY: number,
		private readonly world: World = DEFAULT_WORLD,
		private readonly callbacks: OnlineCallbacks,
	) {
		this.predicted = new PredictedPlayer(startX, startY, world);
		this.bulletPool = new SpritePool(layer, bulletTexture);
		this.manager = new OnlineManager(
			`${location.protocol}//${location.hostname}`,
			GAME_SERVER_PORT,
		);
	}

	get connected(): boolean {
		return this.manager.connected;
	}

	get matched(): boolean {
		return this._matched;
	}

	get localHp(): number {
		return this.info.get(this.manager.myId)?.hp ?? MAX_HP;
	}

	get matchStatus(): MatchStatus | undefined {
		return this._matchStatus;
	}

	/** The room the server put this client in. */
	get roomId(): string {
		return this.manager.roomId;
	}

	/** Every fighter this client predicts but does not own, keyed by server id. */
	get remotes(): ReadonlyMap<string, RemoteFighter> {
		return this.fighters;
	}

	/**
	 * Which fighter `remoteState`, `remoteHp` and the diagnostic's `enemy_*`
	 * metrics are about. Pinned — see `primaryId`.
	 */
	get primaryRemoteId(): string | undefined {
		return this.primaryId;
	}

	hpOf(id: string): number {
		return this.info.get(id)?.hp ?? MAX_HP;
	}

	/** Which side a fighter is on, or `null` in a free-for-all. */
	teamOf(id: string): TeamId | null {
		return this.info.get(id)?.team ?? null;
	}

	/**
	 * The hero the snapshot says a fighter plays. Falls back to Lia before the
	 * first snapshot names anybody.
	 */
	heroOf(id: string): HeroId {
		return this.info.get(id)?.hero ?? "lia";
	}

	/**
	 * The Esc menu's hero select: ask the server to switch this fighter's hero.
	 * The server answers in the next snapshot's `hero` field, and `absorbInfo`
	 * echoes it through `onLocalHero` — the client never applies the change
	 * optimistically, so a refused request (a disconnecting room, a server on
	 * an older build) cannot leave the client and the server disagreeing.
	 */
	requestHero(hero: HeroId) {
		this.manager.sendHero(hero);
	}

	/** Is this fighter up? Dead fighters are still simulated, just not scoring. */
	aliveOf(id: string): boolean {
		return this.info.get(id)?.alive ?? true;
	}

	/** The local fighter's side. What every "is that a teammate" question starts from. */
	get myTeam(): TeamId | null {
		return this.teamOf(this.manager.myId);
	}

	/** Ultimate charge for one fighter, 0..100. */
	ultOf(id: string): number {
		return this.info.get(id)?.ult ?? 0;
	}

	/**
	 * Is a remote fighter holding the ultimate button, per the input the server
	 * last consumed for it?
	 *
	 * The renderer reads this to draw the charge aura on a fighter about to
	 * cast. `ultOf` answers whether it *can*; this answers whether it *is*.
	 */
	ultHeldBy(id: string): boolean {
		return this.fighters.get(id)?.heldUltimate ?? false;
	}

	/** The local fighter's ultimate charge, for the HUD meter. */
	get localUlt(): number {
		return this.ultOf(this.manager.myId);
	}

	/**
	 * True while the room is frozen for an ultimate cast.
	 *
	 * `Match` must run **no fixed steps** while this holds — that is the entire
	 * contract, and skipping the fixed step is what makes it safe: no step means
	 * no prediction, no input sent and no remote advanced, which is exactly what
	 * the server is doing. Presentation keeps running on wall-clock time.
	 */
	get frozen(): boolean {
		return this._cinematic !== null;
	}

	get cinematic(): SnapshotCinematic | null {
		return this._cinematic;
	}

	/** The open black hole, or null. Read by the renderer; owned by the server. */
	get singularity(): Singularity | null {
		return this.field;
	}

	/** Grenades in flight, straight off the newest snapshot. */
	get grenades(): readonly SnapshotGrenade[] {
		return this.latestSnapshot?.grenades ?? [];
	}

	nameOf(id: string): string {
		return this.nameById.get(id)?.name ?? id;
	}

	/**
	 * The current standings, ranked by the same pure function the server uses.
	 *
	 * Rebuilt from the snapshot rather than sent: ranking sixteen names at 20Hz
	 * would restate every tick something that only changes when somebody scores,
	 * and using a *different* ordering on the client is how a scoreboard ends up
	 * disagreeing with the podium.
	 */
	standings(): Standing[] {
		const entries: ScoreEntry[] = [];
		for (const [id, info] of this.info) {
			const roster = this.nameById.get(id);
			entries.push({
				id,
				name: roster?.name ?? id,
				kills: info.kills,
				deaths: info.deaths,
				damage: info.damage,
				denies: info.denies,
				blocked: info.blocked,
				bot: roster?.bot ?? false,
				team: info.team,
			});
		}
		return rankScores(entries);
	}

	/**
	 * The primary remote fighter: HP, position and state.
	 *
	 * A deathmatch has up to fifteen of them, but three callers legitimately want
	 * "the other one" — the training room (where there is exactly one, the dummy),
	 * the aim probe, and the diagnostic's `enemy_x`/`enemy_y` path continuity
	 * metric.
	 *
	 * **The identity is pinned, not derived per call.** Reading it off the front of
	 * the roster looked stable and was not: the roster is replaced whenever anybody
	 * joins or leaves, so "the first remote" could become a different fighter
	 * between two frames — and the diagnostic, comparing this frame's position to
	 * the last one's, reported the gap between two fighters standing in different
	 * parts of the arena as 45-75px of jitter from a fighter that had not moved.
	 * The metric was measuring the wrong thing, not the netcode misbehaving.
	 */
	private primaryId: string | undefined;

	private get primary(): RemoteFighter | undefined {
		const id = this.primaryId;
		return id === undefined ? undefined : this.fighters.get(id);
	}

	/**
	 * Choose a primary, or replace one that has left the room.
	 *
	 * A change of subject is a discontinuity in every metric about the primary —
	 * `enemy_x` and `enemy_y` compare this frame's position to the last one's, and
	 * two fighters standing in different parts of the arena are not a fighter that
	 * moved. So it is announced like any other legitimate discontinuity, and
	 * counted, because "how often did the subject change?" is the first thing to
	 * ask of a suspicious reading.
	 */
	private ensurePrimary() {
		if (this.primaryId !== undefined && this.fighters.has(this.primaryId)) {
			return;
		}
		const next = this.fighters.keys().next().value;
		if (next === this.primaryId) return;
		this.primaryId = next;
		this.rollbackStats.recordPrimarySwitch();
		this.callbacks.onTeleport();
	}

	get remoteHp(): number {
		return this.primaryId === undefined ? MAX_HP : this.hpOf(this.primaryId);
	}

	/**
	 * The primary remote's state exactly as the server last sent it.
	 *
	 * For the diagnostic's melee frame-data tracker, which judges whether a state
	 * machine kept the contracts in the MOVES table. That question is only
	 * answerable about the *authoritative* state machine: the predicted one is a
	 * guess, and its guesses being wrong is what prediction is. Fed the predicted
	 * state, the tracker read a mispredicted uppercut as an uncancellable move
	 * ending 500ms early — a FAIL from correct netcode.
	 */
	get remoteAuthoritativeState(): PlayerPosition | null {
		const id = this.primaryId;
		return id === undefined ? null : (this.authoritative.get(id) ?? null);
	}

	get remoteFacing(): number {
		return this.primary?.state.facing ?? 1;
	}

	/**
	 * Primary remote position in *body* space (AABB top-left), matching what
	 * the simulation uses. Reading it off the sprite instead would be in
	 * centre-origin space and silently off by half a body.
	 */
	get remotePosition(): { x: number; y: number } | null {
		const s = this.primary?.state;
		return s ? { x: s.x, y: s.y } : null;
	}

	/**
	 * The primary remote's full state.
	 *
	 * One state, from one clock. This used to splice an interpolated position onto
	 * an authoritative sword state, because position had to be interpolated to look
	 * smooth while combat state had to be current to be reactable. Rollback removes
	 * the conflict: the fighter is *simulated* at the present instant, so its
	 * position and its swing come from the same tick and cannot disagree.
	 */
	get remoteState(): PlayerPosition | null {
		return this.primary?.state ?? null;
	}

	/**
	 * The nearest living *opponent*, for a client-side AI brain.
	 *
	 * Teammates are filtered here rather than inside the brain, exactly as they
	 * are on the server: a brain is only ever handed an enemy, so it has no way to
	 * decide to attack its own side. See `GameRoom.nearestFoe`.
	 *
	 * Returns the fighter's state *and* hero: a client brain reading a dagger
	 * must know it is reading a dagger.
	 */
	nearestFoe(
		from: PlayerPosition,
	): { state: PlayerPosition; hero: HeroId } | null {
		const mine = this.myTeam;
		let best: { state: PlayerPosition; hero: HeroId } | null = null;
		let bestDist = Number.POSITIVE_INFINITY;
		for (const [id, fighter] of this.fighters) {
			if (!(this.info.get(id)?.alive ?? true)) continue;
			if (!hostile(mine, this.teamOf(id))) continue;
			const dist = Math.hypot(
				fighter.state.x - from.x,
				fighter.state.y - from.y,
			);
			if (dist < bestDist) {
				bestDist = dist;
				best = { state: fighter.state, hero: fighter.hero };
			}
		}
		return best;
	}

	connect(join: JoinOptions = {}) {
		this.manager.connect(
			{
				onState: (snap) => this.onSnapshot(snap),
				onStatus: (msg) => this.callbacks.onStatus(msg),
				onRoundReset: () => this.onRoundReset(),
				onRoster: (msg) => this.onRoster(msg.players),
				onRespawn: (msg) => this.onRespawn(msg.id),
				onMatchOver: (msg) => this.callbacks.onMatchOver(msg),
				onPotg: (msg) => this.callbacks.onPotg(msg),
				onRoundWon: (msg) => this.callbacks.onRoundWon(msg),
				onRoundLive: (msg) => this.callbacks.onRoundLive(msg),
				onSeated: (roomId, screens, mode) =>
					this.callbacks.onSeated(roomId, screens, mode),
				onRoomFull: (roomId) => this.callbacks.onRoomFull(roomId),
			},
			join,
		);
	}

	/**
	 * The training room's two extra messages, passed straight through.
	 *
	 * Deliberately thin: the training room is not netcode, it is a client of it,
	 * so this class gains a pipe rather than a mode.
	 */
	onTrainingState(handler: (state: TrainingStateMsg) => void) {
		this.manager.onTraining(handler);
	}

	sendTrainingConfig(msg: TrainingConfigMsg) {
		this.manager.sendTrainingConfig(msg);
	}

	/**
	 * The roster names fighters. It does **not** decide who is present.
	 *
	 * Presence has exactly one authority: the snapshot, which arrives 20 times a
	 * second and always lists everybody. This message is a name lookup, sent only
	 * when somebody joins or leaves.
	 *
	 * That split is not tidiness. Geckos datagrams are unreliable and unordered, so
	 * a roster taken as the truth about presence lets a *stale* one delete a
	 * fighter the newest snapshot contains — which destroyed its entity and sprite,
	 * rebuilt them on the next snapshot, and threw away its prediction on the way
	 * through. It showed up as the fighter the `enemy_*` metrics describe being
	 * swapped more often than anybody had actually joined or left.
	 */
	private onRoster(entries: RosterEntry[]) {
		this.nameById.clear();
		for (const entry of entries) this.nameById.set(entry.id, entry);
	}

	private dropFighter(id: string) {
		this.fighters.delete(id);
		this.info.delete(id);
		this.authoritative.delete(id);
		this.pendingTeleports.delete(id);
		this.callbacks.onFighterRemoved(id);
	}

	/**
	 * One fighter came back. Adopt the next snapshot for it outright.
	 *
	 * The message races the snapshot carrying the respawned state, so this only
	 * arms a flag; the correction itself is applied when the state arrives. A
	 * fighter that respawns behind a dropped datagram still lands correctly,
	 * because a correction past the teleport threshold is treated as a
	 * discontinuity regardless of whether the announcement got here.
	 */
	private onRespawn(id: string) {
		this.pendingTeleports.add(id);
		if (id === this.manager.myId) this.callbacks.onTeleport();
	}

	/**
	 * The server reset the whole arena — a new match. Drop everything predicted:
	 * re-simulating fighters from before the reset would draw them sliding across
	 * the arena instead of reappearing at their spawns.
	 */
	private onRoundReset() {
		// The server clears both on a reset; mirroring it here means a client cannot
		// spend the first tick of a new match still dragging fighters toward the last
		// match's hole.
		this.field = null;
		this._cinematic = null;
		this.announcedCast = null;
		this.smoother.reset();
		this.bulletPool.releaseAll();
		this.bulletSprites.clear();
		this.bulletFlights.clear();
		this.bulletDead.clear();
		for (const id of this.fighters.keys()) this.pendingTeleports.add(id);
		this.callbacks.onRoundReset();
		console.log("[ONLINE] round reset");
	}

	disconnect() {
		this.manager.disconnect();
	}

	/**
	 * Advance one fixed physics step: predict locally, predict every remote, and
	 * ship the input. Called once per PHYSICS_DT so the client and server consume
	 * input at the same rate — and so every fighter on screen is on the same tick.
	 */
	fixedStep(intent: PlayerIntent, aimAngle: number, dt: number) {
		// The hole as the local fighter feels it — null if this client cast it.
		const seq = this.predicted.step(
			intent,
			dt,
			this.fieldOn(this.manager.myId),
		);
		// Spread the intent rather than listing its fields: `PlayerInput` extends
		// `PlayerIntent` precisely so a field added to the simulation cannot be
		// silently left out of the packet, which would make the server replay a
		// different input than the client predicted.
		this.manager.sendInput({ ...intent, seq, aimAngle });

		// The field's own clock, advanced on the fixed step like everything else it
		// affects. Corrected by every snapshot; this only carries it between them,
		// so a hole does not linger for up to 50ms past its expiry on a client.
		if (this.field) {
			this.field.remainingMs -= dt * MS_PER_SECOND;
			if (this.field.remainingMs <= 0) this.field = null;
		}

		// Remotes advance on the same step, on their carried-forward inputs. Doing
		// this per rendered frame instead would put them on a different clock from
		// the local fighter, and two fighters on two clocks cannot be shown trading
		// blows honestly.
		for (const [id, fighter] of this.fighters) {
			fighter.predict(dt, this.fieldOn(id));
		}
	}

	/**
	 * The room's field as one fighter experiences it.
	 *
	 * Every `tickPlayer` this client runs goes through here rather than reading
	 * `this.field` directly, so the friendly-fire rule is applied in exactly one
	 * place on the client and it is the same shared predicate the server uses.
	 */
	private fieldOn(id: string): Singularity | null {
		return fieldFor(this.field, id, this.teamOf(id));
	}

	/**
	 * A monotonic millisecond clock for ballistics that **stops during a
	 * cinematic freeze**.
	 *
	 * Deliberately not `performance.now()`. A bullet is dead-reckoned from an
	 * anchor and the local clock, which is exact — right up until the server stops
	 * simulating for 1100ms and the wall clock does not. Bullets would fly on
	 * through the cutscene, arrive nowhere the server has them, and snap back when
	 * it lifted. Everything the freeze stops has to stop on the same clock.
	 */
	private renderClockMs = 0;

	/** Per-frame presentation update: render offsets and bullets. */
	render(dtSec: number): { x: number; y: number } {
		if (!this.frozen) this.renderClockMs += dtSec * MS_PER_SECOND;
		this.renderBullets(this.clock.now(Date.now()));
		const at = this.smoother.apply(
			this.predicted.state.x,
			this.predicted.state.y,
			dtSec,
		);
		// The local fighter's correction offset is sub-pixel in practice, so this has
		// never mattered for it — but the rule is that anything drawn from a position
		// the simulation did not produce gets depenetrated first, and an exception
		// nobody can see is exactly the kind that stops being true quietly.
		return legaliseDrawn(at.x, at.y, this.world);
	}

	/** Where a remote fighter should be drawn this frame. */
	renderRemote(id: string, dtSec: number): { x: number; y: number } | null {
		return this.fighters.get(id)?.render(dtSec) ?? null;
	}

	/**
	 * Draw projectiles by dead reckoning, not interpolation.
	 *
	 * A bullet flies at a constant velocity with no gravity and no collision
	 * response, so its position is a closed-form function of time: extrapolating
	 * from the last snapshot is *exact*, and it renders the bullet at the
	 * present instant instead of 150ms in the past. Interpolating them was
	 * strictly worse — it added latency to something that needs to feel sharp,
	 * and mixing an interpolated sample (rendered at now-150ms) with a
	 * dead-reckoned fallback (rendered at now) made the sprite jump ~90px
	 * whenever a bullet crossed from one path to the other.
	 *
	 * Sprites are keyed by bullet id. Indexing by position in the snapshot array
	 * meant a sprite jumped to a completely different bullet every time the
	 * server spliced a dead one out.
	 */
	private renderBullets(serverNow: number) {
		const snap = this.latestSnapshot;
		if (!snap) return;

		this.renderedBullets.length = 0;
		const live = new Set<number>();
		const now = this.renderClockMs;

		for (const b of snap.bullets) {
			live.add(b.id);
			if (this.bulletDead.has(b.id)) continue;

			// Anchor once, on first sight, then fly the bullet purely off the local
			// clock. Re-deriving the position from the newest snapshot every frame
			// looks correct but is not: each arriving snapshot moves the
			// extrapolation base, so any error in the clock estimate shows up as a
			// sawtooth — a small jump forward every 50ms and a stall in between.
			let flight = this.bulletFlights.get(b.id);
			if (!flight) {
				const ageSec =
					Math.min(Math.max(serverNow - snap.t, 0), MAX_EXTRAPOLATION_MS) /
					MS_PER_SECOND;
				flight = {
					x0: b.x + b.vx * ageSec,
					y0: b.y + b.vy * ageSec,
					vx: b.vx,
					vy: b.vy,
					t0: now,
				};
				this.bulletFlights.set(b.id, flight);
			}

			const t = (now - flight.t0) / MS_PER_SECOND;
			const x = flight.x0 + flight.vx * t;
			const y = flight.y0 + flight.vy * t;

			// The server has almost certainly already destroyed a bullet that has
			// reached geometry; retire it now rather than flying it through a wall
			// for the rest of the snapshot interval. This is permanent: letting it
			// reappear past the platform made the sprite blink and jump.
			if (
				pointInAnyPlatform(x, y, this.world) ||
				isBulletOutOfBounds({ ...b, x, y }, this.world)
			) {
				this.bulletDead.add(b.id);
				const stale = this.bulletSprites.get(b.id);
				if (stale) {
					this.bulletPool.release(stale);
					this.bulletSprites.delete(b.id);
				}
				continue;
			}

			let sprite = this.bulletSprites.get(b.id);
			if (!sprite) {
				sprite = this.bulletPool.acquire();
				this.bulletSprites.set(b.id, sprite);
			}
			// Whose shot this is, in one glance. A projectile is the one thing in the
			// arena that arrives *before* you can look at who fired it, so it is
			// tinted at full strength — the fireball's own colour carries no combat
			// information to lose. Set on every frame rather than at acquisition
			// because the pool hands the same sprite to a different owner's bullet.
			sprite.tint = teamTint(0xffffff, this.teamOf(b.ownerId), TINT.full);
			sprite.position.set(x, y);
			this.renderedBullets.push({ id: b.id, x, y });
		}

		for (const [id, sprite] of this.bulletSprites) {
			if (live.has(id)) continue;
			this.bulletPool.release(sprite);
			this.bulletSprites.delete(id);
		}
		for (const id of this.bulletFlights.keys()) {
			if (!live.has(id)) this.bulletFlights.delete(id);
		}
		for (const id of this.bulletDead) {
			if (!live.has(id)) this.bulletDead.delete(id);
		}
	}

	/**
	 * Bandwidth and rollback quality, for the diagnostic report.
	 *
	 * `snapshots: 0` means nothing ever arrived, which makes every other number in
	 * the report — jitter included — a statement about a client simulating alone.
	 */
	netSummary() {
		const bytes = this.snapshotBytes;
		const total = bytes.reduce((a, b) => a + b, 0);
		return {
			snapshots: this.snapshotsSeen,
			fightersInSnapshot: this.latestSnapshot?.players.length ?? 0,
			avgSnapshotBytes: bytes.length > 0 ? Math.round(total / bytes.length) : 0,
			maxSnapshotBytes: bytes.reduce((m, b) => Math.max(m, b), 0),
			/** At the server's 20Hz broadcast rate. */
			estBytesPerSec:
				bytes.length > 0 ? Math.round((total / bytes.length) * SNAPSHOT_HZ) : 0,
			rollback: this.rollbackStats.summary(),
		};
	}

	private onSnapshot(snap: GameSnapshot) {
		this.latestSnapshot = snap;
		this.clock.observe(snap.t, Date.now());
		this.snapshotsSeen++;
		this.snapshotBytes.push(JSON.stringify(snap).length);
		// A bounded window: this runs for the length of a match, and an unbounded
		// array of every snapshot ever seen is a leak with a graph attached.
		if (this.snapshotBytes.length > SNAPSHOT_BYTE_WINDOW)
			this.snapshotBytes.shift();

		// Before anything is reconciled or rolled back, because the field is an
		// argument to every one of those `tickPlayer` calls. Adopting it afterwards
		// would replay this snapshot's ticks against the *previous* snapshot's hole.
		this.absorbUltimate(snap);

		const mine = snap.players.find((p) => p.id === this.manager.myId);
		// The local player is reconciled first, because its unacknowledged input
		// count *is* the rollback depth for everybody else. See Rollback.ts.
		const leadTicks = mine ? this.reconcileLocal(mine) : 0;
		this.rollbackStats.recordLead(leadTicks);

		const seen = new Set<string>();
		for (const p of snap.players) {
			seen.add(p.id);
			this.absorbInfo(p);
			if (p.id === this.manager.myId) continue;
			this.rollbackRemote(p, leadTicks);
		}

		for (const id of [...this.fighters.keys()]) {
			if (seen.has(id)) continue;
			this.dropFighter(id);
		}
		this.ensurePrimary();

		// Sword impacts are one-shot effects. A dropped datagram costs a spark,
		// never a consequence — those all travel in `state`.
		for (const event of snap.melee ?? []) {
			this.callbacks.onMeleeEvent(event);
		}
		// Denies are the same shape: one-shot splashes, consequence in the meter.
		for (const event of snap.denies ?? []) {
			this.callbacks.onDeny(event);
		}

		this._matchStatus = snap.match;
		this.callbacks.onMatch(snap.match, this.standings());

		// One fighter is a valid, if lonely, deathmatch — and an empty room is how
		// anything about the *local* fighter gets measured without a bot in the way.
		// Waiting for two left such a room permanently showing "starting match...".
		if (!this._matched && snap.players.length >= 1) {
			this._matched = true;
			this.callbacks.onStatus("");
		}
	}

	private absorbInfo(p: SnapshotPlayer) {
		const info = this.info.get(p.id) ?? newInfo();
		info.hp = p.hp;
		info.kills = p.kills;
		info.deaths = p.deaths;
		info.damage = p.damage;
		info.denies = p.denies;
		info.blocked = p.blocked;
		info.alive = p.alive;
		info.ult = p.ult ?? 0;
		info.team = p.team ?? null;
		// The hero is an argument to `tickPlayer` on the replay path, so it is
		// absorbed with everything else the snapshot says about this fighter.
		// `rollbackRemote` hands it to the remote's kit; the local one reads its
		// own row here too, which is how the Esc menu's hero change comes home.
		info.hero = p.hero;
		this.info.set(p.id, info);
		if (p.id === this.manager.myId) {
			this.callbacks.onLocalHp(p.hp);
			const kit = kitFor(p.hero);
			if (kit.hero !== this.predicted.currentKit.hero) {
				this.predicted.setKit(kit);
				this.callbacks.onLocalHero(kit.hero);
			}
		}
	}

	/**
	 * Adopt the room's ultimate state: the freeze and the field.
	 *
	 * Both are **full state, every snapshot**, not events — which is what makes
	 * them self-healing over unreliable datagrams. A client that loses the first
	 * cinematic snapshot joins the freeze on the next one 50ms later instead of
	 * playing on alone through a cutscene; a client that loses the snapshot where
	 * a hole closes stops pulling on the following one rather than forever.
	 *
	 * The two *derived* one-shots — "a cast just started", "a hole just opened" —
	 * are edge-detected here against an id, so each fires exactly once no matter
	 * how many snapshots repeat the state that implies it.
	 */
	private absorbUltimate(snap: GameSnapshot) {
		const cine = snap.cinematic ?? null;
		this._cinematic = cine;
		if (cine === null) {
			this.announcedCast = null;
		} else if (this.announcedCast !== cine.casterId) {
			this.announcedCast = cine.casterId;
			this.callbacks.onUltimateCast(cine.casterId);
		}

		const field = snap.singularity ?? null;
		if (field === null) {
			this.field = null;
			return;
		}
		// Copied, never aliased into the snapshot: `fixedStep` decays `remainingMs`
		// in place between snapshots, and mutating the snapshot object would make
		// every later read of it disagree with what actually arrived.
		this.field = { ...field };
		if (!this.seenSingularities.has(field.id)) {
			this.seenSingularities.add(field.id);
			// Bounded: ids only ever grow, and a match that ran for hours would
			// otherwise keep every one of them.
			if (this.seenSingularities.size > MAX_SEEN_SINGULARITIES) {
				const oldest = this.seenSingularities.values().next().value;
				if (oldest !== undefined) this.seenSingularities.delete(oldest);
			}
			this.callbacks.onSingularityOpened(this.field);
		}
	}

	/** Fold the authoritative local state in, and report how far ahead we are. */
	private reconcileLocal(p: SnapshotPlayer): number {
		const before = { x: this.predicted.state.x, y: this.predicted.state.y };
		const result = this.predicted.reconcile(
			unpackState(p.state),
			p.lastSeq,
			PHYSICS_DT,
			this.fieldOn(p.id),
		);
		this.smoother.absorb(
			this.predicted.state.x - before.x,
			this.predicted.state.y - before.y,
		);
		this.callbacks.onReconcile(result);
		return result.replayed;
	}

	private rollbackRemote(p: SnapshotPlayer, leadTicks: number) {
		const state = unpackState(p.state);
		const intent: PlayerIntent | null =
			p.input === null ? null : unpackIntent(p.input);
		// Kept before it is handed to the predictor, which will advance it.
		this.authoritative.set(p.id, { ...state });

		let fighter = this.fighters.get(p.id);
		if (!fighter) {
			// First sight. Adopted outright — there is nothing to reconcile against,
			// and smoothing in from a default position would draw the fighter flying
			// across the arena to its spawn.
			fighter = new RemoteFighter(state, this.world, kitFor(p.hero));
			this.fighters.set(p.id, fighter);
			fighter.teleport(state, intent);
			this.ensurePrimary();
			this.callbacks.onFighterAdded(p.id);
			return;
		}
		// The kit is set every snapshot — it is a table lookup and a comparison,
		// and it is what lets a hero change travel through the same channel the
		// first hero did.
		fighter.setKit(kitFor(p.hero));

		if (this.pendingTeleports.delete(p.id)) {
			fighter.teleport(state, intent);
			this.callbacks.onTeleport();
			return;
		}

		const result: RollbackResult = fighter.rollback(
			state,
			intent,
			leadTicks,
			PHYSICS_DT,
			this.fieldOn(p.id),
		);
		// A dropped dragon ride is a legitimate discontinuity, like a respawn:
		// the predicted ride ended (or was refused) before this client's clock
		// did, and the fighter snaps back from wherever the prediction had
		// carried it. Announced so the jitter metric skips the glide.
		if (result.dragonDropped) {
			// The dropped ride glides back over several frames — the smoother
			// is not reset for it, unlike a respawn — so the suppression
			// window has to cover the glide, not just the snap.
			this.callbacks.onTeleport(8);
		}
		this.rollbackStats.record(result);
		// A jump this large is a respawn the announcement lost the race to, or a
		// fighter the server moved for a reason no client could predict. Either way
		// it is not jitter, and counting it as such would make the metric useless.
		if (result.teleported) this.callbacks.onTeleport();
	}

	/** Projectiles as drawn this frame, for the diagnostic. */
	get bullets(): readonly BulletSample[] {
		return this.renderedBullets;
	}

	/**
	 * The server's bullets with their velocities, for the aim probe.
	 *
	 * Read from the raw snapshot rather than `renderedBullets`, because the
	 * heading is authoritative: it is fixed at spawn from the aim angle the client
	 * sent, and it is the only way to check that a shot actually left in the
	 * direction the cursor was pointing.
	 */
	get bulletVectors(): readonly SnapshotBullet[] {
		return this.latestSnapshot?.bullets ?? [];
	}

	/**
	 * Drawing fighters is not this class's job.
	 *
	 * It owns netcode state; the entity world owns what is on screen. Every remote
	 * is an ordinary entity whose `body` is re-pointed at its `RemoteFighter`
	 * state each frame, so the same animation, sprite-sync and effect systems that
	 * draw the local fighter draw all fifteen of them too — with no second code
	 * path to keep in step.
	 */

	/** Full local reset, e.g. after a match ends. */
	reset() {
		this.predicted.reset(this.startX, this.startY);
		this.smoother.reset();
		this.bulletPool.releaseAll();
		for (const id of this.fighters.keys()) this.pendingTeleports.add(id);
	}
}
