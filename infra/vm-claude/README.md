# VM Claude Runner

Headless Claude Code on the lox-brain VM, running scheduled MCP-aware tasks via systemd timers.

## What it does

Two systemd timers trigger `claude -p "/sync-calendar"` on the VM:

- **06:00 BRT daily** — captures the day's new calendar events into the Obsidian vault
- **19:00 BRT daily** — second pass to capture Gemini meeting notes (which arrive after meetings end with some lag)

Timers declare `America/Sao_Paulo` explicitly via `OnCalendar=`, so they fire at local Brazil time regardless of the VM's system timezone (most cloud VMs default to UTC).

Auth uses a long-lived OAuth token from your Claude Max plan. No `ANTHROPIC_API_KEY`, no per-call billing.

## ⚠️ Known gap — MCP servers and skills must be configured on the VM separately

This runner expects the VM's Claude Code installation to have:

- The `mcp__lox-brain__*` MCP server registered, pointing at the **compiled build** (not `tsx`) so the spawn is fast enough for headless `claude -p`:
  ```bash
  # First build the package (only needed once / after pulls):
  cd ~/lox-brain && npm install && npm run build --workspaces

  # Then register the MCP at user scope so headless claude sees it:
  claude mcp add lox-brain --scope user -- bash -c 'cd /home/$USER/lox-brain && export $(cat .env | xargs) && node packages/core/dist/mcp/index.js'
  ```

  > **Why `node ... dist/...` instead of `npx tsx ... src/...`?** Empirically the `npx tsx` path takes ~5 seconds to bootstrap (npx resolve + tsx transpile + schema check + ivfflat reindex). In headless `claude -p` mode, that exceeds Claude's MCP spawn window and the runner silently falls back to filesystem reads (no notes get written). Using the compiled JS skips the transpile step and the spawn lands in <1 second.
- Any other MCPs that the slash command you invoke needs (e.g., `mcp__claude_ai_Google_Calendar__*`, `mcp__claude_ai_Gmail__*`, `mcp__claude_ai_Google_Drive__*` for `/sync-calendar`). The managed Claude.ai connectors usually auto-register on `claude login` if your account has them enabled — verify with `claude mcp list`.
- The slash command's **skill files** copied/installed into `~/.claude/skills/` on the VM (skills do not travel with OAuth login; they are local per Claude Code installation). Example for `/sync-calendar`:
  ```bash
  # On your laptop:
  ssh obsidian-vm 'mkdir -p ~/.claude/skills/sync-calendar'
  scp ~/.claude/skills/sync-calendar/SKILL.md obsidian-vm:~/.claude/skills/sync-calendar/
  ```
- The skill must support a non-interactive opt-in (e.g., an `auto` argument) so it does not block waiting for "Proceed?" confirmation. The unit files in this folder invoke `claude -p "/sync-calendar auto"` for that reason — if your skill uses a different flag name, edit `ExecStart=` accordingly.

If `claude -p "/<your-skill>"` returns `Unknown command: /<your-skill>` or the journal shows MCP tool errors, that is the gap. If the skill runs but never finishes (or you see a "Proceed?" prompt in the journal), the skill is missing its non-interactive mode.

## Prerequisites

- Ubuntu 22.04+ on the VM (systemd ≥ 247 for `OnCalendar` timezone support)
- Claude Code CLI installed at `/usr/local/bin/claude`. If yours is elsewhere (e.g., nvm or `~/.local/bin`), either symlink it:
  ```bash
  sudo ln -sf "$(which claude)" /usr/local/bin/claude
  ```
  or edit `ExecStart`/`ExecStartPre` paths in the `.service` files to match your install.
- MCP server `lox-brain` configured locally (already running if this is the obsidian-vm)
- Obsidian vault at `$HOME/obsidian`
- Lox brain repo at `$HOME/lox-brain`

> The unit files use a `__LOX_VM_USER__` placeholder in both `User=` and the home paths (e.g., `/home/__LOX_VM_USER__/.claude/.credentials.json`). A single `sed` substitution at install time replaces every occurrence with your actual user. See **Setup → step 3** below.

## Setup

### 1. Log in to Claude on the VM

SSH into the VM as the user that will run the timers (the user that already owns the Obsidian vault and the lox-brain repo on the VM). On a headless VM, `claude login` uses a device-code flow — it prints a URL + code; open the URL in any browser, paste the code, complete login with your Anthropic account:

```bash
claude login
```

After it completes, `~/.claude/.credentials.json` should exist (mode 600). Quick sanity check:

```bash
ls -la ~/.claude/.credentials.json
claude -p "Say hello"   # expect: "Hello!" without auth errors
```

