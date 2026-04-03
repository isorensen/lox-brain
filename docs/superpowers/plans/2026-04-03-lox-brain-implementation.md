# Lox Brain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure `obsidian_open_brain` into the Lox monorepo, parameterize all hardcodes, build a cross-platform interactive installer, and prepare for open-source release.

**Architecture:** Monorepo with npm workspaces (`packages/core`, `packages/shared`, `packages/installer`). Core is the existing MCP server/watcher/embedding code, moved and parameterized. Shared holds the config schema and types. Installer is a new TypeScript CLI wizard with 12 steps, i18n, and security gates.

**Tech Stack:** TypeScript, Node.js 22, npm workspaces, vitest, chalk, ora, inquirer, boxen, gcloud CLI, WireGuard, PostgreSQL 16 + pgvector

**IMPORTANT security note:** All shell command execution in the installer MUST use `execFile` (not `exec`) to prevent command injection. The utility at `packages/installer/src/utils/shell.ts` wraps `execFile` from `node:child_process`.

---

## Phase 1: Foundation — Monorepo Structure & Shared Package

### Task 1: Create workspace root and package scaffolding

**Files:**
- Modify: `package.json` (root — convert to workspace root)
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/installer/package.json`
- Create: `packages/installer/tsconfig.json`
- Create: `tsconfig.base.json` (shared compiler options)

- [ ] **Step 1: Create `tsconfig.base.json` with shared compiler options**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "composite": true
  }
}
```

- [ ] **Step 2: Update root `package.json` to workspace root**

```json
{
  "name": "lox-brain",
  "version": "1.0.0",
  "private": true,
  "description": "Lox — Where knowledge lives. Personal AI-powered Second Brain with semantic search, MCP Server, and Obsidian integration.",
  "workspaces": [
    "packages/shared",
    "packages/core",
    "packages/installer"
  ],
  "scripts": {
    "build": "npm run build --workspaces",
    "test": "npm run test --workspaces --if-present",
    "test:coverage": "npm run test:coverage --workspaces --if-present",
    "lint": "tsc --noEmit --project packages/core/tsconfig.json && tsc --noEmit --project packages/installer/tsconfig.json"
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/isorensen/lox-brain.git"
  },
  "author": "Eduardo Sorensen (iSorensen)",
  "license": "MIT",
  "bugs": {
    "url": "https://github.com/isorensen/lox-brain/issues"
  },
  "homepage": "https://github.com/isorensen/lox-brain#readme"
}
```

- [ ] **Step 3: Create `packages/shared/package.json`**

```json
{
  "name": "@lox-brain/shared",
  "version": "1.0.0",
  "private": true,
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc"
  },
  "type": "commonjs"
}
```

- [ ] **Step 4: Create `packages/shared/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 5: Create `packages/core/package.json`**

```json
{
  "name": "@lox-brain/core",
  "version": "1.0.0",
  "private": true,
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "mcp": "tsx src/mcp/index.ts",
    "mcp:prod": "node dist/mcp/index.js",
    "watcher": "tsx src/watcher/index.ts",
    "watcher:prod": "node dist/watcher/index.js",
    "index-vault": "tsx src/scripts/index-vault.ts"
  },
  "type": "commonjs",
  "dependencies": {
    "@lox-brain/shared": "*",
    "@modelcontextprotocol/sdk": "^1.27.1",
    "chokidar": "^5.0.0",
    "openai": "^6.27.0",
    "pg": "^8.20.0"
  },
  "devDependencies": {
    "@types/node": "^25.3.5",
    "@types/pg": "^8.18.0",
    "@vitest/coverage-v8": "^4.0.18",
    "tsx": "^4.21.0",
    "typescript": "^5.9.3",
    "vitest": "^4.0.18"
  }
}
```

- [ ] **Step 6: Create `packages/core/tsconfig.json`**

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
    { "path": "../shared" }
  ]
}
```

- [ ] **Step 7: Create `packages/installer/package.json`**

```json
{
  "name": "lox",
  "version": "1.0.0",
  "private": true,
  "description": "Lox installer — set up your personal AI-powered Second Brain",
  "bin": {
    "lox": "dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "dev": "tsx src/index.ts"
  },
  "type": "commonjs",
  "dependencies": {
    "@lox-brain/shared": "*",
    "@inquirer/prompts": "^7.0.0",
    "boxen": "^8.0.0",
    "chalk": "^5.4.0",
    "ora": "^8.0.0"
  },
  "devDependencies": {
    "@types/node": "^25.3.5",
    "@vitest/coverage-v8": "^4.0.18",
    "tsx": "^4.21.0",
    "typescript": "^5.9.3",
    "vitest": "^4.0.18"
  }
}
```

- [ ] **Step 8: Create `packages/installer/tsconfig.json`**

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
    { "path": "../shared" }
  ]
}
```

- [ ] **Step 9: Verify workspace structure compiles**

Run: `npm install && npm run build --workspace=packages/shared`
Expected: Clean install, shared package builds (even if empty src/)

- [ ] **Step 10: Commit**

```bash
git add tsconfig.base.json packages/ package.json
git commit -m "feat: scaffold monorepo with npm workspaces (core, shared, installer)"
```

---

### Task 2: Create shared package — config schema and types

**Files:**
- Create: `packages/shared/src/index.ts`
- Create: `packages/shared/src/config.ts`
- Create: `packages/shared/src/types.ts`
- Create: `packages/shared/src/constants.ts`

- [ ] **Step 1: Create `packages/shared/src/types.ts`**

Move existing types from `src/lib/types.ts` and add config types:

```typescript
// --- Note types (from existing codebase) ---

