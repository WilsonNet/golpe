/**
 * The ultimate cinematic's content: one card per hero.
 *
 * The freeze card used to be a black-hole card with the caster's name pasted
 * on it, which was honest while Lia was the only hero and wrong the moment
 * there were four. A card that says "Dragon Thrust" over a collapsing star is
 * a card about somebody else's ultimate — the one thing the freeze exists to
 * announce is *which* threat just landed.
 *
 * So the content lives here, keyed by hero, and the stylesheet keys its palette
 * and motif off the same id (`ultimateStyles.ts`). The hero select reads the
 * names from here too, so a card and the move list can never disagree about
 * what an ultimate is called.
 *
 * **Presentation only.** Nothing in this file is read by the simulation, the
 * server or the wire. `specs/ultimate.md` is the behaviour; this is the voice.
 *
 * The card reads like a fighting-game super: the flavor line first, then the
 * name in the biggest type on screen. Elongated vowels are deliberate — the
 * name is shouted, not labelled.
 */

import type { HeroId } from "../game/simulation/Heroes";

/** The shape drawn behind the card. One motif per hero, drawn in CSS. */
export type UltimateMotif = "rings" | "streaks" | "spinner" | "wound";

export interface UltimateCard {
	/** The ability's plain name, for menus and lists. */
	name: string;
	/** The same name shouted on the freeze card — elongation is deliberate. */
	shout: string;
	/** Who the caster is, in two words. */
	role: string;
	/** The line above the name: what is about to happen, in their voice. */
	flavor: string;
	motif: UltimateMotif;
}

export const ULTIMATE_CARDS: Record<HeroId, UltimateCard> = {
	// The duelist: dry, precise, and entirely unimpressed by your footwork.
	lia: {
		name: "Black Hole",
		shout: "Black Hooooole!",
		role: "The Duelist",
		flavor: "Absorb everything!",
		motif: "rings",
	},
	// The storm: no guard, no brakes, and no interest in a polite approach.
	anands: {
		name: "Dragon Thrust",
		shout: "Dragoooon Thrust!",
		role: "The Storm",
		flavor: "Brace for the storm!",
		motif: "streaks",
	},
	// The executioner: six pellets, one smoke, and no witnesses.
	jeffs: {
		name: "Death Blossom",
		shout: "Death Blossom!",
		role: "The Executioner",
		flavor: "Six pellets, no witnesses!",
		motif: "spinner",
	},
	// The bloodthirsty: every step you take is the ability working as intended.
	ibiriki: {
		name: "Rupture",
		shout: "Rupture!",
		role: "The Bloodthirsty",
		flavor: "Keep moving. I dare you!",
		motif: "wound",
	},
};

/**
 * How many `<i>` elements a motif needs. The shapes are CSS; only the count
 * has to be known to the component, because JSX cannot invent elements from a
 * stylesheet.
 */
export const MOTIF_CHILDREN: Record<UltimateMotif, number> = {
	rings: 4, // three rings and the core
	streaks: 3, // three dash streaks
	spinner: 6, // six ellipse petals, one per shotgun pellet
	wound: 5, // five blood drips
};
