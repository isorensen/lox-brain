# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

- CI/CD pipeline stabilized (deploy script, SSH keepalive, proper error handling)

## [0.4.0] — 2026-03-12

### Added
- `sync-calendar` Claude Code skill (`~/.claude/skills/sync-calendar/SKILL.md`): on-demand Google Calendar → Obsidian vault sync via existing MCPs (Calendar + Gmail + Obsidian Brain)
- Gemini AI meeting notes integration: captures full content (summary, topics, next steps with owners) from `gemini-notes@google.com` emails via Gmail MCP
- Subagent batch processing for large syncs (parallel event processing)
- Smart event filtering: skips events where user did not participate, declined, or was optional and did not accept
- Note format: plain text + Dataview inline fields, tags as wikilinks to `3 - Tags/` (no YAML frontmatter)
- Memory rule persisted for vault note format: `memory/feedback_obsidian_note_format.md`

### Tested
- Full month sync: 67 events created across March 2026 (all-day, timed, meetings with/without Gemini notes)
- 12 improvements applied based on real-world usage during battle-testing

## [0.3.0] — 2026-03-10

### Added
- GitHub Actions CI workflow (`ci.yml`): validates PRs with build, type check, test coverage (80%+), and security audit
- GitHub Actions deploy workflow (`deploy.yml`): auto-deploys to VM via GCP IAP tunnel SSH on merge to main
- GCP service account `github-actions-deploy` with least-privilege IAM roles
- Health check step in deploy workflow verifies watcher service is active
- CI/CD design document and implementation plan

### Changed
- Updated TODO.md: marked text chunking as DONE, added SA key rotation tracking

## [0.2.0] — 2026-03-08

### Added
- Search optimization: `search_semantic`, `search_text`, `list_recent` return metadata only by default (no content).
- New parameters on all search tools: `offset`, `include_content`, `content_preview_length`.
- All search tools now return `PaginatedResult { results, total, limit, offset }` for consistent pagination.

### Changed
- `searchText` default limit changed from 50 to 20.
- Recommended workflow: use search tools to discover notes, then `read_note` for full content.

### Operational Notes
- MCP server runs via stdio over SSH (spawned on-demand by Claude Code).
- After code changes on VM: `pkill -f "tsx src/mcp/index.ts"`, then `/mcp` → reconnect in Claude Code.

## [0.1.0] — 2026-03-08

### Added
- Phase 1–4: GCP infrastructure (VPC, VM, WireGuard VPN, PostgreSQL + pgvector).
- Phase 5: `EmbeddingService` — OpenAI `text-embedding-3-small`, `parseNote`, `computeHash`.
- Phase 6: `VaultWatcher` — chokidar file watcher with embedding pipeline.
- Phase 7: MCP Server with 6 tools: `write_note`, `read_note`, `delete_note`, `search_semantic`, `search_text`, `list_recent`. Path traversal protection via `safePath()`.
- Phase 8: Integration testing — vault indexed (181/186 notes), watcher validated end-to-end.
- Phase 11: Claude Code MCP client config via SSH + WireGuard VPN.
- Systemd service `obsidian-watcher.service` for auto-start on boot.
- `index-vault` script for one-time vault indexing (idempotent, hash-based skip).
- Interactive Code Map and Concept Map playgrounds.
