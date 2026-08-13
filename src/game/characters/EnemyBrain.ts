import {
	DEFAULT_WORLD,
	PLAYER_HEIGHT,
	PLAYER_WIDTH,
	type Rect,
	type World,
} from "../simulation/Arena.js";
import type { HeroId } from "../simulation/Heroes.js";
import { smokeLobAngle } from "../simulation/Items.js";
import { TRAP_RADIUS } from "../../tweakables/items.js";
import { BULLET_SPEED, JUMP_HEIGHT_PX } from "../simulation/Physics.js";
import { SINGULARITY_REACH } from "../../tweakables/ultimate.js";
import type { AIConfig } from "./AIConfig.js";
import { BlossomBrain } from "./BlossomBrain.js";
import { DaggerBrain } from "./DaggerBrain.js";
import { DragonBrain } from "./DragonBrain.js";
import { JumpBrain } from "./JumpBrain.js";
import {
	MeleeBrain,
	STRIKE_RANGE_PX,
	SWORD_DISENGAGE_PX,
} from "./MeleeBrain.js";
import { TeamBrain } from "./TeamBrain.js";
import type { AIInput, AIOutput } from "./types.js";
import { UltimateBrain } from "./UltimateBrain.js";

/** The melee module, whichever hero's it is. See `EnemyBrain.constructor`. */
type MeleeModule = MeleeBrain | DaggerBrain;
/** The ultimate module, whichever hero's it is. */
type UltModule = UltimateBrain | DragonBrain | BlossomBrain;

export enum AIState {
	IDLE = "IDLE",
	CHASE = "CHASE",
	RETREAT = "RETREAT",
	ATTACK = "ATTACK",
	EVADE = "EVADE",
	/**
	 * Deliberately break away, take height, and fight with the gun.
	 *
	 * Without this the state machine could only ever close and swing: at sword
	 * range the only outcome was ATTACK, so two bots met in the middle and stayed
	 * there. Measured, that was 11% of the arena's width, one of nine surfaces,
	 * zero wall jumps and zero bullets — every ledge, the line-of-sight cover and
	 * the whole ranged pipeline untested by the canonical run.
	 */
	ZONE = "ZONE",
}

/** Zoning aims to get at least this far away — comfortably outside sword range. */
const ZONE_RANGE_PX = 330;
/** How long a zoning phase lasts before the bot re-evaluates. */
const ZONE_DURATION_MS = 2600;
/** Minimum gap between zoning phases, so a bot cannot simply never engage. */
const ZONE_COOLDOWN_MS = 2200;
/** The nearest ledge that is above the fighter and reachable with a jump. */
const PERCH_MIN_RISE_PX = 30;
/**
 * The perch cap: how high above the fighter a ledge may be and still be worth
 * jumping for. A single jump reaches `JUMP_HEIGHT_PX`; a double jump reaches
 * roughly 1.8× that, so the cap sits between the two and the brain arms the
 * double jump exactly when the perch needs it. This is what lets a zoning bot
 * actually use the upper ledges instead of hopping under them.
 */
/** A double jump reaches ~1.8x a single; the perch cap sits just under it. */
const PERCH_RISE_FACTOR = 1.7;
const PERCH_MAX_RISE_PX = JUMP_HEIGHT_PX * PERCH_RISE_FACTOR;

// ---------------------------------------------------------------------------
// Decision table. Every literal below is a roll the brain makes against the
// config's personality knobs; each one is named so a tune is a single edit
// instead of a hunt through a state machine.
// ---------------------------------------------------------------------------

/** HP bands (0..100): below `LOW_HP` a fighter is hurt, above `HIGH_HP` hale. */
const LOW_HP = 30;
const HIGH_HP = 80;
/** HP below which a fighter retreats rather than holds the line. */
const FLEE_HP = 40;
/** How far ahead a hurt fighter leads when the bot is dodgey. */
const DODGE_SKILL_SCALE = 0.6;
const DODGE_HURT_MULTIPLIER = 1.5;
const DODGE_HALE_MULTIPLIER = 0.7;
const DODGE_NEUTRAL_MULTIPLIER = 1.0;
/** A dodge only triggers inside this range — far away there is nothing to dodge. */
const DODGE_RANGE_PX = 350;
/** Half-width of the aim jitter band: (1 - accuracy) * 0.5 radians. */
const AIM_JITTER_SPREAD = 0.5;
/** The roll that centres the jitter on the true aim. */
const AIM_JITTER_CENTRE = 0.5;
/** A foe more than this many px above means the high ground — climb to it. */
const HIGH_GROUND_PX = 40;
/** A perch is only worth a double jump if it needs this much of a full one. */
const PERCH_DOUBLE_JUMP_FACTOR = 0.95;
/** Stuck detection: no movement beyond this for this long, this many times. */
const STUCK_WINDOW_MS = 600;
const STUCK_TOLERANCE_PX = 15;
const STUCK_THRESHOLD = 4;
/** A zoning phase ends early if the gap has opened this far past its aim. */
const ZONE_ESCAPE_FACTOR = 1.4;
/** The "sometimes break away instead of brawling" roll, by aggressiveness. */
const WANTS_SPACE_BASE = 0.5;
const WANTS_SPACE_AGGRO_WEIGHT = 0.28;
/** Range bands for the four engagement decisions. */
const EVADE_RANGE_PX = 500;
const EVADE_COINFLIP = 0.5;
const EXECUTE_RANGE_PX = 300;
const FINISH_CHASE_CHANCE = 0.7;
const ATTACK_RANGE_PX = 280;
const CHASE_RANGE_PX = 400;
/** In attack range, a fighter this aggressive holds the chase instead of attacking. */
const STAY_BIAS = 0.3;
/** Reaction time worsens by this per point of missing skill, plus this jitter. */
const REACTION_SKILL_STEP_MS = 40;
const REACTION_JITTER_MS = 100;
/**
 * Close enough that an enemy's dive is landing on you: the bomb's max blast
 * (130px) plus a margin for the judgement.
 */