export interface NoteMetadata {
  title: string | null;
  tags: string[];
  content: string;
}

export interface NoteRow {
  id: string;
  file_path: string;
  title: string | null;
  content: string;
  tags: string[];
  embedding: number[];
  file_hash: string;
  chunk_index: number;
}

export interface SearchOptions {
  limit: number;
  offset: number;
  includeContent: boolean;
  contentPreviewLength: number;
}

export interface PaginatedResult<T> {
  results: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface SearchResult {
  id: string;
  file_path: string;
  title: string | null;
  content?: string;
  tags: string[];
  similarity: number;
  updated_at: Date;
}

export interface RecentNote {
  id: string;
  file_path: string;
  title: string | null;
  content?: string;
  tags: string[];
  updated_at: Date;
}
```

- [ ] **Step 2: Create `packages/shared/src/config.ts`**

```typescript
export interface VpnPeer {
  name: string;
  ip: string;
  public_key: string;
  added_at: string;
}

export interface LoxConfig {
  version: string;
  mode: 'personal' | 'team';
  gcp: {
    project: string;
    region: string;
    zone: string;
    vm_name: string;
    service_account: string;
  };
  database: {
    host: string;
    port: number;
    name: string;
    user: string;
  };
  vpn: {
    server_ip: string;
    subnet: string;
    listen_port: number;
    peers: VpnPeer[];
  };
  vault: {
    repo: string;
    local_path: string;
    preset: 'zettelkasten' | 'para';
  };
  install_dir: string;
  installed_at: string;
}

export const DEFAULT_CONFIG: Partial<LoxConfig> = {
  version: '1.0.0',
  mode: 'personal',
  database: {
    host: '127.0.0.1',
    port: 5432,
    name: 'lox_brain',
    user: 'lox',
  },
  vpn: {
    server_ip: '10.10.0.1',
    subnet: '10.10.0.0/24',
    listen_port: 51820,
    peers: [],
  },
};

export function getConfigPath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  return `${home}/.lox/config.json`;
}
```

- [ ] **Step 3: Create `packages/shared/src/constants.ts`**

```typescript
export const LOX_VERSION = '1.0.0';

export const LOX_ASCII_LOGO = `  _        ___   __  __
 | |      / _ \\  \\ \\/ /
 | |     | | | |  \\  /
 | |___  | |_| |  /  \\
 |_____|  \\___/  /_/\\_\\`;

export const LOX_TAGLINE = 'Where knowledge lives.';

export const LOX_MCP_SERVER_NAME = 'lox-brain';

export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIMENSIONS = 1536;
export const CHUNK_MAX_TOKENS = 4000;
export const CHUNK_OVERLAP_TOKENS = 200;
export const CHARS_PER_TOKEN_ESTIMATE = 3;

