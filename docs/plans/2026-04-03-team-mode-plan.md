# Lox Team Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multi-user Team Mode to Lox as a commercially licensed extension (`packages/team/`), enabling VPN-based user identification, `created_by` attribution, team MCP tools, and an installer wizard for team setup.

**Architecture:** The open core remains MIT (`packages/core/`, `packages/shared/`). Team features live in `packages/team/` under a commercial license. User identity is derived from WireGuard VPN peer IPs -- no auth server needed. The MCP server gains an optional StreamableHTTP transport so it can identify callers by IP. A `registerTeamFeatures()` bootstrap function conditionally loads team features when `config.mode === 'team'` and a valid license key is present.

**Tech Stack:** TypeScript (strict mode), Node.js 22 LTS, vitest, PostgreSQL 16 + pgvector, `@modelcontextprotocol/sdk` (StreamableHTTP transport), `jsonwebtoken` (JWT license validation), `@inquirer/prompts` (installer), WireGuard

---

## Phase 1 -- Core Preparation

### Task 1: Add `created_by` to shared types

**Files:**
- Modify: `packages/shared/src/types.ts`
- Test: `packages/shared/tests/types.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/tests/types.test.ts`:

```typescript
import { describe, it, expectTypeOf } from 'vitest';
import type { NoteRow, SearchResult, RecentNote } from '../src/types.js';

describe('NoteRow type', () => {
  it('should accept created_by as optional string', () => {
    const note: NoteRow = {
      id: 'abc',
      file_path: 'test.md',
      title: 'Test',
      content: 'content',
      tags: [],
      embedding: [0.1],
      file_hash: 'hash',
      chunk_index: 0,
    };
    expectTypeOf(note).toHaveProperty('created_by');
    expectTypeOf<NoteRow['created_by']>().toEqualTypeOf<string | undefined>();
  });
});

describe('SearchResult type', () => {
  it('should have optional created_by field', () => {
    expectTypeOf<SearchResult['created_by']>().toEqualTypeOf<string | undefined>();
  });
});

describe('RecentNote type', () => {
  it('should have optional created_by field', () => {
    expectTypeOf<RecentNote['created_by']>().toEqualTypeOf<string | undefined>();
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm run test --workspace=packages/shared`
Expected: FAIL -- `created_by` property does not exist on `NoteRow`, `SearchResult`, `RecentNote`

- [ ] **Step 3: Write minimal implementation**

In `packages/shared/src/types.ts`, add `created_by?: string` to all three interfaces:

```typescript
export interface NoteRow {
  id: string;
  file_path: string;
  title: string | null;
  content: string;
  tags: string[];
  embedding: number[];
  file_hash: string;
  chunk_index: number;
  created_by?: string;
}

export interface SearchResult {
  id: string;
  file_path: string;
  title: string | null;
  content?: string;
  tags: string[];
  similarity: number;
  updated_at: Date;
  created_by?: string;
}

export interface RecentNote {
  id: string;
  file_path: string;
  title: string | null;
  content?: string;
  tags: string[];
  updated_at: Date;
  created_by?: string;
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `npm run test --workspace=packages/shared`
Expected: PASS

- [ ] **Step 5: Commit**

Message: `feat(shared): add created_by field to NoteRow, SearchResult, RecentNote types`

---

### Task 2: Add `created_by` parameter to `DbClient.upsertNote()`

**Files:**
- Modify: `packages/core/src/lib/db-client.ts`
- Modify: `packages/core/tests/lib/db-client.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/core/tests/lib/db-client.test.ts` inside `describe('upsertNote')`:

```typescript
it('should include created_by in INSERT and preserve it on conflict', async () => {
  mockPool.query.mockResolvedValue({ rowCount: 1 });

  const note: NoteRow = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    file_path: 'notes/team-note.md',
    title: 'Team Note',
    content: 'Written by eduardo',
    tags: ['team'],
    embedding: [0.1, 0.2],
    file_hash: 'hash456',
    chunk_index: 0,
    created_by: 'eduardo',
  };

  await client.upsertNote(note);

  expect(mockPool.query).toHaveBeenCalledTimes(1);
  const [sql, params] = mockPool.query.mock.calls[0];
  expect(sql).toContain('created_by');
  expect(params).toContain('eduardo');
  // On conflict, created_by should NOT be overwritten (use COALESCE to preserve original)
  expect(sql).toContain('COALESCE');
});

it('should pass null created_by when not provided', async () => {
  mockPool.query.mockResolvedValue({ rowCount: 1 });

  const note: NoteRow = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    file_path: 'notes/personal.md',
    title: 'Personal Note',
    content: 'No author',
    tags: [],
    embedding: [0.1],
    file_hash: 'hash789',
    chunk_index: 0,
  };

  await client.upsertNote(note);

  const [sql, params] = mockPool.query.mock.calls[0];
  expect(sql).toContain('created_by');
  expect(params).toContain(null);
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm run test --workspace=packages/core -- --testPathPattern=db-client`
Expected: FAIL -- SQL does not contain `created_by`, params do not include author value

- [ ] **Step 3: Write minimal implementation**

Replace the `upsertNote` method in `packages/core/src/lib/db-client.ts`:

```typescript
async upsertNote(note: NoteRow): Promise<void> {
  const sql = `
    INSERT INTO vault_embeddings (id, file_path, title, content, tags, embedding, file_hash, chunk_index, created_by, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
    ON CONFLICT (file_path, chunk_index) DO UPDATE SET
      title = EXCLUDED.title,
      content = EXCLUDED.content,
      tags = EXCLUDED.tags,
      embedding = EXCLUDED.embedding,
      file_hash = EXCLUDED.file_hash,
      created_by = COALESCE(vault_embeddings.created_by, EXCLUDED.created_by),
      updated_at = NOW()
  `;

  await this.pool.query(sql, [
    note.id,
    note.file_path,
    note.title,
    note.content,
    note.tags,
    JSON.stringify(note.embedding),
    note.file_hash,
    note.chunk_index,
    note.created_by ?? null,
  ]);
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `npm run test --workspace=packages/core -- --testPathPattern=db-client`
Expected: PASS (all existing tests still pass since NoteRow without `created_by` defaults to `null`)

- [ ] **Step 5: Commit**

Message: `feat(core): add created_by to upsertNote with COALESCE to preserve original author`

---

### Task 3: Return `created_by` in search and list queries

**Files:**
- Modify: `packages/core/src/lib/db-client.ts`
- Modify: `packages/core/tests/lib/db-client.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/core/tests/lib/db-client.test.ts`:

Inside `describe('searchSemantic')`:

```typescript
it('should SELECT created_by in semantic search results', async () => {
  const fakeRows = [
    {
      id: 'id1',
      file_path: 'notes/a.md',
      title: 'Note A',
      content: null,
      tags: ['tag1'],
      similarity: 0.92,
      updated_at: new Date('2026-03-07'),
      created_by: 'eduardo',
      total_count: '1',
    },
  ];
  mockPool.query.mockResolvedValue({ rows: fakeRows });

  const result = await client.searchSemantic([0.1], { limit: 5 });

  const [sql] = mockPool.query.mock.calls[0];
  expect(sql).toContain('created_by');
  expect(result.results[0].created_by).toBe('eduardo');
});
```

Inside `describe('searchText')`:

```typescript
it('should SELECT created_by in text search results', async () => {
  const fakeRows = [
    {
      id: 'id1',
      file_path: 'notes/b.md',
      title: 'Note B',
      content: null,
      tags: [],
      updated_at: new Date(),
      created_by: 'matheus',
      total_count: '1',
    },
  ];
  mockPool.query.mockResolvedValue({ rows: fakeRows });

  const result = await client.searchText('query');

  const [sql] = mockPool.query.mock.calls[0];
  expect(sql).toContain('created_by');
  expect(result.results[0].created_by).toBe('matheus');
});
```

Inside `describe('listRecent')`:

```typescript
it('should SELECT created_by in recent notes', async () => {
  const fakeRows = [
    {
      id: 'id1',
      file_path: 'notes/c.md',
      title: 'Note C',
      content: null,
      tags: [],
      updated_at: new Date(),
      created_by: 'igor',
      total_count: '1',
    },
  ];
  mockPool.query.mockResolvedValue({ rows: fakeRows });

  const result = await client.listRecent(5);

  const [sql] = mockPool.query.mock.calls[0];
  expect(sql).toContain('created_by');
  expect(result.results[0].created_by).toBe('igor');
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm run test --workspace=packages/core -- --testPathPattern=db-client`
Expected: FAIL -- SQL queries do not contain `created_by`

- [ ] **Step 3: Write minimal implementation**

In `packages/core/src/lib/db-client.ts`, update the three SELECT queries:

**searchSemantic** -- change the SQL template string:

```typescript
const sql = `
  SELECT id, file_path, title, ${contentCol.sql}, tags,
         1 - (embedding <=> $1::vector) AS similarity,
         updated_at, created_by,
         COUNT(*) OVER() AS total_count
  FROM vault_embeddings
  ORDER BY embedding <=> $1::vector
  LIMIT $${limitIdx}
  OFFSET $${offsetIdx}
`;
```

**listRecent** -- change the SQL template string:

```typescript
const sql = `
  SELECT id, file_path, title, ${contentCol.sql}, tags, updated_at, created_by,
         COUNT(*) OVER() AS total_count
  FROM vault_embeddings
  ORDER BY updated_at DESC
  LIMIT $${limitIdx}
  OFFSET $${offsetIdx}
`;
```

**searchText** -- change the SQL template string:

```typescript
const sql = `
  SELECT id, file_path, title, ${contentCol.sql}, tags, updated_at, created_by,
         COUNT(*) OVER() AS total_count
  FROM vault_embeddings
  WHERE content ILIKE $${queryParamIdx}${tagsClause}
  ORDER BY updated_at DESC
  LIMIT $${limitIdx}
  OFFSET $${offsetIdx}
`;
```

- [ ] **Step 4: Run test to verify pass**

Run: `npm run test --workspace=packages/core -- --testPathPattern=db-client`
Expected: PASS

- [ ] **Step 5: Commit**

Message: `feat(core): return created_by in searchSemantic, searchText, listRecent queries`

---

### Task 4: Add StreamableHTTP transport to MCP server

**Files:**
- Modify: `packages/core/src/mcp/index.ts`
- Create: `packages/core/src/mcp/transports.ts`
- Test: `packages/core/tests/mcp/transports.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/tests/mcp/transports.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('selectTransport', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should default to stdio when MCP_TRANSPORT is not set', async () => {
    delete process.env.MCP_TRANSPORT;
    const { getTransportConfig } = await import('../../src/mcp/transports.js');
    const config = getTransportConfig();
    expect(config.type).toBe('stdio');
  });

  it('should select stdio when MCP_TRANSPORT=stdio', async () => {
    process.env.MCP_TRANSPORT = 'stdio';
    const { getTransportConfig } = await import('../../src/mcp/transports.js');
    const config = getTransportConfig();
    expect(config.type).toBe('stdio');
  });

  it('should select http when MCP_TRANSPORT=http', async () => {
    process.env.MCP_TRANSPORT = 'http';
    const { getTransportConfig } = await import('../../src/mcp/transports.js');
    const config = getTransportConfig();
    expect(config.type).toBe('http');
    expect(config.port).toBe(3100);
    expect(config.host).toBe('127.0.0.1');
  });

  it('should respect MCP_PORT override', async () => {
    process.env.MCP_TRANSPORT = 'http';
    process.env.MCP_PORT = '4200';
    const { getTransportConfig } = await import('../../src/mcp/transports.js');
    const config = getTransportConfig();
    expect(config.port).toBe(4200);
  });

  it('should throw on invalid transport value', async () => {
    process.env.MCP_TRANSPORT = 'websocket';
    const { getTransportConfig } = await import('../../src/mcp/transports.js');
    expect(() => getTransportConfig()).toThrow('Invalid MCP_TRANSPORT');
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm run test --workspace=packages/core -- --testPathPattern=transports`
Expected: FAIL -- module `transports.js` does not exist

- [ ] **Step 3: Write minimal implementation**

Create `packages/core/src/mcp/transports.ts`:

```typescript
export interface StdioTransportConfig {
  type: 'stdio';
}

export interface HttpTransportConfig {
  type: 'http';
  host: string;
  port: number;
}

export type TransportConfig = StdioTransportConfig | HttpTransportConfig;

export function getTransportConfig(): TransportConfig {
  const transport = process.env.MCP_TRANSPORT ?? 'stdio';

  if (transport === 'stdio') {
    return { type: 'stdio' };
  }

  if (transport === 'http') {
    const port = process.env.MCP_PORT ? parseInt(process.env.MCP_PORT, 10) : 3100;
    return {
      type: 'http',
      host: '127.0.0.1',
      port,
    };
  }

  throw new Error(`Invalid MCP_TRANSPORT value: "${transport}". Must be "stdio" or "http".`);
}
```

- [ ] **Step 4: Update MCP server entry to use transport config**

Modify `packages/core/src/mcp/index.ts` to replace the hardcoded stdio transport:

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createServer } from 'node:http';
import OpenAI from 'openai';
import { LOX_MCP_SERVER_NAME, LOX_VERSION } from '@lox-brain/shared';
import { EmbeddingService } from '../lib/embedding-service.js';
import { DbClient } from '../lib/db-client.js';
import { createPool } from '../lib/create-pool.js';
import { createTools } from './tools.js';
import { getTransportConfig } from './transports.js';

const VAULT_PATH = process.env.VAULT_PATH;
if (!VAULT_PATH) {
  console.error('VAULT_PATH environment variable is required');
  process.exit(1);
}
if (!process.env.OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY environment variable is required');
  process.exit(1);
}
if (!process.env.PG_PASSWORD) {
  console.error('PG_PASSWORD environment variable is required');
  process.exit(1);
}

const pool = createPool();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const embeddingService = new EmbeddingService(openai);
const dbClient = new DbClient(pool);
const tools = createTools(dbClient, embeddingService, VAULT_PATH);

const server = new Server(
  { name: LOX_MCP_SERVER_NAME, version: LOX_VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = tools.find((t) => t.name === request.params.name);
  if (!tool) {
    return {
      content: [{ type: 'text' as const, text: `Unknown tool: ${request.params.name}` }],
      isError: true,
    };
  }

  try {
    const result = await tool.handler((request.params.arguments ?? {}) as Record<string, unknown>);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text' as const, text: `Error: ${message}` }],
      isError: true,
    };
  }
});