const BOMB_DANGER_PX = 170;
/** A chase that has been stuck for this long flips into anti-stuck steering. */
const STUCK_ESCALATE_MS = 1200;
/** Chance rolls for the jump/strafe/counter reflexes, hurt vs hale where they differ. */
const RETREAT_JUMP_CHANCE = 0.7;
const WALL_CLIMB_CHANCE = 0.6;
const SKILL_JUMP_CHANCE_PER_POINT = 0.01;
const WALL_JUMP_CHANCE = 0.1;
const RETREAT_JUMP_HURT_CHANCE = 0.4;
const RETREAT_JUMP_HALE_CHANCE = 0.1;
const COUNTER_HALE_SCALE = 0.5;
/** Walk-in targets: a little inside sword range, or a gun's kite distance. */
const SWORD_SETTLE_GRACE_PX = 12;
const GUN_KITE_RANGE_PX = 80;
/**
 * The shotgun's settle range: closer than the gun's kite, because the whole
 * weapon is the cone. A bot that kited at 80px with a shotgun would fire a
 * fan whose edge pellets are already off a 32px body — it has to walk in
 * until the blast actually lands, which is the weapon's whole discipline.
 */
const SHOTGUN_KITE_RANGE_PX = 110;
const STRAFE_HURT_CHANCE = 0.2;
const STRAFE_HALE_CHANCE = 0.4;
const STRAFE_DIR_COINFLIP = 0.5;
const STRAFE_JUMP_HURT_CHANCE = 0.3;
const STRAFE_JUMP_HALE_CHANCE = 0.15;
/** Zoning stops once the gap clears the sword's disengage range by this much. */
const DISENGAGE_GRACE_PX = 40;
/** How often the escape burst is thrown while backing off. */
const DASH_ESCAPE_CHANCE = 0.14;
const ZONE_JUMP_HURT_CHANCE = 0.6;
const ZONE_JUMP_HALE_CHANCE = 0.3;

// ---- the dash approach ----
/**
 * The burst's closing band: outside a swing's reach (walking into one is how
 * swings get whiffed) but inside a dash's range (a burst covers 160px at
 * 1000px/s, so anything in this band is reachable in one).
 */
const DASH_APPROACH_MIN_PX = STRIKE_RANGE_PX + 60;
const DASH_APPROACH_MAX_PX = 280;
/** Base odds of bursting in, at zero skill and no aggression. */
const DASH_APPROACH_BASE_CHANCE = 0.06;
/** Odds per point of skill — a maxed bot bursts in far more often. */
const DASH_APPROACH_SKILL_PER_POINT = 0.006;
/** Odds per point of aggressiveness — a bloodthirsty bot closes hard. */
const DASH_APPROACH_AGGRO_WEIGHT = 0.06;

// ---- item decisions ----
/** A grenade is a ranged option, not a point-blank one: the throw's far band. */
const GRENADE_MIN_RANGE_PX = 120;
const GRENADE_MAX_RANGE_PX = 520;
/** The grenade's cooldown after a throw. */
const GRENADE_COOLDOWN_MS = 4200;
/** The trap's band: close enough to step on, far enough to be in the rush's path. */
const TRAP_MIN_RANGE_PX = 70;
const TRAP_MAX_RANGE_PX = 300;
/** The trap's cooldown after a lay. */
const TRAP_COOLDOWN_MS = 6000;
/** The self-smoke (blossom combo, panic button) cooldown. */
const SELF_SMOKE_COOLDOWN_MS = 3000;
/** The team smoke (a rushed ally) cooldown — the rarest, most expensive play. */
const TEAM_SMOKE_COOLDOWN_MS = 9000;
/** The panic smoke: hurt and pressed by a foe. */
const PANIC_SMOKE_HP = 40;
const PANIC_SMOKE_RANGE_PX = 320;
/** The panic smoke cooldown, between the self and team plays. */
const PANIC_SMOKE_COOLDOWN_MS = 8000;
/** A foe this close to an ally is a rush worth smoking. */
const RUSHED_ALLY_RANGE_PX = 200;
/** A thrust winding up nearby means leave the floor: the designed dodge. */
const THRUST_JUMP_RANGE_PX = 300;
/**
 * The fringe beyond the hole's outer reach where the tug is still felt.
 *
 * The escape is the dash, and the pull falls linearly from the horizon to
 * zero at `SINGULARITY_REACH`; a fighter that waits until it is visibly
 * inside the reach has already lost ground to the drag, so the bot reacts
 * a step early.
 */
