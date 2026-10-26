import { CHUNK_MAX_TOKENS, CHUNK_OVERLAP_TOKENS } from '@lox-brain/shared';

export interface ChunkConfig {
  maxTokens: number;
  overlapTokens: number;
  embedTitle: boolean;
}

const MAX_TO_OVERLAP_RATIO = 5;
const MAX_ALLOWED_CHUNK_TOKENS = 6000;
const TRUE_VALUES = new Set(['true', '1', 'yes']);
const FALSE_VALUES = new Set(['false', '0', 'no']);

function parseInteger(name: string, raw: string, minimum: number): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer of at least ${minimum}, got "${raw}"`);
  }
  return value;
}

function parseBoolean(name: string, raw: string): boolean {
  const normalized = raw.trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  throw new Error(`${name} must be true or false, got "${raw}"`);
}

function defaultOverlapFor(maxTokens: number): number {
  return Math.min(CHUNK_OVERLAP_TOKENS, Math.floor(maxTokens / MAX_TO_OVERLAP_RATIO));
}

export function getChunkConfig(env: NodeJS.ProcessEnv = process.env): ChunkConfig {
  const rawMax = env.LOX_CHUNK_MAX_TOKENS;
  const rawOverlap = env.LOX_CHUNK_OVERLAP_TOKENS;
  const rawEmbedTitle = env.LOX_EMBED_TITLE;
  const maxTokens = rawMax ? parseInteger('LOX_CHUNK_MAX_TOKENS', rawMax, 1) : CHUNK_MAX_TOKENS;
  const overlapTokens = rawOverlap
    ? parseInteger('LOX_CHUNK_OVERLAP_TOKENS', rawOverlap, 0)
    : defaultOverlapFor(maxTokens);

  if (maxTokens > MAX_ALLOWED_CHUNK_TOKENS) {
    throw new Error(`LOX_CHUNK_MAX_TOKENS (${maxTokens}) must not exceed ${MAX_ALLOWED_CHUNK_TOKENS}`);
  }

  if (overlapTokens >= maxTokens) {
    throw new Error(
      `LOX_CHUNK_OVERLAP_TOKENS (${overlapTokens}) must be smaller than LOX_CHUNK_MAX_TOKENS (${maxTokens})`,
    );
  }
  const embedTitle = rawEmbedTitle ? parseBoolean('LOX_EMBED_TITLE', rawEmbedTitle) : true;
  return { maxTokens, overlapTokens, embedTitle };
}
