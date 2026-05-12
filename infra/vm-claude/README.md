# VM Claude Runner

Headless Claude Code on the lox-brain VM, running scheduled MCP-aware tasks via systemd timers.

## What it does

Two systemd timers trigger `claude -p "/sync-calendar"` on the VM:

- **06:00 BRT daily** — captures the day's new calendar events into the Obsidian vault
- **19:00 BRT daily** — second pass to capture Gemini meeting notes (which arrive after meetings end with some lag)

Timers declare `America/Sao_Paulo` explicitly via `OnCalendar=`, so they fire at local Brazil time regardless of the VM's system timezone (most cloud VMs default to UTC).

Auth uses a long-lived OAuth token from your Claude Max plan. No `ANTHROPIC_API_KEY`, no per-call billing.

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

> The unit files use a `__LOX_VM_USER__` placeholder in both `User=` and the home paths (e.g., `/home/__LOX_VM_USER__/.config/lox-claude/env`). A single `sed` substitution at install time replaces every occurrence with your actual user. See **Setup → step 4** below.

## Setup

### 1. Generate OAuth long-lived token

SSH into the VM as the user that will run the timers (the user that already owns the Obsidian vault and the lox-brain repo on the VM):

```bash
claude setup-token
```

This prints a token valid for ~1 year. Copy it. Why `setup-token` instead of `claude login`: refresh of OAuth tokens fails silently in non-interactive mode (issue [anthropics/claude-code#28827](https://github.com/anthropics/claude-code/issues/28827)). `setup-token` produces a long-lived token explicitly designed for automation.

### 2. Save the token

```bash
mkdir -p ~/.config/lox-claude
printf 'CLAUDE_CODE_OAUTH_TOKEN=%s\n' '<paste-token-here>' > ~/.config/lox-claude/env
chmod 600 ~/.config/lox-claude/env
```

### 3. Copy the settings file

From the lox-brain repo on the VM:

```bash
cp infra/vm-claude/settings.json.example ~/.config/lox-claude/settings.json
```

Review the allowlist; tighten or expand as needed for your usage. The runtime principle is start tight, expand on `Permission denied` errors — never pre-authorize speculative tools.

### 4. Install the systemd units

The unit files ship with a `__LOX_VM_USER__` placeholder for the `User=` directive. Substitute it with your VM user before copying:

```bash
# Substitute the placeholder with the current user, then copy
sed "s/__LOX_VM_USER__/$USER/g" infra/systemd/lox-claude-sync-calendar.service | sudo tee /etc/systemd/system/lox-claude-sync-calendar.service > /dev/null
sed "s/__LOX_VM_USER__/$USER/g" infra/systemd/lox-claude-gemini-notes.service  | sudo tee /etc/systemd/system/lox-claude-gemini-notes.service  > /dev/null
sudo cp infra/systemd/lox-claude-*.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now lox-claude-sync-calendar.timer lox-claude-gemini-notes.timer
```

The same `sed` substitution replaces every `__LOX_VM_USER__` in the file — `User=`, `EnvironmentFile=`, `ExecStartPre`, `ExecStart`, and `ReadWritePaths` all get the actual username inlined.

> **Why not the systemd `%h` specifier?** In system services (units in `/etc/systemd/system/`), `%h` always resolves to `/root` regardless of `User=`. It only works as expected in user services. Hardcoded paths via `__LOX_VM_USER__` substitution are the correct portable approach for system units.

### 5. Verify

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

## Renewing the OAuth token

Tokens from `claude setup-token` last about 1 year. When yours nears expiration:

1. Set a calendar reminder ~30 days before expiration when you first generate it
2. SSH to the VM, run `claude setup-token` again
3. Replace the value in `~/.config/lox-claude/env`
4. No restart needed — next timer fire will pick up the new token

If a sync run fails with `401 Unauthorized` in the journal, the token has expired:

```bash
journalctl -u lox-claude-sync-calendar.service | grep -i 401
```

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `ExecStartPre fails: exit 1` | Missing env file or `CLAUDE_CODE_OAUTH_TOKEN` unset | Recreate `~/.config/lox-claude/env` (step 2) |
| `claude -p` exits 1 immediately | Token expired or invalid | Re-run `claude setup-token` |
| `Permission denied: <tool>` | Allowlist too tight in `settings.json` | Add the tool to the `allow` array |
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