const HOLE_ESCAPE_MARGIN_PX = 40;
/**
 * How far short of a trap's trigger the bot leaves the floor.
 *
 * A trap springs on the feet crossing its patch, so the jump has to begin
 * *before* the trigger — a bot that reacts once already inside simply
 * springs it. A jump holds for 240ms and lifts the feet 136px, so a jump
 * started a body-width out clears a patch the bot would otherwise land on.
 */
const TRAP_JUMP_MARGIN_PX = 40;

/**
 * The nearest ledge that is above the fighter and within a jump or two.
 *
 * Zoning without a destination just means jumping on the spot: a fighter has to
 * be standing under a ledge for a jump to reach one, and left to chance that
 * almost never happens. Measured without this, three matches used one of the
 * arena's nine surfaces and never rose above the bottom third.
 */
function perchAbove(selfX: number, selfY: number, world: World): Rect | null {
	let best: Rect | null = null;
	let bestDx = Number.POSITIVE_INFINITY;

	for (const p of world.platforms) {
		const standingY = p.y - PLAYER_HEIGHT;
		const rise = selfY - standingY;
		// Must be genuinely above, and reachable from here.
		if (rise < PERCH_MIN_RISE_PX || rise > PERCH_MAX_RISE_PX) continue;
		// Wide enough to land on.
		if (p.w < PLAYER_WIDTH) continue;

		const dx = Math.abs(p.x + p.w / 2 - selfX);
		if (dx < bestDx) {
			bestDx = dx;
			best = p;
		}
	}
	return best;
}

/**
 * One brain, four modules.
 *
 * The brain owns the state machine and the navigation; each weapon and each
 * team concern is a module with one job, and a future weapon is a new module
 * writing the same `AIOutput` instead of a new branch in a growing class. The
 * modules share no state between them except through this coordinator, which
 * is also what keeps the whole thing a single `decide(input) => output` for the
 * server and the training dummy.
 *
 * **Named export matters**: this class is imported by the server too, and a
 * default export resolves to the module namespace object rather than the class
 * under the server's ESM/CJS interop. Everything shared with `server/` must be
 * a named export.
 */
export class EnemyBrain {
	private config: AIConfig;
	private state: AIState = AIState.IDLE;
	private decisionCooldown = 0;
	private stateTimer = 0;
	private stuckTimer = 0;
	private stuckCheckX = 0;
	private stuckCheckY = 0;
	private stuckCount = 0;
	private zoneCooldown = 0;
	/**
	 * ms until this bot may use its item again. A cooldown rather than "use
	 * when ready", because an item is a finite per-life resource and a brain
	 * that threw both grenades in one exchange would be a brain with no item
	 * for the rest of the round.
	 */
	private itemCooldownMs = 0;

	/** The sword game: techniques, rhythms, stance hysteresis. */
	private readonly melee: MeleeModule;
	/** The jump button: committed presses and the scripted double jump. */
	private readonly jump = new JumpBrain();
	/** The ultimate: when to hold the button and where to aim it. */
	private readonly ultimate: UltModule;
	/** Team roles, spacing and the cover guard. */
	private readonly team: TeamBrain;

	/**
	 * The geometry this brain reasons about — ledges to perch on, cover to use.
	 * Defaults to the single-screen arena; a room's bots pass the room's world
	 * so a wide arena does not teach them to "zone" into a wall.
	 */
	readonly world: World;

	/** The hero this brain fights as — decides which melee and ult modules. */
	readonly hero: HeroId;

	constructor(
		config: AIConfig,
		world: World = DEFAULT_WORLD,
		hero: HeroId = "lia",
	) {
		this.config = config;
		this.world = world;
		this.hero = hero;
		this.team = new TeamBrain(world);
		// One coordinator, one strategy per hero: the dagger has its own melee
		// module (no guard, spam, thrusts, the shoryuken's air game) and its
		// own ultimate module (the dragon is a line, not a lob); Jeffs keeps
		// the sword (the blade is the blade) and aims nothing for the storm (it
		// is radial — see `BlossomBrain`). A future hero is a new pair of
		// modules here — never a branch in this file.
		this.melee = hero === "anands" ? new DaggerBrain() : new MeleeBrain();
		this.ultimate =
			hero === "anands"
				? new DragonBrain()
				: hero === "jeffs"
					? new BlossomBrain()
					: new UltimateBrain();
	}

	getConfig(): AIConfig {
		return { ...this.config };
	}

	updateConfig(config: Partial<AIConfig>) {
		this.config = { ...this.config, ...config };
	}

	resetState() {
		this.state = AIState.IDLE;
		this.decisionCooldown = 0;
		this.stateTimer = 0;
		this.stuckTimer = 0;
		this.stuckCheckX = 0;
		this.stuckCheckY = 0;
		this.stuckCount = 0;
		this.zoneCooldown = 0;
		this.melee.reset();
		this.jump.reset();
		this.ultimate.reset();
		this.team.reset();
	}

	getCurrentState(): AIState {
		return this.state;
	}

	/** The last perception this brain reasoned over, for the diagnostic. */
	private lastInput: AIInput | null = null;

