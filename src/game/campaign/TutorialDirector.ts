/**
 * The tutorial's runtime: the thing that turns a `CampaignModule` into a room.
 *
 * It is a **director, not a game mode.** The match underneath is an ordinary
 * training room — online, predicted, reconciled, with a server-side dummy for
 * an opponent — and everything this class does is expressible as things a
 * player could do themselves from the practice menu: change the dummy's
 * behaviour, reset the room, and watch. That is deliberate. A tutorial with its
 * own simulation would teach a game nobody else is playing, and would be the
 * first thing to rot the day the real one changed.
 *
 * Its three jobs:
 *
 *   1. **Stage** — apply the current lesson's `TrainingConfigPatch` and reset,
 *      so the enemy in front of the player is doing the thing the lesson is
 *      about.
 *   2. **Count** — feed the `LessonTracker` the local body every frame and the
 *      server's outcomes as they arrive.
 *   3. **Report** — emit a `TutorialState` the React overlay renders, and
 *      install `window.__tutorial` so a probe can walk the whole course
 *      without a human.
 *
 * The one thing it must never do is decide an outcome. A hit is the server's,
 * a dash is the simulation's; the director only ever asks.
 */

import { EventBus } from "../EventBus.js";
import { HUD_EVENTS, type HudState } from "../hud.js";
import type { HeroId } from "../simulation/Heroes.js";
import type { PlayerPosition } from "../simulation/Physics.js";
import type {
	TrainingCombatEvent,
	TrainingRoom,
} from "../training/TrainingRoom.js";
import {
	defaultTrainingConfig,
	mergeTrainingConfig,
	type TrainingStateMsg,
} from "../training/types.js";
import { markLessonComplete } from "./progress.js";
import { LessonTracker } from "./signals.js";
import type {
	CampaignModule,
	Chapter,
	Lesson,
	LessonCounters,
	Objective,
} from "./types.js";

/** How long the "lesson cleared" celebration holds before the next one arms. */
const CLEAR_HOLD_MS = 2000;
/** How long a chapter card sits before its first lesson arms. */
const CHAPTER_HOLD_MS = 2600;
/**
 * A grace period after a lesson arms, before its objectives can complete.
 *
 * The reset that opens a lesson is a legitimate discontinuity — bodies snap to
 * spawn, the dummy's script restarts — and a counter that started reading
 * during it would credit the player for the room settling. The training room
 * takes the same precaution for the same reason.
 */
const ARM_SETTLE_MS = 250;

/** Where the course is. */
export type TutorialPhase =
	| "connecting"
	| "chapter"
	| "arming"
	| "playing"
	| "cleared"
	| "finished";

export interface TutorialObjectiveView {
	id: string;
	text: string;
	keys: string[];
	hint: string | null;
	count: number;
	target: number;
	done: boolean;
}

/** Everything the overlay draws, and everything the probe reads. */
export interface TutorialState {
	moduleId: string;
	moduleTitle: string;
	moduleSubtitle: string;
	hero: HeroId;
	phase: TutorialPhase;
	/** Which chapter, and how many there are. */
	chapterIndex: number;
	chapterCount: number;
	chapterTitle: string;
	chapterSubtitle: string;
	/** Which lesson, counted across the whole module. */
	lessonIndex: number;
	lessonCount: number;
	lessonId: string;
	title: string;
	brief: string;
	/** Present only while the lesson is cleared. */
	outro: string | null;
	objectives: TutorialObjectiveView[];
	/** Whole lessons finished in this run, over the module's total. 0..1. */
	moduleProgress: number;
	/** True once every lesson in the module has been cleared. */
	complete: boolean;
}

/** The probe surface. Everything the overlay's buttons do, callable. */
export interface TutorialApi {
	state: () => TutorialState;
	/** Move on. From a cleared lesson or a chapter card, this is "continue". */
	next: () => void;
	/** Give up on this lesson and move on. Nothing is marked complete. */
	skip: () => void;
	/** Re-stage the current lesson from scratch. */
	retry: () => void;
	/** Jump to a lesson by its index across the module. */
	goto: (lessonIndex: number) => void;
	/** Resolve once the room is seated and the first lesson is playing. */
	ready: (timeoutMs?: number) => Promise<boolean>;
}

export interface TutorialDirectorDeps {
	training: TrainingRoom;
	module: CampaignModule;
	hero: HeroId;
	/** The local fighter's live simulation state — re-read, never captured. */
	localBody: () => PlayerPosition;
}

/** A lesson, flattened with the chapter it came from. */
interface Step {
	lesson: Lesson;
	chapter: Chapter;
	chapterIndex: number;
}

export class TutorialDirector {
	private readonly steps: Step[] = [];
	private readonly tracker = new LessonTracker();
	private readonly unsubscribers: (() => void)[] = [];

