# HTTP Transport + created_by Attribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire HTTP transport so the MCP server identifies callers by VPN IP and attributes note authorship via `created_by`.

**Architecture:** MCP server runs as a systemd service in HTTP mode, bound to the VPN interface IP only (`MCP_HOST=10.20.0.1`, read from `config.vpn.server_ip`). Zero Trust: even if GCP firewall is misconfigured, the MCP is unreachable from non-VPN interfaces. Clients connect directly via VPN (e.g., `http://10.20.0.1:3100`). `PeerResolver` maps the TCP source IP to a peer name. `write_note` embeds `created_by` in frontmatter; the watcher extracts it and passes to `upsertNote()`. The DB preserves first author via `COALESCE`.

**Security (Zero Trust):**
- MCP binds to VPN interface only (`10.20.0.1`), NOT `0.0.0.0` — defense-in-depth independent of firewall rules
- WireGuard authenticates peers by public key — no additional auth layer needed on MCP
- `created_by` middleware overwrites any client-supplied `_created_by` — prevents spoofing
- Systemd service runs as non-root user with restricted EnvironmentFile
- No secrets in code — all loaded from `/etc/lox/secrets.env` (GCP Secret Manager backed)

**Tech Stack:** TypeScript, vitest, systemd, WireGuard, PostgreSQL, `@modelcontextprotocol/sdk`