	/** What this brain is doing right now, for the diagnostic. */
	getInsight() {
		const i = this.lastInput;
		const minFoeDistRaw =
			i?.foes.reduce(
				(m, f) => Math.min(m, f.distance),
				Number.POSITIVE_INFINITY,
			) ?? Number.POSITIVE_INFINITY;
		return {
			state: this.state,
			...this.team.insight,
			ultimate: this.ultimate.insight,
			// The perception itself, so a probe can tell "the brain decided not
			// to cast" from "the brain never saw a target".
			foes: i?.foes.length ?? 0,
			minFoeDist: Number.isFinite(minFoeDistRaw)
				? Math.round(minFoeDistRaw)
				: null,
			allies: i?.allies.length ?? 0,
			selfUlt: i?.selfUltCharge ?? 0,
			openFields: i?.fields.length ?? 0,
			stunned: i?.selfStunned ?? false,
		};
	}

	decide(input: AIInput, _time: number, delta: number): AIOutput {
		this.lastInput = input;
		this.decisionCooldown -= delta;
		this.stateTimer += delta;
		this.zoneCooldown = Math.max(0, this.zoneCooldown - delta);
		this.trackStuck(input, delta);

		const isLowHP = input.selfHP <= LOW_HP;
		const isHighHP = input.selfHP >= HIGH_HP;
		const isEnemyLow = input.enemyHP <= LOW_HP;

		const playerFacesMe =
			input.playerFacingDirection * (input.selfX - input.playerX) > 0;

		const dodgeRoll = Math.random();
		const dodgeMultiplier = isLowHP
			? DODGE_HURT_MULTIPLIER
			: isHighHP
				? DODGE_HALE_MULTIPLIER
				: DODGE_NEUTRAL_MULTIPLIER;
		const dodgeThreshold =
			this.config.dodgeChance *
			(this.config.skillLevel / 10) *
			DODGE_SKILL_SCALE *
			dodgeMultiplier;
		const shouldEvade =
			playerFacesMe &&
			input.distanceToPlayer < DODGE_RANGE_PX &&
			dodgeRoll < dodgeThreshold;

		if (this.decisionCooldown <= 0) {
			if (this.state !== AIState.EVADE && shouldEvade) {
				this.state = AIState.EVADE;
				this.stateTimer = 0;
			} else {
				const newState = this.evaluateState(input, isLowHP, isEnemyLow);
				if (newState !== this.state) {
					this.stateTimer = 0;
				}
				this.state = newState;
			}
			this.decisionCooldown = this.getReactionTime();
		}

		if (this.isStuck() && input.touchingDown) {
			this.stuckCount = 0;
		}

		const output = this.executeState(input, isLowHP, isEnemyLow);

		// ---- the weapon modules ----
		//
		// Order is the whole design: the state machine decides where to stand,
		// the melee module decides what the sword does from there, the team module
		// reshapes movement around the side, and the ultimate module asks for the
		// hole last — each layer may override the last, exactly like a human
		// reconsidering.
		const role = this.team.roleFor(input);
		this.melee.decide(input, output, delta, {
			role,
			skill: this.config.skillLevel,
			aggressiveness: this.config.aggressiveness,
		});
		this.team.decide(input, output, this.melee, role, delta);
		this.ultimate.decide(input, delta, role);
		output.ultimate = this.ultimate.hold;
		if (this.ultimate.aimOverride !== null) {
			output.aimAngle = this.ultimate.aimOverride;
		} else {
			output.aimAngle = this.aimAt(input);
		}

		// ---- the bomb ----
		//
		// A fighter mid-dive is a bomb with a fuse, and its one counter is
		// distance — a guard cannot stop it, and there is no trading with it.
		// While the enemy is coming down, every plan the state machine made is
		// shelved: run. Dash, even — the dive is short, and one dash is the
		// whole escape. Last on purpose, after the team module, so the bomb
		// beats even a cover order.
		if (input.enemyPlunging && input.distanceToPlayer < BOMB_DANGER_PX) {
			output.moveLeft = input.playerX > input.selfX;
			output.moveRight = input.playerX <= input.selfX;
			output.dash = input.playerX >= input.selfX ? -1 : 1;
			output.attack = false;
		}

		// ---- the hostile hole ----
		//
		// The singularity is an area hazard with a pull: inside its outer reach
		// the tug drags a fighter in, and the *designed* escape is the dash —
		// a walk at 220px/s loses the tug, a dash at 1000px/s shrugs it off.
		// A bot that kept fighting beside a hostile hole stood in the pull for
		// the whole 4.4s hold and took the full drain, exactly the passivity
		// the bomb reaction above was added to cure. Same shelving order: this
		// runs after the team module, so it beats even a cover order. A hole
		// inside the event horizon is a catch — stunned, no steering — so the
		// rule only saves what can still be saved, and the margin is the fringe
		// where the tug still bites.
		const hostileField = input.fields.find(
			(f) =>
				f.hostile &&
				Math.hypot(f.x - input.selfX, f.y - input.selfY) <
					SINGULARITY_REACH + HOLE_ESCAPE_MARGIN_PX,
		);
		if (hostileField) {
			const awayX = input.selfX - hostileField.x;
			output.moveRight = awayX > 0;
			output.moveLeft = awayX < 0;
			output.dash = awayX >= 0 ? 1 : -1;
			output.attack = false;
		}

		// ---- the hostile trap ----
		//
		// A floor mine springs the moment the feet cross its patch, and the
		// designed counter is the same thing that clears every low obstacle:
		// a jump — the patch is a 40px radius and a full jump lifts the feet
		// 136px. The perception already hands every bot the hostile traps,
		// pre-filtered by the friendly-fire predicate; the reaction is to
		// leave the floor a step before the feet would cross the trigger,
		// so the crossing happens with the feet in the air. Unlike the hole
		// this does not shelve the plan — the bot keeps fighting, it just
		// hops the minefield.
		const nearTrap =
			input.touchingDown &&
			input.traps.some(
				(t) =>
					Math.hypot(
						t.x - (input.selfX + PLAYER_WIDTH / 2),
						t.y - (input.selfY + PLAYER_HEIGHT),
					) <
					TRAP_RADIUS + TRAP_JUMP_MARGIN_PX,
			);
		if (nearTrap) output.jump = true;

		// ---- the thrust's anticipation ----
		//
		// The dagger thrust is unblockable — the guard is exactly the wrong
		// answer to it — and the *designed* dodge is the jump: the dash is a
		// flat line at the height it started, so a foe who leaves the ground
		// during the 260ms anticipation is over the line when it arrives. The
		// read lives here, on the shared coordinator, because it is the same
		// for every hero: whoever you are, a thrust winding up nearby means
		// get off the floor.
		if (
			input.enemyAction === "thrust" &&
			input.enemyPhase === "startup" &&
			input.distanceToPlayer < THRUST_JUMP_RANGE_PX
		) {
			output.jump = true;
			output.attack = false;
			output.block = false;
		}

		// ---- the jump ----
		output.jump = this.jump.resolve(
			input,
			output.jump,
			this.wantsHeight(input),
			delta,
		);
		this.decideItem(input, output, delta);
		return output;
	}

