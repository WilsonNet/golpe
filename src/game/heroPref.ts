/**
 * The hero preference: who a player defaults to, remembered between matches.
 *
 * The same pattern as `playerName.ts` — a namespaced localStorage key read
 * defensively, because a corrupt or missing value must never cost a boot. The
 * menu writes it when a hero is picked, and the launch URL carries the choice
 * into the match; the in-match Esc menu writes it too, so the preference and
 * the fighter stay the same person's.
 */

import { DEFAULT_HERO, type HeroId, isHeroId } from "./simulation/Heroes";

const KEY = "golpe.hero";

export function readStoredHero(): HeroId {
	try {
		const raw = localStorage.getItem(KEY);
		return isHeroId(raw) ? raw : DEFAULT_HERO;
	} catch {
		return DEFAULT_HERO;
	}
}

export function storeHero(hero: HeroId) {
	try {
		localStorage.setItem(KEY, hero);
	} catch {
		// A blocked storage is not a reason to fail a match.
	}
}
