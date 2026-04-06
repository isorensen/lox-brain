# Session Handoff — 2026-04-06

## What was accomplished

### Issues closed (5 issues, 12 releases: v0.6.14 → v0.7.2)
- **#122** vault empty after install — cpSync verification + git commit/push (v0.6.14)
- **#119** 7 audit failures — all 7 were check bugs in gates.ts, not installer gaps (v0.6.15–v0.6.18)
- **#121** lox status stub — replaced with actionable instructions (v0.6.19)
- **#107** PAT in git config — switched to GIT_ASKPASS (v0.6.20)
- **#85** Claude Skills — shipped 4 skills: zettelkasten, obsidian-ingest, sync-calendar, para (v0.7.0–v0.7.2)

### Team mode work (on `feat/team-mode` branch, PR #16)
- Merged 141 commits from main into feat/team-mode (resolved 7 conflicts)
- Fixed 5 integration gaps: DB schema created_by (#136), WireGuard peer config placeholders (#137), HTTP transport in secrets.env (#138), license public key persistence (#139), VPN subnet separation (#140)
- Added multi-config support (#141): team configs save to `~/.lox/teams/<org>/config.json`
- Fixed installer UX: GCP project name suggests org (#143), vault repo uses org owner (#144), Obsidian detection via PATH (#146), deferred peer .conf generation to step 8 (#142)

### First Credifit team mode install completed
- GCP project: `lox-brain-credifit`
- VM: `lox-vm` in `us-east1-b`, VPN at `35.231.177.73:51820`
- Subnet: `10.20.0.0/24` (wg1) — coexists with personal `10.10.0.0/24` (wg0)
- Vault: `credifit-br/lox-vault-credifit` (GitHub)
- MCP: `lox-brain-credifit` registered in Claude Code (stdio mode)
- Watcher running, indexing works (after manual chunk_index fix)
- Local vault at `~/Obsidian/Lox-Credifit` (manually renamed)
- SSH config entry `lox-credifit` added to `~/.ssh/config`
- License keypair in `~/.lox/license-keys/` (also backed up in 1Password Credifit)

### Manual fixes applied to Credifit VM (not yet in installer code)
- `ALTER TABLE vault_embeddings ADD COLUMN chunk_index INTEGER NOT NULL DEFAULT 0` (#152)
- `GRANT ALL ON TABLE vault_embeddings TO lox` (permission fix)
- Unique constraint changed to `(file_path, chunk_index)`
- PEM public key stored as `/etc/lox/license-public.pem` instead of in secrets.env (#151)
- `lox-mcp.sh` updated to load PEM from file

## What's pending — open issues (priority order)

### P0 — Blocks team distribution to Matheus/Lucas
1. **#153** — Wire HTTP transport for `created_by` peer attribution. Without this, all notes are anonymous. The MCP runs in stdio; needs HTTP (port 3100) + SSH tunnel for IP-based identity.
2. **#152** — `chunk_index` column missing from installer schema. Already fixed manually on Credifit VM; needs fix in `step-vm-setup.ts`.

### P1 — Team installer UX (already hit during Credifit validation)
3. **#149** — MCP server name should include org (overwrote personal `lox-brain`)
4. **#150** — Skill copy should not overwrite user's existing customized skills
5. **#151** — PEM public key breaks `bash source` (multi-line in secrets.env)
6. **#148** — Obsidian vault local_path should include org suffix
7. **#147** — Add SSH config entry for VM after VPN setup
8. **#145** — Resume flow skips team pre-steps

### P2 — Pre-existing
9. **#126** — HTTP transport for Windows Claude Desktop compatibility

## Branch state

- **`main`**: v0.7.2, all CI green, 464 tests
- **`feat/team-mode`**: 27 commits ahead of main, 663 tests, NOT yet merged (PR #16)
- The team mode branch has all the bug fixes from main plus team-specific code

## Key architectural decisions made this session

1. **Personal vs Team VPN subnets**: 10.10.0.0/24 (wg0) vs 10.20.0.0/24 (wg1)
2. **Multi-config**: `~/.lox/config.json` (personal) + `~/.lox/teams/<org>/config.json` (team)
3. **GIT_ASKPASS**: PAT no longer in .git/config; fetched from Secret Manager per-operation
4. **License PEM**: stored as `/etc/lox/license-public.pem` file, loaded by lox-mcp.sh (not in secrets.env)
5. **Skills coexistence**: managed via `/mcp` context switching, not duplicated skills

## Next session priority

**Fix #153 first** (HTTP transport wiring) — this is the only blocker before distributing configs to Matheus and Lucas. Then fix #152 and #149 in the installer code.

## Sensitive data check
- No API keys, tokens, passwords, or personal emails in repo or issues ✓
- License keypair in `~/.lox/license-keys/` (gitignored) + 1Password ✓
- PEM on VM at `/etc/lox/license-public.pem` (not in repo) ✓
