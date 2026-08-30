/**
 * The campaign registry.
 *
 * One place that says what content exists. The tutorial is three modules —
 * one per hero — and a future campaign act is another entry in `MODULES` with
 * `kind: "mission"` chapters inside it. Nothing else in the codebase needs to
 * change to add one: the director runs whatever module it is handed, the
 * overlay renders whatever the director reports, and the menu counts progress
 * off `lessonsOf`.
 */

import type { HeroId } from "../../simulation/Heroes.js";
import type { CampaignModule } from "../types.js";
import { ANANDS_COURSE } from "./anands.js";
import { JEFFS_COURSE } from "./jeffs.js";
import { LIA_COURSE } from "./lia.js";

/** Every module that exists, in the order a player would meet them. */
export const MODULES: CampaignModule[] = [
	LIA_COURSE,
	ANANDS_COURSE,
	JEFFS_COURSE,
];

/** The tutorial course for a hero. Every hero has exactly one. */
const TUTORIALS: Record<HeroId, CampaignModule> = {
	lia: LIA_COURSE,
	anands: ANANDS_COURSE,
	jeffs: JEFFS_COURSE,
};

export function tutorialFor(hero: HeroId): CampaignModule {
	return TUTORIALS[hero];
}
