/**
 * Jeffs' course: the executioner.
 *
 * The same sword as Lia — so the sword chapter is shared verbatim — and a
 * completely different second half. The shotgun is a finisher rather than a
 * range answer, the smoke changes what the enemy is *allowed to know* rather
 * than their health, and the blossom is a circle you stand in.
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

export const JEFFS_COURSE: CampaignModule = {
	id: "tutorial-jeffs",
	title: "Jeffs — the executioner",
	subtitle: "Sword, shotgun, smoke and the Death Blossom",
	chapters: [
		basicsChapter("jeffs"),
		swordChapter("jeffs"),
		{
			id: "jeffs-arsenal",
			title: "The arsenal",
			subtitle: "Point blank, a lie, and a storm",
			kind: "course",
			hero: "jeffs",
			lessons: [
				gunLesson("jeffs", {
					title: "The shotgun",
					brief:
						"A fan of pellets, and almost all of the damage is in the first arm's length. Past that the cone widens and every pellet falls off — by a couple of body-lengths it is a warning shot. This is a finisher, not a range answer.",
					outro:
						"Five shells and a slow rack. Pull it on something already reeling, then put it away.",
				}),
				{
					id: "jeffs-smoke",
					title: "The smoke",
					brief:
						"Two per life, and it does no damage at all. It blocks nothing — no bullets, no bodies. What it takes away is *information*: inside the cloud the enemy reads nothing, while your own side still sees ghosts through it.",
					stage: PACING_DUMMY,
					objectives: [o.useItem(1), o.dash(1)],
					outro:
						"Throw it, then be somewhere else. A cloud is only a lie if you move inside it.",
				},
				{
					id: "jeffs-ultimate",
					title: "The Death Blossom",
					brief:
						"Not a throw — a storm you stand in. After the freeze, everything around you takes gunfire for two seconds while you walk, slowly, wherever you want the circle to be. Cast in the air and you hang there for the whole channel.",
					stage: IDLE_DUMMY,
					objectives: [o.castUltimate(1), o.dealDamage(30)],
					outro:
						"The counterplay is distance — and a knockdown, which ends the storm on the spot.",
				},
			],
		},
		graduationChapter("jeffs"),
	],
};
