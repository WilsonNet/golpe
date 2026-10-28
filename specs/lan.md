# LAN play

**One machine hosts; everybody else opens a URL.** The host runs the LAN pack,
which serves the client, the authoritative game server and discovery from one
process. Guests install nothing. The public site never lists a LAN room: a
browser cannot scan a LAN or browse mDNS, so the host is the only place a LAN
listing can be produced.

## One pack, one port

`lan/` is a **distribution** of the game, not a second game. It calls the same
`createGameServer` factory the production entry calls, serves the same Vite
build (staged into the pack as its own `dist`), and contains no `tickPlayer`, no
room and no tuning constant.

- **TCP 9208** carries the client, `/health`, `/rooms`, `/potg`, `/lan/rooms`
  and the geckos signalling. **UDP 9208** carries the WebRTC data channels. One
  port number, one firewall rule.
- The default is 9208. A non-default port is a probe/developer option: the
  client's compiled game port is 9208, so the page must also carry
  `?server=host:port`.
- The launcher opens the **LAN address**, not `127.0.0.1`. The address bar is
  the invitation; a loopback URL sent to another machine is a dead link. With
  no private address it falls back to loopback and says so.
- The page is plain HTTP. Secure-context APIs are unavailable, so room id
  generation and link copying already have non-secure fallbacks. Do not add a
  new secure-context-only dependency without one.

## Discovery

The host pack advertises `_golpe._tcp` with mDNS and browses for the same
service. A discovered record is an **address book**, never a source of truth:
the pack fetches that host's `/rooms`, the same endpoint quick match reads, and
a peer that stops answering disappears on the next refresh.

- `GET /lan/rooms` returns the merged peer rooms, cached for one second. The
  page's own room comes from its ordinary `/rooms`.
- A peer is accepted only when its advertised address is a private IPv4, its
  room id is valid, and its port is real. The browser applies the same checks
  again before drawing a clickable row.
- The LAN list is capped (32 peers, 128 rooms) and every peer fetch has a
  timeout; one broken host cannot stall the browser.
- There is no UDP-broadcast discovery yet. If multicast is blocked, the host's
  URL and the `?server=` link remain the floor.
- The public site never asks for `/lan/rooms`: Caddy's SPA fallback would answer
  it with HTML, and a guest on the internet has no local pack to ask anyway.

## The badge and the order

A row is `LAN` when either:

- it came from the page's **own** game server and the page was loaded from a
  private or loopback address, or
- it came from `/lan/rooms` and its endpoint is a validated private address.

A query parameter or a server-reported `lan: true` field never creates the
badge. LAN rows are **pinned above every internet row**; the chosen sort (ping,
players, mode) runs inside each group, in either direction. The region filter
shows `LAN`, and the row's meta names the host.

## Build and protocol identity

A deterministic simulation cannot negotiate a middle world. The pack therefore
serves its own client and its own server from one commit, and refuses a seat
from anything else:

- Vite compiles `__GOLPE_BUILD__`; the server reads `build.json` from the pack.
  `/health` and `/rooms` carry `build` and `protocol`.
- The LAN server runs with `strictBuild`. A join carrying a different build or
  protocol gets a reliable `build-mismatch` and is not seated. The client shows
  both identities and points at the host's own link.
- A LAN row from another build is not joined through this page's client. Its
  button is **Open host**, which navigates to `http://host:port/?room=<id>` and
  therefore runs the host's own matching client. A same-build row may join with
  `?server=`.
- The hosted game deliberately does **not** gate: its client and server are
  deployed together, and a stale internet row is a cache question. The gate is
  a LAN rule.
- Bump `PROTOCOL_VERSION` whenever `wire.ts` or the wire message shapes change.
  The `check:protocol` CI gate fails a pull request that changes one without the
  other.

## Security

- The pack binds every interface because a LAN party needs it. It is not a
  public server: run it on a network you trust, and keep 9208 closed at the
  router.
- Room passwords and private rooms still apply. There is no account system.
- The map maker's GitHub relay is off in the pack; publishing is a hosted-site
  or checkout feature.
- `/lan/rooms` is read-only and sends CORS headers only to the known hosted
  origins. It never exposes a control endpoint.
- The pack ships its Node runtime, production dependencies and the native WebRTC
  addon. It is built per OS; the addon cannot be cross-compiled.

## Not implemented

- Discovery from the public site through a local pack agent (Chrome LNA).
- A client-only pack / native shell; this is a host pack.
- Auto-update, code signing and notarization.
- UDP-broadcast discovery as a multicast fallback.
- IPv6 discovery.
- Quick match across discovered LAN peers; the browser lists them, quick match
  stays on the page's own server.
