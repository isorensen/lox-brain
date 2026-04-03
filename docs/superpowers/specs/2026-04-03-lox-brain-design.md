# Lox Brain — Design Spec

**Date:** 2026-04-03
**Author:** Eduardo Sorensen + Claude
**Status:** Approved
**Branch:** `feat/lox-restructure`

## 1. Identity

**Name:** Lox (from Latin *locus* — the place where something resides)
**Tagline:** "Where knowledge lives"
**Repo:** `isorensen/lox-brain` (private now, prepared for MIT public release)
**License:** MIT (prepared, activated when open-sourced)

### Name Rationale

| Origin | Meaning | Connection |
|--------|---------|------------|
| Latin *locus* | Place, position | The place where your knowledge lives |
| English *locks* (phonetic) | Locks, keys | Zero Trust — knowledge protected |
| Aerospace LOX | Liquid Oxygen — rocket fuel | Fuel for thought |

### ASCII Logo (approved)

```
  _        ___   __  __
 | |      / _ \  \ \/ /
 | |     | | | |  \  /
 | |___  | |_| |  /  \
 |_____|  \___/  /_/\_\
```

## 2. Architecture — Monorepo with Workspaces

```
lox-brain/
├── packages/
│   ├── core/                 # MCP server, watcher, embedding, db-client
│   │   ├── src/
│   │   ├── tests/
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── installer/            # Interactive CLI wizard
│   │   ├── src/
│   │   │   ├── index.ts              # entry point
│   │   │   ├── steps/                # each wizard step
│   │   │   ├── ui/                   # branding, boxes, spinners
│   │   │   ├── checks/               # prerequisite validations
│   │   │   └── security/             # audit gates
│   │   ├── package.json              # bin: "lox"
│   │   └── tsconfig.json
│   └── shared/               # types, config schema, constants
│       ├── src/
│       ├── package.json
│       └── tsconfig.json
├── templates/
│   ├── zettelkasten/         # vault preset (6 templates, folder structure)
│   ├── para/                 # vault preset PARA method
│   └── obsidian-plugins/     # .obsidian/ config (git, dataview, omnisearch)
├── infra/
│   ├── gcloud/               # parameterized templates (VPC, VM, firewall, NAT)
│   ├── wireguard/            # config templates (server + client)
│   ├── systemd/              # service files
│   └── postgres/             # schema DDL, pg_hba.conf template
├── scripts/
│   ├── install.sh            # bootstrap Linux/macOS
│   └── install.ps1           # bootstrap Windows
├── docs/
├── package.json              # workspace root
├── LICENSE                   # MIT
└── README.md                 # new, generic, Lox branding
```

## 3. Installer — Interactive Wizard

### 3.1 Overview

- **Language:** TypeScript (Node.js)
- **UI libraries:** `chalk` (colors), `ora` (spinners), `inquirer` (prompts), `boxen` (boxes)
- **Cross-platform:** Single codebase for Windows, macOS, Linux
- **i18n:** English and pt-BR (user selects at step 0)
- **Bootstrap:** `install.sh` (Mac/Linux) / `install.ps1` (Windows) installs Node if needed, then runs `npx lox`

### 3.2 Splash Screen

```
╭─────────────────────────────────────────────────╮
│                                                 │
│    _        ___   __  __                        │
│   | |      / _ \  \ \/ /                        │
│   | |     | | | |  \  /                         │
│   | |___  | |_| |  /  \                         │
│   |_____|  \___/  /_/\_\                        │
│                                                 │
│         Where knowledge lives.                  │
│                                                 │
│    Personal AI-powered Second Brain             │
│    Semantic search · MCP Server · Obsidian      │
│                                                 │
│    v1.0.0 · by iSorensen                        │
│                                                 │
╰─────────────────────────────────────────────────╯
```

### 3.3 Wizard Steps

