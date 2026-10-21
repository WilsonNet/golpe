/**
 * The arena's fit to the page, and the one reason it is JavaScript.
 *
 * The box is the largest 4:3 rectangle that fits the page, capped at the
 * stylesheet's `--arena-max-height`. The stylesheet already says that, and it
 * stays in charge of the first paint and of the on-screen deck's layouts.
 *
 * **Browser zoom is why this file exists.** Ctrl/Cmd +/- changes the viewport
 * in CSS pixels, so a box sized in `vw`/`dvh` re-fits at every zoom step — the
 * arena fills the window exactly as it did before, and the command reads as
 * broken. Pinning the box in CSS pixels makes zoom scale it like any other page
 * content: zoom out and the arena shrinks and letterboxes, zoom in and it grows
 * past the window, which becomes a scroll container (`#app.is-zoomed`).
 *
 * A zoom and a window resize both arrive as `resize`, so they are told apart by
 * the *physical* viewport — CSS size x `devicePixelRatio`. A zoom trades CSS
 * pixels for device pixels and leaves the physical size alone; a resize changes
 * it. A zoom is therefore left alone, and the pinned size survives it.
 */

/** The authored ratio, 800x600. The box is scaled from it, never distorted. */
const ARENA_RATIO = 4 / 3;

/** The viewport in device pixels. Constant across a page zoom. */
interface PhysicalViewport {
	w: number;
	h: number;
}

function physicalViewport(): PhysicalViewport {
	const dpr = window.devicePixelRatio || 1;
	return {
		w: Math.round(window.innerWidth * dpr),
		h: Math.round(window.innerHeight * dpr),
	};
}

/** How far a zoom may round and still be the same physical viewport. */
const ZOOM_ROUNDING_PX = 2;

/** The stylesheet's ceiling, so the number lives in exactly one place. */
function arenaMaxHeight(container: HTMLElement): number {
	const raw = getComputedStyle(container)
		.getPropertyValue("--arena-max-height")
		.trim();
	const px = Number.parseFloat(raw);
	return Number.isFinite(px) && px > 0 ? px : Number.POSITIVE_INFINITY;
}

/** Pin the box to the largest 4:3 rectangle that fits the page. */
function fitArenaBox(container: HTMLElement, page: HTMLElement): void {
	const maxHeight = arenaMaxHeight(container);
	const height = Math.min(
		page.clientHeight,
		page.clientWidth * (3 / 4),
		maxHeight,
	);
	// A hidden page measures zero; the stylesheet's answer is the safe fallback.
	if (height <= 0) return;
	container.style.height = `${height}px`;
	container.style.width = `${height * ARENA_RATIO}px`;
}

/** Hand sizing back to the stylesheet — the on-screen deck's layouts. */
function clearArenaBox(container: HTMLElement): void {
	container.style.removeProperty("width");
	container.style.removeProperty("height");
}

/**
 * Keep the arena fitted to the window while leaving browser zoom alone.
 *
 * Returns the teardown. Call once, against the element that owns the HUD box.
 */
export function keepArenaFitted(container: HTMLElement): () => void {
	const page = container.parentElement;
	if (!page) return () => {};

	let physical = physicalViewport();
	let pinned = false;
	let frame = 0;

	const pin = (next: PhysicalViewport) => {
		physical = next;
		pinned = true;
		// Clear the zoom state first: the scrollbar it may have grown would
		// shrink the width we are about to fit to.
		page.classList.remove("is-zoomed");
		fitArenaBox(container, page);
	};

	/**
	 * The deck owns its own layout: full width in portrait, the arena in the
	 * letterbox margin in landscape. Its presence is a DOM fact, which is also
	 * what the stylesheet's `:has()` rule keys off — kept in step here.
	 */
	const syncDeck = () => {
		if (page.querySelector(".gg-deck")) {
			clearArenaBox(container);
			page.classList.remove("is-zoomed");
			pinned = false;
			return;
		}
		// The stylesheet was sizing while the deck was up (or this is the first
		// paint): take over with a fit at the present size.
		if (!pinned) pin(physicalViewport());
	};

	const onResize = () => {
		cancelAnimationFrame(frame);
		// One frame for the browser's zoom metrics to land before they are read.
		frame = requestAnimationFrame(() => {
			if (page.querySelector(".gg-deck")) return;
			const next = physicalViewport();
			const unchanged =
				Math.abs(next.w - physical.w) <= ZOOM_ROUNDING_PX &&
				Math.abs(next.h - physical.h) <= ZOOM_ROUNDING_PX;
			if (pinned && unchanged) {
				// A zoom: the CSS viewport moved, the physical one did not. Keep the
				// pinned size — that is what makes the command do something visible.
				page.classList.add("is-zoomed");
				return;
			}
			pin(next);
		});
	};

	// The deck mounts and unmounts with the match and with its own setting, so it
	// appears after this effect and can leave again without a resize.
	const observer = new MutationObserver(syncDeck);
	observer.observe(page, { childList: true });

	syncDeck();
	window.addEventListener("resize", onResize);

	return () => {
		cancelAnimationFrame(frame);
		observer.disconnect();
		window.removeEventListener("resize", onResize);
	};
}
