# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Lox** (formerly Open Brain) is a hybrid personal knowledge management system connecting a local Obsidian Vault with PostgreSQL+pgvector on a GCP VM, exposed via an MCP Server accessible through WireGuard VPN. Claude Code acts as a first-class client, reading/writing notes and performing semantic search.

**Core principle:** Obsidian Vault is the source of truth. pgvector is a read index derived from it.

### Relationship with `obsidian-ingest` skill

The Claude Code skill `obsidian-ingest` (`~/.claude/skills/obsidian-ingest/`) is a **separate project**. It writes notes directly to the local vault filesystem without requiring any infrastructure. Lox is the evolution: a full system with semantic search (pgvector), remote access (MCP Server over VPN), and automated embedding pipeline. They share the same vault and note format but are independent -- `obsidian-ingest` works without Lox, and vice versa.

## Architecture

```
Local (Obsidian Desktop) <--git sync--> VM (GCE e2-small, us-east1-b)
                                         |
                                         +-- PostgreSQL 16 + pgvector (localhost only)
                                         +-- Vault Watcher (chokidar, detects .md changes)
                                         +-- Embedding Service (OpenAI text-embedding-3-small)
                                         +-- MCP Server (TypeScript, Anthropic SDK)
                                         +-- WireGuard VPN (UDP 51820, 2 peers)

Claude Code (Arch 10.10.0.2 | Mac 10.10.0.3) --VPN--> MCP Server --> tools
```

**Data flow:** Local edit -> git push -> VM git pull (cron 2min) -> Watcher -> OpenAI embedding -> pgvector upsert. Reverse: Claude Code -> MCP Server -> creates .md -> Watcher -> embedding -> pgvector -> git push -> local pull.

## Tech Stack

- **Language:** TypeScript (Node.js 22 LTS)
- **Database:** PostgreSQL 16 + pgvector (vector(1536), ivfflat index)
- **Testing:** vitest (TDD, min 80% coverage)
- **MCP Server:** `@anthropic-ai/sdk`
- **File watcher:** chokidar
- **Embeddings:** OpenAI `text-embedding-3-small`
- **Infra:** GCP (Compute Engine, Cloud Run, Secret Manager, Cloud Logging), WireGuard VPN

## Build & Test Commands

```bash
npm install
npm run build --workspaces               # tsc (all packages)
npm run test --workspace=packages/core   # vitest (core package)
npm run test:coverage                    # vitest --coverage (target: 80%+)
npm run dev                              # tsx watch for development
npm run mcp                              # start MCP server (dev, tsx)
npm run mcp:prod                         # start MCP server (prod, node dist)
npm run watcher                          # start vault watcher (dev)
npm run index-vault                      # one-time vault indexing
```

### MCP Server Restart After Code Changes

The MCP server runs via **stdio over SSH** -- it is spawned on-demand by Claude Code per session. After deploying code changes to the VM:

1. Kill any lingering process on the VM:
   ```bash
   pkill -f "tsx packages/core/src/mcp/index.ts"
   ```
2. Reconnect in Claude Code: run `/mcp` -> select `lox-brain` -> reconnect, **or** restart Claude Code entirely.

Without this step, the old binary remains in memory and changes will not take effect.

### SSH Connection

The SSH user on the VM is **`sorensen`** (configurable per deployment). SSH config (`~/.ssh/config`):

```
Host lox-vm
  HostName 10.10.0.1
  User sorensen
  IdentityFile ~/.ssh/google_compute_engine
```

> **Note:** WireGuard VPN must be active before SSH connects. Arch Linux uses `10.10.0.2`; Mac uses `10.10.0.3`.

## Monorepo Structure

```
lox-brain/
  packages/
    core/
      src/
        lib/               # Embedding service, DB client
        mcp/               # MCP server (stdio transport)
        watcher/           # Vault watcher (chokidar)
      tests/
    cli/                   # CLI tool (lox status, lox migrate)
    installer/             # Cross-platform installer
  docs/
    plans/
```

## Implementation Plan

The project follows an 11-phase plan with explicit gate approval between phases. See `docs/plans/2026-03-07-obsidian-open-brain-plan.md` for full details.

