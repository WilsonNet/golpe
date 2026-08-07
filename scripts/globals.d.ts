/**
 * The window contract the probes drive.
 *
 * The game's own debug hooks (`__gameState`, `__physicsDiagnostic`, ...) are a
 * real contract declared in `src/types/global.d.ts`; importing that module here
 * activates its `declare global`, so `page.evaluate(() => window.__gameState())`
 * typechecks against the actual snapshot shapes and a renamed hook breaks the
 * probe build instead of the measurement.
 *
 * The hooks declared below are the ones the probes themselves inject — a fake
 * frame loop and a software gamepad that the *page* consumes, so they belong to
 * the harness, not the game.
 */
import "../src/types/global";

/** The fake gamepad pad-probe installs before any page script runs. */
export interface PadStubApi {
	press: (button: number) => void;
	release: (button: number) => void;
	clear: () => void;
	axis: (axis: number, value: number) => void;
	axes: (values: number[]) => void;
}

declare global {
	interface Window {
		/** Installed by dash-probe: true once the fake frame loop is live. */
		__fakeFrameInstalled?: boolean;
		/** Installed by dash-probe: advance the fake clock and run one frame. */
		__frame?: (dtMs: number) => void;
		/** Installed by pad-probe: the software gamepad the tests drive. */
		__pad?: PadStubApi;
	}
}
