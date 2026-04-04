import { describe, it, expect } from 'vitest';
import { formatFatalError } from '../../src/utils/format-error.js';

describe('formatFatalError', () => {
  it('returns first 5 lines of stack for Error with stack', () => {
    const err = new Error('boom');
    // Synthetic stack with many lines
    err.stack = [
      'Error: boom',
      '    at frame1 (file.ts:1:1)',
      '    at frame2 (file.ts:2:1)',
      '    at frame3 (file.ts:3:1)',
      '    at frame4 (file.ts:4:1)',
      '    at frame5 (file.ts:5:1)',
      '    at frame6 (file.ts:6:1)',
    ].join('\n');

    const result = formatFatalError(err);
    const lines = result.split('\n');
    expect(lines).toHaveLength(5);
    expect(lines[0]).toBe('Error: boom');
    expect(lines[4]).toBe('    at frame4 (file.ts:4:1)');
    expect(result).not.toContain('frame5');
    expect(result).not.toContain('frame6');
  });

  it('returns full stack when it has fewer than 5 lines', () => {
    const err = new Error('short');
    err.stack = 'Error: short\n    at frame1 (file.ts:1:1)';
    expect(formatFatalError(err)).toBe('Error: short\n    at frame1 (file.ts:1:1)');
  });

  it('returns err.message when Error has no stack', () => {
    const err = new Error('no stack');
    err.stack = undefined;
    expect(formatFatalError(err)).toBe('no stack');
  });

  it('returns String(err) for non-Error values', () => {
    expect(formatFatalError('string thrown')).toBe('string thrown');
    expect(formatFatalError(42)).toBe('42');
    expect(formatFatalError(null)).toBe('null');
    expect(formatFatalError(undefined)).toBe('undefined');
    expect(formatFatalError({ foo: 'bar' })).toBe('[object Object]');
  });

  it('handles real Error stacks (no mock)', () => {
    let caught: unknown;
    try {
      throw new Error('real error');
    } catch (e) {
      caught = e;
    }
    const result = formatFatalError(caught);
    expect(result).toContain('Error: real error');
    expect(result.split('\n').length).toBeLessThanOrEqual(5);
  });
});