	/**
	 * The item: when to press the button and what it is for.
	 *
	 * The item fires on a *press edge* server-side, so the brain pulses `item`
	 * for one tick and then stays silent — a held item button would only ever
	 * spend one charge anyway, but a fresh cooldown is what keeps the resource
	 * from being dumped in a single exchange. Lia's grenade is a ranged option
	 * when the melee has no answer; Anands' trap is a floor hazard laid in the
	 * face of somebody rushing in.
	 */
	private decideItem(input: AIInput, output: AIOutput, delta: number) {
		this.itemCooldownMs = Math.max(0, this.itemCooldownMs - delta);
		if (this.itemCooldownMs > 0) return;
		if (input.selfItemCharges <= 0) return;
		if (input.selfStunned) return;
		if (!input.touchingDown && input.selfHero === "anands") return;

		// The grenade needs a corridor to throw down: range to reach, nothing
		// between, and a target that is not already being sworded (a grenade at
		// melee range would hurt the bot's own exchange).
		if (input.selfHero === "lia") {
			const canReach =
				input.distanceToPlayer > GRENADE_MIN_RANGE_PX &&
				input.distanceToPlayer < GRENADE_MAX_RANGE_PX;
			if (!canReach || !input.hasLineOfSight) return;
			output.item = true;
			this.itemCooldownMs = GRENADE_COOLDOWN_MS;
			return;
		}

		// The trap is a delay, so it belongs in the path of a rush: an enemy
		// close enough to step on it. The brain always faces the nearest foe, so
		// the trap lands between them; a cooldown and the three-charge cap stop
		// a brain from littering the floor with them.
		if (input.selfHero === "anands") {
			if (
				input.distanceToPlayer < TRAP_MAX_RANGE_PX &&
				input.distanceToPlayer > TRAP_MIN_RANGE_PX &&
				input.hasLineOfSight
			) {
				output.item = true;
				this.itemCooldownMs = TRAP_COOLDOWN_MS;
			}
			return;
		}

		// The smoke is the jeffs bot's whole item game, in three plays:
		//
		// 1. The combo: the moment the Death Blossom is held, throw a smoke at
		//    the bot's own feet. The cloud blooms during the hold and the
		//    cinematic freeze, so the channel starts inside friendly smoke —
		//    the enemy cannot see the caster to shoot them through the storm.
		//    The item press is edge-latched server-side, so a held hold costs
		//    exactly one canister; the cooldown paces later casts.
		// 2. The team play: an ally is being rushed — smoke the ally. The
		//    cloud is *their* ally smoke, so they vanish from the enemy's
		//    screens while the fight is still theirs to watch.
		// 3. The panic button: hurt, or facing an outnumbered fight — smoke
		//    the bot's own feet and vanish while still seeing everything.
		// The aim is straight down for the self-smokes (the canister blooms at
		// the thrower's feet) and a solved lob for the team play.
		if (input.selfHero === "jeffs") {
			if (this.ultimate.hold && input.selfItemCharges > 0) {
				output.item = true;
				output.aimAngle = Math.PI / 2;
				this.itemCooldownMs = SELF_SMOKE_COOLDOWN_MS;
				return;
			}

			const rushed = this.rushedAlly(input);
			if (rushed) {
				output.item = true;
				output.aimAngle = smokeLobAngle(
					rushed.x - input.selfX,
					rushed.y - input.selfY,
				);
				this.itemCooldownMs = TEAM_SMOKE_COOLDOWN_MS;
				return;
			}

			const outnumbered = input.foes.length > input.allies.length + 1;
			const hurt =
				input.selfHP < PANIC_SMOKE_HP &&
				input.distanceToPlayer < PANIC_SMOKE_RANGE_PX;
			if (!hurt && !outnumbered) return;
			output.item = true;
			output.aimAngle = Math.PI / 2;
			this.itemCooldownMs = PANIC_SMOKE_COOLDOWN_MS;
			return;
		}
	}

