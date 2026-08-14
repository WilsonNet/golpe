/**
 * Sword combat tuning: the whole `MOVES` frame-data table, the dash bursts,
 * the Massive Strike (charge, slam, blast, the plunge bomb), the guard and
 * the chain. This is the balance of the game — every number here is
 * explained in specs/melee.md, and every hero that carries the sword shares
 * exactly this table. The shapes below (`MoveDef`, `MeleeWeaponDef`) are the
 * contracts the table is written in; tuning a move means changing its row
 * here.
 */

/**
 * The three-hit ground chain, in order.
 *
 * A slash is not one move any more, it is the opening of a sequence: right-to-left
 * diagonal, then left-to-right diagonal, then an overhead finisher. The list is
 * the chain — `comboStep` indexes it, so the length of the combo is a property of
 * this array and not a number written down in three places.
 */

export type MeleeMove =
	| "slash"
	| "slash2"
	| "slash3"
	| "uppercut"
	| "massive"
	| "stab"
	| "thrust"
	| "shoryuken";

/**
 * One attack's complete definition. This table *is* the balance of the game —
 * it is the only place these numbers exist, and specs/melee.md explains why each
 * one holds.
 */
export interface MoveDef {
	/** Wind-up. No hitbox yet, and nothing can be cancelled out of it. */
	startupMs: number;
	/** The hitbox is live for exactly this long. */
	activeMs: number;
	/** The commitment. For heavy moves this is the punish window. */
	recoveryMs: number;
	damage: number;
	/** How far in front of the body the hitbox extends. */
	reachPx: number;
	/** Hitbox top, relative to the body's top edge (negative reaches overhead). */
	boxTopOffset: number;
	boxHeight: number;
	/** Can a front block absorb it? Heavy moves exist precisely because some cannot. */
	blockable: boolean;
	/** Can block or a stance switch cut the recovery short? Only the slash can. */
	cancellable: boolean;
	/**
	 * Does this connect through melee invulnerability?
	 *
	 * Only the follow-ups of the ground chain. A combo hits faster than
	 * `MELEE_IFRAME_MS`, so without this the second and third swings would pass
	 * harmlessly through the fighter the first one just staggered — the combo
	 * would play its animations and deal seven damage. The opener never pierces,
	 * which is what keeps the invulnerability doing its real job of capping
	 * butterfly DPS.
	 */
	piercesIframes: boolean;
	/** Stun applied to whoever it lands on. */
	hitstunMs: number;
	/** Upward impulse on hit. Only the uppercut launches. */
	launchVy: number;
	/** Horizontal impulse on hit, away from the attacker. */
	knockbackVx: number;
	/**
	 * Does it put the target on the floor? Only the chain's finisher.
	 *
	 * A knockdown is a stun that also spikes an airborne target down and reads as
	 * a distinct state on screen — the reason the finisher is worth chaining into
	 * rather than just more damage.
	 */
	knockdown: boolean;
	/** How long the knockdown holds, when `knockdown` is set. Defaults to `KNOCKDOWN_MS`. */
	knockdownMs?: number;
	/**
	 * Horizontal speed the *attacker* travels during the active frames, along
	 * their facing — the dagger thrust's dash. The one place a move moves its
	 * own body.
	 */
	selfVx?: number;
	/**
	 * Vertical speed the *attacker* travels during the active frames — the
	 * shoryuken's rise. Pinned for the whole active window, then gravity owns
	 * the recovery.
	 */
	selfVy?: number;
}

/**
 * Which melee weapon a hero carries in the sword stance.
 *
 * The stance enum on the wire stays `"sword" | "gun"` because it is the slot;
 * this is what the sword slot means for a given hero. `tickMelee` is
 * parameterised by the weapon's definition so a future weapon is a new table
 * and a new entry here, not a branch anywhere else.
 */
export type MeleeWeaponId = "sword" | "dagger";

