/**
 * A one-shot password handoff that never touches the address bar.
 *
 * The URL is the invitation, but the password is not meant to be a query
 * string by default — it would sit in history, be copied with the link, and
 * be readable over a shoulder. A store in `sessionStorage` carries the key
 * from the form that collected it to the next boot's `join` without ever
 * appearing in `?password=`. A manually typed `?password=` still works, so
 * old share links keep working — the URL is a fallback, this store is the
 * default path.
 */

const KEY = "golpe:pendingPassword";

export function setPendingPassword(password: string): void {
	try {
		sessionStorage.setItem(KEY, password);
	} catch {
		// Storage may be unavailable (private mode, quota) — the join will
		// just be attempted without a password and the server will answer
		// `room-locked` again, which is a safe fallback.
	}
}

export function consumePendingPassword(): string | null {
	try {
		const v = sessionStorage.getItem(KEY);
		if (v !== null) sessionStorage.removeItem(KEY);
		return v;
	} catch {
		return null;
	}
}