| # | Step | What it does | Automatic? | Security Gate? |
|---|------|-------------|------------|----------------|
| 0 | **Language** | Select English or pt-BR | Manual | — |
| 1 | **Prerequisites Check** | Validate/install: Node, git, gcloud CLI, WireGuard, Claude Code | Auto-install via winget/brew/apt | — |
| 2 | **GCP Auth** | `gcloud auth login` (opens browser) | Partial | — |
| 3 | **GCP Project** | Create project `lox-brain-<username>`, enable APIs | Yes | — |
| 4 | **Billing** | Guide to link billing in Console, show cost estimate (~US$18/mo) | Manual (pause with instructions) | Warning: budget alert |
| 5 | **Network & Firewall** | Create custom VPC, subnet, firewall deny-all + UDP 51820, Cloud NAT, delete default VPC | Yes | **Gate: validate deny-all, no public IP** |
| 6 | **VM Provisioning** | Create dedicated SA, VM e2-small, no public IP, IAP SSH | Yes | **Gate: validate no-address, SA least-privilege** |
| 7 | **VM Setup** | Via SSH IAP: install Node, PostgreSQL, pgvector, create DB, apply schema | Yes | **Gate: PG localhost only, secrets in Secret Manager** |
| 8 | **WireGuard VPN** | Create static IP, configure server + client, activate tunnel | Yes | **Gate: split tunnel, key permissions** |
| 9 | **Vault Setup** | Create private repo on GitHub, choose preset (Zettelkasten/PARA), configure git sync on VM, install pre-commit hooks | Yes | **Gate: repo private, .gitignore validated, fine-grained PAT, branch protection** |
| 10 | **Obsidian** | Install Obsidian (winget/brew), clone vault, copy .obsidian/ config with plugins | Partial (plugin activation is manual) | — |
| 11 | **Deploy Lox Core** | Clone lox-brain on VM, `npm install`, configure watcher systemd, test MCP server | Yes | **Gate: audit log enabled** |
| 12 | **Claude Code MCP** | `claude mcp add` with correct SSH config | Yes | — |

### 3.4 Post-install: Security Audit

Runs automatically after step 12. Validates all security gates:

```
╭──────────────────────────────────────────────────╮
│  Security Audit — All checks passed              │
│                                                  │
│  * Vault repo is private                         │
│  * Branch protection enabled                     │
│  * .gitignore covers sensitive patterns           │
│  * GitHub PAT: fine-grained, 90-day expiry        │
│  * VM has no public IP                            │
│  * Firewall: deny-all + UDP 51820 only            │
│  * SSH: IAP only, no password auth, no root login │
│  * SSH: key-per-user, key permissions validated    │
│  * PostgreSQL: localhost only                      │
│  * Disk encryption: enabled (GCP default)          │
│  * Secrets: GCP Secret Manager                     │
│  * VPN: split tunnel, key permissions OK           │
│  * Service account: least privilege                │
│  * Default VPC: deleted                            │
│  * Cloud Logging: audit trail active               │
│  * Remote URL: HTTPS (not HTTP)                    │
│  * Pre-commit: gitleaks active                     │
│                                                  │
│  Your brain is secure. Zero Trust verified.       │
╰──────────────────────────────────────────────────╯
```

### 3.5 Post-install: Security Hygiene

```
╭──────────────────────────────────────────────────╮
│  Security Hygiene — 3 Rules to Remember          │
│                                                  │
│  1. Never make your vault repo public.            │
│     Your notes are private. Keep them that way.  │
│                                                  │
│  2. Rotate your GitHub token every 90 days.       │
│     You'll get a reminder. It takes 2 minutes.   │
│                                                  │
│  3. Keep your VPN key private.                    │
│     Treat it like a house key. Don't share it.   │
│                                                  │
╰──────────────────────────────────────────────────╯
```

### 3.6 Post-install: Success Screen

