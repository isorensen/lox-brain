import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// __dirname at runtime is dist/ (compiled output), so go up one level to package root
const pkgPath = resolve(__dirname, '..', 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version: string };

export const LOX_VERSION = pkg.version;

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
