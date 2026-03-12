# Obsidian Open Brain

Hybrid personal knowledge management system connecting a local Obsidian Vault with PostgreSQL+pgvector on a GCP VM, exposed via an MCP Server accessible through WireGuard VPN.

**Core principle:** Obsidian Vault is the source of truth. pgvector is a read index derived from it.

## Architecture

```
Local (Obsidian Desktop) <--git sync--> VM (GCE e2-small, us-east1)
                                         |
                                         +-- PostgreSQL 16 + pgvector (localhost only)
                                         +-- Vault Watcher (chokidar, detects .md changes)
                                         +-- Embedding Service (OpenAI text-embedding-3-small)
                                         +-- MCP Server (TypeScript, Anthropic SDK)
                                         +-- WireGuard VPN (UDP 51820)

Claude Code --VPN--> MCP Server --> tools (write_note, read_note, delete_note, search_semantic, search_text, list_recent)
```

## GCP Infrastructure Setup

### Prerequisites

- Google Cloud SDK (`gcloud`) installed and authenticated
- Billing account linked to the project

### Phase 1: GCP Infrastructure

#### Task 1.1: Create Project & Enable APIs

```bash
# Create project
gcloud projects create obsidian-open-brain --name="Obsidian Open Brain"
gcloud config set project obsidian-open-brain

# Enable required APIs
gcloud services enable compute.googleapis.com
gcloud services enable secretmanager.googleapis.com
gcloud services enable run.googleapis.com
gcloud services enable logging.googleapis.com

# Set default region (us-east1 — cheapest tier, lowest latency to Brazil)
gcloud config set compute/region us-east1
gcloud config set compute/zone us-east1-b

# Checkpoint
gcloud services list --enabled | grep -E '(compute|secretmanager|run|logging)'
```

#### Task 1.2: Create VPC Network

```bash
# Custom VPC (no auto subnets)
gcloud compute networks create obsidian-vpc \
  --subnet-mode=custom

# Subnet in us-east1
gcloud compute networks subnets create obsidian-subnet \
  --network=obsidian-vpc \
  --range=10.0.0.0/24 \
  --region=us-east1

# Checkpoint
gcloud compute networks list
gcloud compute networks subnets list --network=obsidian-vpc
```

#### Task 1.3: Create Firewall Rules (Zero Trust)

Default behavior: deny-all ingress (custom VPC). Only these 3 rules are created:

```bash
# WireGuard VPN (UDP 51820) — auth handled by WireGuard key exchange
gcloud compute firewall-rules create allow-wireguard \
  --network=obsidian-vpc \
  --allow=udp:51820 \
  --source-ranges=0.0.0.0/0 \
  --target-tags=vpn-server \
  --description="Allow WireGuard VPN connections"

# Internal VPC traffic only
gcloud compute firewall-rules create allow-internal \
  --network=obsidian-vpc \
  --allow=tcp,udp,icmp \
  --source-ranges=10.0.0.0/24 \
  --description="Allow internal VPC traffic"

# SSH via IAP only (Google's IAP range, not 0.0.0.0/0)
gcloud compute firewall-rules create allow-iap-ssh \
  --network=obsidian-vpc \
  --allow=tcp:22 \
  --source-ranges=35.235.240.0/20 \
  --target-tags=allow-iap \
  --description="Allow SSH via IAP tunnel only"

# Checkpoint
gcloud compute firewall-rules list --filter="network=obsidian-vpc"
```

#### Task 1.3b: Delete Default VPC (Zero Trust hardening)

Remove the default VPC to eliminate unused attack surface:

```bash
# Delete default firewall rules first (required before deleting network)
gcloud compute firewall-rules list --filter="network=default" --format="value(name)" | \
  xargs -I {} gcloud compute firewall-rules delete {} --quiet

# Delete default network
gcloud compute networks delete default --quiet

# Checkpoint — only obsidian-vpc should remain
gcloud compute networks list
```

#### Task 1.4: Create VM Instance

```bash
# Create dedicated service account
gcloud iam service-accounts create obsidian-vm-sa \
  --display-name="Obsidian VM Service Account"

# Grant minimal roles
gcloud projects add-iam-policy-binding obsidian-open-brain \
  --member="serviceAccount:obsidian-vm-sa@obsidian-open-brain.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

gcloud projects add-iam-policy-binding obsidian-open-brain \
  --member="serviceAccount:obsidian-vm-sa@obsidian-open-brain.iam.gserviceaccount.com" \
  --role="roles/logging.logWriter"

# Create VM (no public IP, SSH via IAP only)
gcloud compute instances create obsidian-vm \
  --zone=us-east1-b \
  --machine-type=e2-small \
  --network=obsidian-vpc \
  --subnet=obsidian-subnet \
  --no-address \
  --tags=vpn-server,allow-iap \
  --service-account=obsidian-vm-sa@obsidian-open-brain.iam.gserviceaccount.com \
  --scopes=cloud-platform \
  --image-family=ubuntu-2404-lts-amd64 \
  --image-project=ubuntu-os-cloud \
  --boot-disk-size=30GB \
  --boot-disk-type=pd-ssd

# Checkpoint — status RUNNING, internal IP only, no external IP
gcloud compute instances describe obsidian-vm \
  --zone=us-east1-b \
  --format="table(name,status,networkInterfaces[0].networkIP,networkInterfaces[0].accessConfigs[0].natIP)"
```

