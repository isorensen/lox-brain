import { describe, it, expect, vi } from 'vitest';
import { createTokenResolver } from '../../src/ingest/token-resolver.js';
import type { IngestConfig, NormalizedEvent } from '../../src/ingest/types.js';

const config = {
  impersonateSubject: 'capture@example.com',
  organizerAllowlist: ['owner@example.com'],
} as IngestConfig;

const event = { organizerEmail: 'owner@example.com' } as NormalizedEvent;

describe('subjectsFor', () => {
  it('tries the capture account first', () => {
    const r = createTokenResolver(config, vi.fn());
    expect(r.subjectsFor(event)[0]).toBe('capture@example.com');
  });

  it('falls back to the organizer when allowlisted', () => {
    const r = createTokenResolver(config, vi.fn());
    expect(r.subjectsFor(event)).toEqual(['capture@example.com', 'owner@example.com']);
  });

  it('omits an organizer that is not allowlisted', () => {
    const r = createTokenResolver(config, vi.fn());
    const stranger = { organizerEmail: 'stranger@example.com' } as NormalizedEvent;
    expect(r.subjectsFor(stranger)).toEqual(['capture@example.com']);
  });

  it('omits an event with no organizer', () => {
    const r = createTokenResolver(config, vi.fn());
    const orphan = { organizerEmail: '' } as NormalizedEvent;
    expect(r.subjectsFor(orphan)).toEqual(['capture@example.com']);
  });

  it('does not duplicate when the organizer is the capture account', () => {
    const r = createTokenResolver(config, vi.fn());
    const self = { organizerEmail: 'capture@example.com' } as NormalizedEvent;
    expect(r.subjectsFor(self)).toEqual(['capture@example.com']);
  });
});

describe('tokenFor', () => {
  it('mints once per subject and caches', async () => {
    const mint = vi.fn().mockResolvedValue('tok');
    const r = createTokenResolver(config, mint);
    await r.tokenFor('capture@example.com');
    await r.tokenFor('capture@example.com');
    expect(mint).toHaveBeenCalledTimes(1);
  });

  it('mints separately for different subjects', async () => {
    const mint = vi.fn().mockResolvedValue('tok');
    const r = createTokenResolver(config, mint);
    await r.tokenFor('a@example.com');
    await r.tokenFor('b@example.com');
    expect(mint).toHaveBeenCalledTimes(2);
  });
});
