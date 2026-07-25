/**
 * The game → React bridge.
 *
 * Deliberately dependency-free. It used to be Phaser's emitter, which meant the
 * React layer transitively depended on the rendering engine for nothing more
 * than a callback list — and every renderer swap dragged the UI along with it.
 */

type Handler = (...args: never[]) => void;

class Emitter {
	private readonly handlers = new Map<string, Set<Handler>>();

	on(event: string, handler: Handler): () => void {
		let set = this.handlers.get(event);
		if (!set) {
			set = new Set();
			this.handlers.set(event, set);
		}
		set.add(handler);
		// Returning the unsubscriber makes the React cleanup path a one-liner, and
		// removes exactly this listener rather than every listener for the event.
		return () => {
			set.delete(handler);
		};
	}

	off(event: string, handler: Handler) {
		this.handlers.get(event)?.delete(handler);
	}

	removeListener(event: string, handler?: Handler) {
		if (handler) this.off(event, handler);
		else this.handlers.delete(event);
	}

	emit(event: string, ...args: unknown[]) {
		const set = this.handlers.get(event);
		if (!set) return;
		// Copy before iterating: a handler that unsubscribes itself would otherwise
		// mutate the set mid-iteration.
		for (const h of [...set]) (h as (...a: unknown[]) => void)(...args);
	}
}

export const EventBus = new Emitter();