export const DB_TABLE_NAME = 'vault_embeddings';
```

- [ ] **Step 4: Create `packages/shared/src/index.ts`**

```typescript
export * from './types.js';
export * from './config.js';
export * from './constants.js';
```

- [ ] **Step 5: Build shared package and verify**

Run: `npm run build --workspace=packages/shared`
Expected: Clean build, `packages/shared/dist/` contains `.js` and `.d.ts` files

- [ ] **Step 6: Commit**

```bash
git add packages/shared/
git commit -m "feat: add shared package with config schema, types, and constants"
```

---

### Task 3: Move core code into `packages/core`

**Files:**
- Move: `src/lib/db-client.ts` -> `packages/core/src/lib/db-client.ts`
- Move: `src/lib/embedding-service.ts` -> `packages/core/src/lib/embedding-service.ts`
- Move: `src/mcp/index.ts` -> `packages/core/src/mcp/index.ts`
- Move: `src/mcp/tools.ts` -> `packages/core/src/mcp/tools.ts`
- Move: `src/watcher/vault-watcher.ts` -> `packages/core/src/watcher/vault-watcher.ts`
- Move: `src/watcher/index.ts` -> `packages/core/src/watcher/index.ts`
- Move: `src/scripts/index-vault.ts` -> `packages/core/src/scripts/index-vault.ts`
- Move: `tests/` -> `packages/core/tests/`
- Move: `vitest.config.ts` -> `packages/core/vitest.config.ts`
- Delete: `src/lib/types.ts` (now in shared)
- Delete: `src/index.ts` (placeholder, no longer needed)

- [ ] **Step 1: Move source files to packages/core**

```bash
mkdir -p packages/core/src/lib packages/core/src/mcp packages/core/src/watcher packages/core/src/scripts
mv src/lib/db-client.ts packages/core/src/lib/
mv src/lib/embedding-service.ts packages/core/src/lib/
mv src/mcp/index.ts packages/core/src/mcp/
mv src/mcp/tools.ts packages/core/src/mcp/
mv src/watcher/vault-watcher.ts packages/core/src/watcher/
mv src/watcher/index.ts packages/core/src/watcher/
mv src/scripts/index-vault.ts packages/core/src/scripts/
```

- [ ] **Step 2: Move tests and vitest config**

```bash
mv tests/ packages/core/tests/
mv vitest.config.ts packages/core/vitest.config.ts
```

- [ ] **Step 3: Update imports in core files — replace `../lib/types.js` with `@lox-brain/shared`**

In `packages/core/src/lib/db-client.ts`, change:
```typescript
// OLD
import type { NoteRow, SearchResult, RecentNote, SearchOptions, PaginatedResult } from './types.js';
// NEW
import type { NoteRow, SearchResult, RecentNote, SearchOptions, PaginatedResult } from '@lox-brain/shared';
```

In `packages/core/src/lib/embedding-service.ts`, change:
```typescript
// OLD
import type { NoteMetadata } from './types.js';
// NEW
import type { NoteMetadata } from '@lox-brain/shared';
```

In `packages/core/src/mcp/tools.ts`, change:
```typescript
// OLD
import type { SearchOptions } from '../lib/types.js';
// NEW
import type { SearchOptions } from '@lox-brain/shared';
```

- [ ] **Step 4: Update imports in test files — replace `../../src/lib/types.js` with `@lox-brain/shared`**

In all test files under `packages/core/tests/`, update type imports:
```typescript
// OLD
import type { NoteRow, SearchOptions } from '../../src/lib/types.js';
// NEW
import type { NoteRow, SearchOptions } from '@lox-brain/shared';
```

- [ ] **Step 5: Delete old `src/` directory and root-level files that moved**

```bash
rm -rf src/
```

Note: Keep root `tsconfig.json` temporarily until Step 9 — CI may reference it.

- [ ] **Step 6: Move `.env.example` to `packages/core/`**

```bash
mv .env.example packages/core/.env.example
```

- [ ] **Step 7: Install workspace dependencies and verify build**

```bash
npm install
npm run build --workspace=packages/shared
npm run build --workspace=packages/core
```

Expected: Both packages build cleanly. If import errors, check that `@lox-brain/shared` resolves via workspace.

- [ ] **Step 8: Run tests**

Run: `npm run test --workspace=packages/core`
Expected: All existing tests pass (the logic hasn't changed, only file locations and import paths)

- [ ] **Step 9: Clean up old root tsconfig.json**

Delete the old root `tsconfig.json` (now each package has its own):

```bash
rm -f tsconfig.json
```

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "refactor: move core code and tests into packages/core, use @lox-brain/shared types"
```

---

### Task 4: Parameterize hardcoded values in core

**Files:**
- Modify: `packages/core/src/mcp/index.ts`
- Modify: `packages/core/src/watcher/index.ts`
- Modify: `packages/core/src/scripts/index-vault.ts`
- Create: `packages/core/src/lib/create-pool.ts`

- [ ] **Step 1: Create `packages/core/src/lib/create-pool.ts` — shared DB pool factory**

```typescript
import { Pool } from 'pg';

export interface DbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export function createPool(config?: Partial<DbConfig>): Pool {
  return new Pool({
    host: config?.host ?? process.env.DB_HOST ?? '127.0.0.1',
    port: config?.port ?? parseInt(process.env.DB_PORT ?? '5432', 10),
    database: config?.database ?? process.env.DB_NAME ?? 'lox_brain',
    user: config?.user ?? process.env.DB_USER ?? 'lox',
    password: config?.password ?? process.env.PG_PASSWORD ?? '',
    // SSL omitted: PostgreSQL listens on localhost only (Zero Trust — no public IP).
  });
}
```

- [ ] **Step 2: Update `packages/core/src/mcp/index.ts` — use `createPool` and parameterized server name**

Replace the hardcoded Pool construction and server name:

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import OpenAI from 'openai';
import { LOX_MCP_SERVER_NAME, LOX_VERSION } from '@lox-brain/shared';
import { EmbeddingService } from '../lib/embedding-service.js';
import { DbClient } from '../lib/db-client.js';
import { createPool } from '../lib/create-pool.js';
import { createTools } from './tools.js';

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
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Lox Brain MCP Server running on stdio');
}

main().catch((err: unknown) => {
  console.error('Fatal error starting MCP server:', err);
  process.exit(1);
});
```

- [ ] **Step 3: Update `packages/core/src/watcher/index.ts` — use `createPool`**

Replace the hardcoded Pool construction:

```typescript
import { readFile } from 'node:fs/promises';
import OpenAI from 'openai';
import { EmbeddingService } from '../lib/embedding-service.js';
import { DbClient } from '../lib/db-client.js';
import { createPool } from '../lib/create-pool.js';
import { VaultWatcher } from './vault-watcher.js';

const VAULT_PATH = process.env.VAULT_PATH;
if (!VAULT_PATH) {
  console.error('VAULT_PATH environment variable is required');
  process.exit(1);
}

const pool = createPool();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const embeddingService = new EmbeddingService(openai);
const dbClient = new DbClient(pool);
const vaultWatcher = new VaultWatcher(VAULT_PATH, embeddingService, dbClient);

async function processFile(filePath: string, label: string): Promise<void> {
  if (!vaultWatcher.shouldProcess(filePath)) return;
  try {
    const content = await readFile(filePath, 'utf-8');
    await vaultWatcher.handleFileChange(filePath, content);
    console.log(`${label}: ${filePath}`);
  } catch (err) {
    console.error(`Error ${label.toLowerCase()} ${filePath}:`, err);
  }
}

