# Regions

How golpe serves three continents without becoming a distributed system.

## The decision

**Game servers: one identical TypeScript binary per region.** SA, US-E and EU
for launch, each running `server/` + the shared simulation. A room is created,
played and reaped inside one region; rooms never migrate, replicate or proxy
between regions. Region selection is client-side (`?server=host[:port]`, the
server browser, the directory listing). Game servers never call each other, so
there is nothing to orchestrate between them — no mesh, no leader, no shared
state.

**Non-game backend: stays TypeScript (Node now, Bun later).** No Elixir, Go or
Rust service. The control plane for launch is the directory (`directory/`): a
stateless aggregator over each region's `/rooms`, and later the home of auth,
persistence, leaderboards and match history. The database, when it arrives, is
Turso (edge SQLite, libSQL) behind Drizzle — read replicas near the players,
writes to the primary, fresh reads routed to the primary.

**Monorepo: still one pnpm package, no Turborepo/Nx.** Folders with clear
boundaries (`src/game/online/regions.ts`, `directory/`, `deploy/`) instead of
workspace splits. Graduate to `apps/*` + `packages/*` workspaces when the
directory grows its own dependencies — not before.

## Why not another language

Measured numbers from 2025–2026 backend comparisons, applied to this project:

- **Go** (P99 ~31ms at 18k RPS, single binary, best ops story) is the right
  *default* for a new backend service — but adopting it now would fork the
  protocol types (`LaunchParams`, `GameSnapshot`, `ScoreEntry`, `PotgClip`)
  across two languages for an I/O-bound control plane with no measured
  bottleneck. First split-out candidate if the TS directory ever saturates.
- **Elixir/BEAM** wins at millions of long-lived connections with
  self-healing (Discord, WhatsApp). The directory holds no connections —
  gameplay traffic stays on the game servers — so there is no BEAM-shaped
  problem here yet.
- **Rust** wins when GC pauses are measured on a hot path (Discord's move).
  Nothing here has measured one; the tick loop does no I/O at all by
  construction.
- **TypeScript on Bun** closes to ~10–15% of Go on HTTP workloads at comparable
  memory. The control plane is exactly that workload. Switch the runtime
  (Node → Bun), not the language, when the time comes.

Revisit when a metric says so: p95 directory latency over budget (→ Go?), tens
of thousands of concurrent control-plane connections (→ Elixir?), GC pauses in
a tick (→ Rust, or more likely: stop doing I/O in the tick).

## Why not Turborepo/Nx

Both pay off at 5+ engineers or 10+ packages with CI minutes to save. This
repo is one deployable game + one tiny directory. pnpm workspaces graduate
when the directory needs its own dependencies; until then a task runner is
config without a problem.

## Running regions locally

```bash
pnpm run dev:regions   # local :9208, sa :9209, us-east :9210, eu :9211, directory :9308
```

The browser then lists rooms per region with per-server ping; Join commits
`?server=` so the match boots where the room lives. Quick match stays on the
page's own server. Probes are unaffected — no `?server=` means
`location.hostname:9208`, exactly as before.

To point the menu at a real fleet:

```bash
VITE_GOLPE_SERVERS=sa=sa.golpe.gg:9208,us-east=us.golpe.gg:9208,eu=eu.golpe.gg:9208 pnpm run dev
```

## Deploying

- **Game server:** `deploy/Dockerfile.game-server` — same image per region,
  `GOLPE_REGION` set per deployment. See `deploy/fly.toml` (with its UDP
  caveat — prove one region with an online probe before committing) and
  `deploy/docker-compose.regions.yml` for plain VPSs.
- **Directory:** `tsx directory/index.ts` with
  `GOLPE_SERVERS=sa=sa.golpe.gg:9208,us-east=us.golpe.gg:9208,eu=eu.golpe.gg:9208`
  and `PORT=9308`. Stateless; cache is `CACHE_MS` (default 3000ms).
- **Protocol:** a game server advertises its region in `/health`
  (`{ ok, rooms, region }`) and on every `/rooms` entry. The fleet format
  `region=host:port,...` is parsed by one function both ends share
  (`parseServerList`), so operator config cannot drift between menu and
  directory.

## Rules that hold this together

- The tick loop never waits on the network or the database. The directory is
  read by menus, never by matches.
- `?server=` is an address and always boots that server. `?region=` is a
  browser filter hint and never moves a match.
- A down region contributes nothing to a listing and fails nothing.
- The simulation stays shared verbatim between client and server — the reason
  the backend stays TypeScript. A second language must never own gameplay
  types.
