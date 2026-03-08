# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

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
