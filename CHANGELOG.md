# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [0.6.10] — 2026-04-05

### Fixed
- `fixWindowsAcl` now grants to `DOMAIN\USERNAME` instead of bare `USERNAME` (#113). On a domain-joined Windows machine, bare `USERNAME` doesn't resolve to the user's actual domain account, so `icacls /grant:r alice:(F)` silently no-ops ("successfully processed 1 file" reported, but the ACE is never written). The user then has NO access to their own SSH key and OpenSSH fails with `Load key "...": Permission denied` — a DIFFERENT failure from the "UNPROTECTED PRIVATE KEY FILE" error we fixed in #101. Fix reads `USERDOMAIN` (standard Windows-populated env var, equals domain name on domain-joined, computer name on workgroup) and builds the fully-qualified principal. Falls back to bare `USERNAME` if `USERDOMAIN` is unset (non-standard environments).


## [0.6.9] — 2026-04-05

### Fixed
- Step 12 now tightens the gcloud `~/.ssh/google_compute_engine` private key ACLs on every re-run (#109). v0.6.7's `tightenGcloudSshKey` call was placed AFTER an early-return path in `configureSshConfig` that fires whenever `~/.ssh/config` already has the `Host lox-vm` entry — i.e. on every re-run. Meanwhile `ensureVmIdentity` (which runs earlier in step 12) calls `gcloud compute ssh`, which regenerates the key with fresh inherited loose Windows ACLs every single time. Net result: re-runs always failed with "UNPROTECTED PRIVATE KEY FILE! CREATOR OWNER (S-1-3-4)" — the fix from v0.6.7/v0.6.8 was unreachable. Restructured the branch so `tightenGcloudSshKey` runs unconditionally at the end. Exported `configureSshConfig` and added 2 regression tests (both branches invoke the tightening).


## [0.6.8] — 2026-04-05

### Fixed
- **Step 11 — `PG_PASSWORD` missing from `/etc/lox/secrets.env` (#103).** The DB password that step 7 (VM Setup) generates and stores in Secret Manager as `lox-db-password` was never read back by step 11. The watcher crashed on every install with "PG_PASSWORD environment variable or explicit password is required" and systemd restart-looped it forever. Step 11 now fetches `lox-db-password` from Secret Manager and includes it in secrets.env. If the secret is missing, returns an actionable failure pointing the user at step 7.
- **Step 11 — `VAULT_PATH` used the user's LOCAL Obsidian folder (#104-A).** `ctx.config.vault.local_path` is the user's Obsidian path on their Windows/macOS machine (e.g. `~/Obsidian/Lox`). Step 11 wrongly copied that into the VM's `VAULT_PATH`. systemd's `EnvironmentFile=` doesn't expand `~`, and the VM doesn't have the user's Obsidian layout anyway. Now always uses the VM-side absolute path `${vmHome}/lox-vault`.
- **Step 9 — VM never cloned the vault repo (#104-B).** `buildVmSetupScript` wrote `~/sync-vault.sh` with `cd ~/lox-vault` but nothing in the installer ever ran `git clone` on the VM. Cron fired silently every 2 minutes, watcher watched a missing directory, Node exited cleanly with no events, systemd restart-looped. Added a one-time idempotent clone at the top of the VM setup script (checks `~/lox-vault/.git` first, fetches PAT from Secret Manager on the VM, embeds it in the remote URL so subsequent `git fetch`/`push` in sync-vault.sh work without a credential helper).
- **Step 9 — template copy silently failed on Windows (#105).** `cp -r templates/<preset>/. <vaultDir>` invoked `cp` which doesn't exist on Windows. The generic `try/catch` swallowed the error and printed the MISLEADING message "Template directory not found" even though the templates existed. Replaced with `fs.cpSync(..., { recursive: true, force: true })` (no shell, cross-platform by construction). Dropped the swallowing catch so a real packaging regression would surface loudly.
- **Step 12 — `fixWindowsAcl` hardening for gcloud SSH key (#101 follow-up).** v0.6.7's `/inheritance:r` + `/grant:r user:F` only stripped inherited ACEs, leaving EXPLICIT `CREATOR OWNER` / `BUILTIN\Users` ACEs on the gcloud-created key file intact. OpenSSH still rejected the key with "UNPROTECTED PRIVATE KEY FILE". Now also explicitly removes the 4 common loose principals (CREATOR OWNER, BUILTIN\Users, Authenticated Users, Everyone) via `icacls /remove` before granting the current user.


## [0.6.7] — 2026-04-05

### Fixed
- Step 12 (MCP Server) now tightens ACLs on the gcloud-created `~/.ssh/google_compute_engine` private key on Windows (#101). Earlier steps (VM Setup, Deploy) invoke `gcloud compute ssh`, which creates the key with inherited loose Windows ACLs (CREATOR OWNER / BUILTIN\Users). Step 12's `scp lox-vm:...` then failed with "UNPROTECTED PRIVATE KEY FILE! Bad permissions" because OpenSSH on Windows validates identity-file permissions before use. The fix (#83) was already applied to `~/.ssh/` and `~/.ssh/config`, just not to the key itself. Extracted `tightenGcloudSshKey` as a testable helper and added 3 regression tests (no-op when key missing, no-op on non-Windows, invokes icacls on Windows when key exists).


## [0.6.6] — 2026-04-05

### Fixed
- Step 8 (WireGuard VPN) now restarts `wg-quick@wg0` on the VM instead of only starting it (#99). Previously re-runs of step 8 generated new server and client keys, overwrote `/etc/wireguard/wg0.conf`, then called `sudo systemctl start wg-quick@wg0` — but `start` is a no-op when the service is already active, so the kernel kept the previous peer keys loaded and client handshakes silently failed ("Handshake for peer 1 did not complete after 5 seconds" repeating indefinitely in the WireGuard log). `restart` stops and re-reads the config, syncing kernel state with the new keys on every step 8 run. Extracted the server-deploy script construction into a pure testable function so the `restart` invariant is locked in with a regression test.
- Step 11 (Deploy) has the same class of bug: `sudo systemctl start lox-watcher` was a no-op on re-run, leaving the watcher loaded with the previous unit file / environment. Changed to `restart` so re-runs of step 11 (after an OpenAI key change, new VAULT_PATH, updated unit file, etc.) correctly reload the service.


## [0.6.5] — 2026-04-05

### Fixed
- User-actionable step failures (like the VPN-not-active check from #93) no longer trigger the "Would you like to report this issue on GitHub?" prompt (#96). Previously any `{success: false}` return from a step caused `handleStepFailure` to offer an auto-report, even for conditions the user could fix themselves (WireGuard not activated, missing prerequisite, etc.), leading to GitHub issues being filed for expected recoverable states. Steps can now mark failures with `actionable: true` to skip the bug-report prompt while still persisting state for resume and printing the guidance message. Applied to the step 12 VPN preflight for now; a follow-up pass will audit other `{success: false}` returns (prerequisites, GCP config missing, etc.).

### Changed
- Extracted `handleStepFailure` from `src/index.ts` into `src/step-failure.ts` with injected dependencies so the failure-handling logic is directly unit-testable.


## [0.6.4] — 2026-04-05

### Fixed
- Step 12 (MCP Server) now detects an inactive WireGuard VPN tunnel before attempting the launcher upload (#93). Previously the raw `scp lox-vm:...` would hang until its 60s timeout and then surface as an unhandled exception ("Connection timed out" to the VPN IP), leaving the user with a stack trace. A fast TCP preflight probe to `vpn_server_ip:22` now runs first: if the tunnel isn't up, step 12 returns a clean failure with platform-aware activation guidance (Windows: WireGuard GUI app → import client config → Activate; macOS: GUI or `sudo wg-quick up ~/.config/lox/wireguard/wg0.conf`; Linux: `sudo wg-quick up …`). Combined with the resume feature (#81/#92), the user activates WireGuard and re-runs — step 12 picks up where it left off.


## [0.6.3] — 2026-04-05

### Fixed
- Installer resume now works across Lox releases (#92). Previously `loadState` strict-rejected any saved state whose `lox_version` did not match the currently running installer, so re-running `irm .../install.ps1 | iex` after a new release shipped (install.ps1 always pulls the latest tarball) silently skipped the resume prompt and restarted from step 1. `schema_version` — bumped whenever `InstallerContext` changes shape — is now the sole compatibility gate. The `lox_version` field stays in the state file (and is shown in the resume-prompt summary as "Saved: … (Lox vX.Y.Z)") so the user can see when state comes from a previous release.


## [0.6.2] — 2026-04-05

### Fixed
- Step 3 (GCP Project) now recovers when the chosen project ID is claimed globally by another account (#90). Previously \`gcloud projects describe\` would return 404 (not accessible to the current account), the installer would call \`gcloud projects create\`, and gcloud would fail with "The project ID you specified is already in use by another project" — crashing the install. This happens routinely when the user previously created the project under a different gcloud login, or when a same-named project was soft-deleted <30 days ago (GCP reserves the ID for the grace period). The installer now catches this specific error, explains the situation, suggests a numeric-suffix variant, and re-prompts. Up to 3 attempts before failing cleanly.


## [0.6.1] — 2026-04-05

### Fixed
- Step 11 (Deploy) now retries transient SSH / IAP tunnel drops up to 3 times with 2s/4s backoff before failing (#87). GCP's IAP relay occasionally drops long-lived \`gcloud compute ssh --tunnel-through-iap\` connections mid-command (errors like "Remote side unexpectedly closed network connection", \`ECONNRESET\`, \`kex_exchange_identification\`, IAP \`4003\`/\`4033\` codes), which previously failed the install on any flake. Non-transient errors (permission, missing script, quota) still fail immediately without wasted retries.
- The main installer loop now catches thrown exceptions from any step and persists state (failed_step) before re-throwing, so the v0.5.0 resume prompt can offer to restart from the exact step that threw. Previously only returned \`{success: false}\` failures saved state; throws bubbled up without a resumable checkpoint.


## [0.6.0] — 2026-04-05

### Added
- Step 11 (Deploy) now prompts the user for their OpenAI API key with a masked input, validates format, uploads it to GCP Secret Manager as `openai-api-key`, and injects it directly into `/etc/lox/secrets.env` on the VM (#84). Previously the installer left an `OPENAI_API_KEY=__REPLACE_FROM_SECRET_MANAGER__` placeholder and instructed the user to fix it manually with `gcloud secrets versions access...`, which left every fresh install in a broken state until the user knew to run that command. If the secret already exists in Secret Manager (e.g. on re-runs), the installer offers to reuse the existing key, replace it, or skip.

### Changed
- The previous "IMPORTANT: Replace OPENAI_API_KEY..." yellow warning in step 11 is gone — it now appears only as a fallback when the user explicitly chose to skip the prompt.


## [0.5.1] — 2026-04-05

### Fixed
- Step 12 (MCP) now strips inherited NTFS ACLs from `~/.ssh/config` on Windows via `icacls /inheritance:r /grant:r "<USERNAME>":F` after writing the file. OpenSSH refuses to read configs with inherited ACEs (e.g. the "Owner Rights" SID S-1-3-4), so `scp`/`ssh lox-vm` failed with "Bad owner or permissions" even after `chmodSync(path, 0o600)` — Windows `chmod` does not touch NTFS ACLs (#83). The same fix is applied to `~/.ssh/` when the installer creates it, and to the config file on resume runs where the entry was already present from a previous failed install.
- The error-reporter's Windows user-path redactor now handles mixed separators (`C:\Users\<name>/.ssh/...`) that OpenSSH emits on Windows, so auto-reports no longer leak the user's Windows account name when scp/ssh errors reference `.ssh/config`.


## [0.5.0] — 2026-04-05

### Added
- Installer can now resume a partial installation (#81). State is persisted to `~/.lox/installer-state.json` (mode 0600) after every successful step and after any failure. On re-run, if saved state is found, the installer shows a summary (last completed step, failed step, timestamp) and offers three choices: continue from where it stopped, pick a specific step to restart from, or start a fresh installation. The saved locale is reused so the resume prompt appears in the user's language. State is cleared automatically when the installation finishes end-to-end, and is rejected if it came from a different Lox version or a stale schema.

### Changed
- The 12 post-language installer steps are now declared in a single `STEPS` registry (`packages/installer/src/steps/registry.ts`) instead of being wired one-by-one in `index.ts`. Makes the step loop resumable and lets the resume prompt label choices with real step names.


## [0.4.6] — 2026-04-05

### Fixed
- Step 11 (Deploy) now resolves the real POSIX `$USER` and `$HOME` on the VM via an SSH probe instead of deriving the install path from the email prefix. GCP OS Login creates POSIX usernames as `<email-prefix>_<domain>_<tld>` (dots → underscores), so guessing `/home/<email-prefix>/` produced a path that did not exist on the VM and `git clone` failed with "could not create leading directories: Permission denied" (#79). The resolved identity is persisted on the installer context and reused by step 12 (MCP) for the SSH config entry, launcher upload path, and install directory.


### Changed
- Prepare repository for open source release
- Remove personal artifacts and internal documentation
- Redact personal infrastructure details (IPs, project IDs, service accounts)
- Rewrite CLAUDE.md as contributor guide
- Refactor installer to use config values instead of hardcoded usernames/paths
- Fix shell injection vulnerability in deploy step
- Update README with badges, improved splash, and public install instructions
- Add CONTRIBUTING.md, CODE_OF_CONDUCT.md, and GitHub issue/PR templates

## [0.4.5] — 2026-04-04

### Changed
- Step 11 (Deploy) now runs all six VM-side phases via the file-based scp+bash pattern (same as step-vault.ts from #61). Each phase — clone, build, secrets.env write, systemd unit install, service start, MCP health probe — is now a local bash script that gets `scp`'d to `/tmp/lox-deploy-<phase>.sh` on the VM and executed with `gcloud compute ssh --command "bash /tmp/<phase>.sh"`. No shell metacharacters (`&&`, `||`, `(...)`, heredocs, pipes, redirects) pass through `gcloud --command` anymore, so cmd.exe on Windows can no longer fragment the remote invocation (#70)
- Extracted each phase body as a pure `build<Phase>Script()` function so the bash content is independently testable without mocking SSH

## [0.4.4] — 2026-04-04

### Changed
- Step 12 (MCP) now uploads a small VM-side launcher script (`/home/<user>/lox-mcp.sh`) and registers Claude Code to invoke `ssh lox-vm /home/<user>/lox-mcp.sh`. Previously the full command body (`cd ... && set -a && source /etc/lox/secrets.env && set +a && node ...`) was passed as a single SSH argument, which Claude Code on Windows would re-spawn through `cmd.exe` and cmd.exe reinterprets `&&` as its own separator — breaking the MCP server startup. The registered command is now metachar-free, so spawning it works on every host Claude Code runs on (#71)

## [0.4.3] — 2026-04-04

### Fixed
- Step 11 (Deploy) no longer fails with `gh: command not found` on the VM. The VM bootstrap does not install the GitHub CLI, and the upstream `isorensen/lox-brain` is a public repo, so the clone now uses plain `git clone https://github.com/isorensen/lox-brain.git` — anonymous HTTPS, no auth or extra dependency required (#73)
- Step 10 (Obsidian) post-install instructions no longer claim plugins were "pre-copied to .obsidian/plugins/". Only the plugin *list* (`community-plugins.json`) is seeded; the user has to install each plugin from Obsidian's Community Plugins browser (#74)
- Step 10 now includes explicit configuration guidance for the `obsidian-git` plugin (vault backup interval, auto-pull, auto-push) — without this the local vault never syncs to the git remote, so VM-side changes never flow back and local edits never reach the embedding index (#74)

## [0.4.2] — 2026-04-04

### Fixed
- Obsidian install no longer times out on Windows. `winget install Obsidian.Obsidian` (and the brew/snap equivalents) now runs with an initial 5-minute timeout, and if it still times out the user is prompted (default=yes) to extend to 10 minutes — same pattern we already use for VM setup phases (#68)
- Step 10 (Obsidian) is now re-run safe: pre-checks via `brew list --cask`, `winget list -e`, or `snap list` and skips install when Obsidian is already present, skips `gh repo clone` when the target vault dir already exists, and copies plugin templates with Node's `fs.cpSync` instead of `cp -r` (which does not exist on Windows)
- Step 11 (Deploy) now clones from the fully-qualified `isorensen/lox-brain` on the VM. The previous unqualified `gh repo clone lox-brain` resolved to the VM user's own GitHub namespace, which 404s for third-party installers who do not have their own fork
- Step 12 (MCP) is now idempotent: detects an existing `lox-brain` entry in `claude mcp list` and removes it before re-adding, so re-running the installer no longer fails on the `claude mcp add` step

### Added
- `utils/extendable-timeout.ts` — reusable helper for long-running operations that should prompt the user to extend timeout on first failure

## [0.4.1] — 2026-04-04

### Fixed
- VM cron setup no longer fails on Windows at the SCP step. `pscp.exe` (bundled with the Cloud SDK on Windows) does not perform server-side tilde expansion, so `lox-vm:~/lox-setup-sync.sh` landed in a literal `~` directory and crashed. Uses `/tmp/lox-setup-sync.sh` as an absolute remote path now (#64)

## [0.4.0] — 2026-04-04

### Added
- Vault Setup now captures the GitHub Fine-Grained PAT via a masked prompt and stores it directly in GCP Secret Manager (secret `lox-github-pat`). The flow validates format locally, is idempotent on re-runs (adds a new version if the secret already exists), and falls back to a printed manual command if the store call fails (#63)

## [0.3.8] — 2026-04-04

### Fixed
- Git sync cron setup on VM no longer fails on Windows. The installer now uploads a setup script via `gcloud compute scp` and executes it with a plain `bash <path>`, avoiding `gcloud --command` arguments with `|`, `(`, `;` that Windows cmd.exe interpreted as its own shell metacharacters (#61)

## [0.3.7] — 2026-04-04

### Fixed
- Vault Setup step no longer crashes when the `lox-vault` repo already exists in the user's GitHub account. Detects existing repos and prompts to reuse (clone) or pick a different name. Also handles stale local clone directories from prior runs (#59)

## [0.3.6] — 2026-04-04

### Fixed
- Unhandled exceptions from installer steps now trigger the auto-report flow. Previously, uncaught exceptions bypassed the report offer and just printed a raw stack trace (#57)

## [0.3.5] — 2026-04-04

### Fixed
- Installer no longer crashes when branch protection setup is blocked by GitHub Pro requirement on private repos. Emits a warning and continues installation (#55)

## [0.3.4] — 2026-04-04

### Changed
- Auto-reported installer failures now include the sub-phase name and source file path, making issues easier to triage (#51)

## [0.3.3] — 2026-04-04

### Fixed
- Installer VM Setup step now idempotent — re-running no longer fails with `role "lox" already exists` (#50)
- pgvector compilation phase handles interrupted previous runs by cleaning `/tmp/pgvector` before clone (#50)
- `createdb` errors are now propagated correctly instead of being silenced

## [0.3.2] — 2026-04-04

### Fixed
- WireGuard client key generation fails on Windows — `wg` and `bash` not available locally (#48). Keys are now generated on the VM where `wg` is installed.
- `sshExec` in step-vpn.ts used `shell()` with `&&` chains — same cmd.exe splitting bug as #40. Replaced with `execSync` + builders from step-vm-setup.ts.
- `process.env.HOME` doesn't exist on Windows — now falls back to `USERPROFILE`.

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