	private index = 0;
	private phase: TutorialPhase = "connecting";
	/** ms spent in the current non-playing phase, for the holds. */
	private holdMs = 0;
	/** ms since the lesson armed — the settle window. */
	private armedMs = 0;
	/** Bumped on every arm, so a late async stage cannot clobber a newer one. */
	private token = 0;
	/** Lessons cleared in this run — the progress bar's numerator. */
	private readonly cleared = new Set<string>();
	private counters: LessonCounters = this.tracker.snapshot();
	/** The last state pushed to the overlay, so it is emitted on change only. */
	private signature = "";

	constructor(private readonly deps: TutorialDirectorDeps) {
		for (const [chapterIndex, chapter] of deps.module.chapters.entries()) {
			for (const lesson of chapter.lessons)
				this.steps.push({ lesson, chapter, chapterIndex });
		}
		this.subscribe();
		this.installApi();
		void this.begin();
	}

	// =========================================================
	//  Wiring
	// =========================================================

	private subscribe() {
		this.unsubscribers.push(
			this.deps.training.onCombat((event) => this.onCombat(event)),
			EventBus.on("training-state", ((state: TrainingStateMsg) => {
				this.tracker.noteStats(state.stats.player);
				this.tracker.noteDummyHp(state.stats.dummy.hp);
			}) as never),
			// The item's charge count is the only honest signal that a throw
			// happened: the press edge is spent server-side, and a client that
			// counted its own button would count one the server refused.
			//
			// Read off the HUD rather than the `item-charge` event, which fires
			// *on change* — so the first value a lesson ever saw was the count
			// after the throw, and the tracker took it as the baseline. The first
			// item use of every lesson was silently free.
			EventBus.on(HUD_EVENTS.state, ((hud: HudState) => {
				this.tracker.noteItemCharges(hud.itemCharges);
			}) as never),
			EventBus.on("ultimate-cast", ((cast: { mine: boolean }) => {
				if (cast.mine) this.tracker.noteUltimateCast();
			}) as never),
		);
	}

	private onCombat(event: TrainingCombatEvent) {
		switch (event.kind) {
			case "melee":
				this.tracker.noteMelee(event.event, event.byLocal);
				break;
			case "deny":
				this.tracker.noteDeny();
				break;
			case "explosion":
				this.tracker.noteExplosion();
				break;
			case "rooted":
				this.tracker.noteRooted();
				break;
		}
	}

	private installApi() {
		const api: TutorialApi = {
			state: () => this.state(),
			next: () => this.next(),
			skip: () => this.skip(),
			retry: () => this.retry(),
			goto: (i) => this.goto(i),
			ready: (timeoutMs) => this.ready(timeoutMs),
		};
		window.__tutorial = api;
		// The overlay's buttons are clients of this API, exactly as the training
		// panel is a client of `window.__training`: one way in, so a probe and a
		// player exercise the same path.
		this.unsubscribers.push(
			EventBus.on("tutorial-command", ((cmd: {
				action: "next" | "skip" | "retry" | "goto";
				lessonIndex?: number;
			}) => {
				if (cmd.action === "next") this.next();
				else if (cmd.action === "skip") this.skip();
				else if (cmd.action === "retry") this.retry();
				else if (cmd.action === "goto") this.goto(cmd.lessonIndex ?? 0);
			}) as never),
		);
	}

	private async begin() {
		this.emit(true);
		// The room has to exist before a stage can be applied: the first config
		// message is what teaches the server this client is listening.
		await this.deps.training.ready();
		await this.arm(0, true);
	}

