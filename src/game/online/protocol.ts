/**
 * The contract a client and a game server must agree on before a fight.
 *
 * The wire is positional and the simulation is deterministic: two builds that
 * disagree about either do not "mostly work", they desync. The hosted game gets
 * away without a runtime check because Caddy serves the client and the game
 * image from the same commit. A LAN pack has no such guarantee — a guest can
 * carry a cached page, or join another host's room from a merged listing — so
 * the LAN handshake refuses a mismatch instead of predicting into a different
 * world.
 *
 * **Bump this whenever `wire.ts`, the message shapes in `types.ts`, or anything
 * the snapshot carries changes.** A build id alone is not enough: two builds can
 * be different without changing the wire, and two builds can share a protocol
 * without being safe to mix. The LAN gate checks both.
 */
export const PROTOCOL_VERSION = 1;

/**
 * Whether a remote side is the same world.
 *
 * Both identities are mandatory: a missing build id or protocol is an older or
 * non-conforming client, and the strict LAN gate refuses it rather than
 * treating "unknown" as "compatible". The hosted server does not call this.
 */
export function buildMatches(
	remoteBuild: unknown,
	remoteProtocol: unknown,
	build: string,
	protocol: number,
): boolean {
	return remoteBuild === build && remoteProtocol === protocol;
}
