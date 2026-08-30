/**
 * Lia's course: the reference kit.
 *
 * Sword and rifle, a guard that punishes, and the black hole. Everything a
 * second hero is measured against is taught here first, which is why Lia's
 * arsenal chapter is the wordiest — a player who understands the grenade's arc
 * and the hole's two radii understands the shape of every ultimate that comes
 * after.
 */

import * as o from "../objectives.js";
import type { CampaignModule } from "../types.js";
import {
	basicsChapter,
	graduationChapter,
	gunLesson,
	IDLE_DUMMY,
	PACING_DUMMY,
	swordChapter,
} from "./common.js";

export const LIA_COURSE: CampaignModule = {
	id: "tutorial-lia",
	title: "Lia — the duelist",
	subtitle: "Sword, rifle, HE grenade and the black hole",
	chapters: [
		basicsChapter("lia"),
		swordChapter("lia"),
		{
			id: "lia-arsenal",
			title: "The arsenal",
			subtitle: "The rifle, the grenade, and the hole that eats a room",
			kind: "course",
			hero: "lia",
			lessons: [
				gunLesson("lia", {
					title: "The rifle",
					brief:
						"One clean shot per press, ten damage, no falloff at any range. Its character is the pause: a small magazine and the fastest reload in the game. Ammo is finite per life — when the reserve is gone the fight goes back to the sword.",
					outro:
						"The magazine reloads whole, or not at all. Firing mid-reload throws the load away and takes the shot.",
				}),
				{
					id: "lia-grenade",
					title: "The HE grenade",
					brief:
						"Two throws per life. It bounces, then detonates: full damage at the point of the blast, nothing at all at the edge. It is a positioning weapon, not a delete button — and a wall is a legitimate thing to throw it at.",
					stage: PACING_DUMMY,
					objectives: [o.useItem(1), o.explode(1)],
					outro: "Learn the bounces. They are the difference between the two.",
				},
				{
					id: "lia-ultimate",
					title: "The black hole",
					brief:
						"Hold the ultimate button to raise a special aim — the grenade's own arc, traced to where it will land — and release to throw. The room freezes for a beat, then a singularity opens: an inner horizon that catches and stuns, an outer reach that only tugs.",
					stage: IDLE_DUMMY,
					objectives: [o.castUltimate(1), o.dealDamage(20)],
					outro:
						"You are immune to your own hole. A guard facing the throw catches the grenade like a bullet — so is a death while you are still holding it.",
				},
			],
		},
		graduationChapter("lia"),
	],
};
