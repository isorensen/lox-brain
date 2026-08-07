import { describe, it, expect } from 'vitest';
import {
  needsResize,
  parseLists,
  probesFor,
  quoteIdent,
  rewriteLists,
  setProbesSql,
  targetLists,
} from '../../src/lib/ivfflat.js';

describe('targetLists', () => {
  it('returns 1 for an empty or small table', () => {
    expect(targetLists(0)).toBe(1);
    expect(targetLists(812)).toBe(1);
  });

  it('follows the rows/1000 rule', () => {
    expect(targetLists(1500)).toBe(2);
    expect(targetLists(50_000)).toBe(50);
    expect(targetLists(1_000_000)).toBe(1000);
  });

  it('clamps to pgvector\'s maximum', () => {
    expect(targetLists(10_000_000_000)).toBe(32768);
  });
});

describe('probesFor', () => {
  it('is ceil(sqrt(lists))', () => {
    expect(probesFor(1)).toBe(1);
    expect(probesFor(2)).toBe(2);
    expect(probesFor(100)).toBe(10);
    expect(probesFor(101)).toBe(11);
  });
});

describe('needsResize', () => {
  it('is false inside the hysteresis band', () => {
    expect(needsResize(1, 1)).toBe(false);
    expect(needsResize(100, 51)).toBe(false);
    expect(needsResize(50, 99)).toBe(false);
  });

  it('is true once the two diverge by a factor of two', () => {
    expect(needsResize(100, 1)).toBe(true);
    expect(needsResize(100, 50)).toBe(true);
    expect(needsResize(1, 2)).toBe(true);
  });
});

describe('parseLists', () => {
  it('reads the lists reloption out of an indexdef', () => {
    expect(parseLists(
      "CREATE INDEX i ON public.vault_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists='100')",
    )).toBe(100);
    expect(parseLists('CREATE INDEX i ON t USING ivfflat (embedding) WITH (lists = 7)')).toBe(7);
  });

  it('falls back to pgvector\'s default when the option is absent', () => {
    expect(parseLists('CREATE INDEX i ON t USING ivfflat (embedding vector_cosine_ops)')).toBe(100);
  });
});

describe('rewriteLists', () => {
  it('replaces an existing lists reloption', () => {
    const def = "CREATE INDEX i ON public.vault_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists='100')";
    expect(rewriteLists(def, 1)).toBe(
      'CREATE INDEX i ON public.vault_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 1)',
    );
  });

  it('appends the reloption when the index was created with defaults', () => {
    const def = 'CREATE INDEX i ON t USING ivfflat (embedding vector_cosine_ops)';
    expect(rewriteLists(def, 4)).toBe(`${def} WITH (lists = 4)`);
  });

  it('preserves the original opclass and column list', () => {
    const def = "CREATE INDEX i ON t USING ivfflat (embedding vector_l2_ops) WITH (lists='100')";
    expect(rewriteLists(def, 3)).toContain('vector_l2_ops');
  });
});

describe('quoteIdent', () => {
  it('double-quotes and escapes embedded quotes', () => {
    expect(quoteIdent('idx_embedding')).toBe('"idx_embedding"');
    expect(quoteIdent('we"ird')).toBe('"we""ird"');
  });
});

describe('setProbesSql', () => {
  it('sets the database-wide default', () => {
    expect(setProbesSql('lox_brain', 7)).toBe('ALTER DATABASE "lox_brain" SET ivfflat.probes = 7');
  });

  it('quotes the database name as an identifier', () => {
    expect(setProbesSql('we"ird db', 1)).toBe('ALTER DATABASE "we""ird db" SET ivfflat.probes = 1');
  });

  it('never emits a fractional probes value into the DDL', () => {
    expect(setProbesSql('db', 2.9)).toBe('ALTER DATABASE "db" SET ivfflat.probes = 2');
  });
});