/**
 * What a weapon is allowed to do, and which moves it can start.
 *
 * Everything about sword combat that varies between weapons lives in this
 * table, and `tickMelee` branches on it rather than on the weapon's name. A
 * future weapon (axe, fists, spear) is a new entry here plus its moves in
 * `MOVES` — the state machine, phases, hitbox and resolution are shared.
 */
export interface MeleeWeaponDef {
	id: MeleeWeaponId;
	label: string;
	/** Every move this weapon can start. Moves stay globally unique in `MOVES`. */
	moves: readonly MeleeMove[];
	/** Can this weapon raise a guard at all? Only the sword. */
	blockable: boolean;
	/** Does this weapon charge a massive? Only the sword. */
	hasCharge: boolean;
	/** The ground chain, or null for a chainless weapon. */
	chain: readonly MeleeMove[] | null;
	/**
	 * The move the block button starts in neutral. Null for the sword, whose
	 * block button *blocks*.
	 */
	shiftMove: MeleeMove | null;
	/** The move the uppercut button starts. Sword: uppercut, dagger: shoryuken. */
	specialMove: MeleeMove;
	/** The melee stance's double-tap dash. See `DAGGER_DASH_*`. */
	burst: { speed: number; durationMs: number; lockoutMs: number };
}
export const COMBO_CHAIN = ["slash", "slash2", "slash3"] as const;

