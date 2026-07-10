import { describe, it, expect } from 'vitest';
import type { IncomingHttpHeaders } from 'node:http';
import { resolveTrustedActor } from '../../src/mcp/trusted-proxy.js';

describe('resolveTrustedActor', () => {
  const SECRET = 'super-secret-shared-value';

  it('returns the actor when the secret matches', () => {
    const headers: IncomingHttpHeaders = {
      'x-lox-proxy-secret': SECRET,
      'x-lox-actor': 'Alice',
    };
    expect(resolveTrustedActor(headers, SECRET)).toBe('Alice');
  });

  it('returns null when the secret is wrong (same length)', () => {
    const headers: IncomingHttpHeaders = {
      'x-lox-proxy-secret': 'super-secret-shared-WRONG',
      'x-lox-actor': 'Alice',
    };
    expect(resolveTrustedActor(headers, SECRET)).toBeNull();
  });

  it('returns null when the secret is wrong (different length, no throw)', () => {
    const headers: IncomingHttpHeaders = {
      'x-lox-proxy-secret': 'short',
      'x-lox-actor': 'Alice',
    };
    expect(resolveTrustedActor(headers, SECRET)).toBeNull();
  });

  it('returns null when the secret header is absent', () => {
    const headers: IncomingHttpHeaders = { 'x-lox-actor': 'Alice' };
    expect(resolveTrustedActor(headers, SECRET)).toBeNull();
  });

  it('returns null when the actor header is absent', () => {
    const headers: IncomingHttpHeaders = { 'x-lox-proxy-secret': SECRET };
    expect(resolveTrustedActor(headers, SECRET)).toBeNull();
  });

  it('returns null when the actor header is blank', () => {
    const headers: IncomingHttpHeaders = {
      'x-lox-proxy-secret': SECRET,
      'x-lox-actor': '   ',
    };
    expect(resolveTrustedActor(headers, SECRET)).toBeNull();
  });

  it('returns null when no expected secret is configured (empty string)', () => {
    const headers: IncomingHttpHeaders = {
      'x-lox-proxy-secret': '',
      'x-lox-actor': 'Alice',
    };
    expect(resolveTrustedActor(headers, '')).toBeNull();
  });

  it('returns null when no expected secret is configured (undefined)', () => {
    const headers: IncomingHttpHeaders = {
      'x-lox-proxy-secret': 'anything',
      'x-lox-actor': 'Alice',
    };
    expect(resolveTrustedActor(headers, undefined)).toBeNull();
  });

  it('returns null when the secret arrives as a duplicated (array) header', () => {
    const headers: IncomingHttpHeaders = {
      'x-lox-proxy-secret': [SECRET, SECRET],
      'x-lox-actor': 'Alice',
    };
    expect(resolveTrustedActor(headers, SECRET)).toBeNull();
  });

  it('returns null when the actor arrives as a duplicated (array) header', () => {
    const headers: IncomingHttpHeaders = {
      'x-lox-proxy-secret': SECRET,
      'x-lox-actor': ['Alice', 'Bob'],
    };
    expect(resolveTrustedActor(headers, SECRET)).toBeNull();
  });

  it('returns null when the actor name exceeds the length cap', () => {
    const headers: IncomingHttpHeaders = {
      'x-lox-proxy-secret': SECRET,
      'x-lox-actor': 'A'.repeat(201),
    };
    expect(resolveTrustedActor(headers, SECRET)).toBeNull();
  });

  it('accepts an actor name at the length cap', () => {
    const headers: IncomingHttpHeaders = {
      'x-lox-proxy-secret': SECRET,
      'x-lox-actor': 'A'.repeat(200),
    };
    expect(resolveTrustedActor(headers, SECRET)).toBe('A'.repeat(200));
  });

  it('trims surrounding whitespace from the resolved actor', () => {
    const headers: IncomingHttpHeaders = {
      'x-lox-proxy-secret': SECRET,
      'x-lox-actor': '  Bob Silva  ',
    };
    expect(resolveTrustedActor(headers, SECRET)).toBe('Bob Silva');
  });
});
