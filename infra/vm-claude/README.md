# VM Claude

Headless Claude Code on the lox-brain VM in two complementary modes:

1. **Cron runner (default)** — scheduled MCP-aware tasks via systemd timers. Captures calendar events and Gemini meeting notes on a fixed schedule.
2. **Telegram channel listener (optional)** — a long-running session listening on Telegram so you can chat with Claude from your phone with full vault + connector access. See [Telegram listener](#telegram-listener-long-running) below.

Both modes share the same auth (`~/.claude/.credentials.json` from `claude login`), the same MCP setup, and the same skills installed under `~/.claude/skills/` on the VM.

## What the cron runner does

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

## Telegram listener (long-running, experimental)

> ⚠️ **`claude --channels` is a research-preview feature.** This service brings up a working channel listener, but inbound-message delivery in long-running background sessions hits real upstream bugs ([see Known upstream limitations below](#known-upstream-limitations-of-claude---channels)). The happy path works for interactive bursts; expect occasional message drops over long idle periods until the upstream fix lands.

A second, optional VM service: `lox-claude-telegram.service` keeps `claude --channels` listening on Telegram. Send a DM from your phone, Claude responds with full vault + connector access.

### Architecture

```
systemd (Type=forking)
  └─ tmux new-session -d -s lox-claude-telegram
       └─ claude --channels plugin:telegram@claude-plugins-official
            └─ bun run start  (the telegram plugin's MCP server)
                 └─ grammy → api.telegram.org (getUpdates polling)
```

**Why tmux?** `claude --channels` requires a real TTY + interactive stdin to spawn the plugin's MCP server. `Type=simple` exits in 4s with `Error: Input must be provided through stdin` ([claude-code#40726](https://github.com/anthropics/claude-code/issues/40726)); a `script -qfec ... /dev/null` PTY is detected as headless and the plugin's `bun server.ts` never spawns. `tmux new-session -d` provides a real interactive TTY in background — the only `Type=forking` shape that lets the channel listener and its MCP server come up correctly.

Inbound DMs arrive as user messages in the session, claude responds, the plugin's `reply` tool sends back to Telegram. Tool-approval prompts are relayed to the phone (permission relay) so write operations are confirmed on-device.

### Security model

State lives in `~/.claude/channels/telegram/access.json` and is re-read on every inbound message. Three policies:

| Policy | Behavior |
|---|---|
| `pairing` (initial) | DM from unknown sender → bot replies with a 6-character pairing code → operator approves with `/telegram:access pair <code>` in a live Claude session. The code is sent only via Telegram to the sender, never logged, so a hostile DM cannot self-approve without access to a running session. |
| `allowlist` (recommended steady state) | DM from non-allowlisted sender → dropped silently, no reply. |
| `disabled` | Drop everything, including allowlisted users. Kill switch. |

**Groups are opt-in per group**, with `requireMention: true` by default.

The pairing window is the only soft spot. Telegram bots are **publicly discoverable by username** (anyone can open `t.me/<botname>` and DM them) — there is no "guessing" if the name is at all predictable. Between starting the service in `pairing` mode and switching to `allowlist`, any Telegram user who finds the bot receives a pairing code. The code alone is useless: approving it requires access to a running Claude session on the VM. But the smaller the window, the smaller the risk. **Do not share the bot username publicly until step 3 below is complete and the policy is set to `allowlist`.**

### Prerequisites

In addition to the cron-runner prerequisites:

- **Bun** installed and on `$PATH` for `User=__LOX_VM_USER__` — the plugin's `server.ts` runs on Bun, not Node. Verify: `bun --version`.
  ```bash
  curl -fsSL https://bun.sh/install | bash
  ```
- **tmux** installed (most distros ship it). Verify: `tmux -V`.
  ```bash
  sudo apt install -y tmux   # Debian/Ubuntu
  ```
- **Telegram plugin** installed in the VM user's Claude config (one-time, interactive). Verify: `claude plugin list | grep telegram`.
- **Bot token** from BotFather, saved to `~/.claude/channels/telegram/.env` (handled by `/telegram:configure`).
- **`access.json`** with at least one allowlisted Telegram numeric user ID and `dmPolicy: "allowlist"`.
- **Dedicated working directory** at `~/lox-telegram-channel/` (created in step 4 below). The unit pins `WorkingDirectory=` here to minimize blast radius.

### Setup (interactive on the VM)

The first four steps run in an interactive Claude session on the VM (`ssh obsidian-vm`, then `claude`). This is unavoidable — pairing requires a live session — but only happens once.

#### 1. Create the bot and save the token

Talk to [@BotFather](https://t.me/BotFather), `/newbot`, follow the prompts. Save the token.

#### 2. Install the plugin and write the token to the VM

```bash
ssh obsidian-vm
claude   # interactive session, NOT `claude -p`
```

Inside the session:

```
/plugin install telegram@claude-plugins-official
/reload-plugins
/telegram:configure <BOT_TOKEN>
/exit
```

`/telegram:configure` writes `~/.claude/channels/telegram/.env`.

#### 3. Pair from your phone, then lock down

Still on the VM, start a channel session:

```bash
ssh obsidian-vm
claude --channels plugin:telegram@claude-plugins-official
```

From your phone, DM your bot anything. You receive a 6-character pairing code. Back in the SSH session, approve it:

```
/telegram:access pair <code>
```

Immediately after pairing succeeds, switch the policy:

```
/telegram:access policy allowlist
```

Verify `~/.claude/channels/telegram/access.json`:

```bash
cat ~/.claude/channels/telegram/access.json
# expect: dmPolicy: "allowlist", your numeric ID in allowFrom
```

`/exit` the session.

#### 4. Create the dedicated working dir and copy settings

```bash
mkdir -p ~/lox-telegram-channel
cp infra/vm-claude/telegram-settings.json.example ~/.config/lox-claude/telegram-settings.json
```

The settings template is **stricter** than the cron runner's `settings.json`: read-only across all MCPs by default, `mcp__lox-brain__write_note` allowed for note capture, the plugin's own `reply`/`react`/`edit_message`/`download_attachment` tools allowed (otherwise every inbound message triggers a permission-relay popup on your phone), and `Bash`/`Write`/`Edit`/`WebFetch`/`WebSearch` plus all Calendar/Gmail/Drive mutating tools explicitly denied. The chat-livre blast radius is larger than a fixed slash command — any inbound message can ask for anything — so the posture starts tight and any expansion goes through phone-side permission relay.

#### 5. Install the systemd unit

```bash
sed "s/__LOX_VM_USER__/$USER/g" infra/systemd/lox-claude-telegram.service | sudo tee /etc/systemd/system/lox-claude-telegram.service > /dev/null
sudo systemctl daemon-reload
sudo systemctl enable --now lox-claude-telegram.service
```

The unit is `Type=forking` because the actual long-running process is the tmux server. On first start with a fresh `~/lox-telegram-channel/` the `ExecStartPost` hook detects the workspace-trust dialog and auto-confirms it with `tmux send-keys 1 Enter` — on subsequent restarts (folder already trusted) it correctly does nothing, keeping the TUI prompt clean.

#### 6. Verify end-to-end

```bash
systemctl status lox-claude-telegram.service     # active (running)
journalctl -u lox-claude-telegram.service -f     # live tail
```

From your phone, DM the bot something that exercises an MCP, e.g. `resume hoje`. Expect a reply within ~30s referencing today's calendar.

From a non-allowlisted account (a friend's, ideally), DM the bot. Expect **no reply**; the journal should log the drop.

Reboot the VM and confirm the service comes back up: `systemctl is-enabled lox-claude-telegram.service` should report `enabled`.

### Telegram listener troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Service fails to start with `ExecStartPre` exit 1 on `.env` | `/telegram:configure` never ran | Run step 2 |
| Service fails to start with `ExecStartPre` exit 1 on `access.json` | Pairing never completed | Run step 3 |
| Service fails to start with `ExecStartPre` exit 1 on `/usr/bin/tmux` | tmux not installed | `sudo apt install -y tmux` |
| Bot replies with pairing codes to strangers | Policy still `pairing`, not `allowlist` | `/telegram:access policy allowlist` in a live channel session |
| Inbound DMs from authorized user get no reply, but pane is otherwise clean | Idle muting — claude is in a post-task state and the REPL is not subscribing to channel notifications ([claude-code#44380](https://github.com/anthropics/claude-code/issues/44380)) | `sudo systemctl restart lox-claude-telegram.service` — known upstream bug, no clean fix until the channel-notification handler is repaired |
| Pane shows `❯ 1` or other stray characters after restart, no replies | `ExecStartPost` sent `1 Enter` on a warm restart where the trust dialog wasn't present — claude is in local-compose mode and ignoring inbound | Restart the service; the current unit already guards `send-keys` behind a pane grep. If you see this on the current build, file an issue. |
| Bot responds once after fresh start, then silence for everything else | Same idle-muting bug as above ([#44380](https://github.com/anthropics/claude-code/issues/44380)). The first message is processed during warmup; subsequent ones land in a session that's no longer subscribed | Restart the service or attach a tmux client (`tmux attach -t lox-claude-telegram`) briefly to "wake" the REPL. Permanent fix waits on upstream. |
| Every inbound DM triggers a permission popup on your phone for `mcp__plugin_telegram_telegram__reply` | The plugin's own tools are not in `~/.config/lox-claude/telegram-settings.json` `permissions.allow` | Copy `infra/vm-claude/telegram-settings.json.example` again — the v0.10.1 template includes them. Restart the service. |
| `bun: command not found` in journal | Bun not on `$PATH` for the service's `User=` (systemd does NOT source `.bashrc`/`.zshrc`) | The current unit already sets `Environment="PATH=/home/__LOX_VM_USER__/.bun/bin:..."` — check the path matches your actual Bun install location |
| Bot replies but cannot answer "resume hoje" | Skill `/sync-calendar` not installed on the VM, or Calendar connector not registered | Same fix as the cron runner — see the gap warning at the top of this README |
| Service restart loop every 15s | OAuth credentials expired (401), or tmux binary missing | `claude login` on the VM; verify `which tmux` |
| `tmux ls` shows the session but pane is stuck at workspace-trust dialog | First-run trust auto-confirm didn't fire (`ExecStartPost` race or grep missed) | `tmux send-keys -t lox-claude-telegram 1 Enter` manually once, then never again |

### Known upstream limitations of `claude --channels`

These are real upstream bugs in Claude Code's channel-notification handling. They affect any long-running `--channels` deployment regardless of how it's wrapped (tmux, screen, dtach, systemd `TTYPath=`, etc.) — the issue is in the REPL/MCP-notification handler, not the surrounding plumbing.

| Issue | Status | What it means here |
|---|---|---|
| [anthropics/claude-code#40726](https://github.com/anthropics/claude-code/issues/40726) | Open | Bare `Type=simple` exits with `Error: Input must be provided through stdin` because the REPL detects non-TTY and falls into `--print` mode. *Mitigated* by wrapping with tmux. |
| [anthropics/claude-code#37933](https://github.com/anthropics/claude-code/issues/37933) | Closed (duplicate of [#36411](https://github.com/anthropics/claude-code/issues/36411)) | `notifications/claude/channel` MCP messages can be silently dropped — exactly the "bot pegou via getUpdates but claude didn't process" symptom. *No clean mitigation* — relies on the upstream handler fix. Watch #36411 (and #44380 below) for the actual repair. |
| [anthropics/claude-code#44380](https://github.com/anthropics/claude-code/issues/44380) | Open | "Channel messages don't wake idle sessions" — the REPL prioritizes stdin over MCP notifications and stops subscribing after a task completes. *Workarounds: periodic restart, or external nudge via `tmux send-keys`*. |
| [anthropics/claude-code#36477](https://github.com/anthropics/claude-code/issues/36477) | Open | `--channels` stops processing after first response. Related to #44380. |
| [anthropics/claude-plugins-official#1594](https://github.com/anthropics/claude-plugins-official/issues/1594) | Open / draft PR | Proposed `--transport http --port 7341` for the Telegram plugin would replace stdio with an HTTP MCP server, sidestepping the REPL-notification path entirely. If/when merged, this is the *real* fix. |

If you need a hardened production-style deployment today, [jaredezz.tech's `--channels` post](https://jaredezz.tech/posts/claude-code-channels-discord-openclaw-alternative/) documents an alternative pattern: external Telegram bot daemon that fires `claude -p` per-message. Heavier to operate but doesn't depend on the broken notification handler.

### What's *not* in the listener

- **No multi-channel** (Slack/Discord). Telegram only.
- **No voice/audio** by default. The `elevenlabs-voice` skill can be invoked on-demand if you ask for it, but is not in the default reply flow.
- **No multi-user / team mode.** Personal account only.

## Design spec

Full design rationale, alternatives considered, and security analysis: [`docs/superpowers/specs/2026-05-09-vm-claude-runner-design.md`](../../docs/superpowers/specs/2026-05-09-vm-claude-runner-design.md)