**Critical Design Note:** SSH tunnel (`ssh -L 3100:127.0.0.1:3100`) does NOT work for peer attribution — the server sees `127.0.0.1`, not the peer's VPN IP. Direct VPN connection is required.

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `packages/shared/src/types.ts` | Add `created_by?: string` to `NoteMetadata` |
| Modify | `packages/core/src/mcp/transports.ts` | Add `MCP_HOST` env var support |
| Modify | `packages/core/src/mcp/tools.ts` | Thread `_created_by` through `addFrontmatter` |
| Modify | `packages/core/src/lib/embedding-service.ts` | Extract `created_by` from frontmatter in `parseNote` |
| Modify | `packages/core/src/watcher/vault-watcher.ts` | Pass `metadata.created_by` to `upsertNote` |
| Create | `infra/systemd/lox-mcp.service` | Systemd unit for MCP HTTP service |
| Modify | `packages/installer/src/steps/step-vm-setup.ts` | Add `chunk_index` to schema (#152) |
| Modify | `packages/installer/src/steps/step-mcp.ts` | Team mode: install systemd service + HTTP registration |
| Test | `packages/core/tests/mcp/transports.test.ts` | MCP_HOST tests |
| Test | `packages/core/tests/lib/embedding-service.test.ts` | parseNote created_by tests |
| Test | `packages/core/tests/mcp/tools.test.ts` | write_note created_by frontmatter tests |
| Test | `packages/core/tests/watcher/vault-watcher.test.ts` | Watcher created_by pass-through tests |

---

### Task 1: Fix #152 — Add chunk_index to installer schema

**Files:**
- Modify: `packages/installer/src/steps/step-vm-setup.ts:320-336`
- Test: `packages/installer/tests/steps/step-vm-setup.test.ts`

- [ ] **Step 1: Write failing test for chunk_index in schema**

In the existing test file for `buildDbSetupScript`, add:

```typescript
it('should include chunk_index column in CREATE TABLE', () => {
  const script = buildDbSetupScript('testpw');
  expect(script).toContain('chunk_index INTEGER NOT NULL DEFAULT 0');
});

it('should use composite unique constraint on (file_path, chunk_index)', () => {
  const script = buildDbSetupScript('testpw');
  expect(script).not.toContain('file_path TEXT UNIQUE NOT NULL');
  expect(script).toContain('UNIQUE (file_path, chunk_index)');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=packages/installer -- --run -t "chunk_index"`
Expected: FAIL — schema has `file_path TEXT UNIQUE NOT NULL` without chunk_index.

- [ ] **Step 3: Fix the CREATE TABLE in buildDbSetupScript**

In `packages/installer/src/steps/step-vm-setup.ts`, replace the CREATE TABLE SQL (lines 320-336):

```sql
CREATE TABLE IF NOT EXISTS vault_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_path TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  tags TEXT[] NOT NULL DEFAULT '{}',
  embedding vector(1536),
  file_hash TEXT NOT NULL DEFAULT '',
  chunk_index INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (file_path, chunk_index)
);
```

Key changes:
- Removed `UNIQUE` from `file_path` column definition
- Added `chunk_index INTEGER NOT NULL DEFAULT 0`
- Added `UNIQUE (file_path, chunk_index)` as table constraint

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=packages/installer -- --run -t "chunk_index"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/installer/src/steps/step-vm-setup.ts packages/installer/tests/steps/step-vm-setup.test.ts
git commit -m "fix(installer): add chunk_index column to schema (#152)"
```

---

### Task 2: Add MCP_HOST env var to transport config

**Files:**
- Modify: `packages/core/src/mcp/transports.ts`
- Test: `packages/core/tests/mcp/transports.test.ts`

- [ ] **Step 1: Write failing test for MCP_HOST**

```typescript
it('should respect MCP_HOST override', async () => {
  process.env.MCP_TRANSPORT = 'http';
  process.env.MCP_HOST = '10.20.0.1';
  const { getTransportConfig } = await import('../../src/mcp/transports.js');
  const config = getTransportConfig();

  if (config.type !== 'http') throw new Error('Expected http config');
  expect(config.host).toBe('10.20.0.1');
});

it('should default MCP_HOST to 127.0.0.1', async () => {
  process.env.MCP_TRANSPORT = 'http';
  delete process.env.MCP_HOST;
  const { getTransportConfig } = await import('../../src/mcp/transports.js');
  const config = getTransportConfig();

  if (config.type !== 'http') throw new Error('Expected http config');
  expect(config.host).toBe('127.0.0.1');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=packages/core -- --run -t "MCP_HOST"`
Expected: FAIL — `MCP_HOST` env var not read.

- [ ] **Step 3: Implement MCP_HOST support**

In `packages/core/src/mcp/transports.ts`, update the http branch:

```typescript
if (transport === 'http') {
  const rawPort = process.env.MCP_PORT;
  const port = rawPort !== undefined ? parseInt(rawPort, 10) : 3100;

  if (rawPort !== undefined && (isNaN(port) || port < 1 || port > 65535)) {
    throw new Error(`Invalid MCP_PORT value: "${rawPort}". Must be a number between 1 and 65535.`);
  }

  const host = process.env.MCP_HOST ?? '127.0.0.1';

  return {
    type: 'http',
    host,
    port,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=packages/core -- --run -t "MCP_HOST"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/mcp/transports.ts packages/core/tests/mcp/transports.test.ts
git commit -m "feat(mcp): add MCP_HOST env var for VPN-bound HTTP transport (#153)"
```

---

### Task 3: Add created_by to NoteMetadata type

**Files:**
- Modify: `packages/shared/src/types.ts:1-5`
- Test: `packages/shared/tests/index.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
it('should allow NoteMetadata with created_by', () => {
  const meta: NoteMetadata = { title: 'Test', tags: ['a'], content: 'body', created_by: 'eduardo' };
  expect(meta.created_by).toBe('eduardo');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=packages/shared -- --run -t "created_by"`
Expected: FAIL — `created_by` not in `NoteMetadata`.

- [ ] **Step 3: Add created_by to NoteMetadata**

In `packages/shared/src/types.ts`:

```typescript
export interface NoteMetadata {
  title: string | null;
  tags: string[];
  content: string;
  created_by?: string;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=packages/shared -- --run -t "created_by"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/tests/index.test.ts
git commit -m "feat(shared): add created_by to NoteMetadata type (#153)"
```

---

### Task 4: Extract created_by from frontmatter in parseNote

**Files:**
- Modify: `packages/core/src/lib/embedding-service.ts:31-79`
- Test: `packages/core/tests/lib/embedding-service.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
it('should extract created_by from frontmatter', () => {
  const rawContent = `---
title: Team Note
tags: [meeting]
created_by: matheus
---

Meeting notes here.`;

  const result = service.parseNote(rawContent);
  expect(result.created_by).toBe('matheus');
});

it('should return undefined created_by when not in frontmatter', () => {
  const rawContent = `---
title: Personal Note
tags: [diary]
---

My personal note.`;

  const result = service.parseNote(rawContent);
  expect(result.created_by).toBeUndefined();
});

it('should return undefined created_by when no frontmatter', () => {
  const rawContent = `Just plain text.`;

  const result = service.parseNote(rawContent);
  expect(result.created_by).toBeUndefined();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace=packages/core -- --run -t "created_by"`
Expected: FAIL — `parseNote` doesn't extract `created_by`.

- [ ] **Step 3: Implement created_by extraction in parseNote**

In `packages/core/src/lib/embedding-service.ts`, inside `parseNote()`, after the tags extraction block (around line 63), add:

```typescript
// Extract created_by from frontmatter
let created_by: string | undefined;
if (frontmatterMatch) {
  const frontmatter = frontmatterMatch[1];
  // ... existing title/tags extraction ...

  const createdByMatch = frontmatter.match(/^created_by:\s*(.+)$/m);
  if (createdByMatch) {
    created_by = createdByMatch[1].trim();
  }
}
```

Update the return statement:

```typescript
return { title, tags, content, created_by };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace=packages/core -- --run -t "created_by"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/lib/embedding-service.ts packages/core/tests/lib/embedding-service.test.ts
git commit -m "feat(core): extract created_by from note frontmatter (#153)"
```

---

### Task 5: Thread created_by through write_note and addFrontmatter

**Files:**
- Modify: `packages/core/src/mcp/tools.ts:40-84`
- Test: `packages/core/tests/mcp/tools.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
describe('addFrontmatter', () => {
  it('should include created_by in frontmatter when provided', () => {
    const result = addFrontmatter('Hello world', ['tag1'], 'eduardo');
    expect(result).toBe('---\ntags: [tag1]\ncreated_by: eduardo\n---\nHello world');
  });

  it('should add frontmatter with only created_by when no tags', () => {
    const result = addFrontmatter('Hello world', [], 'matheus');
    expect(result).toBe('---\ncreated_by: matheus\n---\nHello world');
  });

  it('should not add created_by line when not provided', () => {
    const result = addFrontmatter('Hello world', ['tag1']);
    expect(result).toBe('---\ntags: [tag1]\n---\nHello world');
  });

  it('should not add frontmatter when no tags and no created_by', () => {
    const result = addFrontmatter('Hello world', []);
    expect(result).toBe('Hello world');
  });

  it('should not modify content that already has frontmatter', () => {
    const content = '---\ntitle: Existing\n---\nBody';
    const result = addFrontmatter(content, ['tag1'], 'eduardo');
    expect(result).toBe(content);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace=packages/core -- --run -t "addFrontmatter"`
Expected: FAIL — `addFrontmatter` doesn't accept `createdBy` param.

- [ ] **Step 3: Update addFrontmatter signature and logic**

In `packages/core/src/mcp/tools.ts`, replace `addFrontmatter`:

```typescript
function addFrontmatter(content: string, tags: string[], createdBy?: string): string {
  if (content.startsWith('---')) return content;

  const fields: string[] = [];
  if (tags.length > 0) fields.push(`tags: [${tags.join(', ')}]`);
  if (createdBy) fields.push(`created_by: ${createdBy}`);

  if (fields.length === 0) return content;
  return `---\n${fields.join('\n')}\n---\n${content}`;
}
```

**Note:** Export `addFrontmatter` for testing (add `export` keyword).

- [ ] **Step 4: Update write_note handler to pass _created_by**

In the `write_note` handler (line 67-85), after extracting tags, add:

```typescript
const createdBy = typeof args._created_by === 'string' ? args._created_by : undefined;

const finalContent = addFrontmatter(content, tags, createdBy);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test --workspace=packages/core -- --run -t "addFrontmatter"`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/mcp/tools.ts packages/core/tests/mcp/tools.test.ts
git commit -m "feat(mcp): thread created_by through write_note frontmatter (#153)"
```

---

### Task 6: Watcher passes created_by to upsertNote

**Files:**
- Modify: `packages/core/src/watcher/vault-watcher.ts:47-57`
- Test: `packages/core/tests/watcher/vault-watcher.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
it('should pass created_by from frontmatter to upsertNote', async () => {
  const content = `---
title: Team Note
created_by: lucas
---

Content here.`;

  mockEmbeddingService.parseNote.mockReturnValue({
    title: 'Team Note',
    tags: [],
    content: 'Content here.',
    created_by: 'lucas',
  });
  mockEmbeddingService.chunkText.mockReturnValue(['Content here.']);
  mockEmbeddingService.computeHash.mockReturnValue('newhash');
  mockEmbeddingService.generateEmbedding.mockResolvedValue([0.1, 0.2]);
  mockDbClient.getFileHash.mockResolvedValue(null);

  await watcher.handleFileChange('/vault/test.md', content);

  expect(mockDbClient.upsertNote).toHaveBeenCalledWith(
    expect.objectContaining({ created_by: 'lucas' }),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=packages/core -- --run -t "created_by from frontmatter"`
Expected: FAIL — watcher doesn't pass `created_by`.

- [ ] **Step 3: Add created_by to upsertNote call in watcher**

In `packages/core/src/watcher/vault-watcher.ts`, update the upsert call (line 48-57):

```typescript
for (let i = 0; i < chunkData.length; i++) {
  await this.dbClient.upsertNote({
    id: randomUUID(),
    file_path: relative,
    title: metadata.title,
    content: chunkData[i].content,
    tags: metadata.tags,
    embedding: chunkData[i].embedding,
    file_hash: newHash,
    chunk_index: i,
    created_by: metadata.created_by,
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace=packages/core -- --run -t "created_by"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/watcher/vault-watcher.ts packages/core/tests/watcher/vault-watcher.test.ts
git commit -m "feat(watcher): pass created_by from frontmatter to DB (#153)"
```

---

### Task 7: Create systemd service for MCP HTTP

**Files:**
- Create: `infra/systemd/lox-mcp.service`

- [ ] **Step 1: Create the systemd unit file**

```ini
[Unit]
Description=Lox Brain MCP Server (HTTP)
After=network.target postgresql.service

[Service]
Type=simple
User=__LOX_VM_USER__
WorkingDirectory=__LOX_INSTALL_DIR__
EnvironmentFile=/etc/lox/secrets.env
ExecStart=/usr/bin/env node __LOX_INSTALL_DIR__/packages/core/dist/mcp/index.js
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

The `secrets.env` on the VM must include:
```
MCP_TRANSPORT=http
MCP_PORT=3100
MCP_HOST=10.20.0.1
LOX_MODE=team
```

- [ ] **Step 2: Commit**

```bash
git add infra/systemd/lox-mcp.service
git commit -m "feat(infra): add systemd service for MCP HTTP mode (#153)"
```

---

### Task 8: Update installer step-mcp for team mode

**Files:**
- Modify: `packages/installer/src/steps/step-mcp.ts`
- Test: `packages/installer/tests/steps/step-mcp.test.ts`

- [ ] **Step 1: Write failing test for team mode MCP registration**

```typescript
it('should register MCP with HTTP URL in team mode', () => {
  // Test that buildMcpLauncherScript is NOT used for team mode
  // Team mode uses systemd service + HTTP URL registration
});
```

- [ ] **Step 2: Add systemd service installation for team mode**

In `stepMcp()`, after uploading the launcher script, add a team mode branch:

```typescript
const isTeamMode = ctx.config.mode === 'team';

if (isTeamMode) {
  // Install and start MCP systemd service
  await withSpinner(
    'Installing MCP HTTP service on VM...',
    async () => {
      // Upload service file
      const serviceContent = readFileSync(
        path.join(__dirname, '../../../../infra/systemd/lox-mcp.service'),
        'utf-8',
      )
        .replace(/__LOX_VM_USER__/g, sshUser)
        .replace(/__LOX_INSTALL_DIR__/g, installDir);

      const tmpService = join(tmpdir(), `lox-mcp-${Date.now()}.service`);
      writeFileSync(tmpService, serviceContent);
      try {
        await shell('scp', [tmpService, 'lox-vm:/tmp/lox-mcp.service']);
        await shell('ssh', ['lox-vm', 'sudo', 'mv', '/tmp/lox-mcp.service', '/etc/systemd/system/lox-mcp.service']);
        await shell('ssh', ['lox-vm', 'sudo', 'systemctl', 'daemon-reload']);
        await shell('ssh', ['lox-vm', 'sudo', 'systemctl', 'enable', '--now', 'lox-mcp']);
      } finally {
        try { rmSync(tmpService, { force: true }); } catch { /* best-effort */ }
      }
    },
  );
}
```

- [ ] **Step 3: Update Claude Code registration for team mode**

For team mode, register with HTTP URL using `mcp-remote` or the streamable HTTP URL:

```typescript
const mcpServerName = isTeamMode
  ? `lox-brain-${ctx.config.license_org ?? 'team'}`
  : 'lox-brain';

if (isTeamMode) {
  // Team mode: direct HTTP via VPN
  const vpnServerIp = ctx.config.vpn?.server_ip ?? vpnCfg.serverIp;
  const mcpPort = 3100;
  await shell('claude', [
    'mcp', 'add',
    '--scope', 'user',
    '--transport', 'sse',
    mcpServerName,
    `http://${vpnServerIp}:${mcpPort}/mcp`,
  ]);
} else {
  // Personal mode: SSH stdio (existing behavior)
  await shell('claude', [
    'mcp', 'add',
    '--scope', 'user',
    mcpServerName,
    '--',
    'ssh', 'lox-vm', remoteLauncher,
  ]);
}
```

**Note:** The exact `claude mcp add` syntax for HTTP transport may need adjustment based on Claude Code's current CLI. Verify with `claude mcp add --help` during implementation.

- [ ] **Step 4: Run tests**

Run: `npm run test --workspace=packages/installer -- --run -t "step-mcp"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/installer/src/steps/step-mcp.ts packages/installer/tests/steps/step-mcp.test.ts infra/systemd/lox-mcp.service
git commit -m "feat(installer): team mode MCP HTTP service + registration (#153)"
```

---

### Task 9: Update .env.example with team mode variables

**Files:**
- Modify: `packages/core/.env.example`

- [ ] **Step 1: Add team mode env vars**

```bash
# Database (Lox defaults)
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=lox_brain
DB_USER=lox
PG_PASSWORD=changeme_in_prod

# OpenAI (embeddings)
OPENAI_API_KEY=changeme_in_prod

# Vault
VAULT_PATH=/path/to/your/vault

# MCP Transport (default: stdio)
# MCP_TRANSPORT=http
# MCP_PORT=3100
# MCP_HOST=127.0.0.1  (personal) or VPN IP e.g. 10.20.0.1 (team — Zero Trust: never 0.0.0.0)

# Team mode
# LOX_MODE=team
# LOX_LICENSE_PUBLIC_KEY=/etc/lox/license-public.pem
# LOX_CONFIG_PATH=~/.lox/teams/<org>/config.json
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/.env.example
git commit -m "docs(core): add team mode env vars to .env.example (#153)"
```

---

### Task 10: Run full test suite and type check

- [ ] **Step 1: Type check all packages**

Run: `npx tsc --noEmit --workspaces`
Expected: No type errors

- [ ] **Step 2: Run full test suite**

Run: `npm run test --workspaces`
Expected: All tests pass

- [ ] **Step 3: Final commit if any fixes needed**

---

## Verification Checklist

After all tasks complete, verify on the Credifit VM:

1. `ssh lox-credifit` — confirm VPN connectivity
2. Check `secrets.env` has `MCP_TRANSPORT=http`, `MCP_HOST=10.20.0.1`, `MCP_PORT=3100`, `LOX_MODE=team`
3. `sudo systemctl status lox-mcp` — confirm MCP HTTP service running
4. `curl http://10.20.0.1:3100/mcp` from local machine — confirm reachable via VPN
5. Write a test note via MCP and verify `created_by` appears in frontmatter
6. Query `SELECT file_path, created_by FROM vault_embeddings ORDER BY updated_at DESC LIMIT 5` — verify attribution
7. Verify `list_team_activity` returns `created_by` field