async function main(): Promise<void> {
  const transportConfig = getTransportConfig();

  if (transportConfig.type === 'stdio') {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('Lox Brain MCP Server running on stdio');
  } else {
    const httpServer = createServer(async (req, res) => {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      // Store client IP on the transport for peer resolution in team mode
      (transport as any).clientIp = req.socket.remoteAddress ?? null;
      await server.connect(transport);
      await transport.handleRequest(req, res);
    });

    httpServer.listen(transportConfig.port, transportConfig.host, () => {
      console.error(
        `Lox Brain MCP Server running on http://${transportConfig.host}:${transportConfig.port}`,
      );
    });
  }
}

main().catch((err: unknown) => {
  console.error('Fatal error starting MCP server:', err);
  process.exit(1);
});
```

- [ ] **Step 5: Run test to verify pass**

Run: `npm run test --workspace=packages/core -- --testPathPattern=transports`
Expected: PASS

- [ ] **Step 6: Run full core test suite**

Run: `npm run test --workspace=packages/core`
Expected: All existing tests still PASS

- [ ] **Step 7: Commit**

Message: `feat(core): add StreamableHTTP transport option for team mode peer identification`

---

## Phase 2 -- packages/team/ MVP

### Task 5: Create packages/team/ scaffold

**Files:**
- Create: `packages/team/package.json`
- Create: `packages/team/tsconfig.json`
- Create: `packages/team/src/index.ts`
- Create: `packages/team/LICENSE`
- Modify: `package.json` (root -- add workspace)
- Modify: `package.json` (root -- add lint command for team)

- [ ] **Step 1: Create package.json**

Create `packages/team/package.json`:

```json
{
  "name": "@lox-brain/team",
  "version": "0.1.0",
  "private": true,
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage"
  },
  "dependencies": {
    "@lox-brain/shared": "*",
    "@lox-brain/core": "*",
    "jsonwebtoken": "^9.0.2"
  },
  "devDependencies": {
    "@types/jsonwebtoken": "^9.0.9",
    "@types/node": "^25.3.5",
    "@vitest/coverage-v8": "^4.0.18",
    "tsx": "^4.21.0",
    "typescript": "^5.9.3",
    "vitest": "^4.0.18"
  },
  "type": "commonjs"
}
```

- [ ] **Step 2: Create tsconfig.json**

Create `packages/team/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"],
  "references": [
    { "path": "../shared" },
    { "path": "../core" }
  ]
}
```

- [ ] **Step 3: Create stub entry point**

Create `packages/team/src/index.ts`:

```typescript
import type { LoxConfig } from '@lox-brain/shared';

export interface TeamRegistrationResult {
  success: boolean;
  org?: string;
  peersRegistered?: number;
  error?: string;
}

export async function registerTeamFeatures(
  _server: unknown,
  _config: LoxConfig,
  _tools: unknown[],
  _publicKey: string,
): Promise<TeamRegistrationResult> {
  // Stub -- will be implemented in Task 10
  return { success: false, error: 'Not yet implemented' };
}
```

- [ ] **Step 4: Add to root workspaces**

In root `package.json`, update workspaces array:

```json
{
  "workspaces": [
    "packages/shared",
    "packages/core",
    "packages/installer",
    "packages/team"
  ]
}
```

Update root `package.json` lint script:

```json
{
  "lint": "tsc --noEmit --project packages/shared/tsconfig.json && tsc --noEmit --project packages/core/tsconfig.json && tsc --noEmit --project packages/installer/tsconfig.json && tsc --noEmit --project packages/team/tsconfig.json"
}
```

- [ ] **Step 5: Create LICENSE file**

Create `packages/team/LICENSE`:

```
Lox Team -- Commercial License

Copyright (c) 2026 Eduardo Sorensen (iSorensen). All rights reserved.

This software and associated documentation files (the "Software") are the
proprietary property of Eduardo Sorensen. The Software is licensed, not sold.

GRANT OF LICENSE:
Subject to the terms of this license and payment of applicable fees, the
licensor grants the licensee a non-exclusive, non-transferable, revocable
license to use the Software for the number of users specified in the
license key.

RESTRICTIONS:
1. You may NOT redistribute, sublicense, or share the Software or any
   portion thereof without prior written consent from the licensor.
2. You may NOT modify, reverse engineer, decompile, or disassemble the
   Software except as required by applicable law.
3. You may NOT remove or alter any proprietary notices, labels, or marks
   on the Software.

TERMINATION:
This license is effective until terminated. It will terminate automatically
if you fail to comply with any term of this license or if the license key
expires. Upon termination, you must destroy all copies of the Software.

NO WARRANTY:
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.

LIMITATION OF LIABILITY:
IN NO EVENT SHALL THE LICENSOR BE LIABLE FOR ANY CLAIM, DAMAGES, OR OTHER
LIABILITY ARISING FROM, OUT OF, OR IN CONNECTION WITH THE SOFTWARE.

