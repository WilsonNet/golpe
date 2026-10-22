/**
 * What a map's pull request contains, and what it says.
 *
 * Shared by the two ways a PR is opened — from the browser (the map maker's
 * Publish, through the GitHub API) and from a checkout (`scripts/map-pr.ts`,
 * through `gh`) — so a reviewer sees the same layout and the same checks
 * whichever way the map arrived.
 *
 * A map lands in `maps/<id>/`:
 *
 *   map.json          the map, exactly as the server sanitises it
 *   screenshot-1.png  the whole map at 1:1 (also the menu's map card)
 *   screenshot-N.png  play-test frames, up to three
 *   preview.webm|mp4  one play-test clip against bots
 */

import { SCREEN_W, WORLD_BOTTOM } from "../simulation/Arena";
import { TDM_MIN_SCREENS } from "../simulation/Teams";
import {
	mapRows,
	mapScreens,
	propsFromTilemap,
	solidRectsFromTilemap,
	spawnsFromTilemap,
	type TilemapSpec,
	themeOf,
} from "../simulation/Tilemap";
import type { MapIssue } from "./checks";

/** The repository maps are contributed to. */
export const MAP_REPO = "WilsonNet/golpe";
export const MAX_PR_SHOTS = 3;
/** The play-test frames share one row, with a little room for the gaps. */
const SHOTS_ROW_PERCENT = 96;

export interface PrMediaNames {
	overview: string;
	shots: string[];
	video: string | null;
}

/** The file names a map's folder will hold, given what was captured. */
export function mediaNames(
	shots: number,
	videoExt: "webm" | "mp4" | null,
): PrMediaNames {
	const n = Math.min(shots, MAX_PR_SHOTS);
	return {
		overview: "screenshot-1.png",
		shots: Array.from({ length: n }, (_, i) => `screenshot-${i + 2}.png`),
		video: videoExt ? `preview.${videoExt}` : null,
	};
}

export function prBranch(id: string): string {
	return `map/${id}`;
}

export function prTitle(map: TilemapSpec): string {
	const theme = themeOf(map);
	return `Add map: ${map.meta?.name ?? "Untitled"} (${theme[0]?.toUpperCase()}${theme.slice(1)})`;
}

export function commitMessage(map: TilemapSpec): string {
	return `feat(maps): add ${map.meta?.name ?? "a map"}\n\nMade with the golpe map maker.`;
}

/**
 * The PR's description. `fileUrl` turns a file name inside the map's folder
 * into an absolute URL — pinned to the commit, so the images keep working
 * after the branch is merged and deleted.
 */
export function prBody(
	map: TilemapSpec,
	issues: readonly MapIssue[],
	media: PrMediaNames,
	fileUrl: (name: string) => string,
): string {
	const id = map.meta?.id ?? "map";
	const name = map.meta?.name ?? "Untitled map";
	const screens = mapScreens(map);
	const theme = themeOf(map);
	const errors = issues.filter((i) => i.level === "error");
	const warnings = issues.filter((i) => i.level === "warning");
	const notes = issues.filter((i) => i.level === "info");
	const modes =
		screens >= TDM_MIN_SCREENS
			? "Free-for-all · Team deathmatch"
			: "Free-for-all";
	const author = map.meta?.author
		? map.meta.author.startsWith("@")
			? map.meta.author
			: `@${map.meta.author}`
		: "—";
	const lines: string[] = [];

	lines.push(`## 🗺️ ${name}`, "");
	if (map.meta?.description)
		lines.push(`> ${map.meta.description.replace(/\n+/g, " ")}`, "");

	if (media.video) {
		const poster = media.shots[0] ?? media.overview;
		lines.push(
			"### ▶ Play-test",
			"",
			`[![Play-test of ${name} against bots — click to watch](${fileUrl(poster)})](${fileUrl(media.video)})`,
			"",
			`*Click the frame to watch the clip (\`${media.video}\`): the map played online against bots in the map maker's play-test.*`,
			"",
		);
	}

	lines.push(
		"### Screenshots",
		"",
		`![${name} — the whole map](${fileUrl(media.overview)})`,
		"",
	);
	if (media.shots.length > 0) {
		lines.push(
			media.shots
				.map(
					(s, i) =>
						`<img src="${fileUrl(s)}" width="${Math.floor(SHOTS_ROW_PERCENT / media.shots.length)}%" alt="Play-test frame ${i + 1}">`,
				)
				.join(" "),
			"",
		);
	}

	lines.push(
		"### The map",
		"",
		"| | |",
		"|---|---|",
		`| **Theme** | ${theme} |`,
		`| **Size** | ${screens} screen${screens === 1 ? "" : "s"}${mapRows(map) > 1 ? ` × ${mapRows(map)} rows` : ""} (${screens * SCREEN_W}×${mapRows(map) * WORLD_BOTTOM}) |`,
		`| **Platforms** | ${solidRectsFromTilemap(map).length} |`,
		`| **Spawns** | ${spawnsFromTilemap(map).length} |`,
		`| **Props** | ${propsFromTilemap(map).length} |`,
		`| **Modes** | ${modes} |`,
		`| **Author** | ${author} |`,
		"",
	);

	lines.push("### Checks", "");
	if (errors.length === 0 && warnings.length === 0) {
		lines.push(
			"✅ The map maker's checks pass: spawns, gaps, headroom and jump reach.",
		);
	} else {
		if (errors.length === 0) lines.push("✅ No errors.");
		for (const i of [...errors, ...warnings]) {
			const where = i.at ? ` *(at ${i.at.x},${i.at.y})*` : "";
			lines.push(`- ${i.level === "error" ? "❌" : "⚠️"} ${i.message}${where}`);
		}
	}
	for (const i of notes) lines.push(`- ℹ️ ${i.message}`);
	lines.push(
		"",
		"### Try it",
		"",
		`Once merged, the map is in the menu's map list, and \`?map=${id}\` boots straight into it — e.g. \`/?map=${id}&bots=5\`.`,
		"",
		"---",
		"*Made with the golpe map maker (`?mapmaker=true`).*",
	);
	return lines.join("\n");
}
