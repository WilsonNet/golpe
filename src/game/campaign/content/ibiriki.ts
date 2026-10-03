/**
 * Ibiriki's course: the bloodthirsty.
 *
 * A sword like Lia's guard and uppercut, but heavier swings and a different
 * charge: the Sunder goes *through* a guard rather than around it. The second
 * half teaches what makes him a different game — axes you have to walk back
 * to, a passive that turns a bleeding room into a frenzy, and a curse that
 * makes the whole room stand still.
 */

import * as o from "../objectives.js";
import type { CampaignModule } from "../types.js";
import {
	basicsChapter,
	graduationChapter,
	IDLE_DUMMY,
	PACING_DUMMY,
	SAFE_STAGE,
} from "./common.js";

export const IBIRIKI_COURSE: CampaignModule = {
	id: "tutorial-ibiriki",
	title: "Ibiriki — the bloodthirsty",
	subtitle: "Viking sword, throwing axes, bloodlust and Rupture",
	chapters: [
		basicsChapter("ibiriki"),
		{
			id: "ibiriki-sword",
			title: "The viking sword",
			subtitle: "Heavy hews, the guard, and the Sunder",
			kind: "course",
			hero: "ibiriki",
			lessons: [
				{
					id: "ibiriki-hew",
					title: "The hew",
					brief:
						"Heavier than a katana in every way: slower to start, more damage, and a hit staggers instead of flinching. Attack again as each swing's hitbox closes and the hew chain runs — two cuts and an overhead chop that knocks down. Both feet on the floor.",
					stage: IDLE_DUMMY,
					objectives: [
						o.land("hew", "a hew", 2),
						o.land("hew3", "the finisher", 1),
					],
					outro:
						"Slow to start means the read matters. The stagger is how the next one lands.",
				},
				{
					id: "ibiriki-guard",
					title: "The guard",
					brief:
						"Hold block and face the swing. Every sword hit your guard stops breaks the attacker for a full second — and arms a free Sunder for you to spend.",
					stage: {
						...SAFE_STAGE,
						behaviour: "slash",
						timing: { periodMs: 1400 },
					},
					objectives: [o.block(1), o.parry(2)],
					outro:
						"A guard break is a free second, and the Sunder is what you spend it on.",
				},
				{
					id: "ibiriki-uppercut",
					title: "The uppercut",
					brief:
						"The same uppercut every sword carries: unblockable, short, and it launches the foe higher than a jump to come down on their back.",
					stage: { ...SAFE_STAGE, behaviour: "blockAll" },
					objectives: [o.land("uppercut", "an uppercut", 2)],
					outro: "Read, then throw — a whiff is the exchange.",
				},
				{
					id: "ibiriki-sunder",
					title: "Sunder",
					brief:
						"Hold attack: the sword goes over your head and blood-red motes pour into it. After a second it is armed — release and it comes down top to bottom. **A guard does not stop it**: the guard is crushed, a mini stun and a slice of the damage. This dummy turtles. Raise the charge out of its reach — your first press is a hew, and a hew into a guard breaks *you* — then walk the armed blade in and let go.",
					stage: { ...SAFE_STAGE, behaviour: "blockAll" },
					objectives: [o.crushGuard(2)],
					outro:
						"The raised sword is a tell. Against a guard it is a promise; against a quick blade it is a target.",
				},
			],
		},
		{
			id: "ibiriki-arsenal",
			title: "The hunt",
			subtitle: "Axes, bloodlust, and the curse",
			kind: "course",
			hero: "ibiriki",
			lessons: [
				{
					id: "ibiriki-axes",
					title: "Throwing axes",
					brief:
						"Switch to the axes, hold attack to wind up, release to throw. A tap is a short lob; a full charge flies flat and far wreathed in embers, for almost a whole bar. Five a life and no reload — every axe sticks where it lands until **you walk over it** and take it back.",
					stage: PACING_DUMMY,
					objectives: [o.shoot(3), o.hitShots(2), o.recoverAxes(2)],
					outro:
						"An axe on the floor is an axe you are not holding. Throw where you mean to walk.",
				},
				{
					id: "ibiriki-berserk",
					title: "Berserk",
					brief:
						"Ibiriki smells the weakest foe in the room: the lower their health, the faster he walks and swings. This dummy is already bleeding — below the line — so you are **berserk**: eyes burning, an axe in the off hand, and the attack button runs the frenzy. Sword, axe, both.",
					stage: { ...SAFE_STAGE, behaviour: "idle", dummyHp: 25 },
					objectives: [
						o.goBerserk(1),
						o.land("rend3", "the frenzy's X-cut", 2),
					],
					outro:
						"Berserk takes a quarter off every hit you take. The room's weakest fighter is your fuel.",
				},
				{
					id: "ibiriki-ultimate",
					title: "Rupture",
					brief:
						"Your ultimate is a curse on the whole room. After the freeze you stomp with both weapons drawn, and for six seconds every enemy bleeds for every step they take. This dummy will not stop walking.",
					stage: PACING_DUMMY,
					objectives: [o.castUltimate(1), o.dealDamage(20)],
					outro:
						"Standing still is the only defence — and a foe who stands still is a foe you can walk up to.",
				},
			],
		},
		graduationChapter("ibiriki"),
	],
};
