# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Lox** (formerly Open Brain) is a hybrid personal knowledge management system connecting a local Obsidian Vault with PostgreSQL+pgvector on a GCP VM, exposed via an MCP Server accessible through WireGuard VPN. Claude Code acts as a first-class client, reading/writing notes and performing semantic search.

**Core principle:** Obsidian Vault is the source of truth. pgvector is a read index derived from it.

## Architecture

```
Local (Obsidian Desktop) <--git sync--> VM (GCE)
                                         |
                                         +-- PostgreSQL 16 + pgvector (localhost only)
                                         +-- Vault Watcher (chokidar, detects .md changes)
                                         +-- Embedding Service (OpenAI text-embedding-3-small)
                                         +-- MCP Server (TypeScript, Anthropic SDK)
                                         +-- WireGuard VPN (UDP 51820)

Client --VPN--> VM (10.10.0.1) --> MCP Server --> tools
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

## Configuration

The installer (`packages/installer`) handles initial setup. After installation, runtime configuration is stored in `~/.lox/config.json`. This includes vault path, database connection details, OpenAI API key reference, and WireGuard peer settings. Do not commit this file -- it is excluded by `.gitignore`.

To reconfigure after installation, edit `~/.lox/config.json` directly or re-run the installer.

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

## Database Schema

Database: `lox_brain`, User: `lox`

Table `vault_embeddings`: `id` (UUID PK), `file_path` (TEXT UNIQUE), `title`, `content`, `tags` (TEXT[]), `embedding` (vector(1536)), `file_hash` (SHA256), `created_at`, `updated_at`. Indexes: ivfflat on embedding (cosine), GIN on tags, btree on updated_at DESC.

## Conventions

- Code and commits in English
- Commit messages: imperative mood ("Add feature", not "Added feature")
- TDD cycle: write test first, implement after
- Update README.md, CHANGELOG.md, TODO.md after each delivery
- **Versioning (SemVer):** Every PR must include a version bump in all `package.json` files (root + packages/*). Patch for fixes, minor for features, major for breaking changes. Update CHANGELOG.md with the new version entry.
- **GitHub Releases:** After merging a PR, create a GitHub Release with tag `vX.Y.Z` (e.g., `v0.1.1`). Use the CHANGELOG entry as the release notes body.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on submitting issues, opening pull requests, branching conventions, and the code review process.
