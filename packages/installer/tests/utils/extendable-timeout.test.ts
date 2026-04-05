import { describe, it, expect, vi } from 'vitest';
import { isTimeoutError, withExtendableTimeout } from '../../src/utils/extendable-timeout.js';

describe('isTimeoutError', () => {
  it('matches Error.message containing "timed out"', () => {
    expect(isTimeoutError(new Error('Command timed out after 30000ms: winget'))).toBe(true);
  });

  it('matches Error.message containing SIGTERM', () => {
    expect(isTimeoutError(new Error('Process killed by SIGTERM'))).toBe(true);
  });

  it('matches objects with killed === true', () => {
    expect(isTimeoutError({ killed: true })).toBe(true);
  });

  it('matches Errors with killed === true', () => {
    const err = Object.assign(new Error('boom'), { killed: true });
    expect(isTimeoutError(err)).toBe(true);
  });

  it('returns false for unrelated errors', () => {
    expect(isTimeoutError(new Error('ENOENT'))).toBe(false);
    expect(isTimeoutError(new Error(''))).toBe(false);
    expect(isTimeoutError(null)).toBe(false);
    expect(isTimeoutError(undefined)).toBe(false);
    expect(isTimeoutError('timed out')).toBe(false);
    expect(isTimeoutError({ killed: false })).toBe(false);
  });
});

describe('withExtendableTimeout', () => {
  it('returns fn result on first success without prompting', async () => {
    const confirmFn = vi.fn(async () => true);
    const result = await withExtendableTimeout(
      async (_t) => 'ok',
      {
        label: 'test',
        initialTimeout: 1000,
        maxTimeout: 2000,
        promptMessage: 'retry?',
        confirmFn,
      },
    );
    expect(result).toBe('ok');
    expect(confirmFn).not.toHaveBeenCalled();
  });

  it('retries with maxTimeout when user confirms after a timeout', async () => {
    const timeouts: number[] = [];
    let calls = 0;
    const confirmFn = vi.fn(async () => true);

    const result = await withExtendableTimeout(
      async (timeout) => {
        timeouts.push(timeout);
        calls++;
        if (calls === 1) {
          throw new Error('Command timed out after 1000ms: winget');
        }
        return 'done';
      },
      {
        label: 'Obsidian install',
        initialTimeout: 1000,
        maxTimeout: 5000,
        promptMessage: 'keep waiting?',
        confirmFn,
      },
    );

    expect(result).toBe('done');
    expect(timeouts).toEqual([1000, 5000]);
    expect(confirmFn).toHaveBeenCalledWith('Obsidian install: keep waiting?');
    expect(confirmFn).toHaveBeenCalledTimes(1);
  });

  it('throws when user declines to extend', async () => {
    const confirmFn = vi.fn(async () => false);
    await expect(
      withExtendableTimeout(
        async () => { throw new Error('Command timed out after 1000ms: brew'); },
        {
          label: 'brew install',
          initialTimeout: 1000,
          maxTimeout: 5000,
          promptMessage: 'keep waiting?',
          confirmFn,
        },
      ),
    ).rejects.toThrow('timed out');
    expect(confirmFn).toHaveBeenCalledTimes(1);
  });

  it('does not retry and rethrows on non-timeout errors', async () => {
    const confirmFn = vi.fn(async () => true);
    await expect(
      withExtendableTimeout(
        async () => { throw new Error('Command not found: winget'); },
        {
          label: 'winget',
          initialTimeout: 1000,
          maxTimeout: 5000,
          promptMessage: 'keep waiting?',
          confirmFn,
        },
      ),
    ).rejects.toThrow('Command not found');
    expect(confirmFn).not.toHaveBeenCalled();
  });

  it('does not retry when already at maxTimeout', async () => {
    const confirmFn = vi.fn(async () => true);
    await expect(
      withExtendableTimeout(
        async () => { throw new Error('Command timed out after 5000ms: winget'); },
        {
          label: 'winget',
          initialTimeout: 5000,
          maxTimeout: 5000,
          promptMessage: 'keep waiting?',
          confirmFn,
        },
      ),
    ).rejects.toThrow('timed out');
    expect(confirmFn).not.toHaveBeenCalled();
  });

  it('only retries once — a second timeout on the extended attempt rethrows', async () => {
    const confirmFn = vi.fn(async () => true);
    let calls = 0;
    await expect(
      withExtendableTimeout(
        async () => {
          calls++;
          throw new Error('Command timed out after 5000ms: winget');
        },
        {
          label: 'winget',
          initialTimeout: 1000,
          maxTimeout: 5000,
          promptMessage: 'keep waiting?',
          confirmFn,
        },
      ),
    ).rejects.toThrow('timed out');
    expect(calls).toBe(2);
    expect(confirmFn).toHaveBeenCalledTimes(1);
  });
});
