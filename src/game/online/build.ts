/**
 * The build a client is running.
 *
 * Vite substitutes `__GOLPE_BUILD__` at build time from `GOLPE_BUILD`; the LAN
 * pack builder sets it to the commit it staged. A dev server, a unit test and a
 * page built without the variable all answer `"dev"`, which is honest: they are
 * not a released build.
 *
 * The server carries the same value in `/health`, `/rooms` and the join
 * handshake. The LAN gate compares both the build and `PROTOCOL_VERSION`, so a
 * stale pack cannot quietly predict into a different simulation.
 */
declare const __GOLPE_BUILD__: string | undefined;

export const BUILD_ID =
	typeof __GOLPE_BUILD__ === "string" && __GOLPE_BUILD__.length > 0
		? __GOLPE_BUILD__
		: "dev";
