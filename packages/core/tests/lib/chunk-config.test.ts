import { describe, it, expect } from 'vitest';
import { getChunkConfig } from '../../src/lib/chunk-config.js';

describe('getChunkConfig', () => {
  it('Should keep the shipped defaults when no variable is set', () => {
    expect(getChunkConfig({})).toEqual({ maxTokens: 4000, overlapTokens: 200, embedTitle: true });
  });

  it('Should read the maximum size from LOX_CHUNK_MAX_TOKENS', () => {
    expect(getChunkConfig({ LOX_CHUNK_MAX_TOKENS: '500', LOX_CHUNK_OVERLAP_TOKENS: '50' })).toEqual({
      maxTokens: 500,
      overlapTokens: 50,
      embedTitle: true,
    });
  });

  it('Should shrink the default overlap to a fifth of a small maximum size', () => {
    expect(getChunkConfig({ LOX_CHUNK_MAX_TOKENS: '150' })).toEqual({ maxTokens: 150, overlapTokens: 30, embedTitle: true });
  });

  it('Should keep the default overlap when the maximum size leaves room for it', () => {
    expect(getChunkConfig({ LOX_CHUNK_MAX_TOKENS: '2000' })).toEqual({ maxTokens: 2000, overlapTokens: 200, embedTitle: true });
  });

  it('Should ignore an empty variable', () => {
    expect(getChunkConfig({ LOX_CHUNK_MAX_TOKENS: '' })).toEqual({ maxTokens: 4000, overlapTokens: 200, embedTitle: true });
  });

  it.each(['abc', '0', '-5', '12.5'])('Should reject LOX_CHUNK_MAX_TOKENS="%s" naming the variable', (value) => {
    expect(() => getChunkConfig({ LOX_CHUNK_MAX_TOKENS: value })).toThrow(/LOX_CHUNK_MAX_TOKENS must be an integer of at least 1/);
  });

  it('Should reject an overlap that is not smaller than the maximum size', () => {
    expect(() => getChunkConfig({ LOX_CHUNK_MAX_TOKENS: '300', LOX_CHUNK_OVERLAP_TOKENS: '300' })).toThrow(
      /LOX_CHUNK_OVERLAP_TOKENS \(300\) must be smaller than LOX_CHUNK_MAX_TOKENS \(300\)/,
    );
  });

  it('Should accept an explicit overlap of zero', () => {
    expect(getChunkConfig({ LOX_CHUNK_MAX_TOKENS: '500', LOX_CHUNK_OVERLAP_TOKENS: '0' })).toEqual({
      maxTokens: 500,
      overlapTokens: 0,
      embedTitle: true,
    });
  });

  it('Should reject a negative overlap naming the variable', () => {
    expect(() => getChunkConfig({ LOX_CHUNK_OVERLAP_TOKENS: '-1' })).toThrow(
      /LOX_CHUNK_OVERLAP_TOKENS must be an integer of at least 0/,
    );
  });

  it('Should reject a maximum above what one embedding request can carry', () => {
    expect(() => getChunkConfig({ LOX_CHUNK_MAX_TOKENS: '6001' })).toThrow(
      /LOX_CHUNK_MAX_TOKENS \(6001\) must not exceed 6000/,
    );
  });

  it.each([['false', false], ['0', false], ['no', false], ['true', true], ['1', true], [' FALSE ', false]])(
    'Should read LOX_EMBED_TITLE="%s" as %s',
    (value, expected) => {
      expect(getChunkConfig({ LOX_EMBED_TITLE: value }).embedTitle).toBe(expected);
    },
  );

  it('Should reject an unrecognised LOX_EMBED_TITLE naming the variable', () => {
    expect(() => getChunkConfig({ LOX_EMBED_TITLE: 'maybe' })).toThrow(/LOX_EMBED_TITLE must be true or false, got "maybe"/);
  });
});