export const MOVES: Record<MeleeMove, MoveDef> = {
	/**
	 * The bread and butter. Its 330ms total against a 160ms cancelled length is
	 * the entire reward for learning the butterfly — shrink the recovery and the
	 * technique stops mattering.
	 */
	slash: {
		/**
		 * 75ms, and the number is set by the network rather than by feel.
		 *
		 * Blocking is supposed to be a *read*. Online, the earliest an opponent can
		 * learn a swing has begun is the next 20Hz snapshot — up to 50ms — and the
		 * guard then needs `BLOCK_STARTUP_MS` to become effective. At the original
		 * 55ms of startup that budget did not fit, and it showed: across three
		 * measured matches, 19 guards were raised and not one of them ever
		 * intercepted a slash. A reaction window narrower than the game's own
		 * update rate is not a hard mechanic, it is an absent one.
		 */
		startupMs: 75,
		activeMs: 85,
		recoveryMs: 170,
		damage: 7,
		reachPx: 48,
		boxTopOffset: 6,
		boxHeight: 36,
		blockable: true,
		cancellable: true,
		piercesIframes: false,
		/**
		 * 190ms, and it is the *link* that sets it rather than feel.
		 *
		 * The follow-up can be chained from the moment this move enters recovery
		 * (160ms) and lands after its own 75ms of startup, so the second hitbox
		 * opens ~157ms after the first one did. Any hitstun shorter than that gap
		 * hands the defender free frames in the middle of a combo, which is not a
		 * combo — it is two swings that happen to be near each other.
		 */
		hitstunMs: 190,
		launchVy: 0,
		knockbackVx: 130,
		knockdown: false,
	},
	/**
	 * The second link: the mirror diagonal, left-to-right.
	 *
	 * Same frame data as the opener on purpose. The chain is meant to be a rhythm
	 * you can hold in your hands, not three separate timings to learn, and the
	 * difference between the two is the *angle* — which is what the defender reads
	 * to know whether the finisher is coming next.
	 */
	slash2: {
		startupMs: 75,
		activeMs: 85,
		recoveryMs: 170,
		damage: 7,
		reachPx: 50,
		boxTopOffset: 4,
		boxHeight: 38,
		blockable: true,
		cancellable: true,
		piercesIframes: true,
		/** Longer than the opener's, because the finisher's startup is longer. */
		hitstunMs: 210,
		launchVy: 0,
		knockbackVx: 150,
		knockdown: false,
	},
	/**
	 * The finisher: an overhead that knocks the target down.
	 *
	 * The one link that cannot be cancelled — the chain has to end in a commitment
	 * or it would be a free three-hit string with an escape hatch on every frame.
	 * What it commits to is *neutral*, not a punish: see `KNOCKDOWN_MS`.
	 */
	slash3: {
		startupMs: 85,
		activeMs: 100,
		recoveryMs: 420,
		/** A little more than a link, well under a Massive. 7+7+11 = 25 for the chain. */
		damage: 11,
		reachPx: 54,
		boxTopOffset: -6,
		boxHeight: 52,
		blockable: true,
		cancellable: false,
		piercesIframes: true,
		/** Equal to the knockdown it causes, by construction. */
		hitstunMs: 520,
		launchVy: 0,
		knockbackVx: 300,
		knockdown: true,
	},
	/**
	 * The answer to a turtle. Unblockable and launching, but the shortest reach of
	 * the three, so it has to be walked into — and 340ms of uncancellable recovery
	 * means walking into it wrong loses the exchange.
	 */
	uppercut: {
		startupMs: 110,
		activeMs: 100,
		recoveryMs: 340,
		damage: 11,
		reachPx: 34,
		boxTopOffset: -20,
		boxHeight: 62,
		blockable: false,
		cancellable: false,
		piercesIframes: false,
		hitstunMs: 260,
		/**
		 * Deliberately weaker than JUMP_VELOCITY (-700): a launched fighter rises
		 * slightly less than they could have jumped. High enough to be helpless,
		 * low enough that a launch is not a free ring-out from every platform.
		 */
		launchVy: -620,
		knockbackVx: 90,
		knockdown: false,
	},
	/**
	 * The payoff for a 2.5s charge or a guard break. The swing comes down on the
	 * floor a little in front of the fighter, and what matters about it is what
	 * happens *when it reaches the floor*: the blast that follows is front and
	 * back of the slam point, and it stuns through a guard — which is the whole
	 * "back massive" technique.
	 *
	 * Unlike the old unblockable heavy, **the swing itself can be read and
	 * blocked.** A defender standing in the swing path stops the blade before it
	 * touches the floor, and every block of a sword attack is a guard break — so
	 * a front massive thrown into a turtle is a gift, and the answers to a turtle
	 * are the blast behind you and the plunge bomb above you.
	 */
	massive: {
		/**
		 * Short wind-up because the charge already *was* the wind-up: the sword
		 * is raised for the whole hold, so the swing needs no time to get there.
		 */
		startupMs: 90,
		/** The blade comes down; the floor contact lands at the end of this. */
		activeMs: 130,
		/**
		 * Pulling the sword out of the floor. Longer than the old recovery,
		 * because a move whose blast reaches 100px past the fighter cannot also
		 * leave them free.
		 */
		recoveryMs: 460,
		damage: 24,
		/** The swing's hitbox reaches the slam point and no further. */
		reachPx: 40,
		/** The swing cuts from mid-body down to the feet, where the floor is. */
		boxTopOffset: 20,
		boxHeight: 28,
		/**
		 * Blockable, and that is the point: a turtle can stop the swing by being
		 * *in* its path — and pays nothing, because blocking the swing is the
		 * same guard break as blocking a slash. See `MASSIVE_SLAM_OFFSET_PX`.
		 */
		blockable: true,
		cancellable: false,
		piercesIframes: false,
		hitstunMs: 650,
		launchVy: 0,
		knockbackVx: 420,
		knockdown: false,
	},
	/**
	 * The dagger's bread and butter. Where the slash is 330ms, the stab is
	 * 190ms; where the slash deals 7, the stab deals 5. Fast enough to punish
	 * the gap between a sword wielder's swings — a dagger in range *interrupts*
	 * — and weak enough that trading with the sword still loses.
	 */
	stab: {
		startupMs: 45,
		activeMs: 55,
		recoveryMs: 90,
		damage: 5,
		/** Shorter than the slash's 42: the dagger has to be walked in. */
		reachPx: 30,
		boxTopOffset: 8,
		boxHeight: 30,
		/** A sword guard stops a stab — and guard-breaks the dagger for it. */
		blockable: true,
		/**
		 * Cancellable into the thrust (the dagger's shift press) and a stance
		 * switch, exactly as the slash cancels into a block. The dagger's
		 * rhythm: a storm of stabs that can be spent on one committed lunge.
		 */
		cancellable: true,
		piercesIframes: false,
		/** Shorter than the slash's 190ms: the dagger does not lock you down. */
		hitstunMs: 140,
		launchVy: 0,
		knockbackVx: 90,
		knockdown: false,
	},
	/**
	 * The dagger's Shift move and its whole identity: a committed lunge that
	 * knocks down **everyone in its path** for 1.5s. It is the answer to
	 * everything a dagger cannot do — it has no guard, so it must take the
	 * initiative, and the 260ms anticipation is the tell that lets a quick
	 * foe jump the line before the dash begins.
	 */
	thrust: {
		/**
		 * The anticipation. Long enough to read and react to — a jump clears
		 * the flat line entirely — which is the entire counterplay, because the
		 * dash itself is unblockable and unparryable once it is committed.
		 */
		startupMs: 260,
		/** The dash. `selfVx` carries the body; the hitbox sweeps the path. */
		activeMs: 140,
		/**
		 * The commitment. A whiffed thrust is a 480ms walk-in for the foe who
		 * jumped it — long enough that a thrust chain reads as a choice, not a
		 * spam.
		 */
		recoveryMs: 480,
		/**
		 * Strong to compensate for the lack of a guard: this is the dagger's
		 * heavy, and it out-damages the chain's finisher while being far more
		 * committal.
		 */
		damage: 16,
		reachPx: 40,
		boxTopOffset: 10,
		boxHeight: 28,
		blockable: false,
		cancellable: false,
		/** A foe just stabbed out of their iframes can still be lunged through. */
		piercesIframes: true,
		/** Equal to the knockdown, by construction. See `knockdownMs`. */
		hitstunMs: 1500,
		launchVy: 0,
		knockbackVx: 240,
		knockdown: true,
		knockdownMs: 1500,
		/** The dash: 780 px/s — 60% of the original 1300, a ~109px carry. */
		selfVx: 780,
		/** The flat line: `vy` pinned to zero so an airborne thrust does not fall. */
		selfVy: 0,
	},
	/**
	 * The dagger's anti-air on the uppercut button. A rising stab that hits
	 * into the air, knocks down, and — unlike the sword's uppercut — is
	 * blockable. The trade for a knockdown that lands: a read guard stops it,
	 * and it only fires while the second jump is still in hand, so it can
	 * never be a third jump.
	 */
	shoryuken: {
		startupMs: 90,
		activeMs: 140,
		recoveryMs: 320,
		damage: 8,
		/**
		 * A wide anti-air reach — nearly double the stab's 30 and the sword
		 * uppercut's 34. The anti-air must connect with a foe who is *above*,
		 * which is already a moving target: a narrow box on top of that made
		 * the move whiff everything but a point-blank jump-in.
		 */
		reachPx: 62,
		/** The box reaches 60px above the head — the anti-air. */
		boxTopOffset: -60,
		boxHeight: 112,
		/** Blockable, unlike the sword's uppercut. */
		blockable: true,
		cancellable: false,
		piercesIframes: false,
		/** A weaker knockdown than the thrust's: 900ms, not 1500ms. */
		hitstunMs: 900,
		launchVy: 0,
		knockbackVx: 120,
		knockdown: true,
		knockdownMs: 900,
		/** The rise: a clean anti-air hop, not a jump (see `selfVy`). */
		selfVy: -420,
	},
};

