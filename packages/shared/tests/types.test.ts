import { describe, it, expect, expectTypeOf } from 'vitest';
import type { NoteRow, SearchResult, RecentNote } from '../src/types.js';

describe('NoteRow type', () => {
  it('should have created_by as a defined key in the interface', () => {
    // Runtime check: create a note with created_by and verify the type allows it
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
  it('should have optional created_by field', () => {
    expectTypeOf<SearchResult>().toHaveProperty('created_by');
    expectTypeOf<SearchResult['created_by']>().toEqualTypeOf<string | undefined>();
  });
});

describe('RecentNote type', () => {
  it('should have optional created_by field', () => {
    expectTypeOf<RecentNote>().toHaveProperty('created_by');
    expectTypeOf<RecentNote['created_by']>().toEqualTypeOf<string | undefined>();
  });
});
