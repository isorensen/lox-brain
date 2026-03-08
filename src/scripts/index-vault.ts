/**
 * One-time vault indexing script.
 *
 * Walks all .md files under VAULT_PATH, skipping .obsidian/ and .git/,
 * and upserts embeddings into PostgreSQL via VaultWatcher's pipeline.
 *
 * Usage:
 *   VAULT_PATH=/path/to/vault \
 *   PG_PASSWORD=secret \
 *   OPENAI_API_KEY=sk-... \
 *   npm run index-vault
 */

import { readdir, readFile } from 'node:fs/promises';
import { type Dirent } from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import OpenAI from 'openai';
import { EmbeddingService } from '../lib/embedding-service.js';
import { DbClient } from '../lib/db-client.js';
import { VaultWatcher } from '../watcher/vault-watcher.js';

// ---------------------------------------------------------------------------
// Environment validation
// ---------------------------------------------------------------------------

const VAULT_PATH = process.env['VAULT_PATH'];
const PG_PASSWORD = process.env['PG_PASSWORD'];
const OPENAI_API_KEY = process.env['OPENAI_API_KEY'];

if (!VAULT_PATH) {
  console.error('[index-vault] Error: VAULT_PATH environment variable is required');
  process.exit(1);
}
if (!PG_PASSWORD) {
  console.error('[index-vault] Error: PG_PASSWORD environment variable is required');
  process.exit(1);
}
if (!OPENAI_API_KEY) {
  console.error('[index-vault] Error: OPENAI_API_KEY environment variable is required');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Recursive .md file discovery (skip .obsidian/ and .git/)
// ---------------------------------------------------------------------------

const IGNORED_DIRS = new Set(['.obsidian', '.git']);

async function collectMarkdownFiles(dir: string): Promise<string[]> {
  const results: string[] = [];

  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    console.error(`[index-vault] Cannot read directory ${dir}:`, err);
    return results;
  }

  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      const nested = await collectMarkdownFiles(fullPath);
      results.push(...nested);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(fullPath);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // Wire up dependencies
  const pool = new Pool({
    host: '127.0.0.1',
    port: 5432,
    database: 'open_brain',
    user: 'obsidian_brain',
    password: PG_PASSWORD,
    ssl: false, // localhost-only connection through VPN; SSL not applicable
  });

  const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
  const embeddingService = new EmbeddingService(openai);
  const dbClient = new DbClient(pool);
  const watcher = new VaultWatcher(VAULT_PATH!, embeddingService, dbClient);

  console.log(`[index-vault] Scanning vault at: ${VAULT_PATH}`);

  const files = await collectMarkdownFiles(VAULT_PATH!);
  const total = files.length;
  console.log(`[index-vault] Found ${total} markdown file(s)`);

  let indexed = 0;
  let failed = 0;

  for (let i = 0; i < files.length; i++) {
    const filePath = files[i]!;
    const progress = `[${i + 1}/${total}]`;

    // shouldProcess is a defensive guard; collectMarkdownFiles already filters,
    // but VaultWatcher may have additional rules (e.g. inside .obsidian subtrees
    // reached via symlinks).
    if (!watcher.shouldProcess(filePath)) {
      console.log(`${progress} Skipped (shouldProcess=false): ${filePath}`);
      continue;
    }

    let content: string;
    try {
      content = await readFile(filePath, 'utf-8');
    } catch (err) {
      console.error(`${progress} Failed to read ${filePath}:`, err);
      failed++;
      continue;
    }

    try {
      await watcher.handleFileChange(filePath, content);
      console.log(`${progress} Indexed: ${filePath}`);
      indexed++;
    } catch (err) {
      console.error(`${progress} Failed to index ${filePath}:`, err);
      failed++;
    }
  }

  // Teardown
  await pool.end();

  // Summary
  console.log('\n--- Index-vault summary ---');
  console.log(`  Total files found : ${total}`);
  console.log(`  Successfully indexed: ${indexed}`);
  console.log(`  Failed              : ${failed}`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[index-vault] Unexpected fatal error:', err);
  process.exit(1);
});