```
╭──────────────────────────────────────────────────╮
│                                                  │
│  Lox is ready.                                   │
│                                                  │
│  Your Second Brain is live.                      │
│                                                  │
│  * Obsidian vault: ~/Obsidian/Lox                │
│  * MCP server: connected via VPN                 │
│  * Claude Code: lox-brain MCP configured         │
│                                                  │
│  Next steps:                                     │
│    1. Open Obsidian and explore your vault        │
│    2. Ask Claude: "search my brain for..."        │
│    3. Start adding notes!                         │
│                                                  │
│  Run 'lox status' anytime to check your setup.   │
│                                                  │
╰──────────────────────────────────────────────────╯
```

## 4. Configuration — Zero Hardcodes

All values parameterized. Installer collects them and generates `~/.lox/config.json` on the VM.

| Current hardcoded value | Parameter | Source |
|------------------------|-----------|--------|
| `sorensen` (SSH user) | `LOX_VM_USER` | Installer detects from `gcloud` |
| `obsidian-open-brain` (GCP project) | `LOX_GCP_PROJECT` | Installer generates: `lox-brain-<username>` |
| `us-east1-b` (region) | `LOX_GCP_REGION` / `LOX_GCP_ZONE` | Installer suggests cheapest, user chooses |
| `10.10.0.1` (VPN server) | `LOX_VPN_SERVER_IP` | Auto-generated |
| `10.10.0.2/3` (VPN clients) | `LOX_VPN_CLIENT_IP` | Auto-incremented per client |
| `open_brain` (DB name) | `LOX_DB_NAME` | Default `lox_brain`, configurable |
| `obsidian_brain` (DB user) | `LOX_DB_USER` | Default `lox`, configurable |
| `obsidian-brain` (MCP server name) | `lox-brain` | Fixed |
| `/home/sorensen/obsidian_open_brain` | `LOX_INSTALL_DIR` | Derived: `$HOME/<user>/lox-brain` |
| `/home/sorensen/obsidian/vault` | `LOX_VAULT_DIR` | Derived: `$HOME/<user>/vault` |
| `isorensen/obsidian-git-sync` (vault repo) | `LOX_VAULT_REPO` | Installer creates: `<gh-user>/lox-vault` |

### Config file schema (`~/.lox/config.json`)

```json
{
  "version": "1.0.0",
  "mode": "personal",
  "gcp": {
    "project": "lox-brain-lara",
    "region": "us-east1",
    "zone": "us-east1-b",
    "vm_name": "lox-vm",
    "service_account": "lox-vm-sa@lox-brain-lara.iam.gserviceaccount.com"
  },
  "database": {
    "host": "127.0.0.1",
    "port": 5432,
    "name": "lox_brain",
    "user": "lox"
  },
  "vpn": {
    "server_ip": "10.10.0.1",
    "subnet": "10.10.0.0/24",
    "listen_port": 51820,
    "peers": [
      {
        "name": "lara-windows",
        "ip": "10.10.0.2",
        "public_key": "...",
        "added_at": "2026-04-03T12:00:00Z"
      }
    ]
  },
  "vault": {
    "repo": "larauser/lox-vault",
    "local_path": "/home/lara/vault",
    "preset": "zettelkasten"
  },
  "install_dir": "/home/lara/lox-brain",
  "installed_at": "2026-04-03T12:00:00Z"
}
```

## 5. Security Gates (mandatory, block installation on failure)

### Network & Infrastructure
- VM has no public IP (`--no-address` validated)
- Custom VPC with deny-all default (no auto-subnets)
- Firewall: only UDP 51820 open (WireGuard)
- Default VPC deleted
- Cloud NAT for outbound-only internet
- Disk encryption enabled (GCP default, validated)

### SSH
- SSH via IAP tunnel only (firewall source `35.235.240.0/20`)
- SSH key per user (never shared)
- SSH key file permissions (`chmod 600` / Windows ACL equivalent)
- `PasswordAuthentication no` in sshd_config
- `PermitRootLogin no` in sshd_config

### Database
- PostgreSQL listens on localhost only (`listen_addresses = 'localhost'`)
- Password stored in GCP Secret Manager (never in files)

### VPN
- Split tunnel (`AllowedIPs = 10.10.0.0/24`, not `0.0.0.0/0`)
- WireGuard private key permissions restricted to user
- Remote URL uses HTTPS (not HTTP)

