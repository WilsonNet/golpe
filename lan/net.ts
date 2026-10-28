/**
 * Where the LAN pack is reachable.
 *
 * The launcher must print (and open) the address a *guest* can use, not
 * `127.0.0.1`: the address bar becomes the room link, and a loopback URL sent to
 * another machine is a dead link. This picks the first usable private IPv4 on
 * the host, with the interfaces a machine actually uses for a LAN party tried
 * first.
 */

import os from "node:os";
import { isPrivateHost } from "../src/game/online/lan.js";

/** Interface names that are usually the real network, across the three OSes. */
const PREFERRED = [
	"en0",
	"en1",
	"eth0",
	"eth1",
	"wlan0",
	"Wi-Fi",
	"Ethernet",
	"Local Area Connection",
];

function isIpv4(family: string | number): boolean {
	return family === "IPv4" || family === 4;
}

function isLinkLocal(address: string): boolean {
	return address.startsWith("169.254.");
}

/**
 * The host's LAN address, or loopback when it has none.
 *
 * A link-local address is a last resort: it works on the wire but guests have to
 * type a 169.254 address, and some operating systems deprioritise it. RFC1918
 * and CGNAT win.
 */
export function lanAddress(): string {
	const interfaces = os.networkInterfaces();
	const candidates: { name: string; address: string; preferred: boolean }[] =
		[];
	for (const [name, addresses] of Object.entries(interfaces)) {
		for (const address of addresses ?? []) {
			if (address.internal || !isIpv4(address.family)) continue;
			if (!isPrivateHost(address.address)) continue;
			candidates.push({
				name,
				address: address.address,
				preferred: PREFERRED.includes(name),
			});
		}
	}
	candidates.sort((a, b) => {
		if (a.preferred !== b.preferred) return a.preferred ? -1 : 1;
		const aLink = isLinkLocal(a.address);
		const bLink = isLinkLocal(b.address);
		if (aLink !== bLink) return aLink ? 1 : -1;
		return a.name.localeCompare(b.name);
	});
	return candidates[0]?.address ?? "127.0.0.1";
}