	async ready(timeoutMs = 20000): Promise<boolean> {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			if (this.phase === "playing" || this.phase === "finished") return true;
			await new Promise((r) => setTimeout(r, 100));
		}
		return false;
	}

	// =========================================================
	//  The course
	// =========================================================

	private get step(): Step | undefined {
		return this.steps[this.index];
	}

	/**
	 * Stage a lesson: config first, then reset.
	 *
	 * The order is the training room's, and for its reason — a lesson's spawn
	 * positions are part of its configuration, and resetting first would place
	 * the fighters using the previous lesson's. The whole patch is merged onto
	 * the *defaults* rather than onto whatever the last lesson left behind, so a
	 * lesson is a complete description of a room.
	 */
	private async arm(index: number, showChapter: boolean) {
		const step = this.steps[index];
		if (!step) {
			this.index = this.steps.length;
			this.phase = "finished";
			this.holdMs = 0;
			this.emit(true);
			return;
		}

		const token = ++this.token;
		this.index = index;
		this.phase = "arming";
		this.holdMs = 0;
		this.emit(true);

		await this.deps.training.set(
			mergeTrainingConfig(defaultTrainingConfig(), step.lesson.stage),
		);
		await this.deps.training.reset();
		if (token !== this.token) return;

		this.tracker.reset();
		// Seed the server's tallies *now*, from the room the reset just zeroed.
		//
		// `training-state` is sent on change, and a lesson where nothing changes
		// until the first big hit would hand the tracker that hit as its
		// baseline — the dragon thrust's 30 damage landed, was taken as the
		// opening figure, and "deal 20 damage" read 0/20 forever. A delta needs
		// its zero taken deliberately, not at the first thing that happens.
		const opening = this.deps.training.state();
		this.tracker.noteStats(opening.stats.player);
		this.tracker.noteDummyHp(opening.stats.dummy.hp);
		this.counters = this.tracker.snapshot();
		this.armedMs = 0;
		// The chapter card comes *after* the stage is set, so the room behind it
		// is already the room the first lesson wants.
		this.phase = showChapter ? "chapter" : "playing";
		this.holdMs = 0;
		this.emit(true);
	}

	private next() {
		if (this.phase === "chapter") {
			this.phase = "playing";
			this.holdMs = 0;
			this.armedMs = 0;
			this.emit(true);
			return;
		}
		if (this.phase === "finished") return;
		this.advance();
	}

	private skip() {
		if (this.phase === "finished") return;
		this.advance();
	}

	private retry() {
		void this.arm(this.index, false);
	}

	private goto(lessonIndex: number) {
		const clamped = Math.max(0, Math.min(lessonIndex, this.steps.length - 1));
		const next = this.steps[clamped];
		const here = this.step;
		void this.arm(
			clamped,
			next !== undefined && next.chapterIndex !== here?.chapterIndex,
		);
	}

	/** Move to the next lesson, showing a chapter card when the chapter turns. */
	private advance() {
		const here = this.step;
		const next = this.steps[this.index + 1];
		if (!next) {
			void this.arm(this.steps.length, false);
			return;
		}
		void this.arm(this.index + 1, next.chapterIndex !== here?.chapterIndex);
	}

	// =========================================================
	//  Per-frame
	// =========================================================

	update(dtMs: number) {
		if (this.phase === "chapter") {
			this.holdMs += dtMs;
			if (this.holdMs >= CHAPTER_HOLD_MS) {
				this.phase = "playing";
				this.armedMs = 0;
				this.holdMs = 0;
			}
			this.emit();
			return;
		}

		if (this.phase === "cleared") {
			this.holdMs += dtMs;
			if (this.holdMs >= CLEAR_HOLD_MS) this.advance();
			this.emit();
			return;
		}

		if (this.phase !== "playing") {
			this.emit();
			return;
		}

		this.armedMs += dtMs;
		this.tracker.observe(this.deps.localBody(), dtMs);
		this.counters = this.tracker.snapshot();

		const lesson = this.step?.lesson;
		if (lesson && this.armedMs >= ARM_SETTLE_MS && this.done(lesson)) {
			this.cleared.add(lesson.id);
			markLessonComplete(lesson.id);
			this.phase = "cleared";
			this.holdMs = 0;
			this.emit(true);
			return;
		}
		this.emit();
	}

	private done(lesson: Lesson): boolean {
		return lesson.objectives.every(
			(objective) => objective.count(this.counters) >= objective.target,
		);
	}

	// =========================================================
	//  Reporting
	// =========================================================

	private view(objective: Objective): TutorialObjectiveView {
		const count = Math.min(objective.count(this.counters), objective.target);
		return {
			id: objective.id,
			text: objective.text,
			keys: objective.keys ?? [],
			hint: objective.hint ?? null,
			count,
			target: objective.target,
			done: count >= objective.target,
		};
	}

	state(): TutorialState {
		const step = this.step;
		const module = this.deps.module;
		const objectives = step?.lesson.objectives.map((o) => this.view(o)) ?? [];
		return {
			moduleId: module.id,
			moduleTitle: module.title,
			moduleSubtitle: module.subtitle,
			hero: this.deps.hero,
			phase: this.phase,
			chapterIndex: step?.chapterIndex ?? module.chapters.length,
			chapterCount: module.chapters.length,
			chapterTitle: step?.chapter.title ?? "",
			chapterSubtitle: step?.chapter.subtitle ?? "",
			lessonIndex: Math.min(this.index, this.steps.length),
			lessonCount: this.steps.length,
			lessonId: step?.lesson.id ?? "",
			title: step?.lesson.title ?? "",
			brief: step?.lesson.brief ?? "",
			outro: this.phase === "cleared" ? (step?.lesson.outro ?? null) : null,
			objectives,
			moduleProgress:
				this.steps.length === 0 ? 1 : this.cleared.size / this.steps.length,
			complete: this.phase === "finished",
		};
	}

	/**
	 * Push the state to the overlay — on change, never per frame.
	 *
	 * The signature is what the overlay can actually see: the phase, which
	 * lesson, and each objective's progress. A per-frame emit would re-render
	 * the React tree sixty times a second to redraw nothing, which is the same
	 * bargain the HUD makes at snapshot cadence.
	 */
	private emit(force = false) {
		const state = this.state();
		const signature = [
			state.phase,
			state.lessonId,
			state.objectives.map((o) => `${o.id}:${o.count}`).join(","),
			state.complete,
		].join("|");
		if (!force && signature === this.signature) return;
		this.signature = signature;
		EventBus.emit("tutorial-state", state);
	}

	destroy() {
		for (const off of this.unsubscribers) off();
		this.unsubscribers.length = 0;
		// `delete` rather than assigning undefined: under
		// `exactOptionalPropertyTypes` an optional property and one holding
		// `undefined` are different types, and only removal actually clears it.
		delete window.__tutorial;
	}
}
