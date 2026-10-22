# golpe on Oracle Cloud (free tier)

One VM runs two containers:

| container | port | what |
|---|---|---|
| `web` (Caddy) | `443/tcp` | the Vite client, plus automatic HTTPS |
| `web` (Caddy) | `9208/tcp` | Geckos signalling, `/health`, `/rooms`, `/potg` |
| `game` | `9208/udp` | the WebRTC data channels |
| `web` (Caddy) | `80/tcp` | ACME + redirect |

The client is served over HTTPS because it fetches the game server on the same
hostname at `:9208`. Without TLS that fetch is mixed content on an HTTPS page,
and `crypto.randomUUID` is unavailable on a plain-HTTP origin.

## First-time setup

1. **Assign a public IP** in the Oracle console: *Instance details → Attached
   VNICs → primary VNIC → IP addresses → Edit → Ephemeral public IP*.
2. **Open the ports** in the subnet's security list (or an NSG): ingress from
   `0.0.0.0/0` for `80/tcp`, `443/tcp`, `9208/tcp`, `9208/udp`. Keep `22/tcp`.
3. Add the GitHub Actions secrets and variable:

   ```bash
   gh secret set ORACLE_HOST --body "<public ip>"
   gh secret set ORACLE_USER --body "ubuntu"
   gh secret set ORACLE_SSH_KEY < ~/.ssh/golpe/oracle.key
   gh variable set GOLPE_REGION --body "sa"   # optional, defaults to sa
   gh variable set GOLPE_DOMAIN --body "<ip>.sslip.io"  # optional
   ```

   If `GOLPE_DOMAIN` is unset the workflow derives `<ip>.sslip.io`, which
   resolves the raw IP and gets a real Let's Encrypt certificate. No domain
   purchase is needed.
4. Push to the `deploy` branch. Only that branch deploys.

## Re-deploying

```bash
git push origin main:deploy
```

The workflow pulls `deploy` into `/opt/golpe` and runs
`deploy/oracle/deploy.sh`, which rebuilds both images. Docker layer caching
keeps a no-op deploy fast; a lockfile change re-runs the installs.

## Operating

```bash
ssh ubuntu@<ip>
cd /opt/golpe
sudo docker compose --env-file .env -f deploy/oracle/docker-compose.yml ps
sudo docker compose --env-file .env -f deploy/oracle/docker-compose.yml logs -f game
```

`GOLPE_STUN` can be overridden in `/opt/golpe/.env` if the default Google STUN
servers are blocked. `GOLPE_ICE_PORT` is pinned to `9208` in the compose file
so the UDP security-list rule and libdatachannel agree.

## Why the ports are split

Caddy owns TCP `9208`, the game container owns UDP `9208`. They are different
protocols, so one host port can carry both: the browser's signalling WebSocket
and HTTP fetches go through Caddy, while the WebRTC data channels hit the game
container directly. Caddy terminates TLS for the first; STUN gives the second a
public candidate.