> **Note on `claude setup-token`:** the long-lived token from `setup-token` looks attractive for cron, but is **empirically rejected** in the systemd context as "Invalid bearer token" (likely related to [anthropics/claude-code#50743](https://github.com/anthropics/claude-code/issues/50743) — OAuth refresh broken in headless Linux). We rely on `credentials.json` from `claude login` instead, accepting that you may need to re-run `claude login` periodically when the session refresh fails (recoverable in seconds; see Troubleshooting below).

### 2. Copy the settings file

From the lox-brain repo on the VM:

```bash
cp infra/vm-claude/settings.json.example ~/.config/lox-claude/settings.json
```

Review the allowlist; tighten or expand as needed for your usage. The runtime principle is start tight, expand on `Permission denied` errors — never pre-authorize speculative tools.

### 3. Install the systemd units

The unit files ship with a `__LOX_VM_USER__` placeholder for the `User=` directive and home-relative paths. Substitute it with your VM user before copying:

```bash
# Substitute the placeholder with the current user, then copy
sed "s/__LOX_VM_USER__/$USER/g" infra/systemd/lox-claude-sync-calendar.service | sudo tee /etc/systemd/system/lox-claude-sync-calendar.service > /dev/null
sed "s/__LOX_VM_USER__/$USER/g" infra/systemd/lox-claude-gemini-notes.service  | sudo tee /etc/systemd/system/lox-claude-gemini-notes.service  > /dev/null
sudo cp infra/systemd/lox-claude-*.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now lox-claude-sync-calendar.timer lox-claude-gemini-notes.timer
```

The same `sed` substitution replaces every `__LOX_VM_USER__` in the file — `User=`, `ExecStartPre`, `ExecStart`, and `ReadWritePaths` all get the actual username inlined.

> **Why not the systemd `%h` specifier?** In system services (units in `/etc/systemd/system/`), `%h` always resolves to `/root` regardless of `User=`. It only works as expected in user services. Hardcoded paths via `__LOX_VM_USER__` substitution are the correct portable approach for system units.

### 4. Verify

```bash
systemctl list-timers | grep lox-claude
# expect: two timers, next-run at 06:00 and 19:00

sudo systemctl start lox-claude-sync-calendar.service
journalctl -u lox-claude-sync-calendar.service -n 50
# expect: claude -p output, calendar events written to vault
```

## Customization (different paths)

If your Obsidian vault or lox-brain repo lives somewhere other than `$HOME/obsidian` and `$HOME/lox-brain`, edit `ExecStartPre`, `ExecStart`, and `ReadWritePaths` in the `.service` files (or in the staged copies before substitution) to point at the actual locations. The `__LOX_VM_USER__` substitution handles the home prefix; only the trailing path components matter.

Multi-VM support via the installer is a follow-up; see issue #171.

## Refreshing auth when it expires

The OAuth session in `~/.claude/.credentials.json` includes a refresh token, but per [anthropics/claude-code#50743](https://github.com/anthropics/claude-code/issues/50743), automatic refresh is unreliable in headless Linux. Practically: expect to re-login every few weeks.

When a sync run fails with `401 Invalid bearer token` in the journal:

```bash
journalctl -u lox-claude-sync-calendar.service | grep -i 401   # confirms the symptom
ssh into-the-VM
claude login                                                    # device-code flow, re-establishes credentials.json
```

No restart needed — next timer fire picks up the refreshed credentials. Consider a monthly calendar reminder to refresh proactively before the failure window.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `ExecStartPre fails: exit 1` for `-f .credentials.json` | `claude login` never ran on the VM, or the file got deleted | Re-run `claude login` (Setup → step 1) |
| Journal shows `401 Invalid bearer token` | OAuth session expired (refresh failed in headless) | Re-run `claude login` on the VM |
| Journal shows `Unknown command: /sync-calendar` | The slash command's skill is not installed in the VM's Claude Code (`~/.claude/skills/` is empty) | See the gap warning at the top of this file — install/copy the skill from your laptop |
| Journal shows `Lox Brain MCP isn't available in this session` (or claude falls back to filesystem reads) | The MCP was registered with `npx tsx` and the spawn timed out under `-p` | Re-register pointing at the compiled build: `claude mcp remove lox-brain --scope user && claude mcp add lox-brain --scope user -- bash -c 'cd /home/$USER/lox-brain && export $(cat .env \| xargs) && node packages/core/dist/mcp/index.js'`. Run `npm run build --workspaces` first if `packages/core/dist/` is missing. |
| Service finishes in &lt;5s with no useful output | Skill waiting for "Proceed?" prompt that nobody can answer | Confirm `ExecStart=` has `/sync-calendar auto` (or your skill's equivalent non-interactive flag) |
| `Permission denied: <tool>` in the journal | Allowlist too tight in `settings.json` | Add the tool to the `allow` array in `~/.config/lox-claude/settings.json` |
| Timer never fires | Not enabled | `sudo systemctl enable --now <timer>` |
| Many runs queued at boot | `Persistent=true` is replaying missed runs | Expected on first start; clears after first run |
| MCP `lox-brain` not reachable | Service down on VM | `systemctl status lox-mcp.service` |
| Vault has no new notes after 24h | Skill ran but vault not git-pushed | Check `lox-watcher.service` and git sync |

## Logs and monitoring

```bash
# Recent logs from a specific service
journalctl -u lox-claude-sync-calendar.service -n 100

# Live tail
journalctl -u lox-claude-sync-calendar.service -f

# All lox-claude logs
journalctl -u 'lox-claude-*' --since today

# Check timer schedule
systemctl list-timers --all | grep lox-claude

# Check for failed services
systemctl --failed
```

For MVP this is enough. If failures become silent or frequent, see follow-up: Cloud Logging + log-based alerting (out of scope for this PR).

## Design spec

Full design rationale, alternatives considered, and security analysis: [`docs/superpowers/specs/2026-05-09-vm-claude-runner-design.md`](../../docs/superpowers/specs/2026-05-09-vm-claude-runner-design.md)
