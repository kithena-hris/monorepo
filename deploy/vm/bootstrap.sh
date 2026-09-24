#!/usr/bin/env bash
# One Oracle Ampere A1 VM (Ubuntu 24.04, arm64), made ready for `deploy.sh`.
#
#   ssh ubuntu@<public ip> 'sudo TS_AUTHKEY=tskey-auth-… bash -s' < deploy/vm/bootstrap.sh
#
# Idempotent: every step checks or overwrites, so running it again is how a
# setting here reaches a VM that already exists. After the first run the VM
# takes no inbound traffic at all — Tailscale for SSH, Cloudflare Tunnel for
# the router, both dialling out — so delete the security list's port-22 rule.
# `docs/environments.md` "Hosting" has the whole checklist.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "run as root" >&2; exit 1; }
export DEBIAN_FRONTEND=noninteractive

# Ubuntu's own Docker and Compose rather than Docker's apt repository: they
# come from the security pocket, so unattended-upgrades patches them too.
apt-get update -q
apt-get install -y -q docker.io docker-compose-v2 unattended-upgrades ufw openssl
systemctl enable --now docker

# Every container's log, capped, or json-file grows until the disk is full.
cat > /etc/docker/daemon.json <<'EOF'
{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" } }
EOF
systemctl restart docker

# Security updates nightly, and the reboot a kernel update needs, at an hour
# nobody is signing in. Every service is `restart: unless-stopped`.
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
cat > /etc/apt/apt.conf.d/52kithena-reboot <<'EOF'
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:30";
EOF

# 4 GB of swap: headroom for a spike, not capacity. The limits in
# `compose.yaml` are what keep the stack inside 24 GB.
if ! swapon --show | grep -q /swapfile; then
  [ -f /swapfile ] || { fallocate -l 4G /swapfile; chmod 600 /swapfile; mkswap /swapfile; }
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
sysctl -q -w vm.swappiness=10
echo 'vm.swappiness=10' > /etc/sysctl.d/90-kithena.conf

# SSH by key only, never as root. Reachable only over Tailscale once ufw is on.
cat > /etc/ssh/sshd_config.d/10-kithena.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
EOF
systemctl reload ssh

# Tailscale: the deploy workflows and the founder reach the VM through it, as
# `deploy`, with Tailscale SSH checking the tailnet policy instead of a key.
command -v tailscale >/dev/null || curl -fsSL https://tailscale.com/install.sh | sh
if ! tailscale status >/dev/null 2>&1; then
  : "${TS_AUTHKEY:?set TS_AUTHKEY to a Tailscale auth key tagged tag:vm}"
  tailscale up --ssh --authkey "$TS_AUTHKEY" --advertise-tags=tag:vm --hostname kithena-vm
fi

# Oracle's Ubuntu image ships its own iptables rules (open 22, reject the
# rest), loaded by netfilter-persistent. Two firewalls is one too many; ufw is
# the one kept. Only on the first run, before Docker has chains worth keeping.
if dpkg -s netfilter-persistent >/dev/null 2>&1; then
  apt-get purge -y -q iptables-persistent netfilter-persistent
  iptables -P INPUT ACCEPT
  iptables -F INPUT
  systemctl restart docker
fi
# Nothing inbound except on the tailnet. Published Docker ports would bypass
# this; `compose.yaml` publishes none.
ufw default deny incoming
ufw default allow outgoing
ufw allow in on tailscale0
ufw --force enable

# The deploy user. It runs `docker` through sudo, which is root in all but
# name: the separation is who may log in (the tailnet policy says `deploy`),
# not what they may do once in.
id deploy >/dev/null 2>&1 || useradd --create-home --shell /bin/bash deploy
echo 'deploy ALL=(root) NOPASSWD:ALL' > /etc/sudoers.d/90-deploy
chmod 440 /etc/sudoers.d/90-deploy
install -d -m 700 -o root -g root /etc/kithena

# Nightly backups, once `/etc/kithena/backup.env` exists. `backup.sh` is the
# copy the deploy workflow keeps current in `~deploy/kithena`.
cat > /etc/systemd/system/kithena-backup.service <<'EOF'
[Unit]
Description=Back up the VM Postgres and the kithena topics
ConditionPathExists=/etc/kithena/backup.env
ConditionPathExists=/home/deploy/kithena/backup.sh
[Service]
Type=oneshot
ExecStart=/bin/bash /home/deploy/kithena/backup.sh
EOF
cat > /etc/systemd/system/kithena-backup.timer <<'EOF'
[Unit]
Description=Nightly kithena backup
[Timer]
OnCalendar=*-*-* 03:30:00 UTC
Persistent=true
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now kithena-backup.timer

echo "bootstrapped: $(tailscale ip -4 2>/dev/null || echo 'tailscale not up')"
