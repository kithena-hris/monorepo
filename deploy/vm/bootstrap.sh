#!/usr/bin/env bash
# One 4 GB Ubuntu 24.04 VM, x86_64 or arm64, made ready for `deploy.sh`.
#
#   ssh root@<public ip> 'TS_AUTHKEY=tskey-auth-… bash -s' < deploy/vm/bootstrap.sh
#
# As root on Hetzner and DigitalOcean; on Oracle and AWS, where the image's user
# is `ubuntu`, `ssh ubuntu@<ip> 'sudo TS_AUTHKEY=… bash -s' < …` instead.
#
# `IDLE_STOP_MINUTES=30` beside `TS_AUTHKEY` makes the VM stop itself after
# that long unused (`idle-stop.sh`): the AWS host wants it, a VM billed flat
# does not. Left unset on a later run, it is removed again.
#
# Idempotent: every step checks or overwrites, so running it again is how a
# setting here reaches a VM that already exists. After the first run the VM
# takes no inbound traffic at all — Tailscale for SSH, Cloudflare Tunnel for
# the router, both dialling out — so remove the provider firewall's SSH rule
# (Hetzner and DigitalOcean: the Cloud Firewall; Oracle: the security list;
# AWS: the security group, `deploy/aws/provision.sh --close-ssh`).
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

# 4 GB of swap on a 4 GB box: headroom for a spike, not capacity, and rarely
# touched (swappiness 10). The limits in `compose.yaml` are what keep the
# stack inside the RAM; neither Hetzner's nor DigitalOcean's image has swap.
if ! swapon --show | grep -q /swapfile; then
  [ -f /swapfile ] || { fallocate -l 4G /swapfile; chmod 600 /swapfile; mkswap /swapfile; }
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
sysctl -q -w vm.swappiness=10
echo 'vm.swappiness=10' > /etc/sysctl.d/90-kithena.conf

# Tailscale: the deploy workflows and the founder reach the VM through it, as
# `deploy`, with Tailscale SSH checking the tailnet policy instead of a key.
command -v tailscale >/dev/null || curl -fsSL https://tailscale.com/install.sh | sh
if ! tailscale status >/dev/null 2>&1; then
  : "${TS_AUTHKEY:?set TS_AUTHKEY to a Tailscale auth key tagged tag:vm}"
  tailscale up --ssh --authkey "$TS_AUTHKEY" --advertise-tags=tag:vm --hostname kithena-vm
fi

# SSH by key only, never as root — and only once Tailscale is up, so a first
# run that failed before this point can be rerun as root over the public
# address. From here on the way in is Tailscale SSH as `deploy`.
cat > /etc/ssh/sshd_config.d/10-kithena.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
EOF
systemctl reload ssh

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
# this; `compose.yaml` publishes none. Reset first, so a rule the image or an
# earlier hand added (DigitalOcean's 1-click images allow 22) does not survive.
ufw --force reset >/dev/null
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
After=kithena-start.service
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

# Stop when idle, and start the stack at boot (`idle-stop.sh` says what idle
# is). The boot unit is half of it: `compose stop` leaves every
# `unless-stopped` container stopped until something starts it again.
if [ -n "${IDLE_STOP_MINUTES:-}" ]; then
  [[ "$IDLE_STOP_MINUTES" =~ ^[0-9]+$ ]] || { echo "IDLE_STOP_MINUTES must be a number" >&2; exit 1; }
  printf 'IDLE_STOP_MINUTES=%s\n' "$IDLE_STOP_MINUTES" > /etc/kithena/idle-stop.env
  cat > /etc/systemd/system/kithena-start.service <<'EOF'
[Unit]
Description=Start the kithena Compose projects at boot
After=docker.service network-online.target
Wants=docker.service network-online.target
ConditionPathExists=/home/deploy/kithena/idle-stop.sh
[Service]
Type=oneshot
ExecStart=/bin/bash /home/deploy/kithena/idle-stop.sh start
[Install]
WantedBy=multi-user.target
EOF
  cat > /etc/systemd/system/kithena-idle-stop.service <<'EOF'
[Unit]
Description=Stop the VM when nobody is using it
ConditionPathExists=/home/deploy/kithena/idle-stop.sh
After=kithena-start.service
[Service]
Type=oneshot
EnvironmentFile=/etc/kithena/idle-stop.env
ExecStart=/bin/bash /home/deploy/kithena/idle-stop.sh
EOF
  cat > /etc/systemd/system/kithena-idle-stop.timer <<'EOF'
[Unit]
Description=Check every five minutes whether the VM is idle
[Timer]
OnCalendar=*:0/5
[Install]
WantedBy=timers.target
EOF
  systemctl daemon-reload
  systemctl enable kithena-start.service
  systemctl enable --now kithena-idle-stop.timer
else
  systemctl disable --now kithena-idle-stop.timer kithena-start.service 2>/dev/null || true
  rm -f /etc/systemd/system/kithena-idle-stop.service /etc/systemd/system/kithena-idle-stop.timer \
    /etc/systemd/system/kithena-start.service /etc/kithena/idle-stop.env
  systemctl daemon-reload
fi

# The architecture is what the `VM_PLATFORM` repository variable must say.
echo "bootstrapped: $(tailscale ip -4 2>/dev/null || echo 'tailscale not up')," \
  "VM_PLATFORM=linux/$(dpkg --print-architecture)"
