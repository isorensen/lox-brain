<div align="center">

```
 ██╗      ██████╗ ██╗  ██╗
 ██║     ██╔═══██╗╚██╗██╔╝
 ██║     ██║   ██║ ╚███╔╝
 ██║     ██║   ██║ ██╔██╗
 ███████╗╚██████╔╝██╔╝ ██╗
 ╚══════╝ ╚═════╝ ╚═╝  ╚═╝
```

### Where knowledge lives.

[![CI](https://github.com/isorensen/lox-brain/actions/workflows/ci.yml/badge.svg)](https://github.com/isorensen/lox-brain/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) (core packages) | [![License: Commercial](https://img.shields.io/badge/License-Commercial-blue.svg)](packages/team/LICENSE) (team package)
[![Node.js](https://img.shields.io/badge/Node.js-22%20LTS-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)

</div>

# Lox

Lox is a hybrid personal knowledge management system that connects a local [Obsidian](https://obsidian.md) vault with PostgreSQL+pgvector for semantic search, exposed via an MCP Server over WireGuard VPN. Claude Code is a first-class client -- reading, writing, and searching notes through natural language.

**Core principle:** The Obsidian Vault is the source of truth. pgvector is a read index derived from it.

## Architecture

```
Local (Obsidian Desktop) <--git sync--> VM (GCE e2-small, us-east1)
                                         |
                                         +-- PostgreSQL 16 + pgvector (localhost only)
                                         +-- Vault Watcher (chokidar, detects .md changes)
                                         +-- Embedding Service (OpenAI text-embedding-3-small)
                                         +-- MCP Server (TypeScript, stdio over SSH)
                                         +-- WireGuard VPN (UDP 51820)

Claude Code --VPN--> MCP Server --> tools
```

**Data flow:** Local edit -> git push -> VM git pull (cron 2min) -> Watcher -> OpenAI embedding -> pgvector upsert. Reverse: Claude Code -> MCP Server -> creates .md -> Watcher -> embedding -> pgvector -> git push -> local pull.

## Features

- **Semantic search** across your entire vault using OpenAI embeddings + pgvector
- **Full-text search** with PostgreSQL tsvector
- **MCP Server** with 6 tools accessible from Claude Code
- **Vault watcher** that auto-indexes new and modified notes
- **Text chunking** for large notes (4000 tokens, 200 overlap)
- **Zero Trust security** -- no public IPs, VPN-only access, secrets in GCP Secret Manager
- **Git sync** between local vault and VM (bidirectional, 2-min cron)
- **Claude Skills** shipped out of the box (`/zettelkasten`, more coming) for day-one workflows
- **CI/CD** via GitHub Actions (build, test, deploy over IAP tunnel)
- **[Calendar ingest](docs/calendar-ingest.md)** -- captures Gemini meeting notes from Google Calendar ceremonies into vault notes, via a keyless domain-wide-delegation service account

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) 22 LTS or later
- [Git](https://git-scm.com/)
- A GCP account (for VM infrastructure)
- [Obsidian](https://obsidian.md) (for local vault editing)

### Install

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/isorensen/lox-brain/main/scripts/install.sh | bash

# Windows (PowerShell)
irm https://raw.githubusercontent.com/isorensen/lox-brain/main/scripts/install.ps1 | iex

# Or clone and run manually
git clone https://github.com/isorensen/lox-brain.git
cd lox-brain
bash scripts/install.sh
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `write_note` | Create or update a note in the vault |
| `read_note` | Read the full content of a note by path |
| `delete_note` | Delete a note from the vault and index |
| `search_semantic` | Semantic search using embeddings (cosine similarity); `sort: 'recency'` reranks the relevant notes by date |
| `search_text` | Full-text search using PostgreSQL tsvector |
| `list_recent` | List recently modified notes |

All search tools return metadata only by default. Use `read_note` to fetch full content after finding notes. Pagination parameters: `limit`, `offset`, `include_content`, `content_preview_length`.

## Claude Skills

Lox ships with Claude Skills that provide opinionated workflows on top of the MCP tools. Installed automatically to `~/.claude/skills/` during setup.

| Skill | Description |
|-------|-------------|
| `/zettelkasten` | Generate atomic smart notes from project codebases (3 modes: full scan, topic-focused, review) |
| `/obsidian-ingest` | Ingest URLs, images, PDFs, and text into the vault with semantic deduplication and categorization |
| `/sync-calendar` | Sync Google Calendar events to meeting notes, with optional Gemini AI summary integration |
| `/para` | Organize content using the PARA method (Projects, Areas, Resources, Archives) |

## Monorepo Structure

```
lox-brain/
  packages/
    shared/                # Constants, types, config
    core/                  # MCP server, vault watcher, embedding service (runs on VM)
    installer/             # Cross-platform setup wizard (runs locally)
  skills/
    zettelkasten/          # /zettelkasten Claude Skill
    obsidian-ingest/       # /obsidian-ingest Claude Skill
    sync-calendar/         # /sync-calendar Claude Skill
    para/                  # /para Claude Skill
  docs/
    plans/                 # Design docs and implementation plan
  templates/
    para/                  # PARA vault template
    zettelkasten/          # Zettelkasten vault template
  .github/
    workflows/             # CI/CD (build, test, deploy)
```

## Security (Zero Trust)

- VM public IP **restricted to VPN endpoint** (WireGuard UDP 51820 only)
- PostgreSQL listens on **localhost only** (127.0.0.1)
- Firewall: **deny-all** default, only UDP 51820 (WireGuard) open
- SSH via **IAP tunnel only** (Google range 35.235.240.0/20)
- Secrets in **GCP Secret Manager** (never hardcoded)
- Dedicated **service accounts** with least-privilege roles
- Default VPC **deleted** to reduce attack surface
- Cloud NAT for **outbound-only** internet access
- **Cloud Logging** with audit trail

## Development

```bash
npm install                              # Install all dependencies
npm run build --workspaces               # Build all packages
npm run test --workspace=packages/core   # Run tests (vitest)
npm run test:coverage                    # Coverage report (target: 80%+)
npm run watcher --workspace=packages/core      # Start vault watcher (dev, tsx)
npm run index-vault --workspace=packages/core  # One-time full vault indexing
```

## Operations

### Run the MCP server from the compiled build

Clients (Claude Code on each machine, scripts, anything that spawns the MCP over ssh) should run the compiled server:

```bash
node packages/core/dist/mcp/index.js
```

Not `npx tsx packages/core/src/mcp/index.ts`. The MCP is spawned once per stdio connection, and `tsx` transpiles on every spawn: about 3 s more per start and roughly twice the memory per process tree (~100 MB against ~50 MB), which adds up with several sessions open on a 2 GB VM.

### Deploy on the VM after a `git pull`

`dist` is not rebuilt by CI, so a `git pull` alone leaves the VM serving the old code. `bash infra/deploy.sh` does the whole sequence; by hand it is:

```bash
npm ci
npm run build --workspaces       # rebuild dist; build off the VM if memory is tight, then sync dist
# if infra/postgres/schema.sql changed, re-apply it as the table owner (see infra/deploy.sh)
sudo systemctl restart lox-watcher   # when the watcher's code changed (packages/core/src/watcher or src/lib)
```

MCP processes that are already running keep the code they started with until their client reconnects.

### Boot-time reindex

The MCP server rebuilds the ivfflat indexes (`REINDEX`, or a resize when the row count has drifted) at most once per PostgreSQL boot. It records the last run in the `lox_maintenance` table and compares it with `pg_postmaster_start_time()`; concurrent starts are serialized by an advisory lock, and a start that finds the lock taken skips instead of waiting. Each start logs one line on stderr:

- `ivfflat: reindexed (no reindex recorded | last reindex at … predates PostgreSQL start at …): …`
- `ivfflat: reindex skipped (already reindexed at …, after PostgreSQL started at …)`
- `ivfflat: reindex skipped (another process holds the reindex lock)`
- `ivfflat: reindex skipped (lox_maintenance missing; apply infra/postgres/schema.sql)`: the runtime role could not create the table. Re-apply `schema.sql` as the owner (`infra/deploy.sh` does); until then no start reindexes.
- `ivfflat: reindexed (…; marker not recorded (<error>); every start will reindex until fixed): …`: the reindex succeeded but the marker write failed, so the next start reindexes again. That is the pre-0.21.1 behavior, still serialized by the lock; fix the error (usually table privileges on `lox_maintenance`).

A crash recovery is **not** a new boot. When a backend dies (for example OOM-killed), the postmaster resets the other backends and replays WAL but keeps running, so `pg_postmaster_start_time()` does not change and the next start skips. Only a real restart of the PostgreSQL service counts. To force a pass after a crash recovery, or at any other time, delete the marker and start an MCP:

```sql
DELETE FROM lox_maintenance WHERE task = 'ivfflat_reindex';
```

## Chunking

Notes are split into chunks before embedding. Three optional variables tune this; the defaults are unchanged.

| Variable | Default | Meaning |
|----------|---------|---------|
| `LOX_CHUNK_MAX_TOKENS` | `4000` | Maximum chunk size, from 1 to 6000 (estimated at 3 characters per token) |
| `LOX_CHUNK_OVERLAP_TOKENS` | `min(200, max / 5)` | Overlap between chunks; must be smaller than the maximum |
| `LOX_EMBED_TITLE` | `true` | Prepend the note title to every chunk before embedding |

Things to know before changing them:

- **Put them in `/etc/lox/secrets.env`.** Both systemd units load that file, and so should a manual re-index: `set -a; . /etc/lox/secrets.env; set +a; npm run index-vault`. Set anywhere else, a manual re-index silently runs with the defaults.
- **Re-index after changing them.** `file_hash` depends on the note content only, so without a re-index the notes you edit afterwards use the new settings and every other note keeps its old chunks, with no warning.
- **`LOX_EMBED_TITLE=false` trades title lookups for cleaner small chunks.** The `# Title` heading stays in the first chunk, so notes that repeat their title in the body are still found by it. A note whose title lives only in the frontmatter can no longer be found by its title, because text search indexes `content` only and the title is no longer part of the embedding.

## Cost

Estimated monthly cost: **~US$18/month** (GCE e2-small + 30GB pd-ssd + Cloud NAT + minimal traffic).

## Lox Team (Commercial)

Lox Team extends the personal brain into a shared, multi-user knowledge base
for corporate teams. It is available under a commercial license.

### What Team Mode adds

- **Multi-user identity** via WireGuard VPN peers -- each user is identified
  by their VPN IP, no auth server needed.
- **`created_by` attribution** -- every note is tagged with its author
  automatically (from the caller's VPN peer, or from an authenticated trusted
  proxy such as the chat backend via a shared-secret-gated identity header).
- **Team MCP tools** -- `list_team_activity` and `search_by_author` for
  cross-team knowledge discovery.
- **Installer team flow** -- guided setup for license validation, peer
  generation, and WireGuard config distribution.

### Licensing

| Package | License |
|---------|---------|
| `packages/core` | MIT |
| `packages/shared` | MIT |
| `packages/cli` | MIT |
| `packages/installer` | MIT |
| `packages/team` | Commercial (see `packages/team/LICENSE`) |

Personal mode (single user) is free and open source. Team mode (2+ users)
requires a commercial license key. Contact eduardo@isorensen.dev for
licensing inquiries.

## Status

Lox is under active development. The installer and infrastructure setup are being tested and refined. Breaking changes may occur between minor versions. Check the [CHANGELOG](CHANGELOG.md) and [releases](https://github.com/isorensen/lox-brain/releases) for details.

## Disclaimer

This software is provided "as-is" without warranty of any kind. By using Lox, you acknowledge that:

- **You are responsible for your own data.** Lox stores personal notes, credentials, and API keys on infrastructure you provision. The authors are not responsible for any data loss, unauthorized access, or security incidents arising from misconfiguration, vulnerabilities, or misuse.
- **GCP costs are your responsibility.** The installer provisions cloud resources (VMs, storage, networking) on your GCP account. Monitor your billing to avoid unexpected charges.
- **No liability for data breaches.** While Lox follows Zero Trust security principles (VPN-only access, encrypted connections, least-privilege IAM), no system is immune to vulnerabilities. The authors disclaim all liability for personal or corporate data exposure.
- **Review before deploying in production.** This project is designed for personal use. If you use it in a corporate or team environment, conduct your own security review.

See the [MIT License](LICENSE) for the full legal terms.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[MIT](LICENSE)