#### Task 1.4b: Cloud NAT (outbound internet without public IP)

Cloud NAT allows the VM to reach the internet (apt, npm, git) without exposing a public IP.
Inbound traffic remains blocked — Zero Trust preserved.

```bash
# Create Cloud Router (required by NAT)
gcloud compute routers create obsidian-router \
  --network=obsidian-vpc \
  --region=us-east1

# Create Cloud NAT
gcloud compute routers nats create obsidian-nat \
  --router=obsidian-router \
  --region=us-east1 \
  --auto-allocate-nat-external-ips \
  --nat-all-subnet-ip-ranges

# Checkpoint — SSH into VM and test outbound connectivity
gcloud compute ssh obsidian-vm \
  --zone=us-east1-b \
  --tunnel-through-iap

# Inside VM:
curl -s --max-time 5 https://google.com && echo "OK"
```

#### Task 1.4c: Budget Alert

Budget of R$240/month (~US$42) configured via GCP Console:
- **Budgets & alerts** → Create budget
- Project: `obsidian-open-brain`
- Amount: R$240
- Thresholds: 50%, 90%, 100%

Estimated monthly cost: ~US$18 (e2-small + 30GB pd-ssd + Cloud NAT + minimal traffic).

#### Task 1.5: Base VM Setup (via SSH IAP)

```bash
gcloud compute ssh obsidian-vm \
  --zone=us-east1-b \
  --tunnel-through-iap

# Inside VM:
sudo apt update && sudo apt upgrade -y

sudo apt install -y \
  curl \
  git \
  build-essential \
  postgresql-common

# Node.js 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# Checkpoint
node -v   # v22.x
npm -v    # 10.x
git --version  # 2.x
```

### Phase 2: WireGuard VPN

#### Task 2.1: Static IP for VPN endpoint

```bash
# Create static IP
gcloud compute addresses create obsidian-vpn-ip \
  --region=us-east1

# Get allocated IP
gcloud compute addresses describe obsidian-vpn-ip \
  --region=us-east1 \
  --format="value(address)"

# Attach to VM (firewall ensures only UDP 51820 is reachable)
gcloud compute instances add-access-config obsidian-vm \
  --zone=us-east1-b \
  --access-config-name="vpn-only" \
  --address=STATIC_IP
```

#### Task 2.2: WireGuard Server (on VM via SSH IAP)

```bash
sudo apt install -y wireguard

# Generate server keys
wg genkey | sudo tee /etc/wireguard/server_private.key | \
  wg pubkey | sudo tee /etc/wireguard/server_public.key
sudo chmod 600 /etc/wireguard/server_private.key

SERVER_PRIVATE_KEY=$(sudo cat /etc/wireguard/server_private.key)

# Create server config (paste private key manually if heredoc fails)
sudo tee /etc/wireguard/wg0.conf << EOF
[Interface]
PrivateKey = $SERVER_PRIVATE_KEY
Address = 10.10.0.1/24
ListenPort = 51820
PostUp = iptables -A FORWARD -i wg0 -j ACCEPT; iptables -t nat -A POSTROUTING -o ens4 -j MASQUERADE
PostDown = iptables -D FORWARD -i wg0 -j ACCEPT; iptables -t nat -D POSTROUTING -o ens4 -j MASQUERADE
EOF

# Enable IP forwarding
echo "net.ipv4.ip_forward=1" | sudo tee -a /etc/sysctl.conf
sudo sysctl -p

# Start and enable WireGuard
sudo systemctl enable wg-quick@wg0
sudo systemctl start wg-quick@wg0

# Checkpoint
sudo wg show
sudo cat /etc/wireguard/server_public.key
```

#### Task 2.3: WireGuard Client (local machine)