/**
 * The sword's double-tap dash. Owned here because it is the *sword weapon's*
 * burst — the dagger's lives beside it in `MELEE_WEAPONS`. `Physics.ts`
 * re-exports these so the old importers keep working; the tumble stays there,
 * because a tumble is what the gun *stance* does and the gun stance never
 * changes weapon.
 */
export const DASH_SPEED = 1000;

/** Minimum gap between dashes, so it cannot be held down as a speed boost. */
export const DASH_LOCKOUT_MS = 250;

/**
 * How long a dash holds its line — no gravity, no vertical drift at all.
 *
 * A dash that fell while it travelled was a dive, and it made the one thing a
 * dash is for — crossing a gap, breaking away, repositioning at the peak of a
 * jump — depend on how far through the arc you happened to be. Holding Y makes it
 * a *line*, which is what a player is aiming when they gesture it.
 *
 * **Deliberately shorter than `DASH_LOCKOUT_MS`.** The gap between the two is the
 * window in which gravity always gets a say, so no amount of dashing is level
 * flight: at 160 against a 250ms lockout, a chained dasher still falls for 90ms in
 * every 250. Raise this past the lockout and the fighter simply never comes down.
 */
export const DASH_DURATION_MS = 160;

/**
 * The dagger's double-tap dash: lighter weapon, faster burst.
 *
 * The sword dashes at `DASH_SPEED` (1000) for 160ms with a 250ms lockout; the
 * dagger weighs nothing, so its burst is a little faster, a little shorter and
 * ready a little sooner. The difference is a feel, not a gap the sword cannot
 * close — the thrust is where the dagger's real speed lives.
 */
