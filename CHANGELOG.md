# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Changed
- Prepare repository for open source release
- Remove personal artifacts and internal documentation
- Redact personal infrastructure details (IPs, project IDs, service accounts)
- Rewrite CLAUDE.md as contributor guide
- Refactor installer to use config values instead of hardcoded usernames/paths
- Fix shell injection vulnerability in deploy step
- Update README with badges, improved splash, and public install instructions
- Add CONTRIBUTING.md, CODE_OF_CONDUCT.md, and GitHub issue/PR templates

## [0.1.3] — 2026-04-04

### Fixed
- Systemic fix: `shell()` utility now wraps all commands with `cmd.exe /c` on Windows, resolving `.cmd`/`.bat` execution for all 43+ `gcloud` call sites (#17, #21)
- GCP authentication verification failing on Windows (#21) — `getActiveAccount()` used `execFile('gcloud', ...)` which couldn't resolve `gcloud.cmd`
- `LOX_VERSION` and `DEFAULT_CONFIG.version` were hardcoded at `0.1.0` while `package.json` was at `0.1.2` — splash screen showed wrong version
- Windows "command not found" errors now produce clean `Command not found: <cmd>` messages instead of raw `cmd.exe` error output

### Changed
- `LOX_VERSION` now reads dynamically from `package.json` — version can never desync again
- `DEFAULT_CONFIG.version` imports `LOX_VERSION` from constants instead of hardcoding
- Removed per-caller `.cmd` fallback in `checkGcloud()` — handled systemically by `shell()`

## [0.1.2] — 2026-04-04

### Fixed
- gcloud CLI Windows detection fix was incomplete (#17). Node.js `execFile()` cannot execute `.cmd`/`.bat` files at all — not even with explicit extension. Changed fallback to use `cmd.exe /c gcloud --version` which properly resolves `gcloud.cmd` via the Windows command interpreter. Args remain hardcoded with no injection risk.

## [0.1.1] — 2026-04-04

### Fixed
- gcloud CLI not detected on Windows during installation (#17). Google Cloud SDK installs `gcloud.cmd` (batch wrapper), which Node.js `execFile()` doesn't resolve. Added explicit `gcloud.cmd` fallback for Windows without compromising `execFile` security.

## [0.1.0] — 2026-04-03

> **Note:** Version reset to 0.1.0. Previous version numbers (0.1.0–0.4.0) reflected internal phase milestones, not public SemVer. This entry marks the first versioned public-facing release of Lox.

### Changed (Breaking)
- **Renamed project**: obsidian_open_brain → **Lox** (`isorensen/lox-brain`). All references to the old name are deprecated.
- **Monorepo restructure**: codebase split into `packages/core`, `packages/shared`, `packages/installer` using npm workspaces.

### Added
- `packages/installer` — interactive 12-step CLI wizard (i18n: en/pt-BR, 17 security gates)
- `packages/shared` — types, `LoxConfig` schema, constants (`LOX_VERSION`, `EMBEDDING_MODEL`, etc.)
- Cross-platform bootstrap scripts: `scripts/install.sh` + `scripts/install.ps1`
- `lox migrate` command for existing installations
- MIT License
- Vault presets: `templates/zettelkasten/` (6 templates + folder structure) and `templates/para/`
- Infra templates: `infra/postgres/schema.sql`, `infra/wireguard/`, `infra/systemd/lox-watcher.service`
- `created_by TEXT` column in schema for future multi-user support
- Security hardening: secrets rotated (PG_PASSWORD + OPENAI_API_KEY), OpenAI key scoped to Embeddings-only
- Zettelkasten notes renamed from "Open Brain" to "Lox" throughout `docs/zettelkasten/`

### Changed
- All hardcoded values (DB name/user, GCP project, VPN IPs) replaced with configurable `createPool()` factory
- Embedding model and chunking constants moved to `@lox-brain/shared`
- CI/CD updated for monorepo: sequential build (shared → core → installer), parameterized deploy secrets
- All 4 Claude Code skills updated: `obsidian-brain` MCP reference → `lox-brain`
- `lox-watcher` systemd service replaces `obsidian-watcher.service`
- Secrets location: `/etc/lox/secrets.env` (chmod 640, root:<user>) replaces `.env` in repo root

### Fixed
- npm audit: picomatch vulnerability resolved
- CI build order: shared package must build before core and installer (sequential steps)
- `.tsbuildinfo` files removed from git tracking

---

## Historical Phase Log (pre-SemVer)

These entries document internal development phases completed before the public release. Version numbers below are phase identifiers, not SemVer releases.

### Phase 0.4 — 2026-03-12 (sync-calendar skill)

- `sync-calendar` Claude Code skill: on-demand Google Calendar → Obsidian vault sync via MCPs (Calendar + Gmail + Obsidian Brain)
- Gemini AI meeting notes integration via `gemini-notes@google.com` emails
- Subagent batch processing for large syncs
- Smart event filtering (skips declined/non-participating events)
- Note format: plain text + Dataview inline fields, tags as wikilinks to `3 - Tags/`
- Battle-tested: 67 events synced across March 2026

### Phase 0.3 — 2026-03-10 (CI/CD)

- GitHub Actions CI workflow (`ci.yml`): build, type check, test coverage (80%+), security audit on PRs
- GitHub Actions deploy workflow (`deploy.yml`): auto-deploys to VM via GCP IAP tunnel SSH on merge to main
- GCP service account `github-actions-deploy` with least-privilege IAM roles
- Health check step in deploy workflow verifies watcher service is active

### Phase 0.2 — 2026-03-08 (search optimization)

- `search_semantic`, `search_text`, `list_recent` return metadata only by default (no content)
- New parameters on all search tools: `offset`, `include_content`, `content_preview_length`
- All search tools return `PaginatedResult { results, total, limit, offset }`
- `searchText` default limit changed from 50 to 20

### Phase 0.1 — 2026-03-08 (initial system)

- Phase 1–4: GCP infrastructure (VPC, VM, WireGuard VPN, PostgreSQL + pgvector)
- Phase 5: `EmbeddingService` — OpenAI `text-embedding-3-small`, `parseNote`, `computeHash`
- Phase 6: `VaultWatcher` — chokidar file watcher with embedding pipeline
- Phase 7: MCP Server with 6 tools: `write_note`, `read_note`, `delete_note`, `search_semantic`, `search_text`, `list_recent`
- Phase 8: Integration testing — vault indexed (181/186 notes), watcher validated end-to-end
- Phase 11: Claude Code MCP client config via SSH + WireGuard VPN
- Systemd service `obsidian-watcher.service` for auto-start on boot
- `index-vault` script for one-time vault indexing (idempotent, hash-based skip)
- Interactive Code Map and Concept Map playgrounds
