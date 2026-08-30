/**
 * The chapters every hero shares: the feet, the sword, and the graduation
 * fight.
 *
 * Two heroes carry the same sword and the same guard, so the sword chapter is
 * written once and handed the hero's name — the alternative was three copies
 * of the butterfly drifting apart the first time the cancel window changed.
 * The dagger's melee is a different game and lives in `anands.ts`.
 *
 * Every stage is an ordinary training config. The teaching is in `brief`; the
 * *doing* is in the objectives; the dummy's behaviour is what makes the drill
 * a fight rather than a demonstration.
 */

import { HEROES, type HeroId } from "../../simulation/Heroes.js";
import * as o from "../objectives.js";
import type { Chapter, Lesson } from "../types.js";

/**
 * The room a lesson is played in unless it says otherwise: nobody can die,
 * nothing resets under you, and the dummy is close enough to hit.
 *
 * Invincibility on both sides is the whole reason a tutorial can be relaxed
 * about ordering — a player who spends four minutes on the dash lesson does
 * not come out of it at 12 HP.
 */
const SAFE = {
	dummyInvincible: true,
	playerInvincible: true,
	disableRoundReset: true,
} as const;

/** A dummy that stands there and takes it. */
const idle = { ...SAFE, behaviour: "idle" } as const;

// ---------------------------------------------------------------------------
// Chapter 1 — the feet
// ---------------------------------------------------------------------------

export function basicsChapter(hero: HeroId): Chapter {
	const name = HEROES[hero].name;
	return {
		id: `${hero}-basics`,
		title: "First steps",
		subtitle: "Walking, jumping, and the burst that closes a gap",
		kind: "course",
		hero,
		lessons: [
			{
				id: `${hero}-basics-walk`,
				title: "Find your feet",
				brief: `This is ${name}, and this is the arena. Walk left and right — the sword reaches barely further than an arm, so where you stand is most of the fight. The dummy in front of you cannot be hurt and cannot hurt you.`,
				stage: idle,
				objectives: [o.walk(8), o.jump(2)],
				outro: "That is the whole of moving. Everything else is timing.",
			},
			{
				id: `${hero}-basics-air`,
				title: "The second jump",
				brief:
					"Press jump again while you are in the air for a second, weaker hop. It refills only when you land — spend it and the ground is the only thing that gives it back.",
				stage: idle,
				objectives: [o.doubleJump(2)],
				outro: "Two jumps. Count them, because the arena will.",
			},
			{
				id: `${hero}-basics-dash`,
				title: "Closing the gap",
				brief:
					"Double-tap a direction to dash: a flat, gravity-free line. On the ground it crosses a gap; in the air it holds your height the whole way, which is how you reach ledges a jump cannot.",
				stage: { ...SAFE, behaviour: "walk" },
				objectives: [o.dash(2), o.airDash(1)],
				outro: "A dash is a decision, not a movement key. It has a cooldown.",
			},
			{
				id: `${hero}-basics-stance`,
				title: "Two weapons, one hand",
				brief:
					"You carry a melee weapon and a ranged one, and only one is out at a time. Switching is instant. In gun stance the dash becomes a tumble — slower, lower, and it sprawls under things.",
				stage: idle,
				objectives: [o.switchStance(2), o.tumble(1)],
				outro:
					"Sword is home. The gun answers a range problem; it is not where a fight starts.",
			},
		],
	};
}

// ---------------------------------------------------------------------------
// Chapter 2 — the sword (Lia and Jeffs)
// ---------------------------------------------------------------------------