async function main(): Promise<void> {
  const chokidar = await import('chokidar');

  console.log(`Watching vault at: ${VAULT_PATH}`);

  const fsWatcher = chokidar.watch(VAULT_PATH!, {
    ignored: [/(^|[/\\])\../, /node_modules/],
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 500 },
  });

  fsWatcher
    .on('add', (fp) => processFile(fp, 'Indexed'))
    .on('change', (fp) => processFile(fp, 'Re-indexed'))
    .on('unlink', async (filePath) => {
      if (!vaultWatcher.shouldProcess(filePath)) return;
      try {
        await vaultWatcher.handleFileDelete(filePath);
        console.log(`Removed: ${filePath}`);
      } catch (err) {
        console.error(`Error removing ${filePath}:`, err);
      }
    });
}

main().catch((err) => {
  console.error('Fatal error starting watcher:', err);
  process.exit(1);
});
```

- [ ] **Step 4: Update `packages/core/src/scripts/index-vault.ts` — use `createPool`**

Replace the hardcoded Pool construction (lines 83-89):

```typescript
// Replace:
  const pool = new Pool({
    host: '127.0.0.1',
    port: 5432,
    database: 'open_brain',
    user: 'obsidian_brain',
    password: PG_PASSWORD,
    ssl: false,
  });

// With:
  const pool = createPool({ password: PG_PASSWORD });