	/**
	 * The ally a foe is about to reach, or null. The team smoke's target: a
	 * rushed ally is a vanguard about to be swarmed, and a cloud over them is
	 * the support's whole contribution to that exchange.
	 */
	private rushedAlly(input: AIInput): { x: number; y: number } | null {
		let best: { x: number; y: number; d: number } | null = null;
		for (const ally of input.allies) {
			if (!ally.alive) continue;
			for (const foe of input.foes) {
				const d = Math.hypot(foe.x - ally.x, foe.y - ally.y);
				if (d < RUSHED_ALLY_RANGE_PX && (!best || d < best.d)) {
					best = { x: ally.x, y: ally.y, d };
				}
			}
		}
		return best ? { x: best.x, y: best.y } : null;
	}

	// -------------------------------------------------------------------------
	// Aiming
	// -------------------------------------------------------------------------

	/**
	 * The angle to point the gun: lead the target, then miss by accuracy.
	 *
	 * A bullet takes `distance / BULLET_SPEED` to arrive, and in that time the
	 * target has moved — a fighter strafing at walk speed is ~30px off by the
	 * time a shot from 80px... a shot from 300px arrives 0.5s later and the
	 * target has moved ~110px. A brain that aimed at where the foe *was* would
	 * be training the ranged game to miss, so the aim is at where it will be.
	 */
	private aimAt(input: AIInput): number {
		const timeOfFlight = input.distanceToPlayer / BULLET_SPEED;
		const px = input.playerX + input.enemyVX * timeOfFlight;
		const py = input.playerY + input.enemyVY * timeOfFlight;
		const accuracyFactor = this.config.accuracy * (this.config.skillLevel / 10);
		const aimJitter = (1 - accuracyFactor) * AIM_JITTER_SPREAD;
		return (
			Math.atan2(py - input.selfY, px - input.selfX) +
			(Math.random() - AIM_JITTER_CENTRE) * aimJitter
		);
	}

	// -------------------------------------------------------------------------
	// Height: the double jump
	// -------------------------------------------------------------------------

	/**
	 * "This jump is for height", per state.
	 *
	 * The double jump is a resource with a cost (it cannot be used again until
	 * landing), so the brain only asks for it when the situation actually wants
	 * it: closing on an enemy that holds the high ground, climbing to a ledge a
	 * single jump cannot reach, or fleeing with no health to spare.
	 */
	private wantsHeight(input: AIInput): boolean {
		switch (this.state) {
			case AIState.CHASE:
			case AIState.ATTACK:
				// The foe holds the high ground. A blind chase is *not* enough: a
				// double jump every time the line of sight broke measured the bots
				// airborne 80% of a duel, hopping through it instead of walking.
				return input.playerY < input.selfY - HIGH_GROUND_PX;
			case AIState.ZONE: {
				const perch = perchAbove(input.selfX, input.selfY, this.world);
				if (!perch) return false;
				// Only the ledges a single jump cannot reach need the second press.
				const rise = input.selfY - (perch.y - PLAYER_HEIGHT);
				return rise > JUMP_HEIGHT_PX * PERCH_DOUBLE_JUMP_FACTOR;
			}
			case AIState.EVADE:
			case AIState.RETREAT:
				return input.selfHP <= FLEE_HP;
			default:
				return false;
		}
	}

	// -------------------------------------------------------------------------
	// The state machine
	// -------------------------------------------------------------------------

	private trackStuck(input: AIInput, delta: number) {
		this.stuckTimer += delta;
		if (this.stuckTimer > STUCK_WINDOW_MS) {
			const dx = Math.abs(input.selfX - this.stuckCheckX);
			const dy = Math.abs(input.selfY - this.stuckCheckY);
			if (dx < STUCK_TOLERANCE_PX && dy < STUCK_TOLERANCE_PX) {
				this.stuckCount++;
			} else {
				this.stuckCount = Math.max(0, this.stuckCount - 1);
			}
			this.stuckCheckX = input.selfX;
			this.stuckCheckY = input.selfY;
			this.stuckTimer = 0;
		}
	}

	private isStuck(): boolean {
		return this.stuckCount >= STUCK_THRESHOLD;
	}

