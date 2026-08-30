/**
 * Anands' course: the dagger.
 *
 * The chapter that cannot be shared. Anands has **no guard** — Shift is the
 * thrust, a committed lunge — so every lesson the sword spends on blocking and
 * the butterfly is spent here on interrupting instead. Teaching the dagger
 * against a sword's drill would teach the wrong reflex, which is exactly the
 * reason the training room lets the dummy change hero.
 */

import * as o from "../objectives.js";
import type { CampaignModule } from "../types.js";
import {
	basicsChapter,
	graduationChapter,
	gunLesson,
	IDLE_DUMMY,
	PACING_DUMMY,
} from "./common.js";

const SAFE = {
	dummyInvincible: true,
	playerInvincible: true,
	disableRoundReset: true,
} as const;

export const ANANDS_COURSE: CampaignModule = {
	id: "tutorial-anands",
	title: "Anands — the dagger storm",
	subtitle: "Stab, thrust, shoryuken, and a dragon to ride",
	chapters: [
		basicsChapter("anands"),
		{
			id: "anands-dagger",
			title: "The dagger",
			subtitle: "No guard, no waiting — the fastest weapon in the game",
			kind: "course",
			hero: "anands",
			lessons: [
				{
					id: "anands-stab",
					title: "Faster than a sword",
					brief:
						"The stab is half the sword's wind-up and less than half its damage. That trade is the whole hero: a dagger in range lives inside the gap between someone else's swings.",
					stage: IDLE_DUMMY,
					objectives: [o.land("stab", "a stab", 4)],
					outro: "Trading with a sword still loses. Do not trade — interrupt.",
				},
				{
					id: "anands-thrust",
					title: "The thrust",
					brief:
						"You have no block. Shift is a lunge instead: it carries your body forward and knocks down everyone in its path, and once committed it cannot be blocked. This dummy is holding its guard — go through it.",
					stage: { ...SAFE, behaviour: "blockAll" },
					objectives: [o.land("thrust", "a thrust", 1), o.knockdown(1)],
					outro:
						"The wind-up is the tell, and the line is flat — a jump clears it entirely. That is the counterplay you will be on the wrong end of.",
				},
				{
					id: "anands-shoryuken",
					title: "The shoryuken",
					brief:
						"A rising stab with a wide reach that knocks down. It only fires while your second jump is still in hand, so it can never be a third jump — and unlike a sword's uppercut it *is* blockable. The dummy is jumping; catch it.",
					stage: { ...SAFE, behaviour: "jump", timing: { periodMs: 1300 } },
					// Throw it before landing it: the shoryuken has a jump budget
					// gate, and finding out *when* it refuses to come out is half of
					// what the drill teaches.
					objectives: [
						o.perform("shoryuken", "a shoryuken", 2),
						o.land("shoryuken", "a shoryuken", 1),
					],
					outro: "Anti-air, not a mixup. A read guard stops it cold.",
				},
				{
					id: "anands-pressure",
					title: "Living in the gap",
					brief:
						"This dummy counter-attacks — it swings back the moment your move goes active. With no guard, your defence is that its swing never starts: stab, cancel into the thrust, keep it reeling.",
					stage: {
						...SAFE,
						behaviour: "counterAttack",
						timing: { delayMs: 140, periodMs: 1000 },
					},
					objectives: [o.land("stab", "a stab", 5), o.dealDamage(30)],
					outro:
						"Pressure is not damage. It is the other fighter never getting a turn.",
				},
			],
		},
		{
			id: "anands-arsenal",
			title: "The arsenal",
			subtitle: "The stream, the mine, and the ride",
			kind: "course",
			hero: "anands",
			lessons: [
				gunLesson("anands", {
					title: "The machine gun",
					brief:
						"Four shots where a rifle fires one, each worth less, all of them faster. It is the lightest hero's stream — a whole magazine, racked whole. Ammo is finite per life.",
					outro:
						"A stream that misses is a magazine that is gone. Lead the walk.",
				}),
				{
					id: "anands-trap",
					title: "The trap",
					brief:
						"Three per life. It plants where it lands and arms itself. What it takes is not health — it is *feet*: a caught fighter is rooted, unable to walk, dash or jump, though they can still swing, guard and cast. It is single-use, and a jump clears the patch entirely.",
					stage: PACING_DUMMY,
					objectives: [o.useItem(1), o.root(1)],
					outro:
						"A root stops a dash, a tumble and a lunge dead — no momentum carries anyone out of it.",
				},
				{
					id: "anands-ultimate",
					title: "The dragon thrust",
					brief:
						"Not a throw — a ride. Hold to aim, release, and after the freeze you launch along that angle with gravity switched off, sweeping everything in the line until an obstacle stops you. No guard in the game stops it.",
					stage: IDLE_DUMMY,
					objectives: [o.castUltimate(1), o.dealDamage(20)],
					outro:
						"Even rooted you can cast it. It is the one ultimate a trap cannot take away.",
				},
			],
		},
		graduationChapter("anands"),
	],
};
