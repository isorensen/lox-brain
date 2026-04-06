import { describe, it, expect, expectTypeOf } from 'vitest';
import type { NoteRow, SearchResult, RecentNote } from '../src/types.js';

describe('NoteRow type', () => {
  it('should accept created_by value in a concrete instance', () => {
    const note: NoteRow = {
      id: 'abc',
      file_path: 'test.md',
      title: 'Test',
      content: 'content',
      tags: [],
      embedding: [0.1],
      file_hash: 'hash',
      chunk_index: 0,
      created_by: 'eduardo',
    };
    expect(note.created_by).toBe('eduardo');
  });

  it('should allow created_by to be omitted (optional)', () => {
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
    expect(note.created_by).toBeUndefined();
  });

  it('should type created_by as string | undefined', () => {
    expectTypeOf<NoteRow>().toHaveProperty('created_by');
    expectTypeOf<NoteRow['created_by']>().toEqualTypeOf<string | undefined>();
  });
});

describe('SearchResult type', () => {
  it('should accept created_by value in a concrete instance', () => {
    const result: SearchResult = {
      id: 'abc',
      file_path: 'test.md',
      title: 'Test',
      content: 'content',
      tags: ['tag1'],
      similarity: 0.95,
      updated_at: new Date(),
      created_by: 'lara',
    };
    expect(result.created_by).toBe('lara');
  });

  it('should allow created_by to be omitted (optional)', () => {
    const result: SearchResult = {
      id: 'abc',
      file_path: 'test.md',
      title: 'Test',
      tags: [],
      similarity: 0.9,
      updated_at: new Date(),
    };
    expect(result.created_by).toBeUndefined();
  });

  it('should type created_by as string | undefined', () => {
    expectTypeOf<SearchResult>().toHaveProperty('created_by');
    expectTypeOf<SearchResult['created_by']>().toEqualTypeOf<string | undefined>();
  });
});

describe('RecentNote type', () => {
  it('should accept created_by value in a concrete instance', () => {
    const note: RecentNote = {
      id: 'abc',
      file_path: 'test.md',
      title: 'Test',
      content: 'content',
      tags: ['tag1'],
      updated_at: new Date(),
      created_by: 'eduardo',
    };
    expect(note.created_by).toBe('eduardo');
  });

  it('should allow created_by to be omitted (optional)', () => {
    const note: RecentNote = {
      id: 'abc',
      file_path: 'test.md',
      title: 'Test',
      tags: [],
      updated_at: new Date(),
    };
    expect(note.created_by).toBeUndefined();
  });

  it('should type created_by as string | undefined', () => {
    expectTypeOf<RecentNote>().toHaveProperty('created_by');
    expectTypeOf<RecentNote['created_by']>().toEqualTypeOf<string | undefined>();
  });
});