```bash
# Install (Arch Linux)
sudo pacman -S wireguard-tools

# Generate client keys
wg genkey | tee /tmp/client_private.key | \
  wg pubkey | tee /tmp/client_public.key

# On VM: add client peer
sudo wg set wg0 peer CLIENT_PUBLIC_KEY allowed-ips 10.10.0.2/32

# On VM: persist peer in config
sudo tee -a /etc/wireguard/wg0.conf << 'EOF'

[Peer]
PublicKey = CLIENT_PUBLIC_KEY
AllowedIPs = 10.10.0.2/32
EOF

# On local: create client config
CLIENT_PRIVATE_KEY=$(cat /tmp/client_private.key)
sudo tee /etc/wireguard/wg-obsidian.conf << WGEOF
[Interface]
PrivateKey = $CLIENT_PRIVATE_KEY
Address = 10.10.0.2/24

[Peer]
PublicKey = SERVER_PUBLIC_KEY
Endpoint = STATIC_IP:51820
AllowedIPs = 10.10.0.0/24
PersistentKeepalive = 25
WGEOF

# Activate VPN (split tunnel — only 10.10.0.0/24 routed through VPN)
sudo wg-quick up wg-obsidian

# Checkpoint — bidirectional ping
ping -c 3 10.10.0.1        # local → VM
# On VM: ping -c 3 10.10.0.2  # VM → local
```

### Phase 3: Git Vault Sync

#### Task 3.1: Store GitHub Token in Secret Manager

```bash
# Create fine-grained PAT on GitHub:
# - Scope: only isorensen/obsidian-git-sync
# - Permissions: Contents (RW) + Metadata (R)
# - Expiration: 90 days

# Store in Secret Manager (zsh syntax)
read -s "GH_TOKEN?GitHub token: " && echo

echo -n "$GH_TOKEN" | gcloud secrets create git-vault-token \
  --data-file=- \
  --replication-policy=automatic \
  --project=obsidian-open-brain

unset GH_TOKEN
```

#### Task 3.2: Clone Vault on VM

```bash
# On VM (via SSH IAP):
GIT_TOKEN=$(gcloud secrets versions access latest --secret=git-vault-token)

mkdir -p /home/$USER/obsidian
cd /home/$USER/obsidian
git clone https://x-access-token:${GIT_TOKEN}@github.com/isorensen/obsidian-git-sync.git vault

cd vault
git config user.name "Obsidian VM"
git config user.email "obsidian-vm@noreply"
unset GIT_TOKEN
```

#### Task 3.3: Git Sync Cron (every 2 minutes)

```bash
# Create sync script
cat > /home/$USER/obsidian/git-sync.sh << 'SCRIPT'
#!/bin/bash
cd /home/sorensen/obsidian/vault

GIT_TOKEN=$(gcloud secrets versions access latest --secret=git-vault-token)
git remote set-url origin https://x-access-token:${GIT_TOKEN}@github.com/isorensen/obsidian-git-sync.git

git pull --rebase --autostash 2>&1 | logger -t obsidian-git-sync

git add -A
if ! git diff --cached --quiet; then
  git commit -m "auto-sync from VM $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  git push 2>&1 | logger -t obsidian-git-sync
fi

# Clean token from remote URL after sync
git remote set-url origin https://github.com/isorensen/obsidian-git-sync.git
SCRIPT

chmod +x /home/$USER/obsidian/git-sync.sh

# Add to cron
(crontab -l 2>/dev/null; echo "*/2 * * * * /home/sorensen/obsidian/git-sync.sh") | crontab -
```

## Security Posture (Zero Trust)

- **No public IP** on VM (`--no-address`)
- **PostgreSQL** listens on localhost only (127.0.0.1)
- **Firewall:** deny-all default, only UDP 51820 (WireGuard) open
- **SSH:** via IAP tunnel only (Google range 35.235.240.0/20)
- **Secrets:** GCP Secret Manager (never hardcoded)
- **Service account:** dedicated with minimal roles (secretAccessor + logWriter)
- **Default VPC:** deleted to reduce attack surface
- **Cloud NAT:** outbound-only internet access (no public IP on VM)
- **Budget:** R$240/month alert at 50%, 90%, 100%
- **WireGuard VPN:** split tunnel, only 10.10.0.0/24 routed; static IP with firewall-restricted access (UDP 51820 only)
- **Audit:** Cloud Logging enabled

### Phase 4: PostgreSQL + pgvector

```bash
# On VM (via SSH IAP):
sudo apt install -y postgresql postgresql-16-pgvector

# Create database and user
sudo -u postgres psql << 'SQL'
CREATE USER obsidian_brain WITH PASSWORD 'FROM_SECRET_MANAGER';
CREATE DATABASE open_brain OWNER obsidian_brain;
\c open_brain
CREATE EXTENSION vector;
SQL

# Store password in Secret Manager
echo -n "PASSWORD" | gcloud secrets create pg-obsidian-password --data-file=-

# Schema (see docs/plans for full DDL)
# Table: vault_embeddings (UUID PK, file_path UNIQUE, embedding vector(1536), tags TEXT[], file_hash)
# Indexes: ivfflat cosine, GIN tags, btree updated_at DESC
```

