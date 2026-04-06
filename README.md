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
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
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
| `search_semantic` | Semantic search using embeddings (cosine similarity) |
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
npm run dev                              # Dev mode (tsx watch)
npm run watcher                          # Start vault watcher
npm run index-vault                      # One-time full vault indexing
```

## Cost

Estimated monthly cost: **~US$18/month** (GCE e2-small + 30GB pd-ssd + Cloud NAT + minimal traffic).

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
