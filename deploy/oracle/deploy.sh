#!/usr/bin/env bash
#
# One idempotent deploy step, run on the Oracle VM after the workflow has
# checked out the `deploy` branch. Installs Docker on first boot, opens the
# four ports the cloud security list also needs, writes `.env`, rebuilds the
# two images and waits until the public HTTPS endpoint answers.
#
# Usage (from the repo root, as root or with passwordless sudo):
#   sudo bash deploy/oracle/deploy.sh <domain> [region]
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DOMAIN="${1:-${GOLPE_DOMAIN:-}}"
REGION="${2:-${GOLPE_REGION:-sa}}"
STUN="${GOLPE_STUN:-stun:stun1.l.google.com:19302,stun:stun2.l.google.com:19302}"

if [ -z "$DOMAIN" ]; then
	echo "deploy.sh: a domain (or the sslip.io hostname) is required" >&2
	exit 1
fi

if [ "$(id -u)" -eq 0 ]; then
	SUDO=""
else
	SUDO="sudo"
fi

echo "==> golpe deploy: $DOMAIN (region $REGION)"

# --- Docker ---------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
	echo "==> installing Docker"
	curl -fsSL https://get.docker.com | $SUDO sh
fi
if ! $SUDO docker compose version >/dev/null 2>&1; then
	echo "==> installing the compose plugin"
	$SUDO apt-get update -y
	$SUDO apt-get install -y docker-compose-v2 ||
		$SUDO apt-get install -y docker-compose-plugin
fi
$SUDO systemctl enable --now docker

# --- Host firewall --------------------------------------------------------
# Oracle's Ubuntu image ends its INPUT chain with a REJECT. Docker's published
# ports are forwarded and normally bypass it, but the host rules are made
# explicit here so a reboot cannot leave the deploy unreachable.
if command -v iptables >/dev/null 2>&1; then
	echo "==> opening 22/tcp, 80/tcp, 443/tcp, 9208/tcp, 9208/udp"
	open_port() {
		local proto="$1" port="$2"
		if ! $SUDO iptables -C INPUT -p "$proto" --dport "$port" -j ACCEPT 2>/dev/null; then
			$SUDO iptables -I INPUT 1 -p "$proto" --dport "$port" -j ACCEPT
		fi
	}
	open_port tcp 22
	open_port tcp 80
	open_port tcp 443
	open_port tcp 9208
	open_port udp 9208

	if command -v netfilter-persistent >/dev/null 2>&1; then
		$SUDO netfilter-persistent save || true
	elif [ -d /etc/iptables ]; then
		$SUDO sh -c 'iptables-save > /etc/iptables/rules.v4'
	fi
fi

# --- Configuration --------------------------------------------------------
cat >"$ROOT/.env" <<EOF
GOLPE_DOMAIN=$DOMAIN
GOLPE_REGION=$REGION
GOLPE_STUN=$STUN
EOF
chmod 600 "$ROOT/.env"

# --- Build and run --------------------------------------------------------
cd "$ROOT"
echo "==> building and starting the stack"
$SUDO docker compose --env-file .env -f deploy/oracle/docker-compose.yml \
	up -d --build --remove-orphans

# --- Health ---------------------------------------------------------------
# Ask through Caddy, on loopback but with the public hostname, so this proves
# TLS, the reverse proxy and the game server in one request. Certificate
# issuance can take a few seconds on the first run; the loop waits for it.
echo "==> waiting for https://$DOMAIN:9208/health"
HEALTH=""
for _ in $(seq 1 90); do
	if HEALTH="$(curl -fsS --max-time 5 \
		--resolve "$DOMAIN:9208:127.0.0.1" \
		"https://$DOMAIN:9208/health" 2>/dev/null)"; then
		break
	fi
	HEALTH=""
	sleep 2
done

if [ -z "$HEALTH" ]; then
	echo "deploy.sh: the game server did not answer; recent logs:" >&2
	$SUDO docker compose --env-file .env -f deploy/oracle/docker-compose.yml \
		logs --tail=80 game web >&2 || true
	exit 1
fi

echo "==> health: $HEALTH"
echo "==> golpe is live at https://$DOMAIN/"