	private evaluateState(
		input: AIInput,
		isLowHP: boolean,
		isEnemyLow: boolean,
	): AIState {
		if (this.isStuck()) {
			return AIState.CHASE;
		}
		// Sword range is somewhere to *be*, not somewhere to flee. Backing off on
		// contact was correct when the only weapon was a gun; with a sword it
		// meant the fighter fled the exact distance its best options need, and no
		// melee exchange ever happened.
		// A zoning phase runs to its own clock; ending it early would mean never
		// actually getting anywhere.
		if (this.state === AIState.ZONE) {
			const done =
				this.stateTimer > ZONE_DURATION_MS ||
				input.distanceToPlayer > ZONE_RANGE_PX * ZONE_ESCAPE_FACTOR;
			if (!done) return AIState.ZONE;
			this.zoneCooldown = ZONE_COOLDOWN_MS;
		}

		if (input.distanceToPlayer < STRIKE_RANGE_PX) {
			if (isLowHP) return AIState.RETREAT;
			// Break away sometimes rather than brawling until someone dies. Cautious
			// fighters zone more, which is what makes two bots play differently
			// instead of mirroring each other into the centre of the map.
			const wantsSpace =
				WANTS_SPACE_BASE -
				WANTS_SPACE_AGGRO_WEIGHT * this.config.aggressiveness;
			if (this.zoneCooldown <= 0 && Math.random() < wantsSpace) {
				return AIState.ZONE;
			}
			return AIState.ATTACK;
		}
		if (isLowHP && !isEnemyLow) {
			if (input.distanceToPlayer < EVADE_RANGE_PX) {
				return Math.random() < EVADE_COINFLIP ? AIState.ATTACK : AIState.EVADE;
			}
			return AIState.CHASE;
		}
		if (isEnemyLow && !isLowHP) {
			if (input.distanceToPlayer < EXECUTE_RANGE_PX) {
				return AIState.ATTACK;
			}
			return Math.random() < FINISH_CHASE_CHANCE
				? AIState.CHASE
				: AIState.ATTACK;
		}
		if (input.distanceToPlayer < ATTACK_RANGE_PX) {
			if (!input.hasLineOfSight) return AIState.CHASE;
			return AIState.ATTACK;
		}
		if (input.distanceToPlayer < CHASE_RANGE_PX) {
			if (!input.hasLineOfSight) return AIState.CHASE;
			const stayBias = this.state === AIState.ATTACK ? STAY_BIAS : 0;
			const decision =
				Math.random() < this.config.aggressiveness - stayBias
					? AIState.CHASE
					: AIState.ATTACK;
			return decision;
		}
		return AIState.CHASE;
	}

	private getReactionTime(): number {
		const skillBonus = (10 - this.config.skillLevel) * REACTION_SKILL_STEP_MS;
		return (
			this.config.reactionTime + skillBonus + Math.random() * REACTION_JITTER_MS
		);
	}