export const DAGGER_DASH_SPEED = 1100;

export const DAGGER_DASH_DURATION_MS = 150;

export const DAGGER_DASH_LOCKOUT_MS = 220;

export const MELEE_WEAPONS: Record<MeleeWeaponId, MeleeWeaponDef> = {
	sword: {
		id: "sword",
		label: "SWORD",
		moves: ["slash", "slash2", "slash3", "uppercut", "massive"],
		blockable: true,
		hasCharge: true,
		chain: COMBO_CHAIN,
		shiftMove: null,
		specialMove: "uppercut",
		burst: {
			speed: DASH_SPEED,
			durationMs: DASH_DURATION_MS,
			lockoutMs: DASH_LOCKOUT_MS,
		},
	},
	dagger: {
		id: "dagger",
		label: "DAGGER",
		moves: ["stab", "thrust", "shoryuken"],
		blockable: false,
		hasCharge: false,
		chain: null,
		shiftMove: "thrust",
		specialMove: "shoryuken",
		burst: {
			speed: DAGGER_DASH_SPEED,
			durationMs: DAGGER_DASH_DURATION_MS,
			lockoutMs: DAGGER_DASH_LOCKOUT_MS,
		},
	},
};

/**
 * How long the chain stays alive after a link *ends*.
 *
 * The link itself needs no window at all — the next slash can be started from the
 * moment the previous one enters recovery, which is what "very little delay"
 * means. This is only the grace afterwards, so a player who lets a swing finish,
 * or cancels one into a block and comes back out of it, is still in the same
 * combo. Wide on purpose: a dropped chain costs a whole combo, and there is
 * nothing to exploit in it — the chain is three moves long however slowly you
 * walk down it, and it dies the moment you leave the ground.
 */
export const COMBO_LINK_MS = 260;

/**
 * How long the chain's finisher keeps its victim on the floor.
 *
 * **Equal to the finisher's own active-plus-recovery, by construction**, and
 * `Melee.test.ts` asserts it. The attacker's swing ends at
 * `startup + active + recovery` and the victim's knockdown ends at
 * `hit + KNOCKDOWN_MS`, so if the hitbox connects on its first live frame the two
 * end on the same tick: a landed combo ends in *neutral*, not in free pressure.
 * That is what pays for the chain being uninterruptible once it reaches the
 * finisher.
 */
export const KNOCKDOWN_MS = 520;

