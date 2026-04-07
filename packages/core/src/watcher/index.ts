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
  // Ensure schema is up-to-date (adds columns introduced after initial setup).
  await dbClient.ensureSchema();
  console.log('Schema migration check complete');

  // chokidar v5 is ESM-only; dynamic import is required from CommonJS modules.
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
