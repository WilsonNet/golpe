/**
 * The campaign layer's front door.
 *
 * Everything outside this folder — `Match`, the overlay, the menu, the probe —
 * imports from here and never from a content file, so the content can be
 * reorganised without a single call site changing. Named exports only: the
 * server does not reach through this module today, but the rule that made
 * `simulation/Physics.ts` explicit applies the moment it does.
 */

export { tutorialFor } from "./content/index.js";
export { progressOf } from "./progress.js";
export {
	type TutorialApi,
	TutorialDirector,
	type TutorialObjectiveView,
	type TutorialState,
} from "./TutorialDirector.js";
export { lessonsOf } from "./types.js";