/**
 * Downward velocity a knockdown forces on its victim.
 *
 * Only ever applied as a floor (`max`), so a target already falling faster keeps
 * its own speed. It exists so the finisher looks like what it is when it catches
 * somebody in the air — an uppercut's victim comes back down *hard* rather than
 * drifting through their own knockdown.
 */
export const KNOCKDOWN_SLAM_VY = 520;

/**
 * Hold the attack button this long to arm a Massive Strike.
 *
 * 1.6s — long enough that arming in somebody's face is a read they can punish
 * (a stun, a guard break, a stance switch all spend it), short enough that the
 * armed delivery phase — walk it in, hop it into a bomb — is the majority of
 * the commitment rather than a distant reward. The original 4s made the
 * charge itself the whole move, and the fighter spent most of the gesture
 * standing still.
 */
export const MASSIVE_CHARGE_MS = 1600;

/**
 * Hold past this and the charge roots your walk.
 *
 * The root cannot begin on the press itself: a butterfly tap is a press held
 * ~55ms, and a chain link ~75ms, and neither must lose its mobility — the
 * butterfly is the *mobile* pressure technique. This threshold sits past every
 * cancel a slash offers, so only a hold that has outlived the slash's own
 * decisions commits to the charge.
 */
export const CHARGE_LOCK_MS = 250;

/**
 * How long a guard-break-granted Massive stays armed before it fades.
 *
 * The reward for reading a swing is real but perishable: 4s to spend it,
 * because it must be spent with intent — a free Massive that hung around
 * forever would replace the sword game with a waiting game.
 */
export const PARRY_MASSIVE_LIFETIME_MS = 4000;

/**
 * Delay before a guard becomes effective. **Zero, on purpose.**
 *
 * It was 30ms, framed as "a guard is not instantaneous". Online that framing was
 * a fiction: the reaction budget for blocking a 75ms slash is already spent on
 * the 50ms snapshot interval, and taking another 30ms out of what remains was
 * the difference between a hard read and an impossible one — 19 guards raised
 * across three measured matches, zero slashes intercepted.
 *
 * Anything between 1 and 16ms would also have been a fiction, just a quieter
 * one: the simulation steps at 60Hz, so a sub-tick delay rounds away to nothing
 * while still reading like a real cost. Blocking is risky because it covers one
 * side, slows you down, and every sword hit it stops turns the exchange around
 * completely — not because the button is sticky.
 */
export const BLOCK_STARTUP_MS = 0;

/** What a guard-broken attacker eats. Long enough for the free Massive to land. */
export const GUARD_BREAK_STUN_MS = 1000;

/** Extra stun on top of the move's own, for landing on someone's unfaced side. */
export const BACKSTAB_BONUS_STUN_MS = 500;

/**
 * Melee damage immunity after being hit.
 *
 * This, and not an attack cooldown, is what caps butterfly damage. A cooldown
 * would slow the technique down and take away the mobility that makes it worth
 * learning; invulnerability instead makes swinging *faster* stop paying, which
 * keeps the butterfly a positioning tool rather than the highest-DPS option.
 */
export const MELEE_IFRAME_MS = 180;

/** Shared shove when an attack is absorbed. Nobody wins, both get space. */
export const BLOCK_PUSHBACK = 90;

// ---------------------------------------------------------------------------
// The massive's floor blast
// ---------------------------------------------------------------------------

/**
 * How far in front of the body's centre the sword tip hits the floor.
 *
 * A little in front, not at the feet — the whole geometry of the move depends
 * on it. The swing's hitbox reaches exactly this far, so a defender *in* the
 * swing path can read and block it; anything past the slam point is out of the
 * swing and into the blast. And the blast radiates front **and back** of this
 * point, which is what makes a fighter who turned away from a turtle a threat:
 * the turtle behind them is outside the swing but inside the blast.
 */
export const MASSIVE_SLAM_OFFSET_PX = 56;

