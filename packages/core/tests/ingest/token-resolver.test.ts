import { describe, it, expect, vi } from 'vitest';
import { createTokenResolver } from '../../src/ingest/token-resolver.js';
import type { IngestConfig, NormalizedEvent } from '../../src/ingest/types.js';

const config = {
  impersonateSubject: 'capture@example.com',
  organizerAllowlist: ['owner@example.com', 'creator@example.com'],
} as IngestConfig;

const event = { organizerEmail: 'owner@example.com', creatorEmail: '' } as NormalizedEvent;

/** A team ceremony calendar: `organizer` is the calendar itself, the human is `creator`. */
const GROUP_CALENDAR = 'c_abc123@group.calendar.google.com';

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
    const stranger = { organizerEmail: 'stranger@example.com', creatorEmail: '' } as NormalizedEvent;
    expect(r.subjectsFor(stranger)).toEqual(['capture@example.com']);
  });

  it('normalizes the casing an allowlisted organizer arrived with', () => {
    const r = createTokenResolver(config, vi.fn());
    const shouty = { organizerEmail: 'Owner@Example.com', creatorEmail: '' } as NormalizedEvent;
    expect(r.subjectsFor(shouty)).toEqual(['capture@example.com', 'owner@example.com']);
  });

  it('omits an event with no organizer', () => {
    const r = createTokenResolver(config, vi.fn());
    const orphan = { organizerEmail: '', creatorEmail: '' } as NormalizedEvent;
    expect(r.subjectsFor(orphan)).toEqual(['capture@example.com']);
  });

  it('does not duplicate when the organizer is the capture account', () => {
    const r = createTokenResolver(config, vi.fn());
    const self = { organizerEmail: 'capture@example.com', creatorEmail: '' } as NormalizedEvent;
    expect(r.subjectsFor(self)).toEqual(['capture@example.com']);
  });

  it('falls back to the creator when the organizer is the group calendar itself', () => {
    const r = createTokenResolver(config, vi.fn());
    const ceremony = {
      organizerEmail: GROUP_CALENDAR,
      creatorEmail: 'creator@example.com',
    } as NormalizedEvent;
    const subjects = r.subjectsFor(ceremony);
    expect(subjects).toEqual(['capture@example.com', 'creator@example.com']);
    expect(subjects).not.toContain(GROUP_CALENDAR);
  });

  it('tries the creator before the organizer when both are allowlisted', () => {
    const r = createTokenResolver(config, vi.fn());
    const both = {
      organizerEmail: 'owner@example.com',
      creatorEmail: 'creator@example.com',
    } as NormalizedEvent;
    expect(r.subjectsFor(both)).toEqual([
      'capture@example.com',
      'creator@example.com',
      'owner@example.com',
    ]);
  });

  it('adds an allowlisted identity once when the creator is also the organizer', () => {
    const r = createTokenResolver(config, vi.fn());
    const personal = {
      organizerEmail: 'owner@example.com',
      creatorEmail: 'owner@example.com',
    } as NormalizedEvent;
    expect(r.subjectsFor(personal)).toEqual(['capture@example.com', 'owner@example.com']);
  });

  it('does not duplicate when the creator is the capture account', () => {
    const r = createTokenResolver(config, vi.fn());
    const own = {
      organizerEmail: GROUP_CALENDAR,
      creatorEmail: 'capture@example.com',
    } as NormalizedEvent;
    expect(r.subjectsFor(own)).toEqual(['capture@example.com']);
  });

  it('omits an organizer that is not allowlisted even when the creator is', () => {
    const r = createTokenResolver(config, vi.fn());
    const mixed = {
      organizerEmail: 'stranger@example.com',
      creatorEmail: 'creator@example.com',
    } as NormalizedEvent;
    expect(r.subjectsFor(mixed)).toEqual(['capture@example.com', 'creator@example.com']);
  });

  it('omits both when neither the creator nor the organizer is allowlisted', () => {
    const r = createTokenResolver(config, vi.fn());
    const strangers = {
      organizerEmail: GROUP_CALENDAR,
      creatorEmail: 'stranger@example.com',
    } as NormalizedEvent;
    expect(r.subjectsFor(strangers)).toEqual(['capture@example.com']);
  });

  it('falls through to the organizer when the creator is empty', () => {
    const r = createTokenResolver(config, vi.fn());
    const noCreator = { organizerEmail: 'owner@example.com', creatorEmail: '' } as NormalizedEvent;
    expect(r.subjectsFor(noCreator)).toEqual(['capture@example.com', 'owner@example.com']);
  });

  it('normalizes the casing an allowlisted creator arrived with', () => {
    const r = createTokenResolver(config, vi.fn());
    const shouty = {
      organizerEmail: GROUP_CALENDAR,
      creatorEmail: 'Creator@Example.com',
    } as NormalizedEvent;
    expect(r.subjectsFor(shouty)).toEqual(['capture@example.com', 'creator@example.com']);
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

  it('retries a subject whose mint failed instead of caching the rejection', async () => {
    const mint = vi
      .fn()
      .mockRejectedValueOnce(new Error('transient network failure'))
      .mockResolvedValue('tok');
    const r = createTokenResolver(config, mint);

    await expect(r.tokenFor('owner@example.com')).rejects.toThrow('transient network failure');
    await expect(r.tokenFor('owner@example.com')).resolves.toBe('tok');
    expect(mint).toHaveBeenCalledTimes(2);
  });

  it('mints separately for different subjects', async () => {
    const mint = vi.fn().mockResolvedValue('tok');
    const r = createTokenResolver(config, mint);
    await r.tokenFor('a@example.com');
    await r.tokenFor('b@example.com');
    expect(mint).toHaveBeenCalledTimes(2);
  });
});