- **Phases 1-4:** Infrastructure (GCP VPC/VM, WireGuard, Git sync, PostgreSQL+pgvector)
- **Phase 5:** Embedding Service library (TypeScript, TDD)
- **Phase 6:** Vault Watcher (chokidar + embedding pipeline)
- **Phase 7:** MCP Server (6 tools)
- **Phase 8:** Integration testing (end-to-end)
- **Phase 9:** Cloud Run panel (VM start/stop)
- **Phase 10:** Backups & monitoring
- **Phase 11:** Claude Code MCP client config

**Rule:** No phase advances without explicit user confirmation at its gate.

## Key Documentation

- `docs/HANDOFF.md` -- Current phase status and session resumption prompt
- `docs/TECHNICAL_HANDOFF.md` -- Architecture overview and principles
- `docs/plans/2026-03-07-obsidian-open-brain-design.md` -- Detailed design (components, schema, stack)
- `docs/plans/2026-03-07-obsidian-open-brain-plan.md` -- 11-phase implementation plan with tasks and gates

## Security (Zero Trust)

- VM has no public IP; all access via WireGuard VPN
- PostgreSQL listens on localhost only (127.0.0.1)
- Firewall: deny-all default, only UDP 51820 open
- Secrets (OpenAI key, Git token) in GCP Secret Manager, never hardcoded
- Cloud Logging with audit trail for all access
- Daily disk snapshots for backup

## Security & Engineering Standards

### Infrastructure Security (CRITICAL)
- **NEVER** expose database ports (5432, 3306, 6379, 27017) to 0.0.0.0 or public IPs.
- **ALWAYS** enable SSL/TLS on all database connections.
- **ALWAYS** enable automated backups on database instances.
- **NEVER** assign public IPs to database instances. Use VPC/private networking.
- **NEVER** create firewall rules with source 0.0.0.0/0 for SSH/RDP/DB ports.
- **NEVER** use primitive IAM roles (Editor/Owner) on service accounts.
- **ALWAYS** deploy Cloud Run/Lambda with authentication required (`--no-allow-unauthenticated`).
- **ALWAYS** use dedicated service accounts with least-privilege roles.

### Secrets Management (CRITICAL)
- **NEVER** hardcode passwords, API keys, or tokens in source code.
- **ALWAYS** use GCP Secret Manager for production secrets.
- **ALWAYS** ensure .gitignore covers: `.env`, `*.pem`, `*.key`, `credentials.json`, `service-account*.json`
- If a secret is committed accidentally: **rotate immediately** (removing from history is not enough).

### Code Security
- **ALWAYS** use prepared statements / parameterized queries for SQL.
- **ALWAYS** sanitize output to prevent XSS.
- **ALWAYS** configure security headers (CSP, HSTS, X-Frame-Options, X-Content-Type-Options).
- **NEVER** use CORS `Access-Control-Allow-Origin: *` in production.
- **ALWAYS** implement rate limiting on public endpoints.

### Node.js Security
- Run `npm audit` before committing.
- Use `helmet` for security headers in Express apps.
- Use `express-rate-limit` for rate limiting.
- Never use dynamic code execution or string-to-code conversion with user input.

### LGPD/BACEN Compliance
- **ALWAYS** encrypt personal data at rest and in transit.
- **ALWAYS** implement audit logging for personal data access.
- **ALWAYS** use anonymized data in non-production environments.

## Database Schema

Database: `lox_brain`, User: `lox`

Table `vault_embeddings`: `id` (UUID PK), `file_path` (TEXT UNIQUE), `title`, `content`, `tags` (TEXT[]), `embedding` (vector(1536)), `file_hash` (SHA256), `created_at`, `updated_at`. Indexes: ivfflat on embedding (cosine), GIN on tags, btree on updated_at DESC.

## Conventions

- Communication in pt-BR; code and commits in English
- Commit messages: imperative mood, English ("Add feature", not "Added feature")
- TDD cycle: write test first, implement after
- Update README.md, CHANGELOG.md, TODO.md after each delivery