```

Add import at top:
```typescript
import { createPool } from '../lib/create-pool.js';
```

Remove the `Pool` import from `pg` (no longer needed directly).

- [ ] **Step 5: Update `packages/core/src/lib/embedding-service.ts` — use constants from shared**

Replace hardcoded model and chunking values:

```typescript
import { createHash } from 'node:crypto';
import type OpenAI from 'openai';
import type { NoteMetadata } from '@lox-brain/shared';
import { EMBEDDING_MODEL, CHUNK_MAX_TOKENS, CHUNK_OVERLAP_TOKENS, CHARS_PER_TOKEN_ESTIMATE } from '@lox-brain/shared';
```

Then replace in `generateEmbedding`:
```typescript
// OLD
model: 'text-embedding-3-small',
// NEW
model: EMBEDDING_MODEL,
```

And in `chunkText` (the method that uses these values):
```typescript
// OLD
chunkText(text: string, maxTokens = 4000, overlapTokens = 200): string[] {
  const maxChars = maxTokens * 3;
  const overlapChars = overlapTokens * 3;
// NEW
chunkText(text: string, maxTokens = CHUNK_MAX_TOKENS, overlapTokens = CHUNK_OVERLAP_TOKENS): string[] {
  const maxChars = maxTokens * CHARS_PER_TOKEN_ESTIMATE;
  const overlapChars = overlapTokens * CHARS_PER_TOKEN_ESTIMATE;
```

- [ ] **Step 6: Update `.env.example` in packages/core with new defaults**

```
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
```

- [ ] **Step 7: Run tests to verify nothing broke**

Run: `npm run build --workspaces && npm run test --workspace=packages/core`
Expected: All tests pass. The parameterization only affects runtime config, not test logic (tests mock the Pool).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: parameterize all hardcoded DB/config values in core, use shared constants"
```

---

### Task 5: Update CI/CD workflows and deploy script

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/deploy.yml`
- Modify: `scripts/deploy.sh` -> `infra/deploy.sh`
- Create: `infra/systemd/lox-watcher.service`

- [ ] **Step 1: Update `.github/workflows/ci.yml` for monorepo**

```yaml
name: CI

on:
  pull_request:
    branches: [main]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Type check
        run: |
          npx tsc --noEmit --project packages/shared/tsconfig.json
          npx tsc --noEmit --project packages/core/tsconfig.json

      - name: Build
        run: npm run build --workspaces

      - name: Test with coverage
        run: npm run test:coverage --workspace=packages/core

      - name: Security audit
        run: npm audit --audit-level=high
```

- [ ] **Step 2: Move and parameterize deploy script**

```bash
mkdir -p infra
mv scripts/deploy.sh infra/deploy.sh
```

Update `infra/deploy.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Resolve install directory from Lox config or fallback to default
LOX_CONFIG="$HOME/.lox/config.json"
if [ -f "$LOX_CONFIG" ]; then
  PROJECT_DIR=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$LOX_CONFIG','utf8')).install_dir)")
else
  PROJECT_DIR="$HOME/lox-brain"
fi

cd "$PROJECT_DIR"

echo "=== Lox deploy started at $(date -u) ==="

echo "--- git pull ---"
git pull origin main

echo "--- npm ci ---"
npm ci

echo "--- npm run build ---"
npm run build --workspaces

echo "--- restart watcher ---"
sudo systemctl restart lox-watcher

echo "--- kill stale MCP processes ---"
pkill -f 'tsx src/mcp/index.ts' || true
pkill -f 'tsx packages/core/src/mcp/index.ts' || true

echo "--- verify watcher ---"
systemctl is-active lox-watcher

echo "=== Lox deploy completed at $(date -u) ==="
echo "DEPLOY_SUCCESS"
```

- [ ] **Step 3: Update `.github/workflows/deploy.yml` — parameterize SSH user and paths**

```yaml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Authenticate to GCP
        uses: google-github-actions/auth@v2
        with:
          credentials_json: '${{ secrets.GCP_SA_KEY }}'

      - name: Setup gcloud
        uses: google-github-actions/setup-gcloud@v2

      - name: Deploy to VM
        run: |
          gcloud compute ssh ${{ secrets.VM_SSH_USER }}@${{ secrets.VM_NAME }} \
            --zone=${{ secrets.GCP_ZONE }} \
            --project=${{ secrets.GCP_PROJECT_ID }} \
            --tunnel-through-iap \
            --command="nohup bash ~/lox-brain/infra/deploy.sh > /tmp/deploy.log 2>&1; cat /tmp/deploy.log"

      - name: Health check
        run: |
          gcloud compute ssh ${{ secrets.VM_SSH_USER }}@${{ secrets.VM_NAME }} \
            --zone=${{ secrets.GCP_ZONE }} \
            --project=${{ secrets.GCP_PROJECT_ID }} \
            --tunnel-through-iap \
            --command="systemctl is-active lox-watcher && tail -1 /tmp/deploy.log | grep -q DEPLOY_SUCCESS"
```

Note: Requires adding secrets `VM_SSH_USER`, `VM_NAME`, `GCP_ZONE` in GitHub repo settings.

- [ ] **Step 4: Create systemd service template**

Create `infra/systemd/lox-watcher.service`:

```ini
[Unit]
Description=Lox Brain Vault Watcher
After=network.target postgresql.service

[Service]
Type=simple
User=__LOX_VM_USER__
WorkingDirectory=__LOX_INSTALL_DIR__
EnvironmentFile=__LOX_INSTALL_DIR__/.env
ExecStart=/usr/bin/node __LOX_INSTALL_DIR__/packages/core/dist/watcher/index.js
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

The installer will replace `__LOX_VM_USER__` and `__LOX_INSTALL_DIR__` with actual values from config.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: update CI/CD for monorepo, parameterize deploy script and systemd service"
```

---

### Task 6: Add infra templates and vault templates

**Files:**
- Create: `infra/postgres/schema.sql`
- Create: `infra/postgres/pg_hba.conf.template`
- Create: `infra/wireguard/server.conf.template`
- Create: `infra/wireguard/client.conf.template`
- Create: `templates/zettelkasten/` (folder structure + template files)
- Create: `templates/para/` (folder structure + template files)
- Create: `templates/obsidian-plugins/` (.obsidian config)

- [ ] **Step 1: Create `infra/postgres/schema.sql`**

```sql
-- Lox Brain — PostgreSQL schema
-- Requires: pgvector extension

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS vault_embeddings (
  id UUID PRIMARY KEY,
  file_path TEXT NOT NULL,
  title TEXT,
  content TEXT NOT NULL,
  tags TEXT[] DEFAULT '{}',
  embedding vector(1536),
  file_hash TEXT NOT NULL,
  chunk_index INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (file_path, chunk_index)
);

-- Semantic search index (cosine similarity)
CREATE INDEX IF NOT EXISTS idx_vault_embeddings_embedding
  ON vault_embeddings USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Tag search index
CREATE INDEX IF NOT EXISTS idx_vault_embeddings_tags
  ON vault_embeddings USING gin (tags);

-- Recent notes index
CREATE INDEX IF NOT EXISTS idx_vault_embeddings_updated_at
  ON vault_embeddings (updated_at DESC);
```

Note: includes `created_by TEXT` column for future multi-user support (Credifit).

- [ ] **Step 2: Create `infra/postgres/pg_hba.conf.template`**

```
# Lox Brain — PostgreSQL client authentication
# TYPE  DATABASE  USER           ADDRESS        METHOD
local   all       postgres                      peer
local   all       __LOX_DB_USER__                scram-sha-256
host    all       __LOX_DB_USER__  127.0.0.1/32  scram-sha-256
# DENY all other connections
host    all       all              0.0.0.0/0     reject
```

- [ ] **Step 3: Create WireGuard templates**

`infra/wireguard/server.conf.template`:
```ini
[Interface]
PrivateKey = __WG_SERVER_PRIVATE_KEY__
Address = __LOX_VPN_SERVER_IP__/24
ListenPort = __LOX_VPN_LISTEN_PORT__
PostUp = iptables -A FORWARD -i wg0 -j ACCEPT; iptables -t nat -A POSTROUTING -o ens4 -j MASQUERADE
PostDown = iptables -D FORWARD -i wg0 -j ACCEPT; iptables -t nat -D POSTROUTING -o ens4 -j MASQUERADE
```

`infra/wireguard/client.conf.template`:
```ini
[Interface]
PrivateKey = __WG_CLIENT_PRIVATE_KEY__
Address = __LOX_VPN_CLIENT_IP__/24

[Peer]
PublicKey = __WG_SERVER_PUBLIC_KEY__
Endpoint = __WG_ENDPOINT__:__LOX_VPN_LISTEN_PORT__
AllowedIPs = __LOX_VPN_SUBNET__
PersistentKeepalive = 25
```

- [ ] **Step 4: Create Zettelkasten vault template**

```bash
mkdir -p "templates/zettelkasten/1 - Fleeting Notes"
mkdir -p "templates/zettelkasten/2 - Projects"
mkdir -p "templates/zettelkasten/2 - Source Material/Articles"
mkdir -p "templates/zettelkasten/2 - Source Material/Books"
mkdir -p "templates/zettelkasten/2 - Source Material/Podcasts"
mkdir -p "templates/zettelkasten/2 - Source Material/Videos"
mkdir -p "templates/zettelkasten/2 - Source Material/Other"
mkdir -p "templates/zettelkasten/3 - Tags"
mkdir -p "templates/zettelkasten/5 - Templates"
mkdir -p "templates/zettelkasten/6 - Atomic Notes"
mkdir -p "templates/zettelkasten/7 - Meeting Notes"
mkdir -p "templates/zettelkasten/attachments"
```

Create `templates/zettelkasten/Welcome to Lox.md` — welcome note explaining the folder structure and how Lox works (see spec section 3.6 for content style).

Create template files in `templates/zettelkasten/5 - Templates/`: `Full Note.md`, `Meeting Notes.md`, `People Note.md`, `Task.md`, `Source Material.md`, `Date.md` — each with Obsidian template variables (`{{date:YYYY-MM-DD}}`, `{{time:HH:mm}}`, `{{title}}`).

- [ ] **Step 5: Create PARA vault template**

```bash
mkdir -p "templates/para/1 - Inbox"
mkdir -p "templates/para/2 - Projects"
mkdir -p "templates/para/3 - Areas"
mkdir -p "templates/para/4 - Resources"
mkdir -p "templates/para/5 - Archive"
mkdir -p "templates/para/Templates"
```

Create `templates/para/Welcome to Lox.md` and template files in `templates/para/Templates/`: `Note.md`, `Meeting.md`, `Project.md`.

- [ ] **Step 6: Create Obsidian plugin configs**

`templates/obsidian-plugins/community-plugins.json`:
```json
["obsidian-git", "dataview", "omnisearch", "emoji-shortcodes", "recent-files-obsidian"]
```

`templates/obsidian-plugins/app.json`:
```json
{"newFileLocation": "current", "newLinkFormat": "shortest", "useMarkdownLinks": false, "showFrontmatter": true}
```

`templates/obsidian-plugins/core-plugins.json`:
```json
{"file-explorer": true, "global-search": true, "graph": true, "backlinks": true, "outgoing-links": true, "tag-pane": true, "templates": true, "note-composer": true, "command-palette": true, "switcher": true, "outline": true, "word-count": true, "bookmarks": true}
```

- [ ] **Step 7: Add .gitkeep files to empty template directories**

```bash
find templates/ -type d -empty -exec touch {}/.gitkeep \;
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add infra templates (postgres, wireguard, systemd) and vault presets (zettelkasten, para)"
```

---

### Task 7: Add LICENSE, update README, and update docs

**Files:**
- Create: `LICENSE`
- Rewrite: `README.md`
- Modify: `CLAUDE.md`
- Modify: `TODO.md`

- [ ] **Step 1: Create MIT LICENSE file**

Standard MIT license text with `Copyright (c) 2026 Eduardo Sorensen (iSorensen)`.

- [ ] **Step 2: Rewrite README.md with Lox branding**

New README should include: ASCII logo, tagline, what/why/how description, architecture diagram, quick start (install.sh/install.ps1), MCP tools table, CLI commands, security section, development commands, cost estimate, license. See design spec for exact content.

- [ ] **Step 3: Update CLAUDE.md — replace obsidian_open_brain references with Lox**

Key changes: project name Lox, MCP server name `lox-brain`, build commands `npm run build --workspaces`, test commands `npm run test --workspace=packages/core`, watcher service `lox-watcher`.

- [ ] **Step 4: Update TODO.md — add Lox-specific items**

Add: Lox Local Mode (medium priority), and update existing items to reflect new paths/names.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs: add MIT license, rewrite README with Lox branding, update CLAUDE.md and TODO.md"
```

---

## Phase 2: Installer — Core Framework

### Task 8: Installer scaffolding — entry point, i18n, and UI components

**Files:**
- Create: `packages/installer/src/index.ts`
- Create: `packages/installer/src/i18n/index.ts`
- Create: `packages/installer/src/i18n/en.ts`
- Create: `packages/installer/src/i18n/pt-br.ts`
- Create: `packages/installer/src/ui/splash.ts`
- Create: `packages/installer/src/ui/box.ts`
- Create: `packages/installer/src/ui/spinner.ts`
- Create: `packages/installer/src/utils/shell.ts`
- Create: `packages/installer/vitest.config.ts`
- Create: `packages/installer/tests/i18n.test.ts`

- [ ] **Step 1: Create shell utility using execFile (safe, no injection)**

`packages/installer/src/utils/shell.ts`:
```typescript
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFileCb);

export interface ShellResult {
  stdout: string;
  stderr: string;
}

export async function shell(cmd: string, args: string[] = []): Promise<ShellResult> {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    });
    return { stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
      throw new Error(`Command not found: ${cmd}`);
    }
    throw err;
  }
}

export async function commandExists(cmd: string): Promise<boolean> {
  try {
    await shell(cmd, ['--version']);
    return true;
  } catch {
    return false;
  }
}

export function getPlatform(): 'windows' | 'macos' | 'linux' {
  switch (process.platform) {
    case 'win32': return 'windows';
    case 'darwin': return 'macos';
    default: return 'linux';
  }
}
```

- [ ] **Step 2: Create i18n — English strings (`en.ts`), pt-BR strings (`pt-br.ts`), and index**

English and pt-BR string files with all installer UI text (step names, security messages, success screens, etc.). Index file with `setLocale()`, `getLocale()`, `t()` functions.

- [ ] **Step 3: Write i18n test**

Test: defaults to English, switches to pt-BR, pt-BR has all keys English has, no empty strings.

- [ ] **Step 4: Run i18n test**

Run: `cd packages/installer && npx vitest run tests/i18n.test.ts`
Expected: All tests pass

- [ ] **Step 5: Create UI components — splash, box, spinner**

`splash.ts`: renders ASCII logo + tagline using constants from shared.
`box.ts`: renders Unicode-bordered boxes and step headers.
`spinner.ts`: wraps ora with start/succeed/fail pattern.

- [ ] **Step 6: Create installer entry point (minimal — language select + splash)**

- [ ] **Step 7: Create vitest config for installer**

- [ ] **Step 8: Build and verify installer runs**

Run: `npm run build --workspaces && node packages/installer/dist/index.js`
Expected: Language selector, splash screen, placeholder message.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: add installer scaffolding with i18n (en + pt-BR), splash screen, and UI components"
```

---

### Task 9: Installer — prerequisite checks (Step 1)

**Files:**
- Create: `packages/installer/src/checks/prerequisites.ts`
- Create: `packages/installer/tests/checks/prerequisites.test.ts`

- [ ] **Step 1: Create prerequisite checks**

Checks for: Node.js 22+, git, gcloud CLI, GitHub CLI (gh), WireGuard. Each returns name, installed boolean, version, and platform-specific install command (winget/brew/apt).

- [ ] **Step 2: Write test for getPlatform utility**

- [ ] **Step 3: Run test and verify**

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add installer prerequisite checks with cross-platform install commands"
```

---

### Task 10: Installer — security audit module

**Files:**
- Create: `packages/installer/src/security/audit.ts`
- Create: `packages/installer/src/security/gates.ts`
- Create: `packages/installer/tests/security/gates.test.ts`

- [ ] **Step 1: Create security gate definitions**

17 gates covering: repo private, branch protection, VM no public IP, firewall deny-all, SSH IAP only + no password + no root, PG localhost, secrets in Secret Manager, VPN split tunnel, SA least privilege, default VPC deleted, cloud logging, HTTPS remote, gitleaks, disk encryption, .gitignore, GitHub PAT scope, SSH key permissions. Each gate has a `check()` function using `shell()` to validate via gcloud/gh CLI.

- [ ] **Step 2: Create audit runner and rendering functions**

`runSecurityAudit()` runs all gates, `renderAuditResults()` renders the Unicode box with pass/fail, `renderSecurityHygiene()` renders the 3 rules.

- [ ] **Step 3: Write tests for rendering (not for actual gcloud calls)**

- [ ] **Step 4: Run tests and verify**

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add security audit module with 17 gates and i18n-aware rendering"
```

---

### Task 11: Installer — wizard step framework and Steps 0-4

**Files:**
- Create: `packages/installer/src/steps/types.ts`
- Create: `packages/installer/src/steps/step-language.ts`
- Create: `packages/installer/src/steps/step-prerequisites.ts`
- Create: `packages/installer/src/steps/step-gcp-auth.ts`
- Create: `packages/installer/src/steps/step-gcp-project.ts`
- Create: `packages/installer/src/steps/step-billing.ts`
- Modify: `packages/installer/src/index.ts`

- [ ] **Step 1: Create step type interface**

`InstallerContext` (holds partial config, locale, GCP info), `StepResult` (success + message), `InstallerStep` function type.

- [ ] **Step 2: Implement Steps 0-4**

Step 0 (Language): select locale via inquirer.
Step 1 (Prerequisites): run checks, show installed/missing, fail if missing.
Step 2 (GCP Auth): check active account, run `gcloud auth login` if needed.
Step 3 (GCP Project): prompt project ID, create project, enable APIs, set region.
Step 4 (Billing): show instructions box, open browser, wait for ENTER.

- [ ] **Step 3: Wire steps into index.ts**

- [ ] **Step 4: Build and verify**

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: implement installer steps 0-4 (language, prerequisites, GCP auth, project, billing)"
```

---

### Task 12: Installer — Steps 5-8 (Infrastructure)

**Files:**
- Create: `packages/installer/src/steps/step-network.ts`
- Create: `packages/installer/src/steps/step-vm.ts`
- Create: `packages/installer/src/steps/step-vm-setup.ts`
- Create: `packages/installer/src/steps/step-vpn.ts`

- [ ] **Step 1: Implement Step 5 — Network & Firewall**

VPC, subnet, firewall rules, Cloud Router, Cloud NAT, delete default VPC. Security gate validation.

- [ ] **Step 2: Implement Step 6 — VM Provisioning**

Service account, VM creation, security gate validation.

- [ ] **Step 3: Implement Step 7 — VM Setup**

SSH via IAP, install packages, DB setup, schema, Secret Manager, sshd hardening.

- [ ] **Step 4: Implement Step 8 — WireGuard VPN**

Static IP, key generation, server/client config, tunnel activation, connectivity test.

- [ ] **Step 5: Wire steps 5-8 into index.ts and build**

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: implement installer steps 5-8 (network, VM, VM setup, VPN)"
```

---

### Task 13: Installer — Steps 9-12 (Application)

**Files:**
- Create: `packages/installer/src/steps/step-vault.ts`
- Create: `packages/installer/src/steps/step-obsidian.ts`
- Create: `packages/installer/src/steps/step-deploy.ts`
- Create: `packages/installer/src/steps/step-mcp.ts`

- [ ] **Step 1: Implement Step 9 — Vault Setup**

Preset choice, GitHub repo creation (private), template copy, .gitignore, PAT guidance, branch protection, git sync cron, gitleaks pre-commit.

- [ ] **Step 2: Implement Step 10 — Obsidian**

Install Obsidian, clone vault, copy plugin configs, manual activation instructions.

- [ ] **Step 3: Implement Step 11 — Deploy Lox Core**

Clone repo on VM, build, .env from config, systemd service, test MCP.

- [ ] **Step 4: Implement Step 12 — Claude Code MCP**

SSH config, `claude mcp add`, verification.

- [ ] **Step 5: Wire steps 9-12 + post-install screens + save config**

- [ ] **Step 6: Build and verify**

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: implement installer steps 9-12 (vault, obsidian, deploy, MCP) and post-install screens"
```

---

## Phase 3: Bootstrap Scripts & Migration

### Task 14: Bootstrap scripts (install.sh + install.ps1)

**Files:**
- Create: `scripts/install.sh`
- Create: `scripts/install.ps1`

- [ ] **Step 1: Create `scripts/install.sh` (macOS/Linux bootstrap)**

Shows ASCII logo, checks/installs Node 22+, clones repo to temp dir, builds, runs installer, cleans up.

- [ ] **Step 2: Create `scripts/install.ps1` (Windows bootstrap)**

Same logic in PowerShell: checks Node via winget, clones, builds, runs installer.

- [ ] **Step 3: Make install.sh executable**

```bash
chmod +x scripts/install.sh
```

- [ ] **Step 4: Commit**

```bash
git add scripts/
git commit -m "feat: add cross-platform bootstrap scripts (install.sh + install.ps1)"
```

---

### Task 15: Migration command (`lox migrate`)

**Files:**
- Create: `packages/installer/src/migrate.ts`
- Create: `packages/installer/tests/migrate.test.ts`

- [ ] **Step 1: Create migration detector and executor**

`detectOldInstallation()`: checks common paths for `obsidian_open_brain` package.json.
`runMigration()`: generates `~/.lox/config.json` from old values, prints manual steps remaining.

- [ ] **Step 2: Write migration test**

Test: returns null when no installation, detects by package name.

- [ ] **Step 3: Add `migrate` subcommand to installer entry point**

Check `process.argv` for `migrate` and `status` subcommands before wizard flow.

- [ ] **Step 4: Run tests and verify**

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add lox migrate command for obsidian_open_brain to Lox migration"
```

---

## Phase 4: History Scan & Finalization

### Task 16: Security scan of git history

**Files:** None (validation only)

- [ ] **Step 1: Run gitleaks on full history**

```bash
gitleaks detect --source . --verbose
```

Expected: No secrets found.

- [ ] **Step 2: If secrets found — clean with git filter-repo**

Only if step 1 found secrets. Requires explicit user approval for force push.

---

### Task 17: Final verification and PR

- [ ] **Step 1: Run full test suite**

```bash
npm run build --workspaces
npm run test --workspace=packages/core
npm run test --workspace=packages/installer
```

- [ ] **Step 2: Type check all packages**

```bash
npx tsc --noEmit --project packages/shared/tsconfig.json
npx tsc --noEmit --project packages/core/tsconfig.json
npx tsc --noEmit --project packages/installer/tsconfig.json
```

- [ ] **Step 3: Security audit**

```bash
npm audit --audit-level=high
```

- [ ] **Step 4: Verify monorepo workspace resolution**

```bash
npm ls @lox-brain/shared
```

- [ ] **Step 5: Test installer dry run**

```bash
node packages/installer/dist/index.js
```

- [ ] **Step 6: Create PR**

---

## Dependency Graph

```
Task 1 (scaffold) -> Task 2 (shared) -> Task 3 (move core) -> Task 4 (parameterize)
                                                                  |
Task 5 (CI/CD) <--------------------------------------------------
Task 6 (templates) — independent, can run in parallel with Task 5
Task 7 (docs) — depends on Task 5
Task 8 (installer scaffold) — depends on Task 2
Task 9 (prerequisites) -> Task 10 (security) -> Task 11 (steps 0-4) -> Task 12 (steps 5-8) -> Task 13 (steps 9-12)
Task 14 (bootstrap scripts) — depends on Task 13
Task 15 (migration) — depends on Task 8
Task 16 (gitleaks scan) — independent, run anytime
Task 17 (verification) — depends on all other tasks
```

**Parallelizable groups:**
- Tasks 5 + 6 (CI/CD + templates) — independent after Task 4
- Tasks 8 + 15 (installer scaffold + migration) — after Task 2, independent of Tasks 5-7
- Task 16 (gitleaks) — can run anytime