	private executeState(
		input: AIInput,
		isLowHP: boolean,
		isEnemyLow: boolean,
	): AIOutput {
		const output: AIOutput = {
			moveLeft: false,
			moveRight: false,
			jump: false,
			attack: false,
			block: false,
			uppercut: false,
			swordStance: true,
			// Always face the opponent. A guard only covers one side, so turning to
			// meet them is not a flourish — it is the difference between blocking
			// and being backstabbed.
			face: input.playerX >= input.selfX ? 1 : -1,
			dash: 0,
			aimAngle: 0,
			evadeActive: false,
			ultimate: false,
			item: false,
		};

		switch (this.state) {
			case AIState.CHASE: {
				const reallyStuck =
					this.isStuck() && this.stateTimer > STUCK_ESCALATE_MS;
				if (reallyStuck) {
					output.moveRight = !(input.playerX > input.selfX);
					output.moveLeft = !(input.playerX <= input.selfX);
				} else {
					output.moveRight = input.playerX > input.selfX;
					output.moveLeft = input.playerX <= input.selfX;
				}
				if (
					isLowHP &&
					input.touchingDown &&
					Math.random() < RETREAT_JUMP_CHANCE
				) {
					output.jump = true;
				} else if (
					// Climbing blind is only worth it against a wall or up to a foe
					// that actually holds the high ground. Hopping every grounded frame
					// while the line of sight is broken measured the bots airborne for
					// most of a duel, jumping in place instead of walking around cover.
					(!input.hasLineOfSight &&
						(input.touchingLeft || input.touchingRight)) ||
					input.playerY < input.selfY - 60
				) {
					if (input.touchingDown) output.jump = true;
				} else if (this.isStuck() && input.touchingDown) {
					output.jump = Math.random() < WALL_CLIMB_CHANCE;
				} else if (
					input.touchingDown &&
					Math.random() < SKILL_JUMP_CHANCE_PER_POINT * this.config.skillLevel
				) {
					output.jump = true;
				}
				if (
					!input.touchingDown &&
					(input.touchingLeft || input.touchingRight) &&
					Math.random() < WALL_JUMP_CHANCE
				) {
					output.jump = true;
				}
				break;
			}

			case AIState.RETREAT: {
				output.moveRight = input.playerX <= input.selfX;
				output.moveLeft = input.playerX > input.selfX;
				// A walk retreat is a walk-forward chase: both sides move at
				// 240px/s, so the gap never opens. The burst is the one tool
				// that creates separation against an equal-speed pursuer, the
				// same roll zoning's escape uses.
				if (
					input.touchingDown &&
					Math.random() < DASH_ESCAPE_CHANCE
				) {
					output.dash = input.playerX >= input.selfX ? -1 : 1;
				}
				output.jump =
					input.touchingDown &&
					(isLowHP
						? Math.random() < RETREAT_JUMP_HURT_CHANCE
						: Math.random() < RETREAT_JUMP_HALE_CHANCE);
				const counterChance = isEnemyLow
					? Math.min(1, this.config.aggressiveness)
					: this.config.aggressiveness * COUNTER_HALE_SCALE;
				if (Math.random() < counterChance) {
					output.attack = input.hasLineOfSight;
				}
				break;
			}

			case AIState.ATTACK: {
				if (!input.hasLineOfSight) {
					output.moveRight = input.playerX > input.selfX;
					output.moveLeft = input.playerX <= input.selfX;
					output.jump = input.touchingDown;
					output.attack = false;
				} else {
					// Walk in until a swing can actually reach. The sword is the
					// primary weapon, so "in position" means sword range, not the
					// old ranged-duel spacing. The shotgun's range is its own too:
					// a Jeffs bot walks in closer than a gunner before pulling the
					// trigger, because the cone decides what lands.
					const wanted = this.melee.swordDrawn
						? STRIKE_RANGE_PX - SWORD_SETTLE_GRACE_PX
						: this.hero === "jeffs"
							? SHOTGUN_KITE_RANGE_PX
							: GUN_KITE_RANGE_PX;
					if (input.distanceToPlayer > wanted) {
						output.moveRight = input.playerX > input.selfX;
						output.moveLeft = input.playerX <= input.selfX;
					}
					// The burst approach: walk until the dash is worth it, then
					// cover the gap in one line. Without it the bots walked the
					// whole arena at 240px/s, and the dash — the movement tool
					// the whole game is built around — never happened outside
					// zoning. Gated on the foe being in neutral: bursting into
					// a live swing is exactly how a human loses, and the bot
					// should not be better at dying than playing.
					if (
						this.melee.swordDrawn &&
						input.touchingDown &&
						input.enemyGrounded &&
						input.enemyAction === "none" &&
						input.distanceToPlayer >= DASH_APPROACH_MIN_PX &&
						input.distanceToPlayer <= DASH_APPROACH_MAX_PX &&
						Math.random() <
							DASH_APPROACH_BASE_CHANCE +
								DASH_APPROACH_SKILL_PER_POINT *
									this.config.skillLevel +
								DASH_APPROACH_AGGRO_WEIGHT *
									this.config.aggressiveness
					) {
						output.dash = input.playerX >= input.selfX ? 1 : -1;
					}
					const strafe =
						!this.melee.swordDrawn &&
						Math.random() < (isLowHP ? STRAFE_HURT_CHANCE : STRAFE_HALE_CHANCE);
					if (strafe) {
						output.moveLeft = Math.random() < STRAFE_DIR_COINFLIP;
						output.moveRight = !output.moveLeft;
						output.jump =
							input.touchingDown &&
							(isLowHP
								? Math.random() < STRAFE_JUMP_HURT_CHANCE
								: Math.random() < STRAFE_JUMP_HALE_CHANCE);
					}
					output.attack = true;
				}
				break;
			}

			case AIState.ZONE: {
				// Put the arena between us: back off, and climb while doing it. Height
				// is what turns a retreat into a position rather than a corner.
				const away = input.selfX - input.playerX;
				const perch = perchAbove(input.selfX, input.selfY, this.world);

				// Space first, height second. Climbing while still inside sword range
				// left the fighter high but engaged: the gun never came out, because
				// the stance only holsters past SWORD_DISENGAGE_PX. Getting out of
				// reach is what makes the ranged game reachable at all.
				const tooClose =
					input.distanceToPlayer < SWORD_DISENGAGE_PX + DISENGAGE_GRACE_PX;

				if (tooClose) {
					output.moveLeft = away < 0;
					output.moveRight = away >= 0;
					// Walking away from someone who walks at your speed gains nothing —
					// the gap never opens. The burst is the only tool that creates
					// separation against an equal-speed opponent: a dash while the
					// sword is out, a tumble when the gun is — the simulation decides
					// which from the stance, so the brain just asks for the burst.
					if (Math.random() < DASH_ESCAPE_CHANCE)
						output.dash = away >= 0 ? 1 : -1;
				} else if (perch) {
					// Head for a specific ledge and jump when actually underneath it.
					// Steering toward a destination is the difference between climbing
					// the arena and hopping on the spot.
					const target = perch.x + perch.w / 2;
					const dx = target - input.selfX;
					if (Math.abs(dx) > PLAYER_WIDTH / 2) {
						output.moveRight = dx > 0;
						output.moveLeft = dx < 0;
					} else if (input.touchingDown) {
						output.jump = true;
					}
				}

				// Wall jump rather than sliding back down a face.
				if (
					!input.touchingDown &&
					(input.touchingLeft || input.touchingRight)
				) {
					output.jump = true;
				}

				output.attack = input.hasLineOfSight;
				break;
			}

			case AIState.EVADE: {
				output.evadeActive = true;
				const awayX = input.selfX - input.playerX;
				if (awayX > 0) {
					output.moveLeft = true;
					output.moveRight = false;
				} else {
					output.moveLeft = false;
					output.moveRight = true;
				}
				output.jump =
					input.touchingDown &&
					(isLowHP
						? Math.random() < ZONE_JUMP_HURT_CHANCE
						: Math.random() < ZONE_JUMP_HALE_CHANCE);
				break;
			}

			default:
				break;
		}

		// Walking into a wall gets you nowhere: climb it. This is what turns an
		// obstacle into a route instead of somewhere the AI grinds to a halt.
		const blockedAhead =
			(output.moveRight && input.touchingRight) ||
			(output.moveLeft && input.touchingLeft);
		if (blockedAhead && (input.touchingDown || this.jumpHoldActive)) {
			output.jump = true;
		}

		return output;
	}

	/** Whether the jump button is currently held by the jump module. */
	private get jumpHoldActive(): boolean {
		return this.jump.isHolding;
	}
}
