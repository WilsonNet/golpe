export interface AIConfig {
	skillLevel: number;
	reactionTime: number;
	accuracy: number;
	aggressiveness: number;
	dodgeChance: number;
}

/**
 * A randomised bot personality, so a solo match is not the same fight twice.
 *
 * One implementation shared by the server and a local client's AI-vs-AI mode:
 * the two used to roll their own copies of the same five ranges, and a tune
 * that moved one but not the other made online and offline bots play
 * differently.
 *
 * Each roll is `min + random * span`. Skill skews the dice rather than being a
 * fixed draw, so the distribution leans on the weaker side on purpose.
 */
const SKILL_MIN = 4;
const SKILL_SPAN = 4;
const REACTION_MIN_MS = 150;
const REACTION_SPAN_MS = 250;
const ACCURACY_MIN = 0.45;
const ACCURACY_SPAN = 0.4;
const AGGRESSION_MIN = 0.35;
const AGGRESSION_SPAN = 0.45;
const DODGE_MIN = 0.2;
const DODGE_SPAN = 0.4;
export function randomBotConfig(): AIConfig {
	return {
		skillLevel: SKILL_MIN + Math.floor(Math.random() * SKILL_SPAN),
		reactionTime:
			REACTION_MIN_MS + Math.floor(Math.random() * REACTION_SPAN_MS),
		accuracy: ACCURACY_MIN + Math.random() * ACCURACY_SPAN,
		aggressiveness: AGGRESSION_MIN + Math.random() * AGGRESSION_SPAN,
		dodgeChance: DODGE_MIN + Math.random() * DODGE_SPAN,
	};
}
