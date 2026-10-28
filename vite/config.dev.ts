import {
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join, normalize, sep } from "node:path";
import babel from "@rolldown/plugin-babel";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vite";

/**
 * Serves the art boards' folder (`unprocessed-sprites/`) to the sprite slicer.
 *
 * The sprite workshop (`?slicer=true`) lists and loads raw boards — Gemini
 * art, reference paintings, anything not clean enough for the game — and the
 * folder must be reachable from the browser without a rebuild. `public/`
 * would work for serving but gives no way to *list* what is there, which is
 * the whole point: the slicer polls `GET /unprocessed/list.json` and every
 * PNG dropped into the folder appears in it a moment later. See
 * `docs/sprite-slicer.md`.
 *
 * Dev-only: the slicer still works without this (file picker, drag-drop),
 * and the shipped build never needs raw boards.
 */
function artWorkshop(): Plugin {
	return {
		name: "art-workshop",
		configureServer(server) {
			const boards = join(server.config.root, "unprocessed-sprites");
			const IMAGE = /\.(png|jpe?g|webp)$/i;
			const MIME: Record<string, string> = {
				png: "image/png",
				jpg: "image/jpeg",
				jpeg: "image/jpeg",
				webp: "image/webp",
			};

			server.middlewares.use("/unprocessed", (req, res) => {
				// The mount prefix is stripped by connect, so inside here the
				// path is relative: `/list.json` is the listing, `/x.png` a board.
				const path = new URL(req.url ?? "/", "http://localhost").pathname;

				// The listing, polled by the slicer for hot-reload.
				if (path === "/list.json") {
					let entries: { name: string; size: number; mtime: number }[] = [];
					try {
						entries = readdirSync(boards)
							.filter((f) => IMAGE.test(f))
							.map((f) => {
								const st = statSync(join(boards, f));
								return { name: f, size: st.size, mtime: st.mtimeMs };
							})
							.sort((a, b) => a.name.localeCompare(b.name));
					} catch {
						// The folder may not exist yet — an empty list is the answer.
					}
					res.setHeader("Content-Type", "application/json");
					res.setHeader("Cache-Control", "no-store");
					res.end(JSON.stringify(entries));
					return;
				}

				// One board's bytes. Path-traversal-proof: the resolved path must
				// stay inside the folder.
				const rel = decodeURIComponent(path.replace(/^\//, ""));
				const file = normalize(join(boards, rel));
				if (!file.startsWith(`${boards}${sep}`) && file !== boards) {
					res.statusCode = 403;
					res.end("forbidden");
					return;
				}
				try {
					const data = readFileSync(file);
					const ext = file.split(".").pop()?.toLowerCase() ?? "";
					res.setHeader(
						"Content-Type",
						MIME[ext] ?? "application/octet-stream",
					);
					// The slicer cache-busts with its own query; never let the
					// browser keep a stale board when the file was re-saved.
					res.setHeader("Cache-Control", "no-store");
					res.end(data);
				} catch {
					res.statusCode = 404;
					res.end("not found");
				}
				return;
			});
		},
	};
}

/**
 * The map maker's "Save into this checkout": write a published map's files
 * into `maps/<id>/`, where `pnpm map:pr <id>` picks them up and opens the pull
 * request with `gh`.
 *
 * Dev-only, like the art workshop — the shipped build has no checkout to
 * write into, and its Publish sheet offers the GitHub routes instead. The
 * file names are an allow-list (the folder layout `game/maps/pullRequest.ts`
 * defines) and the id is a slug, so nothing can be written outside the map's
 * own folder.
 */
function mapMakerSave(): Plugin {
	const SLUG = /^[a-z0-9][a-z0-9-]{0,47}$/;
	const FILES = /^(map\.json|screenshot-[1-4]\.png|preview\.(webm|mp4))$/;
	const MAX_BODY = 64 * 1024 * 1024;
	return {
		name: "map-maker-save",
		configureServer(server) {
			server.middlewares.use("/__mapmaker", (req, res) => {
				const path = new URL(req.url ?? "/", "http://localhost").pathname;
				const reply = (status: number, body: unknown) => {
					res.statusCode = status;
					res.setHeader("Content-Type", "application/json");
					res.end(JSON.stringify(body));
				};
				if (path === "/ping") return reply(200, { ok: true });
				if (path !== "/save" || req.method !== "POST") {
					return reply(404, { error: "not found" });
				}
				const chunks: Buffer[] = [];
				let size = 0;
				req.on("data", (c: Buffer) => {
					size += c.length;
					if (size <= MAX_BODY) chunks.push(c);
				});
				req.on("end", () => {
					if (size > MAX_BODY) return reply(413, { error: "too large" });
					try {
						const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
							id?: unknown;
							files?: Record<string, unknown>;
						};
						const id = typeof body.id === "string" ? body.id : "";
						if (!SLUG.test(id)) return reply(400, { error: "bad map id" });
						const files = Object.entries(body.files ?? {});
						if (!files.some(([n]) => n === "map.json")) {
							return reply(400, { error: "map.json missing" });
						}
						const dir = join(server.config.root, "maps", id);
						mkdirSync(dir, { recursive: true });
						for (const [name, data] of files) {
							if (!FILES.test(name) || typeof data !== "string") continue;
							writeFileSync(join(dir, name), Buffer.from(data, "base64"));
						}
						return reply(200, { path: `maps/${id}/` });
					} catch (err) {
						return reply(400, { error: String(err) });
					}
				});
			});
		},
	};
}

export default defineConfig({
	base: "./",
	// Same substitution as the production build: the LAN handshake compares the
	// client's build with the server's `/health`, and a dev server says "dev".
	define: {
		__GOLPE_BUILD__: JSON.stringify(process.env.GOLPE_BUILD ?? "dev"),
	},
	plugins: [
		artWorkshop(),
		mapMakerSave(),
		react(),
		/**
		 * The React Compiler auto-memoises every component and hook, which
		 * makes the hand-written useCallback/useMemo in src/ui/ redundant —
		 * and lets new components skip them entirely. It runs through
		 * @rolldown/plugin-babel in both dev and prod (the preset pins
		 * `applyToEnvironmentHook` to the client consumer, so the server
		 * build never sees it), and its rolldown filter only touches files
		 * that look like components — the exact same `babel-plugin-react-compiler`
		 * version the optional peer of @vitejs/plugin-react demands.
		 */
		babel({ presets: [reactCompilerPreset()] }),
	],
	server: {
		port: 8084,
		/**
		 * Bind every interface, not just loopback.
		 *
		 * Vite's default is localhost, which makes the game unreachable from any
		 * other machine — so a LAN game failed at the first step, before any netcode
		 * was involved, with nothing but a browser timeout to explain it. The game
		 * server already binds `*:9208`; this is the half that did not.
		 *
		 * It does mean the dev server is exposed to the local network while it runs.
		 * That is the entire point of a LAN party, and it is a dev server: do not run
		 * it on a network you would not hand a shell to.
		 */
		host: true,
	},
	// Three libraries here keep global state and break outright if the dev
	// optimiser gives them two module instances:
	//   - pixi.js registers renderers and environment adapters in a global
	//     extension registry at import time; a second copy dies on boot with
	//     "Extension type environment already has a handler".
	//   - react/react-dom keep the hook dispatcher in module scope; a second copy
	//     fails with "Invalid hook call" and a null `useState`.
	// Both failures look like application bugs and are neither.
	optimizeDeps: {
		include: ["pixi.js", "react", "react-dom", "react-dom/client"],
	},
	resolve: {
		dedupe: ["pixi.js", "react", "react-dom"],
	},
});