/**
 * The blast's radius around the slam point, front and back equally.
 *
 * 100px either side: from the slam point the front reach ends ~156px past the
 * body's centre, and the back reach ~44px past it — far enough that a blocking
 * fighter standing on the attacker's back is caught, which is the back-massive.
 */
export const MASSIVE_BLAST_RADIUS_PX = 100;

export const MASSIVE_BLAST_DAMAGE = 24;

/**
 * The blast's stun goes **through a guard** — that is the entire point of the
 * back massive, and of the massive generally: the answer to a turtle is not to
 * out-swing them but to make the floor explode where they stand.
 */
export const MASSIVE_BLAST_STUN_MS = 650;

/** Horizontal shove away from the slam point, so the fight separates. */
export const MASSIVE_BLAST_KNOCKBACK_PX_S = 240;

// ---------------------------------------------------------------------------
// The plunge bomb (an airborne massive)
// ---------------------------------------------------------------------------

/**
 * The dive's speed. Faster than `MAX_FALL_SPEED` (950) — the bomb is not
 * falling, it is *pressing* — and fast enough that the whole dive reads as one
 * deliberate line rather than a fall you could second-guess.
 */
export const PLUNGE_SPEED = 1500;

/** How fast a dive sheds its horizontal velocity: a bomb falls straight down. */
export const PLUNGE_DECEL = 3000;

/**
 * Fall heights beyond this buy nothing. The arena's high ledges are ~300px
 * above the floor, so a cap well past that keeps the formulas honest without
 * letting a corner of the map turn into a nuke. The per-value maxima below
 * are the value of exactly this fall: 450 + 500·0.5 = 700, and so on, so the
 * cap is *the* big bomb rather than an unreachable tail.
 */
export const PLUNGE_MAX_FALL_PX = 500;

export const PLUNGE_DAMAGE = 24;

/**
 * The dive's grab: how far past the bomber's own body the column reaches, on
 * every side. Any hostile fighter airborne inside it is caught and carried
 * down with the bomb. The dive is vertical and sheds `vx`, so the column is
 * exactly where the bomber will land — which is what makes the catch dodgeable
 * (step out of the line) and what makes it an anti-air answer (the shoryuken
 * and the uppercut both put their users inside it).
 */
export const PLUNGE_CATCH_RADIUS_PX = 32;

/**
 * How long a caught fighter is carried down with the bomber.
 *
 * A body's worth more than the longest possible dive (`PLUNGE_MAX_FALL_PX` /
 * `PLUNGE_SPEED` = 333ms), so the ride always reaches the floor, and the tail
 * past it is what lets the landing blast tell "carried" from "launched".
 * Set once per catch (never refreshed), so both sides decay the same number.
 */
export const PLUNGE_CARRY_MS = 400;

export const PLUNGE_BLAST_BASE_RADIUS_PX = 70;

export const PLUNGE_BLAST_RADIUS_PER_PX = 0.12;

export const PLUNGE_BLAST_MAX_RADIUS_PX = 130;

/** Stun grows with the bomb; a 500px fall stuns for the full 700ms. */
export const PLUNGE_STUN_BASE_MS = 450;

export const PLUNGE_STUN_PER_PX_MS = 0.5;

export const PLUNGE_STUN_MAX_MS = 700;

/** Knockup (upward launch) grows with the bomb, from a hop toward a full jump. */
export const PLUNGE_KNOCKUP_BASE = -250;

export const PLUNGE_KNOCKUP_PER_PX = -0.9;

export const PLUNGE_KNOCKUP_MAX = -700;

/**
 * The bomber's own punishment: the sword is stuck in the ground, and the bigger
 * the bomb the longer it takes to pull out. Only a melee hit ends it early.
 */
export const PLUNGE_STUCK_BASE_MS = 400;

export const PLUNGE_STUCK_PER_PX_MS = 0.8;

export const PLUNGE_STUCK_MAX_MS = 800;