### Phases 5-7: Application Code (TypeScript, TDD)

```bash
npm install
npm run build          # tsc
npm test               # vitest (59 tests)
npm run test:coverage  # vitest --coverage (target: 80%+)
```

Components:
- **Embedding Service** (`src/lib/embedding-service.ts`): OpenAI text-embedding-3-small, parseNote, computeHash
- **DB Client** (`src/lib/db-client.ts`): upsert, delete, searchSemantic, searchText, listRecent
- **Vault Watcher** (`src/watcher/`): chokidar file watcher → embedding pipeline
- **MCP Server** (`src/mcp/`): 6 tools via stdio transport

### Phase 8: Integration Testing

```bash
# On VM: index all vault notes
export $(cat .env | xargs) && npm run index-vault

# Start watcher (or use systemd service)
sudo systemctl start obsidian-watcher

# Test MCP server
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | \
  VAULT_PATH=... PG_PASSWORD=... OPENAI_API_KEY=... npx tsx src/mcp/index.ts
```

### Phase 11: Claude Code MCP Config

```bash
# Prerequisites: VPN active, SSH config for obsidian-vm (10.10.0.1)

# Add MCP server to Claude Code (global scope)
claude mcp add --scope user obsidian-brain -- \
  ssh obsidian-vm "cd /home/sorensen/obsidian_open_brain && \
  export \$(cat .env | xargs) && npx tsx src/mcp/index.ts"

# Verify
claude mcp list
```

Available MCP tools: `write_note`, `read_note`, `delete_note`, `search_semantic`, `search_text`, `list_recent`

### Search Tools: Metadata-Only by Default

`search_semantic`, `search_text`, and `list_recent` return **metadata only** (no content) by default to keep responses compact. Use `read_note` to fetch full content after identifying the relevant notes.

All three tools share the same pagination parameters:

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | number | 10 (search) / 20 (text) | Max results |
| `offset` | number | 0 | Skip N results (pagination) |
| `include_content` | boolean | false | Include full note content in results |
| `content_preview_length` | number | 0 | Chars of content to include as preview (0 = none) |

All search tools return a `PaginatedResult`:
```json
{ "results": [...], "total": 42, "limit": 10, "offset": 0 }
```

**Typical workflow:**
```
search_semantic("kafka consumer") → returns titles/paths/tags
read_note("path/to/note.md")     → fetch full content of chosen note
```

## Calendar → Obsidian Sync

The `sync-calendar` Claude Code skill syncs Google Calendar events into the Obsidian vault on demand.

**Skill location:** `~/.claude/skills/sync-calendar/SKILL.md`

**Capabilities:**
- Fetches events from Google Calendar for any date range
- Captures full Gemini AI meeting notes from Gmail (`gemini-notes@google.com`)
- Skips events where the user did not participate (declined, optional-not-accepted, no-response)
- Deduplicates: checks vault before creating a note
- Creates notes in `7 - Meeting Notes/` using Dataview inline fields (no YAML frontmatter)
- Tags as wikilinks to `3 - Tags/`
- Batch processes large date ranges via parallel subagents

**Usage (invoke from Claude Code):**
```
/sync-calendar 2026-03-01 2026-03-31
```

**Automation (planned):** `feat/calendar-automation` — standalone TypeScript script on the VM with cron (1–2h interval), using Google Calendar API + Gmail API directly (no Claude session required).

## VM Services (systemd)

```bash
# Watcher auto-starts on boot
sudo systemctl status obsidian-watcher    # check status
sudo journalctl -u obsidian-watcher -f    # follow logs

# MCP Server is invoked on-demand by Claude Code via SSH (no systemd needed)
```

## Project Status

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | GCP Infrastructure | Complete |
| 2 | WireGuard VPN | Complete |
| 3 | Git Vault Sync | Complete |
| 4 | PostgreSQL + pgvector | Complete |
| 5 | Embedding Service | Complete |
| 6 | Vault Watcher | Complete |
| 7 | MCP Server | Complete |
| 8 | Integration Testing | Complete |
| 9 | Cloud Run Panel | Deferred |
| 10 | Backups & Monitoring | Pending |
| 11 | Claude Code MCP Config | Complete |

## Documentation

- [Design](docs/plans/2026-03-07-obsidian-open-brain-design.md)
- [Implementation Plan](docs/plans/2026-03-07-obsidian-open-brain-plan.md)
- [Handoff](docs/HANDOFF.md)
- [Technical Handoff](docs/TECHNICAL_HANDOFF.md)
- [TODO](TODO.md)

## License

Private project.
