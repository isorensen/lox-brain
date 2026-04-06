# Lox Team Mode — Open Core Design Spec

**Date:** 2026-04-03
**Status:** Draft
**Author:** Eduardo Sorensen

---

## 1. Overview

Lox is a personal knowledge management system (Obsidian + pgvector + MCP Server). This spec defines the **Team Mode** — a commercially licensed extension that enables multi-user shared brains for corporate teams.

**Business model:** Open Core. The personal mode stays MIT (free, open source). Team features live in `packages/team/` under a commercial/proprietary license.

**First customer:** Credifit (Eduardo's company). Separate GCP VM, 3 initial users.

---

## 2. Architecture

### 2.1 Monorepo Structure

```
lox-brain/
  LICENSE                              # MIT (default for everything)
  packages/
    core/           → MIT              # embedding, db, watcher, MCP server
    shared/         → MIT              # config, types
    cli/            → MIT              # lox status, lox migrate
    installer/      → MIT              # wizard cross-platform
    team/           → Commercial       # multi-user addon
      LICENSE        → Proprietary/Commercial
      src/
        multi-user/                    # VPN peer mgmt, created_by injection
        mcp-extensions/                # team MCP tools
```

### 2.2 Licensing

- All packages except `packages/team/` are MIT licensed
- `packages/team/` has its own LICENSE file with proprietary/commercial terms
- Use grant: personal mode (1 user) is always free; team mode (2+ users) requires a commercial license
- Future option: migrate to BSL-1.1 when there is demand from third-party customers (auto-converts to MIT after 4 years)

### 2.3 Multi-User Identity via VPN

WireGuard is the authentication layer. Each user gets a VPN peer with a fixed IP. The MCP server resolves the caller's IP to a user identity via config.

```
Eduardo  (Mac)     --VPN peer 1 (10.10.0.2)--> VM Credifit (10.10.0.1)
Matheus  (Linux)   --VPN peer 2 (10.10.0.3)-->       |
Igor     (Windows) --VPN peer 3 (10.10.0.4)-->       +-- MCP Server (identifies caller by IP)
                                                      +-- PostgreSQL (created_by per note)
                                                      +-- Shared vault (git)
```

No auth server, no tokens, no sessions. WireGuard public/private key pairs per peer already prove identity.

### 2.4 Peer Resolver

```typescript
// packages/team/src/multi-user/peer-resolver.ts
interface PeerMap {
  [vpnIp: string]: { name: string; email: string };
}
```

Loaded from `~/.lox/config.json` `vpn.peers` array.

### 2.5 `created_by` Injection

The `created_by` column already exists in the `vault_embeddings` table. The team package provides middleware that intercepts write operations and injects the author:

```
write_note("Reunião Altis", content)
  → team middleware resolves peer IP → "eduardo"
  → INSERT ... created_by = 'eduardo'
```

For personal mode, `created_by` stays `null`. Zero breaking change.

### 2.6 MCP Transport

Current: stdio over SSH. For team mode, the MCP server needs to listen on a TCP port (StreamableHTTP on `127.0.0.1:3100`) so it can identify the caller by VPN peer IP. SSH remains available for personal mode.

### 2.7 Team MCP Tools

`packages/team/mcp-extensions/` registers additional tools on the MCP server:

- `list_team_activity` — recent notes with who wrote each one
- `search_by_author` — search notes by a specific colleague

Personal tools (`write_note`, `search_semantic`, etc.) continue working normally. Team mode only adds `created_by` automatically.

### 2.8 Shared Vault

- Private git repo on GitHub/GitLab (org-owned)
- All users have push access via deploy key on the VM
- Watcher (chokidar) works the same — detects `.md` changes, generates embeddings, upserts to pgvector
- Each user can optionally clone the vault repo locally for Obsidian desktop access

---

## 3. License Gate

### 3.1 License Key Format

MVP: offline JWT signed with a private key (held by the licensor) and verified with a public key embedded in `packages/team/`.

```json
{
  "org": "credifit",
  "max_peers": 10,
  "expires": "2027-04-03",
  "issued_by": "isorensen"
}
```

Keys are generated manually with a local script. Validation is offline (verify signature + expiration). No call home, no telemetry.

### 3.2 Bootstrap

```typescript
// packages/team/src/index.ts
export function registerTeamFeatures(server: McpServer, config: LoxConfig) {
  if (config.mode !== 'team' || !validateLicense(config.license_key)) {
    return; // noop — personal mode
  }
  // register created_by middleware, team tools, etc.
}
```

Without a valid key, `packages/team/` simply does not load. The MCP server starts in personal mode normally.

---

## 4. Installer Changes

### 4.1 New Steps for Team Mode

The installer gains a mode selection step at the beginning:

1. **Mode selection** — Personal vs Team
2. **License key** — validation + org name display
3. **Peers** — collect name/email per user, generate WireGuard keypairs automatically
4. **Output** — generate `.conf` per peer, update `config.json` with peer map

### 4.2 Config Output

```jsonc
{
  "mode": "team",
  "license_key": "lox-team-XXXX-...",
  "org": "credifit",
  "vault_path": "/home/lox/vault",
  "vpn": {
    "server_ip": "10.10.0.1",
    "subnet": "10.10.0.0/24",
    "listen_port": 51820,
    "peers": [
      { "name": "eduardo", "email": "eduardo@credifit.com.br", "ip": "10.10.0.2" },
      { "name": "matheus", "email": "matheus@credifit.com.br", "ip": "10.10.0.3" },
      { "name": "igor",    "email": "igor@credifit.com.br",    "ip": "10.10.0.4" }
    ]
  }
}
```

### 4.3 VPN Config Distribution

The installer generates one `.conf` file per peer. The admin distributes them manually. Each user imports into their WireGuard client (available on Mac/Windows/Linux/iOS/Android).

```
output/
  credifit-eduardo.conf
  credifit-matheus.conf
  credifit-igor.conf
```

---

## 5. Credifit Deploy Plan

### 5.1 Infrastructure

| Resource   | Value                                     |
|------------|-------------------------------------------|
| GCP Project | Credifit's own GCP project               |
| VM         | e2-small (2 vCPU, 2GB RAM)               |
| Disk       | 20GB SSD                                  |
| Region     | southamerica-east1 (São Paulo)            |
| Public IP  | None — VPN only                           |
| Firewall   | deny-all, except UDP 51820 (WireGuard)   |
| Backup     | Daily disk snapshot (7-day retention)     |
| Cost       | ~USD 20-25/month                          |

### 5.2 Deploy Steps

1. Create GCP project for Credifit
2. Run installer with Team mode + license key
3. Create private vault repo on Credifit's GitHub/GitLab
4. Configure git sync on VM (2min cron)
5. Distribute WireGuard `.conf` to Eduardo, Matheus, Igor
6. Each user configures Claude Code local → MCP server via VPN
7. (Optional) Each user clones vault repo in Obsidian

### 5.3 Client-Side Requirements

| Tool        | Required               | Purpose                              |
|-------------|------------------------|--------------------------------------|
| WireGuard   | Yes                    | VPN connection to MCP                |
| Claude Code | Yes                    | Client that talks to MCP server      |
| Obsidian    | No                     | Local vault visualization (optional) |
| Git         | Only if using Obsidian | Vault sync for local reading         |

### 5.4 Claude Code Config (per user)

```jsonc
{
  "mcpServers": {
    "lox-credifit": {
      "command": "ssh",
      "args": [
        "-o", "StrictHostKeyChecking=accept-new",
        "lox@10.10.0.1",
        "node", "/home/lox/lox-brain/dist/mcp/index.js"
      ]
    }
  }
}
```

---

## 6. Execution Roadmap

### Phase 1 — Core Preparation

1. MCP transport via StreamableHTTP (TCP listener on `127.0.0.1:3100` for peer IP identification)
2. Add optional `created_by` parameter to core db-client write functions (default `null`)

### Phase 2 — `packages/team/` MVP

1. License validation (JWT offline)
2. Peer resolver (config map IP → user identity)
3. `created_by` middleware (intercepts writes, injects author)
4. MCP extensions (`list_team_activity`, `search_by_author`)
5. Bootstrap `registerTeamFeatures()` called on MCP startup

### Phase 3 — Installer Team Flow

1. Mode selection step (Personal vs Team)
2. License key validation step
3. Peers collection step (name/email, WireGuard keypair generation)
4. Output generation (`.conf` per peer, updated `config.json`)
5. i18n strings (pt-BR and en for new steps)

### Phase 4 — Credifit Deploy

1. Create Credifit GCP project
2. Run team installer
3. Configure private vault repo + git sync
4. Distribute VPN configs
5. Test: each user writes a note, verify `created_by`, semantic search

### Phase 5 — Licensing & Documentation (parallel with 3-4)

1. Add LICENSE file to `packages/team/`
2. Update README.md — "Lox Team" section
3. Update CONTRIBUTING.md — CLA requirement for `packages/team/` PRs
4. Landing section explaining Personal vs Team

### Dependencies

```
Phase 1 → Phase 2 → Phase 3 → Phase 4
                                  ↑
                     Phase 5 ─────┘ (parallel with 3-4)
```

---

## 7. Explicitly Deferred (Post-MVP)

These items are NOT part of this spec. Each becomes its own design when there is real demand:

- Folder/tag-level permissions
- Admin dashboard (web UI for user management)
- License server (API for key generation/validation)
- SSO / LDAP integration
- Advanced audit trail (export, compliance reports)
- SaaS managed hosting
- `lox local` mode (no GCP dependency)
- Marketplace for plugins/integrations

---

## 8. Success Criteria

1. Eduardo, Matheus, and Igor can each write notes to the shared Credifit vault via Claude Code MCP
2. Each note has correct `created_by` attribution
3. `list_team_activity` shows who wrote what
4. `search_by_author` filters correctly
5. Personal mode (Eduardo's own brain) continues working independently on the other VM
6. License key validation prevents team features from loading without valid key