### Git & Vault
- Vault repo is private (validated via `gh repo view --json isPrivate`)
- Branch protection enabled on main
- `.gitignore` covers: `.env`, `*.pem`, `*.key`, `credentials.json`, `service-account*.json`, `token*.json`
- GitHub PAT: fine-grained, scoped to vault repo only, 90-day expiry
- Pre-commit hook: gitleaks active

### Access & Secrets
- Dedicated service account with least-privilege roles (secretAccessor + logWriter)
- All secrets in GCP Secret Manager (never hardcoded)
- Cloud Logging enabled with audit trail

## 6. Vault Templates

### Zettelkasten preset (recommended, based on Eduardo's vault)

```
1 - Fleeting Notes/
2 - Projects/
2 - Source Material/
    ├── Articles/
    ├── Books/
    ├── Podcasts/
    ├── Videos/
    └── Other/
3 - Tags/
5 - Templates/
    ├── Full Note.md
    ├── Meeting Notes.md
    ├── People Note.md
    ├── Task.md
    ├── Source Material.md
    └── Date.md
6 - Atomic Notes/
7 - Meeting Notes/
attachments/
Welcome to Lox.md
```

### PARA preset (Tiago Forte method)

```
1 - Inbox/
2 - Projects/
3 - Areas/
4 - Resources/
5 - Archive/
Templates/
    ├── Note.md
    ├── Meeting.md
    └── Project.md
Welcome to Lox.md
```

### Obsidian plugins (pre-configured for both presets)

- `obsidian-git` — vault sync
- `dataview` — metadata queries
- `omnisearch` — full-text search
- `emoji-shortcodes` — emoji insertion
- `recent-files-obsidian` — quick file access

## 7. Multi-user Preparation (Credifit — future)

Not implemented now, but design must not block it.

### Model
- One VM, one PostgreSQL, one vault, one MCP server
- Each user has: own WireGuard key, own SSH key, own VPN IP
- All access the same database and vault
- Permissions: all read/write (RBAC deferred)

### Design decisions taken NOW to avoid blocking
- `vpn_peers[]` array in config (supports N users)
- `created_by TEXT` column in `vault_embeddings` table (nullable, backward-compatible)
- Installer flag `--mode=personal|team` adjusts defaults (team skips Obsidian install)

### Future commands (not implemented now)
- `lox add-user` — add new VPN peer + SSH key
- `lox remove-user` — revoke access
- RBAC (read-only vs read-write)

## 8. Migration (`lox migrate`)

For existing `obsidian_open_brain` installations (Eduardo's current setup).

### On VM
1. Generate `~/.lox/config.json` from current values
2. Move/symlink install directory to new path
3. Update systemd service (`obsidian-watcher`) paths
4. Update git remote to `isorensen/lox-brain`
5. Update `deploy.yml` with new paths

### On local machine
1. Update SSH config alias (optional — `obsidian-vm` still works)
2. Update Claude Code MCP: `claude mcp remove obsidian-brain` → `claude mcp add lox-brain ...`
3. Update Claude Code skills referencing `obsidian-brain`

### Script
`lox migrate` command detects old installation and performs migration automatically with confirmation at each step.

## 9. Repo Migration Plan

1. Create branch `feat/lox-restructure`
2. Restructure codebase into monorepo with workspaces
3. Parameterize all hardcoded values
4. Run `gitleaks detect` on full git history
5. If clean → rename repo on GitHub (`obsidian_open_brain` → `lox-brain`)
6. If secrets found → `git filter-branch` to clean → rename
7. Make public when ready (separate decision)

## 10. Future (deferred to TODO)

- **Lox Local Mode** — run everything locally without GCP (PostgreSQL local, no VPN, zero cost)
- **Lox add-user / remove-user** — multi-user management for team mode
- **RBAC** — role-based access control for team vaults
- **Lox CLI** — `lox search`, `lox ingest`, `lox status` as standalone commands