export function swordChapter(hero: HeroId): Chapter {
	return {
		id: `${hero}-sword`,
		title: "The sword",
		subtitle: "The chain, the guard, and the two ways through a turtle",
		kind: "course",
		hero,
		lessons: [
			{
				id: `${hero}-slash`,
				title: "The bread and butter",
				brief:
					"A diagonal cut, right to left. It is fast, it is short, and it has to be walked into range — the whole sword game hangs off it.",
				stage: idle,
				objectives: [o.land("slash", "a slash", 3)],
				outro: "Now do it three more times without stopping.",
			},
			{
				id: `${hero}-chain`,
				title: "The three-hit chain",
				brief:
					"Attack again as each swing's hitbox closes and the chain runs: diagonal, mirror diagonal, then an overhead finisher that knocks the target down. It needs both feet on the floor, and a cancel drops it.",
				stage: idle,
				objectives: [
					o.land("slash2", "the second link", 1),
					o.land("slash3", "the finisher", 1),
				],
				outro:
					"The finisher cannot be cancelled. It ends in neutral by construction — that is the price of the knockdown.",
			},
			{
				id: `${hero}-guard`,
				title: "The guard",
				brief:
					"Hold block and face the swing. The guard covers the side you are facing and nothing else — and a block that stops a sword attack guard-breaks the attacker for a full second. The dummy is swinging at you now.",
				stage: { ...SAFE, behaviour: "slash", timing: { periodMs: 1400 } },
				objectives: [o.block(1), o.parry(2)],
				outro:
					"A guard break is a free second. What you do with it is the next lesson.",
			},
			{
				id: `${hero}-butterfly`,
				title: "The butterfly",
				brief:
					"The first two links of the chain cancel into a block. Swing, then guard before the swing finishes: you get the hitbox and the guard, and you keep the initiative. This is the loop good players open with.",
				stage: { ...SAFE, behaviour: "slash", timing: { periodMs: 1600 } },
				objectives: [o.butterfly(2)],
				outro:
					"Cancel early and it is merely safe. Cancel as the active frames close and it is safe *and* it hurts.",
			},
			{
				id: `${hero}-uppercut`,
				title: "Answering a turtle",
				brief:
					"This dummy holds its guard. A slash will not get through it — the uppercut will: unblockable, and it launches. It reaches barely past your own body and its recovery cannot be cancelled, so a whiff is the exchange. And the foe comes back down **on their back**: the launch is the hit, the floor is the knockdown.",
				stage: { ...SAFE, behaviour: "blockAll" },
				objectives: [o.land("uppercut", "an uppercut", 2)],
				outro: "Unblockable, short, and slow to recover. Read, then throw.",
			},
			{
				id: `${hero}-backstab`,
				title: "Behind the guard",
				brief:
					"A guard covers the side it faces and nothing else. This dummy is holding block with its back to you — walk around a turtle and the same slash that bounced off the front goes straight through.",
				stage: { ...SAFE, behaviour: "blockAll", facing: "away" },
				objectives: [o.backstab(1)],
				outro:
					"Getting behind somebody is a movement problem. That is what the dash is for.",
			},
			{
				id: `${hero}-massive`,
				title: "The Massive Strike",
				brief:
					"Hold attack. After a second and a half the sword flashes — that is the Massive, armed and carried. Release it on the ground and it slams, blasting in front *and behind* the slam point: turn away from a guard and the blast stuns through it.",
				stage: idle,
				objectives: [o.armMassive(1), o.blast(1)],
				outro:
					"Charging roots your walk, but never your dash or your double jump. Delivery is the strategy.",
			},
			{
				id: `${hero}-plunge`,
				title: "The plunge bomb",
				brief:
					"Release the same charge in the air and it becomes a dive: straight down at speed, blasting bigger the further you fell. The dive itself is a weapon — it catches airborne enemies and carries them into the landing — and it cannot be anti-aired.",
				stage: idle,
				objectives: [o.plunge(1), o.bomb(1)],
				outro:
					"It plants you in the ground afterwards. Only a melee hit digs you back out.",
			},
		],
	};
}

// ---------------------------------------------------------------------------
// The last chapter — a real fight
// ---------------------------------------------------------------------------

/**
 * The graduation: everything at once, against a dummy that hits back.
 *
 * The player stays invincible on purpose. The lesson being tested is "can you
 * put a hundred points of damage on something that is trying to interrupt
 * you", and a death would answer a different question badly — this is the last
 * five minutes of a tutorial, not a difficulty check.
 */
export function graduationChapter(hero: HeroId): Chapter {
	const name = HEROES[hero].name;
	return {
		id: `${hero}-graduation`,
		title: "Graduation",
		subtitle: "Everything at once, against something that fights back",
		kind: "course",
		hero,
		lessons: [
			{
				id: `${hero}-graduation-fight`,
				title: "Put it down",
				brief: `No more drills. This dummy counter-attacks — it swings back the moment your move goes active — and it can be killed. Take it to zero with anything ${name} carries.`,
				stage: {
					...SAFE,
					dummyInvincible: false,
					dummyHp: 100,
					behaviour: "counterAttack",
					timing: { delayMs: 140, periodMs: 900 },
				},
				objectives: [o.knockout(1)],
				outro: "That is the game. The rest is other people.",
			},
		],
	};
}

/**
 * The gun lesson, which is the same drill for every hero and a different
 * sentence for each: switch stance, land three, and let the reload happen.
 *
 * The dummy paces rather than standing still — a stationary target teaches
 * "the gun fires", and a moving one teaches leading it.
 */
export function gunLesson(
	hero: HeroId,
	words: { title: string; brief: string; outro: string },
): Lesson {
	return {
		id: `${hero}-gun`,
		title: words.title,
		brief: words.brief,
		stage: { ...SAFE, behaviour: "walk" },
		// Fire first, then land: the two are different lessons. The first is
		// "the trigger is the same button as the sword", the second is leading a
		// target that is walking. The reload comes free once the magazine is out.
		objectives: [o.shoot(5), o.hitShots(3), o.reload(1)],
		outro: words.outro,
	};
}

/** The stage every "use the thing on a target" lesson wants: a pacing dummy. */
export const PACING_DUMMY = { ...SAFE, behaviour: "walk" } as const;

/** The stage for a drill that needs the dummy to stand still and take it. */
export const IDLE_DUMMY = idle;