For licensing inquiries: eduardo@isorensen.dev
```

- [ ] **Step 6: Install dependencies and verify build**

Run: `npm install && npm run build --workspace=packages/team`
Expected: Build succeeds

- [ ] **Step 7: Commit**

Message: `feat(team): create packages/team scaffold with commercial license`

---

### Task 6: License validation

**Files:**
- Create: `packages/team/src/license/validator.ts`
- Create: `packages/team/src/license/types.ts`
- Create: `packages/team/scripts/generate-license.ts`
- Test: `packages/team/tests/license/validator.test.ts`

- [ ] **Step 1: Create the types file**

Create `packages/team/src/license/types.ts`:

```typescript
export interface LicensePayload {
  org: string;
  max_peers: number;
  expires: string;
  issued_by: string;
}
```

- [ ] **Step 2: Write the failing test**

Create `packages/team/tests/license/validator.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { validateLicense } from '../../src/license/validator.js';
import type { LicensePayload } from '../../src/license/types.js';

describe('validateLicense', () => {
  let privateKey: string;
  let publicKey: string;

  beforeAll(() => {
    const pair = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    privateKey = pair.privateKey;
    publicKey = pair.publicKey;
  });

  function createToken(payload: LicensePayload, key: string, expiresIn?: string): string {
    return jwt.sign(payload, key, {
      algorithm: 'RS256',
      expiresIn: expiresIn ?? '365d',
    });
  }

  it('should return payload for a valid license', () => {
    const token = createToken(
      { org: 'credifit', max_peers: 10, expires: '2027-04-03', issued_by: 'isorensen' },
      privateKey,
    );

    const result = validateLicense(token, publicKey);

    expect(result).not.toBeNull();
    expect(result!.org).toBe('credifit');
    expect(result!.max_peers).toBe(10);
    expect(result!.expires).toBe('2027-04-03');
    expect(result!.issued_by).toBe('isorensen');
  });

  it('should return null for an expired token', () => {
    const token = jwt.sign(
      { org: 'credifit', max_peers: 10, expires: '2025-01-01', issued_by: 'isorensen' },
      privateKey,
      { algorithm: 'RS256', expiresIn: '-1s' },
    );

    const result = validateLicense(token, publicKey);

    expect(result).toBeNull();
  });

  it('should return null for a token signed with wrong key', () => {
    const wrongPair = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const token = createToken(
      { org: 'credifit', max_peers: 10, expires: '2027-04-03', issued_by: 'isorensen' },
      wrongPair.privateKey,
    );

    const result = validateLicense(token, publicKey);

    expect(result).toBeNull();
  });

  it('should return null for a malformed token', () => {
    const result = validateLicense('not-a-jwt', publicKey);

    expect(result).toBeNull();
  });

  it('should return null for an empty string', () => {
    const result = validateLicense('', publicKey);

    expect(result).toBeNull();
  });

  it('should return null when required fields are missing', () => {
    const token = jwt.sign(
      { org: 'credifit' },
      privateKey,
      { algorithm: 'RS256', expiresIn: '365d' },
    );

    const result = validateLicense(token, publicKey);

    expect(result).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify failure**

Run: `npm run test --workspace=packages/team -- --testPathPattern=validator`
Expected: FAIL -- module `validator.js` does not exist

- [ ] **Step 4: Write minimal implementation**

Create `packages/team/src/license/validator.ts`:

```typescript
import jwt from 'jsonwebtoken';
import type { LicensePayload } from './types.js';

function isValidPayload(decoded: unknown): decoded is LicensePayload & Record<string, unknown> {
  if (typeof decoded !== 'object' || decoded === null) return false;
  const obj = decoded as Record<string, unknown>;
  return (
    typeof obj.org === 'string' &&
    typeof obj.max_peers === 'number' &&
    typeof obj.expires === 'string' &&
    typeof obj.issued_by === 'string'
  );
}

export function validateLicense(token: string, publicKey: string): LicensePayload | null {
  if (!token || !publicKey) return null;

  try {
    const decoded = jwt.verify(token, publicKey, { algorithms: ['RS256'] });

    if (!isValidPayload(decoded)) return null;

    return {
      org: decoded.org,
      max_peers: decoded.max_peers,
      expires: decoded.expires,
      issued_by: decoded.issued_by,
    };
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: Create the license generation script**

Create `packages/team/scripts/generate-license.ts`:

```typescript
#!/usr/bin/env tsx

import jwt from 'jsonwebtoken';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);

function usage(): never {
  console.error(
    'Usage: tsx generate-license.ts --org <org> --max-peers <n> --expires <YYYY-MM-DD> --key <path-to-private-key.pem>',
  );
  process.exit(1);
}

function getArg(flag: string): string {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) usage();
  return args[idx + 1];
}

const org = getArg('--org');
const maxPeers = parseInt(getArg('--max-peers'), 10);
const expires = getArg('--expires');
const keyPath = getArg('--key');

if (!org || isNaN(maxPeers) || !expires || !keyPath) usage();

const privateKey = readFileSync(resolve(keyPath), 'utf-8');

const expiresDate = new Date(expires);
const nowMs = Date.now();
const diffMs = expiresDate.getTime() - nowMs;
if (diffMs <= 0) {
  console.error('Error: expires date must be in the future');
  process.exit(1);
}

const diffSeconds = Math.floor(diffMs / 1000);

const token = jwt.sign(
  { org, max_peers: maxPeers, expires, issued_by: 'isorensen' },
  privateKey,
  { algorithm: 'RS256', expiresIn: diffSeconds },
);

console.log(token);
```

- [ ] **Step 6: Run test to verify pass**

Run: `npm run test --workspace=packages/team -- --testPathPattern=validator`
Expected: PASS

- [ ] **Step 7: Commit**

Message: `feat(team): add JWT license validation and generation script`

---

### Task 7: Peer resolver

**Files:**
- Create: `packages/team/src/multi-user/peer-resolver.ts`
- Test: `packages/team/tests/multi-user/peer-resolver.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/team/tests/multi-user/peer-resolver.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { PeerResolver } from '../../src/multi-user/peer-resolver.js';
import type { VpnPeer } from '@lox-brain/shared';

describe('PeerResolver', () => {
  const peers: VpnPeer[] = [
    { name: 'eduardo', ip: '10.10.0.2', public_key: 'key1', added_at: '2026-04-03' },
    { name: 'matheus', ip: '10.10.0.3', public_key: 'key2', added_at: '2026-04-03' },
    { name: 'igor', ip: '10.10.0.4', public_key: 'key3', added_at: '2026-04-03' },
  ];

  it('should resolve a known IP to its peer identity', () => {
    const resolver = new PeerResolver(peers);
    const result = resolver.resolve('10.10.0.2');

    expect(result).not.toBeNull();
    expect(result!.name).toBe('eduardo');
  });

  it('should return null for an unknown IP', () => {
    const resolver = new PeerResolver(peers);
    const result = resolver.resolve('10.10.0.99');

    expect(result).toBeNull();
  });

  it('should return null for the server IP', () => {
    const resolver = new PeerResolver(peers);
    const result = resolver.resolve('10.10.0.1');

    expect(result).toBeNull();
  });

  it('should return null for empty string', () => {
    const resolver = new PeerResolver(peers);
    const result = resolver.resolve('');

    expect(result).toBeNull();
  });

  it('should handle IPv6-mapped IPv4 addresses', () => {
    const resolver = new PeerResolver(peers);
    const result = resolver.resolve('::ffff:10.10.0.3');

    expect(result).not.toBeNull();
    expect(result!.name).toBe('matheus');
  });

  it('should handle empty peer list', () => {
    const resolver = new PeerResolver([]);
    const result = resolver.resolve('10.10.0.2');

    expect(result).toBeNull();
  });

  it('should return all registered peers', () => {
    const resolver = new PeerResolver(peers);

    expect(resolver.peerCount).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm run test --workspace=packages/team -- --testPathPattern=peer-resolver`
Expected: FAIL -- module does not exist

- [ ] **Step 3: Write minimal implementation**

Create `packages/team/src/multi-user/peer-resolver.ts`:

```typescript
import type { VpnPeer } from '@lox-brain/shared';

export interface ResolvedPeer {
  name: string;
  ip: string;
}

export class PeerResolver {
  private readonly peerMap: Map<string, ResolvedPeer>;

  constructor(peers: VpnPeer[]) {
    this.peerMap = new Map();
    for (const peer of peers) {
      this.peerMap.set(peer.ip, { name: peer.name, ip: peer.ip });
    }
  }

  resolve(ip: string): ResolvedPeer | null {
    if (!ip) return null;

    // Handle IPv6-mapped IPv4 (e.g. ::ffff:10.10.0.2)
    const normalizedIp = ip.startsWith('::ffff:') ? ip.slice(7) : ip;

    return this.peerMap.get(normalizedIp) ?? null;
  }

  get peerCount(): number {
    return this.peerMap.size;
  }
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `npm run test --workspace=packages/team -- --testPathPattern=peer-resolver`
Expected: PASS

- [ ] **Step 5: Commit**

Message: `feat(team): add PeerResolver for VPN IP to user identity mapping`

---

### Task 8: `created_by` middleware

**Files:**
- Create: `packages/team/src/multi-user/created-by-middleware.ts`
- Test: `packages/team/tests/multi-user/created-by-middleware.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/team/tests/multi-user/created-by-middleware.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { wrapToolWithCreatedBy } from '../../src/multi-user/created-by-middleware.js';
import { PeerResolver } from '../../src/multi-user/peer-resolver.js';
import type { VpnPeer } from '@lox-brain/shared';

describe('wrapToolWithCreatedBy', () => {
  const peers: VpnPeer[] = [
    { name: 'eduardo', ip: '10.10.0.2', public_key: 'key1', added_at: '2026-04-03' },
  ];
  const resolver = new PeerResolver(peers);

  it('should inject created_by into write_note args', async () => {
    const innerHandler = vi.fn().mockResolvedValue({ written: 'test.md' });
    const tool = {
      name: 'write_note',
      description: 'Write a note',
      inputSchema: {},
      handler: innerHandler,
    };

    const wrapped = wrapToolWithCreatedBy(tool, resolver, () => '10.10.0.2');

    await wrapped.handler({ file_path: 'test.md', content: 'hello' });

    expect(innerHandler).toHaveBeenCalledWith({
      file_path: 'test.md',
      content: 'hello',
      _created_by: 'eduardo',
    });
  });

  it('should not inject created_by for read_note', async () => {
    const innerHandler = vi.fn().mockResolvedValue({ content: 'data' });
    const tool = {
      name: 'read_note',
      description: 'Read a note',
      inputSchema: {},
      handler: innerHandler,
    };

    const wrapped = wrapToolWithCreatedBy(tool, resolver, () => '10.10.0.2');

    await wrapped.handler({ file_path: 'test.md' });

    expect(innerHandler).toHaveBeenCalledWith({ file_path: 'test.md' });
  });

  it('should not inject created_by when peer is unknown', async () => {
    const innerHandler = vi.fn().mockResolvedValue({ written: 'test.md' });
    const tool = {
      name: 'write_note',
      description: 'Write a note',
      inputSchema: {},
      handler: innerHandler,
    };

    const wrapped = wrapToolWithCreatedBy(tool, resolver, () => '10.10.0.99');

    await wrapped.handler({ file_path: 'test.md', content: 'hello' });

    expect(innerHandler).toHaveBeenCalledWith({ file_path: 'test.md', content: 'hello' });
  });

  it('should not inject created_by when IP getter returns null', async () => {
    const innerHandler = vi.fn().mockResolvedValue({ written: 'test.md' });
    const tool = {
      name: 'write_note',
      description: 'Write a note',
      inputSchema: {},
      handler: innerHandler,
    };

    const wrapped = wrapToolWithCreatedBy(tool, resolver, () => null);

    await wrapped.handler({ file_path: 'test.md', content: 'hello' });

    expect(innerHandler).toHaveBeenCalledWith({ file_path: 'test.md', content: 'hello' });
  });

  it('should preserve all other tool properties', () => {
    const tool = {
      name: 'write_note',
      description: 'My description',
      inputSchema: { type: 'object' },
      handler: vi.fn(),
    };

    const wrapped = wrapToolWithCreatedBy(tool, resolver, () => '10.10.0.2');

    expect(wrapped.name).toBe('write_note');
    expect(wrapped.description).toBe('My description');
    expect(wrapped.inputSchema).toEqual({ type: 'object' });
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm run test --workspace=packages/team -- --testPathPattern=created-by-middleware`
Expected: FAIL -- module does not exist

- [ ] **Step 3: Write minimal implementation**

Create `packages/team/src/multi-user/created-by-middleware.ts`:

```typescript
import type { PeerResolver } from './peer-resolver.js';

export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

const WRITE_TOOLS = new Set(['write_note']);

export function wrapToolWithCreatedBy(
  tool: Tool,
  resolver: PeerResolver,
  getClientIp: () => string | null,
): Tool {
  if (!WRITE_TOOLS.has(tool.name)) {
    return tool;
  }

  return {
    ...tool,
    async handler(args: Record<string, unknown>): Promise<unknown> {
      const ip = getClientIp();
      if (ip) {
        const peer = resolver.resolve(ip);
        if (peer) {
          return tool.handler({ ...args, _created_by: peer.name });
        }
      }
      return tool.handler(args);
    },
  };
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `npm run test --workspace=packages/team -- --testPathPattern=created-by-middleware`
Expected: PASS

- [ ] **Step 5: Commit**

Message: `feat(team): add created_by middleware for write tool interception`

---

### Task 9: Team MCP extensions (team tools + author filter)

**Files:**
- Create: `packages/team/src/mcp-extensions/team-tools.ts`
- Modify: `packages/core/src/lib/db-client.ts` (add `searchByAuthor` method)
- Test: `packages/team/tests/mcp-extensions/team-tools.test.ts`
- Test: `packages/core/tests/lib/db-client.test.ts` (add `searchByAuthor` test)

- [ ] **Step 1: Write the failing test for DbClient.searchByAuthor**

Add to `packages/core/tests/lib/db-client.test.ts`:

```typescript
describe('searchByAuthor', () => {
  it('should filter by created_by with parameterized query', async () => {
    const fakeRows = [
      {
        id: 'id1',
        file_path: 'notes/team.md',
        title: 'Team Note',
        content: null,
        tags: ['meeting'],
        updated_at: new Date(),
        created_by: 'eduardo',
        total_count: '1',
      },
    ];
    mockPool.query.mockResolvedValue({ rows: fakeRows });

    const result = await client.searchByAuthor('eduardo');

    expect(mockPool.query).toHaveBeenCalledTimes(1);
    const [sql, params] = mockPool.query.mock.calls[0];
    expect(sql).toContain('created_by = ');
    expect(params).toContain('eduardo');
    expect(result.results[0].created_by).toBe('eduardo');
  });

  it('should support text query combined with author filter', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });

    await client.searchByAuthor('eduardo', 'meeting');

    const [sql, params] = mockPool.query.mock.calls[0];
    expect(sql).toContain('created_by = ');
    expect(sql).toContain('ILIKE');
    expect(params).toContain('eduardo');
    expect(params).toContain('%meeting%');
  });

  it('should return PaginatedResult', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });

    const result = await client.searchByAuthor('eduardo');

    expect(result).toHaveProperty('results');
    expect(result).toHaveProperty('total');
    expect(result).toHaveProperty('limit');
    expect(result).toHaveProperty('offset');
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm run test --workspace=packages/core -- --testPathPattern=db-client`
Expected: FAIL -- `searchByAuthor` is not a function

- [ ] **Step 3: Implement DbClient.searchByAuthor**

Add to `packages/core/src/lib/db-client.ts`, as a new method in the `DbClient` class (before the closing brace):

```typescript
async searchByAuthor(
  author: string,
  query?: string,
  options?: Partial<SearchOptions>,
): Promise<PaginatedResult<RecentNote>> {
  const opts = this.buildSearchOptions(options, TEXT_DEFAULTS);

  let paramIdx = 1;

  // $1 = author
  const authorParamIdx = paramIdx++;

  let queryClause = '';
  let queryParamIdx = 0;
  if (query) {
    queryParamIdx = paramIdx++;
    queryClause = ` AND content ILIKE $${queryParamIdx}`;
  }

  const contentCol = this.buildContentColumn(opts, paramIdx);
  paramIdx = contentCol.nextParamIndex;

  const limitIdx = paramIdx++;
  const offsetIdx = paramIdx++;

  const sql = `
    SELECT id, file_path, title, ${contentCol.sql}, tags, updated_at, created_by,
           COUNT(*) OVER() AS total_count
    FROM vault_embeddings
    WHERE created_by = $${authorParamIdx}${queryClause}
    ORDER BY updated_at DESC
    LIMIT $${limitIdx}
    OFFSET $${offsetIdx}
  `;

  const params: unknown[] = [author];
  if (query) {
    params.push(`%${query}%`);
  }
  params.push(...contentCol.params, opts.limit, opts.offset);

  const result = await this.pool.query(sql, params);
  return this.buildPaginatedResult(result.rows, opts);
}
```

- [ ] **Step 4: Run core tests to verify pass**

Run: `npm run test --workspace=packages/core -- --testPathPattern=db-client`
Expected: PASS

- [ ] **Step 5: Write the failing test for team tools**

Create `packages/team/tests/mcp-extensions/team-tools.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { createTeamTools } from '../../src/mcp-extensions/team-tools.js';

describe('createTeamTools', () => {
  const mockDbClient = {
    listRecent: vi.fn(),
    searchByAuthor: vi.fn(),
  };

  it('should return two tools: list_team_activity and search_by_author', () => {
    const tools = createTeamTools(mockDbClient as any);

    expect(tools).toHaveLength(2);
    expect(tools.map((t) => t.name)).toEqual(['list_team_activity', 'search_by_author']);
  });

  describe('list_team_activity', () => {
    it('should call listRecent and return results with created_by', async () => {
      mockDbClient.listRecent.mockResolvedValue({
        results: [
          { id: '1', file_path: 'a.md', title: 'A', tags: [], updated_at: new Date(), created_by: 'eduardo' },
          { id: '2', file_path: 'b.md', title: 'B', tags: [], updated_at: new Date(), created_by: 'matheus' },
        ],
        total: 2,
        limit: 20,
        offset: 0,
      });

      const tools = createTeamTools(mockDbClient as any);
      const listTool = tools.find((t) => t.name === 'list_team_activity')!;

      const result = await listTool.handler({ limit: 20 });

      expect(mockDbClient.listRecent).toHaveBeenCalledTimes(1);
      expect(result).toHaveProperty('results');
    });
  });

  describe('search_by_author', () => {
    it('should call searchByAuthor with author and optional query', async () => {
      mockDbClient.searchByAuthor.mockResolvedValue({
        results: [
          { id: '1', file_path: 'a.md', title: 'A', tags: [], updated_at: new Date(), created_by: 'eduardo' },
        ],
        total: 1,
        limit: 20,
        offset: 0,
      });

      const tools = createTeamTools(mockDbClient as any);
      const searchTool = tools.find((t) => t.name === 'search_by_author')!;

      const result = await searchTool.handler({ author: 'eduardo', query: 'meeting' });

      expect(mockDbClient.searchByAuthor).toHaveBeenCalledWith('eduardo', 'meeting', {
        limit: 20,
        offset: 0,
        includeContent: false,
        contentPreviewLength: 300,
      });
      expect(result).toHaveProperty('results');
    });

    it('should throw when author is missing', async () => {
      const tools = createTeamTools(mockDbClient as any);
      const searchTool = tools.find((t) => t.name === 'search_by_author')!;

      await expect(searchTool.handler({})).rejects.toThrow('author must be a non-empty string');
    });
  });
});
```

- [ ] **Step 6: Run test to verify failure**

Run: `npm run test --workspace=packages/team -- --testPathPattern=team-tools`
Expected: FAIL -- module does not exist

- [ ] **Step 7: Implement team tools**

Create `packages/team/src/mcp-extensions/team-tools.ts`:

```typescript
import type { DbClient } from '@lox-brain/core';
import type { SearchOptions } from '@lox-brain/shared';

export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

export function createTeamTools(dbClient: DbClient): Tool[] {
  return [
    {
      name: 'list_team_activity',
      description: 'List recent notes with author attribution. Shows who wrote each note.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Maximum number of results (default: 20)' },
          offset: { type: 'number', description: 'Pagination offset (default: 0)' },
          include_content: { type: 'boolean', description: 'Include content preview (default: false)' },
          content_preview_length: { type: 'number', description: 'Truncate content to N chars (default: 300)' },
        },
      },
      async handler(args: Record<string, unknown>): Promise<unknown> {
        const searchOptions: Partial<SearchOptions> = {
          limit: (args.limit as number | undefined) ?? 20,
          offset: (args.offset as number | undefined) ?? 0,
          includeContent: (args.include_content as boolean | undefined) ?? false,
          contentPreviewLength: (args.content_preview_length as number | undefined) ?? 300,
        };

        return dbClient.listRecent(searchOptions);
      },
    },
    {
      name: 'search_by_author',
      description: 'Search notes written by a specific team member. Optionally filter by text query.',
      inputSchema: {
        type: 'object',
        properties: {
          author: { type: 'string', description: 'Author name (as registered in VPN peer config)' },
          query: { type: 'string', description: 'Optional text search within that author\'s notes' },
          limit: { type: 'number', description: 'Maximum number of results (default: 20)' },
          offset: { type: 'number', description: 'Pagination offset (default: 0)' },
          include_content: { type: 'boolean', description: 'Include content preview (default: false)' },
          content_preview_length: { type: 'number', description: 'Truncate content to N chars (default: 300)' },
        },
        required: ['author'],
      },
      async handler(args: Record<string, unknown>): Promise<unknown> {
        const author = args.author;
        if (typeof author !== 'string' || author.trim() === '') {
          throw new Error('author must be a non-empty string');
        }

        const query = args.query as string | undefined;
        const searchOptions: Partial<SearchOptions> = {
          limit: (args.limit as number | undefined) ?? 20,
          offset: (args.offset as number | undefined) ?? 0,
          includeContent: (args.include_content as boolean | undefined) ?? false,
          contentPreviewLength: (args.content_preview_length as number | undefined) ?? 300,
        };

        return dbClient.searchByAuthor(author, query, searchOptions);
      },
    },
  ];
}
```

- [ ] **Step 8: Run test to verify pass**

Run: `npm run test --workspace=packages/team -- --testPathPattern=team-tools`
Expected: PASS

- [ ] **Step 9: Commit**

Message: `feat(team): add list_team_activity and search_by_author MCP tools`

---

### Task 10: Bootstrap `registerTeamFeatures()`

**Files:**
- Modify: `packages/team/src/index.ts`
- Modify: `packages/core/src/mcp/index.ts`
- Test: `packages/team/tests/index.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/team/tests/index.test.ts`:

```typescript
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { registerTeamFeatures } from '../src/index.js';
import type { LoxConfig } from '@lox-brain/shared';

describe('registerTeamFeatures', () => {
  let publicKey: string;
  let privateKey: string;

  beforeAll(() => {
    const pair = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    publicKey = pair.publicKey;
    privateKey = pair.privateKey;
  });

  function makeConfig(overrides: Partial<LoxConfig> = {}): LoxConfig {
    return {
      version: '0.1.0',
      mode: 'team',
      gcp: { project: 'test', region: 'us', zone: 'us-a', vm_name: 'vm', service_account: 'sa' },
      database: { host: '127.0.0.1', port: 5432, name: 'lox_brain', user: 'lox' },
      vpn: {
        server_ip: '10.10.0.1',
        subnet: '10.10.0.0/24',
        listen_port: 51820,
        peers: [
          { name: 'eduardo', ip: '10.10.0.2', public_key: 'k1', added_at: '2026-04-03' },
        ],
      },
      vault: { repo: 'repo', local_path: '/vault', preset: 'zettelkasten' },
      install_dir: '/opt/lox',
      installed_at: '2026-04-03',
      ...overrides,
    } as LoxConfig;
  }

  it('should return success:false when mode is personal', async () => {
    const config = makeConfig({ mode: 'personal' });
    const mockServer = {} as any;

    const result = await registerTeamFeatures(mockServer, config, [], publicKey);

    expect(result.success).toBe(false);
    expect(result.error).toContain('personal');
  });

  it('should return success:false when license key is missing', async () => {
    const config = makeConfig();
    const mockServer = {} as any;

    const result = await registerTeamFeatures(mockServer, config, [], publicKey);

    expect(result.success).toBe(false);
    expect(result.error).toContain('license');
  });

  it('should return success:false when license key is invalid', async () => {
    const config = makeConfig();
    (config as any).license_key = 'invalid-token';
    const mockServer = {} as any;

    const result = await registerTeamFeatures(mockServer, config, [], publicKey);

    expect(result.success).toBe(false);
    expect(result.error).toContain('license');
  });

  it('should return success:true with valid license and team mode', async () => {
    const token = jwt.sign(
      { org: 'credifit', max_peers: 10, expires: '2027-04-03', issued_by: 'isorensen' },
      privateKey,
      { algorithm: 'RS256', expiresIn: '365d' },
    );

    const config = makeConfig();
    (config as any).license_key = token;

    const mockTool = {
      name: 'write_note',
      description: 'Write a note',
      inputSchema: {},
      handler: vi.fn(),
    };
    const mockServer = {} as any;

    const result = await registerTeamFeatures(mockServer, config, [mockTool], publicKey);

    expect(result.success).toBe(true);
    expect(result.org).toBe('credifit');
    expect(result.peersRegistered).toBe(1);
  });

  it('should return wrapped tools and team tools in the result', async () => {
    const token = jwt.sign(
      { org: 'credifit', max_peers: 10, expires: '2027-04-03', issued_by: 'isorensen' },
      privateKey,
      { algorithm: 'RS256', expiresIn: '365d' },
    );

    const config = makeConfig();
    (config as any).license_key = token;

    const mockTool = {
      name: 'write_note',
      description: 'Write a note',
      inputSchema: {},
      handler: vi.fn(),
    };
    const mockServer = {} as any;

    const mockDbClient = {
      listRecent: vi.fn(),
      searchByAuthor: vi.fn(),
    } as any;

    const result = await registerTeamFeatures(mockServer, config, [mockTool], publicKey, {
      dbClient: mockDbClient,
    });

    expect(result.tools).toBeDefined();
    const toolNames = result.tools!.map((t) => t.name);
    expect(toolNames).toContain('write_note');
    expect(toolNames).toContain('list_team_activity');
    expect(toolNames).toContain('search_by_author');
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm run test --workspace=packages/team -- --testPathPattern=index`
Expected: FAIL -- current stub returns `{ success: false, error: 'Not yet implemented' }`

- [ ] **Step 3: Implement registerTeamFeatures**

Replace `packages/team/src/index.ts`:

```typescript
import type { LoxConfig } from '@lox-brain/shared';
import type { DbClient } from '@lox-brain/core';
import { validateLicense } from './license/validator.js';
import type { LicensePayload } from './license/types.js';
import { PeerResolver } from './multi-user/peer-resolver.js';
import { wrapToolWithCreatedBy } from './multi-user/created-by-middleware.js';
import type { Tool } from './multi-user/created-by-middleware.js';
import { createTeamTools } from './mcp-extensions/team-tools.js';

export type { LicensePayload } from './license/types.js';
export { validateLicense } from './license/validator.js';
export { PeerResolver } from './multi-user/peer-resolver.js';
export { wrapToolWithCreatedBy } from './multi-user/created-by-middleware.js';
export { createTeamTools } from './mcp-extensions/team-tools.js';

export interface TeamRegistrationResult {
  success: boolean;
  org?: string;
  peersRegistered?: number;
  tools?: Tool[];
  error?: string;
}

export async function registerTeamFeatures(
  _server: unknown,
  config: LoxConfig,
  tools: Tool[],
  publicKey: string,
  options?: {
    getClientIp?: () => string | null;
    dbClient?: DbClient;
  },
): Promise<TeamRegistrationResult> {
  if (config.mode !== 'team') {
    return { success: false, error: 'Cannot register team features in personal mode' };
  }

  const licenseKey = (config as any).license_key as string | undefined;
  if (!licenseKey) {
    return { success: false, error: 'No license key found in config' };
  }

  const license = validateLicense(licenseKey, publicKey);
  if (!license) {
    return { success: false, error: 'Invalid or expired license key' };
  }

  const peers = config.vpn?.peers ?? [];
  const resolver = new PeerResolver(peers);

  const getClientIp = options?.getClientIp ?? (() => null);

  // Wrap existing tools with created_by middleware
  const wrappedTools = tools.map((tool) =>
    wrapToolWithCreatedBy(tool, resolver, getClientIp),
  );

  // Create team-specific tools (only if dbClient is provided)
  const teamTools: Tool[] = options?.dbClient
    ? createTeamTools(options.dbClient)
    : [];

  const allTools = [...wrappedTools, ...teamTools];

  return {
    success: true,
    org: license.org,
    peersRegistered: resolver.peerCount,
    tools: allTools,
  };
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `npm run test --workspace=packages/team -- --testPathPattern=index`
Expected: PASS

- [ ] **Step 5: Update MCP server to call registerTeamFeatures in team mode**

Modify `packages/core/src/mcp/index.ts`. After the line `const tools = createTools(dbClient, embeddingService, VAULT_PATH);`, add:

```typescript
let activeTools = tools;

// Team mode integration (dynamic import to avoid hard dependency on @lox-brain/team)
const LOX_MODE = process.env.LOX_MODE ?? 'personal';
if (LOX_MODE === 'team') {
  try {
    const { registerTeamFeatures } = await import('@lox-brain/team');
    const { readFileSync } = await import('node:fs');
    const { getConfigPath } = await import('@lox-brain/shared');

    const configPath = getConfigPath();
    const configRaw = readFileSync(configPath, 'utf-8');
    const config = JSON.parse(configRaw);

    const PUBLIC_KEY = process.env.LOX_LICENSE_PUBLIC_KEY ?? '';

    const transportConfig = getTransportConfig();
    let clientIpGetter: (() => string | null) | undefined;
    if (transportConfig.type === 'http') {
      clientIpGetter = () => (globalThis as any).__lox_current_client_ip ?? null;
    }

    const result = await registerTeamFeatures(server, config, tools, PUBLIC_KEY, {
      getClientIp: clientIpGetter,
      dbClient,
    });

    if (result.success && result.tools) {
      activeTools = result.tools;
      console.error(`Lox Team Mode active: org=${result.org}, peers=${result.peersRegistered}`);
    } else {
      console.error(`Lox Team Mode not loaded: ${result.error}`);
    }
  } catch (err: unknown) {
    console.error('Failed to load team features:', err);
  }
}
```

Then update both server handlers to use `activeTools` instead of `tools`:

```typescript
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: activeTools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = activeTools.find((t) => t.name === request.params.name);
  if (!tool) {
    return {
      content: [{ type: 'text' as const, text: `Unknown tool: ${request.params.name}` }],
      isError: true,
    };
  }

  try {
    const result = await tool.handler((request.params.arguments ?? {}) as Record<string, unknown>);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text' as const, text: `Error: ${message}` }],
      isError: true,
    };
  }
});
```

- [ ] **Step 6: Run full test suite**

Run: `npm run test --workspace=packages/core && npm run test --workspace=packages/team`
Expected: All PASS

- [ ] **Step 7: Commit**

Message: `feat(team): wire registerTeamFeatures bootstrap into MCP server`

---

## Phase 3 -- Installer Team Flow

### Task 11: Installer mode selection step

**Files:**
- Create: `packages/installer/src/steps/step-mode.ts`
- Modify: `packages/installer/src/i18n/en.ts`
- Modify: `packages/installer/src/i18n/pt-br.ts`
- Modify: `packages/installer/src/index.ts`
- Test: `packages/installer/tests/steps/step-mode.test.ts`

- [ ] **Step 1: Add i18n strings**

Add to `I18nStrings` interface in `packages/installer/src/i18n/en.ts`:

```typescript
// Team mode
step_mode: string;
mode_prompt: string;
mode_personal_desc: string;
mode_team_desc: string;
```

Add to the `en` object:

```typescript
// Team mode
step_mode: 'Mode Selection',
mode_prompt: 'Choose installation mode:',
mode_personal_desc: 'Single user — your personal Second Brain.',
mode_team_desc: 'Multi-user — shared brain for your team (requires license key).',
```

Add to `packages/installer/src/i18n/pt-br.ts`:

```typescript
// Team mode
step_mode: 'Selecao de Modo',
mode_prompt: 'Escolha o modo de instalacao:',
mode_personal_desc: 'Usuario unico — seu Segundo Cerebro pessoal.',
mode_team_desc: 'Multi-usuario — cerebro compartilhado para a equipe (requer chave de licenca).',
```

- [ ] **Step 2: Write the failing test**

Create `packages/installer/tests/steps/step-mode.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { InstallerContext } from '../../src/steps/types.js';

vi.mock('@inquirer/prompts', () => ({
  select: vi.fn(),
}));

describe('stepMode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should set config.mode to personal when user selects personal', async () => {
    const { select } = await import('@inquirer/prompts');
    (select as any).mockResolvedValue('personal');

    const { stepMode } = await import('../../src/steps/step-mode.js');

    const ctx: InstallerContext = { config: {}, locale: 'en' };
    const result = await stepMode(ctx);

    expect(result.success).toBe(true);
    expect(ctx.config.mode).toBe('personal');
  });

  it('should set config.mode to team when user selects team', async () => {
    const { select } = await import('@inquirer/prompts');
    (select as any).mockResolvedValue('team');

    const { stepMode } = await import('../../src/steps/step-mode.js');

    const ctx: InstallerContext = { config: {}, locale: 'en' };
    const result = await stepMode(ctx);

    expect(result.success).toBe(true);
    expect(ctx.config.mode).toBe('team');
  });

  it('should always return success', async () => {
    const { select } = await import('@inquirer/prompts');
    (select as any).mockResolvedValue('personal');

    const { stepMode } = await import('../../src/steps/step-mode.js');

    const ctx: InstallerContext = { config: {}, locale: 'en' };
    const result = await stepMode(ctx);

    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify failure**

Run: `npm run test --workspace=packages/installer -- --testPathPattern=step-mode`
Expected: FAIL -- module does not exist

- [ ] **Step 4: Write minimal implementation**

Create `packages/installer/src/steps/step-mode.ts`:

```typescript
import { select } from '@inquirer/prompts';
import { t } from '../i18n/index.js';
import type { InstallerContext, StepResult } from './types.js';

export async function stepMode(ctx: InstallerContext): Promise<StepResult> {
  const mode = await select<'personal' | 'team'>({
    message: t('mode_prompt'),
    choices: [
      {
        name: `${t('mode_personal')} — ${t('mode_personal_desc')}`,
        value: 'personal' as const,
      },
      {
        name: `${t('mode_team')} — ${t('mode_team_desc')}`,
        value: 'team' as const,
      },
    ],
  });

  ctx.config.mode = mode;

  return { success: true };
}
```

- [ ] **Step 5: Integrate into installer index.ts**

In `packages/installer/src/index.ts`, add the import at the top:

```typescript
import { stepMode } from './steps/step-mode.js';
```

Insert the mode selection step after `console.log(renderSplash());` and before the prerequisites step:

```typescript
  // Step 0.5: Mode Selection
  const modeResult = await stepMode(ctx);
  if (!modeResult.success) process.exit(1);
```

- [ ] **Step 6: Run test to verify pass**

Run: `npm run test --workspace=packages/installer -- --testPathPattern=step-mode`
Expected: PASS

- [ ] **Step 7: Commit**

Message: `feat(installer): add mode selection step (Personal vs Team)`

---

### Task 12: Installer license key step

**Files:**
- Create: `packages/installer/src/steps/step-license.ts`
- Modify: `packages/installer/src/i18n/en.ts`
- Modify: `packages/installer/src/i18n/pt-br.ts`
- Modify: `packages/installer/src/index.ts`
- Test: `packages/installer/tests/steps/step-license.test.ts`

- [ ] **Step 1: Add i18n strings**

Add to `I18nStrings` interface in `packages/installer/src/i18n/en.ts`:

```typescript
// License
step_license: string;
license_prompt: string;
license_valid: string;
license_invalid: string;
license_org: string;
license_max_peers: string;
license_expires: string;
```

Add to the `en` object:

```typescript
// License
step_license: 'License Key',
license_prompt: 'Enter your Lox Team license key:',
license_valid: 'License validated successfully.',
license_invalid: 'Invalid or expired license key. Please try again.',
license_org: 'Organization',
license_max_peers: 'Max peers',
license_expires: 'Expires',
```

Add to `packages/installer/src/i18n/pt-br.ts`:

```typescript
// License
step_license: 'Chave de Licenca',
license_prompt: 'Insira sua chave de licenca Lox Team:',
license_valid: 'Licenca validada com sucesso.',
license_invalid: 'Chave de licenca invalida ou expirada. Tente novamente.',
license_org: 'Organizacao',
license_max_peers: 'Max peers',
license_expires: 'Expira em',
```

- [ ] **Step 2: Write the failing test**

Create `packages/installer/tests/steps/step-license.test.ts`:

```typescript
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { InstallerContext } from '../../src/steps/types.js';

vi.mock('@inquirer/prompts', () => ({
  password: vi.fn(),
}));

describe('stepLicense', () => {
  let privateKey: string;
  let publicKey: string;

  beforeAll(() => {
    const pair = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    privateKey = pair.privateKey;
    publicKey = pair.publicKey;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should skip if mode is personal', async () => {
    const { stepLicense } = await import('../../src/steps/step-license.js');

    const ctx: InstallerContext = { config: { mode: 'personal' }, locale: 'en' };
    const result = await stepLicense(ctx, publicKey);

    expect(result.success).toBe(true);
    expect(result.message).toContain('skip');
  });

  it('should validate and store license key for team mode', async () => {
    const { password } = await import('@inquirer/prompts');
    const token = jwt.sign(
      { org: 'credifit', max_peers: 10, expires: '2027-04-03', issued_by: 'isorensen' },
      privateKey,
      { algorithm: 'RS256', expiresIn: '365d' },
    );
    (password as any).mockResolvedValue(token);

    const { stepLicense } = await import('../../src/steps/step-license.js');

    const ctx: InstallerContext = { config: { mode: 'team' }, locale: 'en' };
    const result = await stepLicense(ctx, publicKey);

    expect(result.success).toBe(true);
    expect((ctx.config as any).license_key).toBe(token);
    expect((ctx.config as any).org).toBe('credifit');
  });

  it('should return failure for invalid license key', async () => {
    const { password } = await import('@inquirer/prompts');
    (password as any).mockResolvedValue('invalid-token');

    const { stepLicense } = await import('../../src/steps/step-license.js');

    const ctx: InstallerContext = { config: { mode: 'team' }, locale: 'en' };
    const result = await stepLicense(ctx, publicKey);

    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify failure**

Run: `npm run test --workspace=packages/installer -- --testPathPattern=step-license`
Expected: FAIL -- module does not exist

- [ ] **Step 4: Write minimal implementation**

Create `packages/installer/src/steps/step-license.ts`:

```typescript
import { password } from '@inquirer/prompts';
import jwt from 'jsonwebtoken';
import { t } from '../i18n/index.js';
import type { InstallerContext, StepResult } from './types.js';

interface LicensePayload {
  org: string;
  max_peers: number;
  expires: string;
  issued_by: string;
}

function validateLicenseKey(token: string, publicKey: string): LicensePayload | null {
  if (!token || !publicKey) return null;
  try {
    const decoded = jwt.verify(token, publicKey, { algorithms: ['RS256'] }) as Record<string, unknown>;
    if (
      typeof decoded.org !== 'string' ||
      typeof decoded.max_peers !== 'number' ||
      typeof decoded.expires !== 'string' ||
      typeof decoded.issued_by !== 'string'
    ) {
      return null;
    }
    return {
      org: decoded.org,
      max_peers: decoded.max_peers,
      expires: decoded.expires,
      issued_by: decoded.issued_by,
    };
  } catch {
    return null;
  }
}

export async function stepLicense(ctx: InstallerContext, publicKey: string): Promise<StepResult> {
  if (ctx.config.mode !== 'team') {
    return { success: true, message: 'skip: personal mode' };
  }

  const key = await password({
    message: t('license_prompt'),
    mask: '*',
  });

  const payload = validateLicenseKey(key, publicKey);
  if (!payload) {
    return { success: false, message: t('license_invalid') };
  }

  (ctx.config as any).license_key = key;
  (ctx.config as any).org = payload.org;

  console.log(`  ${t('license_org')}: ${payload.org}`);
  console.log(`  ${t('license_max_peers')}: ${payload.max_peers}`);
  console.log(`  ${t('license_expires')}: ${payload.expires}`);

  return { success: true, message: t('license_valid') };
}
```

- [ ] **Step 5: Integrate into installer index.ts**

In `packages/installer/src/index.ts`, add the import:

```typescript
import { stepLicense } from './steps/step-license.js';
```

Insert after the mode selection step:

```typescript
  // Step 0.7: License Key (team mode only)
  const LICENSE_PUBLIC_KEY = process.env.LOX_LICENSE_PUBLIC_KEY ?? '';
  const licenseResult = await stepLicense(ctx, LICENSE_PUBLIC_KEY);
  if (!licenseResult.success) {
    console.error(`\n${licenseResult.message}`);
    process.exit(1);
  }
```

- [ ] **Step 6: Run test to verify pass**

Run: `npm run test --workspace=packages/installer -- --testPathPattern=step-license`
Expected: PASS

- [ ] **Step 7: Commit**

Message: `feat(installer): add license key validation step for team mode`

---

### Task 13: Installer peers step

**Files:**
- Create: `packages/installer/src/steps/step-peers.ts`
- Modify: `packages/installer/src/i18n/en.ts`
- Modify: `packages/installer/src/i18n/pt-br.ts`
- Modify: `packages/installer/src/index.ts`
- Test: `packages/installer/tests/steps/step-peers.test.ts`

- [ ] **Step 1: Add i18n strings**

Add to `I18nStrings` interface in `packages/installer/src/i18n/en.ts`:

```typescript
// Peers
step_peers: string;
peers_count_prompt: string;
peers_name_prompt: string;
peers_email_prompt: string;
peers_generating: string;
peers_generated: string;
peers_conf_written: string;
```

Add to the `en` object:

```typescript
// Peers
step_peers: 'Team Peers',
peers_count_prompt: 'How many team members (excluding the server)?',
peers_name_prompt: 'Name for peer',
peers_email_prompt: 'Email for peer',
peers_generating: 'Generating WireGuard keypairs...',
peers_generated: 'Keypairs generated for all peers.',
peers_conf_written: 'WireGuard config files written to output/',
```

Add to `packages/installer/src/i18n/pt-br.ts`:

```typescript
// Peers
step_peers: 'Peers da Equipe',
peers_count_prompt: 'Quantos membros na equipe (excluindo o servidor)?',
peers_name_prompt: 'Nome do peer',
peers_email_prompt: 'Email do peer',
peers_generating: 'Gerando pares de chaves WireGuard...',
peers_generated: 'Pares de chaves gerados para todos os peers.',
peers_conf_written: 'Arquivos de configuracao WireGuard escritos em output/',
```

- [ ] **Step 2: Write the failing test**

Create `packages/installer/tests/steps/step-peers.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { InstallerContext } from '../../src/steps/types.js';

vi.mock('@inquirer/prompts', () => ({
  input: vi.fn(),
  number: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn((cmd: string, args?: string[]) => {
    if (cmd === 'wg' && args?.[0] === 'genkey') return Buffer.from('fake-private-key-base64\n');
    if (cmd === 'wg' && args?.[0] === 'pubkey') return Buffer.from('fake-public-key-base64\n');
    return Buffer.from('');
  }),
}));

vi.mock('node:fs', () => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

describe('stepPeers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should skip if mode is personal', async () => {
    const { stepPeers } = await import('../../src/steps/step-peers.js');

    const ctx: InstallerContext = { config: { mode: 'personal' }, locale: 'en' };
    const result = await stepPeers(ctx);

    expect(result.success).toBe(true);
    expect(result.message).toContain('skip');
  });

  it('should collect peers and store in config', async () => {
    const { input, number: numberPrompt } = await import('@inquirer/prompts');
    (numberPrompt as any).mockResolvedValue(2);
    (input as any)
      .mockResolvedValueOnce('eduardo')
      .mockResolvedValueOnce('eduardo@credifit.com.br')
      .mockResolvedValueOnce('matheus')
      .mockResolvedValueOnce('matheus@credifit.com.br');

    const { stepPeers } = await import('../../src/steps/step-peers.js');

    const ctx: InstallerContext = {
      config: {
        mode: 'team',
        vpn: { server_ip: '10.10.0.1', subnet: '10.10.0.0/24', listen_port: 51820, peers: [] },
      },
      locale: 'en',
    };
    (ctx.config as any).org = 'credifit';
    const result = await stepPeers(ctx);

    expect(result.success).toBe(true);
    expect(ctx.config.vpn!.peers).toHaveLength(2);
    expect(ctx.config.vpn!.peers![0].name).toBe('eduardo');
    expect(ctx.config.vpn!.peers![0].ip).toBe('10.10.0.2');
    expect(ctx.config.vpn!.peers![1].name).toBe('matheus');
    expect(ctx.config.vpn!.peers![1].ip).toBe('10.10.0.3');
  });

  it('should assign incremental IPs starting from .2', async () => {
    const { input, number: numberPrompt } = await import('@inquirer/prompts');
    (numberPrompt as any).mockResolvedValue(3);
    (input as any)
      .mockResolvedValueOnce('a').mockResolvedValueOnce('a@x.com')
      .mockResolvedValueOnce('b').mockResolvedValueOnce('b@x.com')
      .mockResolvedValueOnce('c').mockResolvedValueOnce('c@x.com');

    const { stepPeers } = await import('../../src/steps/step-peers.js');

    const ctx: InstallerContext = {
      config: {
        mode: 'team',
        vpn: { server_ip: '10.10.0.1', subnet: '10.10.0.0/24', listen_port: 51820, peers: [] },
      },
      locale: 'en',
    };
    (ctx.config as any).org = 'testorg';
    const result = await stepPeers(ctx);

    expect(result.success).toBe(true);
    expect(ctx.config.vpn!.peers![0].ip).toBe('10.10.0.2');
    expect(ctx.config.vpn!.peers![1].ip).toBe('10.10.0.3');
    expect(ctx.config.vpn!.peers![2].ip).toBe('10.10.0.4');
  });

  it('should write .conf files', async () => {
    const { input, number: numberPrompt } = await import('@inquirer/prompts');
    (numberPrompt as any).mockResolvedValue(1);
    (input as any)
      .mockResolvedValueOnce('eduardo')
      .mockResolvedValueOnce('eduardo@credifit.com.br');

    const { writeFileSync, mkdirSync } = await import('node:fs');

    const { stepPeers } = await import('../../src/steps/step-peers.js');

    const ctx: InstallerContext = {
      config: {
        mode: 'team',
        vpn: { server_ip: '10.10.0.1', subnet: '10.10.0.0/24', listen_port: 51820, peers: [] },
      },
      locale: 'en',
    };
    (ctx.config as any).org = 'credifit';
    await stepPeers(ctx);

    expect(mkdirSync).toHaveBeenCalledWith(expect.stringContaining('output'), { recursive: true });
    expect(writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('credifit-eduardo.conf'),
      expect.stringContaining('[Interface]'),
    );
  });
});
```

- [ ] **Step 3: Run test to verify failure**

Run: `npm run test --workspace=packages/installer -- --testPathPattern=step-peers`
Expected: FAIL -- module does not exist

- [ ] **Step 4: Write minimal implementation**

Create `packages/installer/src/steps/step-peers.ts`:

```typescript
import { input, number as numberPrompt } from '@inquirer/prompts';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { t } from '../i18n/index.js';
import type { InstallerContext, StepResult } from './types.js';

function generateKeypair(): { privateKey: string; publicKey: string } {
  const privateKey = execFileSync('wg', ['genkey']).toString().trim();
  const publicKey = execFileSync('wg', ['pubkey'], { input: privateKey }).toString().trim();
  return { privateKey, publicKey };
}

function assignIp(baseSubnet: string, index: number): string {
  const parts = baseSubnet.split('/')[0].split('.');
  parts[3] = String(index + 2);
  return parts.join('.');
}

function generateConfFile(
  peerPrivateKey: string,
  peerIp: string,
  serverPublicKey: string,
  serverEndpoint: string,
  serverPort: number,
): string {
  return `[Interface]
PrivateKey = ${peerPrivateKey}
Address = ${peerIp}/24
DNS = 1.1.1.1

[Peer]
PublicKey = ${serverPublicKey}
Endpoint = ${serverEndpoint}:${serverPort}
AllowedIPs = 10.10.0.0/24
PersistentKeepalive = 25
`;
}

export async function stepPeers(ctx: InstallerContext): Promise<StepResult> {
  if (ctx.config.mode !== 'team') {
    return { success: true, message: 'skip: personal mode' };
  }

  const count = await numberPrompt({
    message: t('peers_count_prompt'),
    min: 1,
    max: 254,
  });

  if (!count || count < 1) {
    return { success: false, message: 'At least 1 peer is required' };
  }

  const org = (ctx.config as any).org ?? 'lox';
  const subnet = ctx.config.vpn?.subnet ?? '10.10.0.0/24';
  const serverPort = ctx.config.vpn?.listen_port ?? 51820;
  const peers: Array<{
    name: string;
    email: string;
    ip: string;
    public_key: string;
    privateKey: string;
    added_at: string;
  }> = [];

  console.log(t('peers_generating'));

  for (let i = 0; i < count; i++) {
    const name = await input({ message: `${t('peers_name_prompt')} ${i + 1}:` });
    const email = await input({ message: `${t('peers_email_prompt')} ${i + 1}:` });
    const ip = assignIp(subnet, i);
    const keypair = generateKeypair();

    peers.push({
      name,
      email,
      ip,
      public_key: keypair.publicKey,
      privateKey: keypair.privateKey,
      added_at: new Date().toISOString().split('T')[0],
    });
  }

  // Store peers in config (without private keys)
  ctx.config.vpn = ctx.config.vpn ?? {
    server_ip: '10.10.0.1',
    subnet,
    listen_port: serverPort,
    peers: [],
  };
  ctx.config.vpn.peers = peers.map(({ name, ip, public_key, added_at }) => ({
    name,
    ip,
    public_key,
    added_at,
  }));

  // Write .conf files
  const outputDir = path.resolve(process.cwd(), 'output');
  mkdirSync(outputDir, { recursive: true });

  // Server public key placeholder -- in real deploy this comes from wg genkey on the server
  const serverPublicKey = 'SERVER_PUBLIC_KEY_PLACEHOLDER';
  const serverEndpoint = 'SERVER_ENDPOINT_PLACEHOLDER';

  for (const peer of peers) {
    const confContent = generateConfFile(
      peer.privateKey,
      peer.ip,
      serverPublicKey,
      serverEndpoint,
      serverPort,
    );
    const filename = `${org}-${peer.name}.conf`;
    writeFileSync(path.join(outputDir, filename), confContent);
  }

  console.log(t('peers_generated'));
  console.log(t('peers_conf_written'));

  return { success: true };
}
```

- [ ] **Step 5: Integrate into installer index.ts**

In `packages/installer/src/index.ts`, add the import:

```typescript
import { stepPeers } from './steps/step-peers.js';
```

Insert after the license step:

```typescript
  // Step 0.8: Peers (team mode only)
  const peersResult = await stepPeers(ctx);
  if (!peersResult.success) {
    console.error(`\n${peersResult.message}`);
    process.exit(1);
  }
```

- [ ] **Step 6: Run test to verify pass**

Run: `npm run test --workspace=packages/installer -- --testPathPattern=step-peers`
Expected: PASS

- [ ] **Step 7: Commit**

Message: `feat(installer): add team peers collection step with WireGuard config generation`

---

## Phase 5 -- Licensing and Documentation

### Task 14: Licensing and documentation

**Files:**
- Modify: `README.md` (root)
- Modify: `CONTRIBUTING.md` (root)

> Note: `packages/team/LICENSE` was already created in Task 5.

- [ ] **Step 1: Update README.md**

Add a "Lox Team" section to the root `README.md`, after the existing features section:

```markdown
## Lox Team (Commercial)

Lox Team extends the personal brain into a shared, multi-user knowledge base
for corporate teams. It is available under a commercial license.

### What Team Mode adds

- **Multi-user identity** via WireGuard VPN peers -- each user is identified
  by their VPN IP, no auth server needed.
- **`created_by` attribution** -- every note is tagged with its author
  automatically.
- **Team MCP tools** -- `list_team_activity` and `search_by_author` for
  cross-team knowledge discovery.
- **Installer team flow** -- guided setup for license validation, peer
  generation, and WireGuard config distribution.

### Licensing

| Package | License |
|---------|---------|
| `packages/core` | MIT |
| `packages/shared` | MIT |
| `packages/cli` | MIT |
| `packages/installer` | MIT |
| `packages/team` | Commercial (see `packages/team/LICENSE`) |

Personal mode (single user) is free and open source. Team mode (2+ users)
requires a commercial license key. Contact eduardo@isorensen.dev for
licensing inquiries.
```

- [ ] **Step 2: Update CONTRIBUTING.md**

Add a CLA note to `CONTRIBUTING.md`:

```markdown
## Contributor License Agreement (CLA)

Contributions to `packages/team/` require a Contributor License Agreement.
This is because `packages/team/` is under a commercial license, and we need
to ensure that contributions can be distributed under those terms.

For all other packages (MIT-licensed), no CLA is required. Standard GitHub
fork-and-PR workflow applies.

If you would like to contribute to `packages/team/`, please contact
eduardo@isorensen.dev before opening a pull request.
```

- [ ] **Step 3: Verify no broken links**

Run: `grep -r 'packages/team' README.md CONTRIBUTING.md`
Expected: References exist and are correct

- [ ] **Step 4: Commit**

Message: `docs: add Team Mode section to README and CLA note to CONTRIBUTING`

---

## Summary

| Task | Phase | Component | New Files | Modified Files |
|------|-------|-----------|-----------|----------------|
| 1 | 1 | Shared types | `packages/shared/tests/types.test.ts` | `packages/shared/src/types.ts` |
| 2 | 1 | DbClient created_by | -- | `packages/core/src/lib/db-client.ts`, `packages/core/tests/lib/db-client.test.ts` |
| 3 | 1 | Search/list created_by | -- | `packages/core/src/lib/db-client.ts`, `packages/core/tests/lib/db-client.test.ts` |
| 4 | 1 | HTTP transport | `packages/core/src/mcp/transports.ts`, `packages/core/tests/mcp/transports.test.ts` | `packages/core/src/mcp/index.ts` |
| 5 | 2 | Team scaffold | `packages/team/*` | `package.json` (root) |
| 6 | 2 | License validation | `packages/team/src/license/*`, `packages/team/tests/license/*`, `packages/team/scripts/generate-license.ts` | -- |
| 7 | 2 | Peer resolver | `packages/team/src/multi-user/peer-resolver.ts`, `packages/team/tests/multi-user/peer-resolver.test.ts` | -- |
| 8 | 2 | created_by middleware | `packages/team/src/multi-user/created-by-middleware.ts`, `packages/team/tests/multi-user/created-by-middleware.test.ts` | -- |
| 9 | 2 | Team tools | `packages/team/src/mcp-extensions/team-tools.ts`, `packages/team/tests/mcp-extensions/team-tools.test.ts` | `packages/core/src/lib/db-client.ts`, `packages/core/tests/lib/db-client.test.ts` |
| 10 | 2 | Bootstrap | `packages/team/tests/index.test.ts` | `packages/team/src/index.ts`, `packages/core/src/mcp/index.ts` |
| 11 | 3 | Mode selection | `packages/installer/src/steps/step-mode.ts`, `packages/installer/tests/steps/step-mode.test.ts` | `packages/installer/src/i18n/en.ts`, `packages/installer/src/i18n/pt-br.ts`, `packages/installer/src/index.ts` |
| 12 | 3 | License step | `packages/installer/src/steps/step-license.ts`, `packages/installer/tests/steps/step-license.test.ts` | `packages/installer/src/i18n/en.ts`, `packages/installer/src/i18n/pt-br.ts`, `packages/installer/src/index.ts` |
| 13 | 3 | Peers step | `packages/installer/src/steps/step-peers.ts`, `packages/installer/tests/steps/step-peers.test.ts` | `packages/installer/src/i18n/en.ts`, `packages/installer/src/i18n/pt-br.ts`, `packages/installer/src/index.ts` |
| 14 | 5 | Documentation | -- | `README.md`, `CONTRIBUTING.md` |

**Estimated time:** 3-4 hours for a single developer following TDD strictly.

**Dependencies between tasks:**
- Tasks 1-3 are sequential (types -> upsert -> search)
- Task 4 is independent of 1-3
- Tasks 5-10 are sequential within Phase 2
- Tasks 11-13 are sequential within Phase 3
- Task 14 can run in parallel with Phase 3
- Phase 2 depends on Phase 1 completion
- Phase 3 depends on Task 6 (license validation) from Phase 2

**Parallelism opportunities:**
- Phase 1: Tasks 1-3 (sequential) || Task 4 (independent)
- Phase 2 + Phase 3: Task 14 can run in parallel with Tasks 11-13
- Within Phase 2: Tasks 6, 7, 8 can be developed in parallel after Task 5
