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
                                         +-- MCP Server (TypeScript, stdio or HTTP transport)
                                         +-- WireGuard VPN (UDP 51820)

Client --VPN--> VM (10.10.0.1) --> MCP Server --> tools
```

**Transports:** The MCP server supports two transport modes controlled by `MCP_TRANSPORT`:
- `stdio` (default) — used for single-user personal mode, launched by Claude Code directly
- `http` — used for team mode; binds to `MCP_HOST` (default `127.0.0.1`, set to VPN interface for multi-user), port `MCP_PORT` (default `3100`). Uses session-based `StreamableHTTPServerTransport`. The caller's VPN IP is extracted from `req.socket.remoteAddress` for peer attribution.

**Identity attribution (`created_by`):** resolved server-side per request, never from client-supplied args. Resolution order: (a) trusted-proxy actor — a caller presenting a valid `X-Lox-Proxy-Secret` (matching `LOX_TRUSTED_PROXY_SECRET`) may forward an `X-Lox-Actor` header, for backend integrations that reach the MCP over the private network without being a registered WireGuard peer; (b) the caller's WireGuard peer, resolved from source IP; (c) stripped (anti-spoofing) when neither resolves. See `packages/core/.env.example` and `packages/core/src/mcp/trusted-proxy.ts`.

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
# The runtime entrypoints live in the core workspace, not the root — running
# these without --workspace fails with `Missing script`.
npm run mcp --workspace=packages/core          # start MCP server (dev, tsx)
npm run mcp:prod --workspace=packages/core     # start MCP server (prod, node dist)
npm run watcher --workspace=packages/core      # start vault watcher (dev)
npm run index-vault --workspace=packages/core  # one-time vault indexing
```

`index-vault` reads `VAULT_PATH`, `PG_PASSWORD` and `OPENAI_API_KEY` from the
environment. systemd supplies them to the services from an `EnvironmentFile`,
but a manual shell does not — on a VM, load them first with
`set -a; . /etc/lox/secrets.env; set +a`.

## Configuration

The installer (`packages/installer`) handles initial setup. After installation, runtime configuration is stored in `~/.lox/config.json`. This includes vault path, database connection details, OpenAI API key reference, and WireGuard peer settings. Do not commit this file -- it is excluded by `.gitignore`.

To reconfigure after installation, edit `~/.lox/config.json` directly or re-run the installer.

## Monorepo Structure

```
lox-brain/
  packages/
    shared/                # Constants, types, config (consumed by core + installer)
      src/
        config.ts
        constants.ts       # LOX_VERSION (read dynamically from package.json)
        types.ts
    core/                  # Runs on the GCP VM
      src/
        lib/               # Embedding service, DB client
        mcp/               # MCP server (stdio + HTTP transport)
          index.ts         # Server entry point, transport selection
          tools.ts         # Tool definitions
          transports.ts    # TransportConfig, getTransportConfig()
          trusted-proxy.ts # resolveTrustedActor() — trusted-proxy identity forwarding
        watcher/           # Vault watcher (chokidar)
        scripts/           # index-vault, migrations
      tests/
    installer/             # Cross-platform setup wizard (Win/macOS/Linux)
      src/
        steps/             # step-*.ts — ordered install steps
        utils/             # shell(), windows-acl, etc.
    team/                  # Team mode (commercial license; see README "Team Mode")
      src/
        license/           # License validation
        multi-user/        # peer-resolver.ts, created-by-middleware.ts
        mcp-extensions/    # Team-only tools (list_team_activity, search_by_author)
  infra/
    systemd/               # lox-mcp.service, lox-watcher.service
    wireguard/             # WireGuard config templates
    postgres/              # PostgreSQL config
  docs/
    plans/                 # Historical planning docs (pre-monorepo)
    internal/              # Gitignored (strategy, pricing — not public)
    zettelkasten/
    superpowers/
  ROADMAP.md               # Public roadmap (Phase 0-4)
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

Table `vault_embeddings`: `id` (UUID PK), `file_path` (TEXT), `chunk_index` (INTEGER, default 0), `title`, `content`, `tags` (TEXT[]), `embedding` (vector(1536)), `file_hash` (SHA256), `created_by` (TEXT, default ''), `created_at`, `updated_at`. Unique constraint on `(file_path, chunk_index)`. Indexes: ivfflat on embedding (cosine), GIN on tags, btree on updated_at DESC.

## Conventions

- Code and commits in English
- Commit messages: imperative mood ("Add feature", not "Added feature")
- TDD cycle: write test first, implement after
- Update README.md, CHANGELOG.md, TODO.md after each delivery
- **Versioning (SemVer):** Every PR must include a version bump in all `package.json` files (root + packages/*). Patch for fixes, minor for features, major for breaking changes. Update CHANGELOG.md with the new version entry.
- **GitHub Releases:** After merging a PR, create a GitHub Release with tag `vX.Y.Z` (e.g., `v0.1.1`). Use the CHANGELOG entry as the release notes body.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on submitting issues, opening pull requests, branching conventions, and the code review process.
