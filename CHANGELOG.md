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

## [0.3.1] — 2026-04-04

### Fixed
- SSH hardening phase fails with `Unit sshd.service not found` (#44). On Debian/Ubuntu the service is `ssh`, not `sshd`. Changed `systemctl restart sshd` → `systemctl restart ssh`.

## [0.3.0] — 2026-04-04

### Added
- Command string safety tests for Windows cmd.exe compatibility (#43). Validates all `execSync` command strings for unquoted shell operators (`&&`, `||`, `|`, `>`, `<`, `^`), unquoted `--command` values with spaces, and operators inside `--command="..."`.
- Exported pure builder functions (`buildWarmupCommand`, `buildSshExecCommand`, `buildScpCommand`, `buildSshExecScriptCommand`) for testable command construction.
- `assertCmdExeSafe()` utility in `cmd-safety.ts` for reusable cmd.exe safety validation.
- Regression guards that would have caught issues #38 and #40 before shipping.

## [0.2.6] — 2026-04-04

### Fixed
- `&&` in `--command` interpreted by cmd.exe as command separator on Windows (#40). Removed inline `rm -f` cleanup from `sshExecScript` — temp scripts in `/tmp` are cleaned on VM reboot.
- Phase and DB setup error handlers now extract gcloud stderr via `extractExecError()` helper, so auto-reports include the actual error instead of generic "Command failed" wrapper.
- Deduplicated stderr extraction logic into shared `extractExecError()` function (was copy-pasted in 3 catch blocks).

## [0.2.5] — 2026-04-04

### Fixed
- SSH warmup `--command=echo ok` fails on Windows: gcloud parses the space as a separate argument (#38). Changed warmup to `--command=true` and added double-quote wrapping to all `--command` values in sshExec/sshExecScript.
- Auto-report missing actual gcloud error (#38). SSH warmup now captures stderr via `stdio: ['inherit','inherit','pipe']` and the error handler extracts gcloud `ERROR:` lines instead of the generic Node.js wrapper message.

## [0.2.4] — 2026-04-04

### Fixed
- `--strict-host-key-checking=accept_new` is not a valid gcloud value (#35). Changed to `--strict-host-key-checking=no` (valid choices: ask, no, yes).
- Auto-report issue body truncated on Windows (#35). Multiline `--body` argument was mangled by `cmd.exe /c`. Now uses `--body-file` with a temp file for reliable cross-platform behavior.

## [0.2.3] — 2026-04-04

### Fixed
- Semantic search returning empty results after VM/PostgreSQL restart (#34). The ivfflat index becomes inconsistent on restart — now automatically reindexed on MCP server startup.

## [0.2.2] — 2026-04-04

### Fixed
- `--ssh-flag="-o StrictHostKeyChecking=accept-new"` not recognized by gcloud (#31). Replaced with native `--strict-host-key-checking=accept_new` flag.
- `LOX_VERSION` was hardcoded in installer `index.ts` — now imported from `@lox-brain/shared`.

### Added
- Auto-issue-reporting: when the installer fails, offers to create a GitHub issue via `gh` CLI with sanitized error details (redacts GCP project IDs, service accounts, Windows paths, billing IDs).
- Centralized `handleStepFailure()` in index.ts — all 12 steps now use consistent error handling with auto-report.

## [0.2.1] — 2026-04-04

### Fixed
- SSH command parsing on Windows (#31). `cmd.exe` was interpreting `&&` and double quotes in SSH commands. Replaced with SCP-based approach: script written to temp file, uploaded to VM, then executed — completely avoids shell quoting issues.
- First SSH connection hanging forever (#31). `gcloud compute ssh` on first connect asks for passphrase and host key interactively. Added `sshWarmup()` with `stdio: 'inherit'` before phase loop, plus `--quiet` and `StrictHostKeyChecking=accept-new` for subsequent calls.

## [0.2.0] — 2026-04-04

### Added
- VM setup progress feedback (#29): monolithic SSH script split into 7 individual phases (system update, Node.js, PostgreSQL, pgvector compile, DB setup, SSH hardening, WireGuard), each with its own spinner and timeout
- VM log fetching on timeout: when a phase times out, installer attempts to fetch last 20 lines from the VM for diagnosis
- Per-phase timeout retry: each phase can be retried individually with doubled timeout
- `/issue new <desc>` mode in the `/issue` skill for creating new issues
- Disclaimer section in README: data responsibility, GCP costs, no liability for breaches
- i18n: 8 new VM phase strings in en and pt-BR

### Changed
- Version bump from 0.1.x to 0.2.0 (feature release)

## [0.1.7] — 2026-04-04

### Fixed
- VM setup SSH command timing out at 30s (#27). `sshExec()` now uses the declared `SSH_TIMEOUT` constant (5 min default, 10 min for full setup script).
- Secret Manager password storage using `bash -c` which doesn't exist on Windows. Replaced with cross-platform temp file approach.
- No error handling in `stepVmSetup` — SSH and secret storage failures now return clean messages.

### Added
- Timeout retry prompt: when VM setup times out, user is asked "Continue waiting?" instead of failing immediately. Timeout doubles on each retry (max 20 min).

## [0.1.6] — 2026-04-04

### Fixed
- IAM binding `--condition=None` flag causing parse error on gcloud (#21). Removed the flag entirely — no condition is the default behavior.
- Service account "does not exist" error during IAM binding (#21). GCP propagation delay after SA creation now handled with 5s initial delay + retry (3 attempts, 5s between each).
- Raw stack traces on IAM binding and VM creation failures — now caught with clean error messages.
- VM creation timeout — increased to 120s (was 30s default, VM creation takes 30-60s).

## [0.1.5] — 2026-04-04

### Fixed
- `gcloud services enable` timeout on new GCP projects (#21). Default 30s was too short — APIs now enabled one at a time with 120s timeout and per-API spinner feedback
- Raw stack traces on API enable failures — all errors now caught and shown as clean messages
- `install.ps1` temp directory cleanup failing on Windows due to file handle contention — added retry with delay
- `install.ps1` silently continuing after `npm ci` or `npm run build` failures — added exit guards

### Changed
- `shell()` now accepts optional `{ timeout }` parameter (default 30s) for long-running commands
- Timeout errors now produce clean `Command timed out after Xms: <cmd>` messages

## [0.1.4] — 2026-04-04

### Added
- Billing account detection and linking in GCP project setup step (#21). The installer now:
  - Checks if the project has a billing account linked before enabling APIs
  - Lists available billing accounts and lets the user select one
  - Links the selected billing account automatically via `gcloud billing projects link`
  - If no billing accounts exist, guides the user to create one at the GCP Console and waits
- i18n: 8 new billing-related strings in en and pt-BR

### Fixed
- `gcloud services enable` no longer crashes with raw stack trace when billing is missing (#21). Now shows a clear error message.

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
