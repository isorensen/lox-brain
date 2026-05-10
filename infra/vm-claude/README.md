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
- Obsidian vault at `/home/sorensen/obsidian`
- Lox brain repo at `/home/sorensen/lox-brain`

## Setup

### 1. Generate OAuth long-lived token

SSH into the VM as the user that will run the timers (default: `sorensen`):

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

```bash
sudo cp infra/systemd/lox-claude-*.service /etc/systemd/system/
sudo cp infra/systemd/lox-claude-*.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now lox-claude-sync-calendar.timer lox-claude-gemini-notes.timer
```

### 5. Verify

```bash
systemctl list-timers | grep lox-claude
# expect: two timers, next-run at 06:00 and 19:00

sudo systemctl start lox-claude-sync-calendar.service
journalctl -u lox-claude-sync-calendar.service -n 50
# expect: claude -p output, calendar events written to vault
```

## Customization (different user or paths)

The unit files hardcode `User=sorensen` and `/home/sorensen/...` paths. To run on a VM with different user or paths:

1. Edit `infra/systemd/lox-claude-*.service` — replace `sorensen` and update `EnvironmentFile`, `ExecStartPre`, `ExecStart`, `ReadWritePaths`
2. Re-run setup steps above

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
