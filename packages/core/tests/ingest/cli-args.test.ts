import { describe, it, expect } from 'vitest';
import { parseArgs } from '../../src/scripts/ingest-calendar.js';

describe('parseArgs', () => {
  it('reads an explicit window', () => {
    const a = parseArgs(['--from', '2025-06-01', '--to', '2026-08-07']);
    expect(a).toMatchObject({ from: '2025-06-01', to: '2026-08-07', dryRun: false });
  });

  it('honours --dry-run', () => {
    expect(parseArgs(['--from', '2026-01-01', '--to', '2026-01-02', '--dry-run']).dryRun).toBe(true);
  });

  it('expands --since into a window ending tomorrow', () => {
    const a = parseArgs(['--since', '2026-08-01']);
    expect(a.from).toBe('2026-08-01');
    expect(a.to > a.from).toBe(true);
  });

  it('rejects a window with no dates', () => {
    expect(() => parseArgs([])).toThrow(/--from|--since/);
  });

  it('rejects an inverted window', () => {
    expect(() => parseArgs(['--from', '2026-08-07', '--to', '2026-01-01'])).toThrow(/before/i);
  });

  it('lets --from win over --since', () => {
    const a = parseArgs(['--since', '2026-01-01', '--from', '2026-02-01', '--to', '2026-03-01']);
    expect(a.from).toBe('2026-02-01');
  });

  it('honours an explicit --to given with --since', () => {
    expect(parseArgs(['--since', '2026-01-01', '--to', '2026-01-05']).to).toBe('2026-01-05');
  });

  it('rejects a flag left without a value', () => {
    expect(() => parseArgs(['--from'])).toThrow(/--from|--since/);
  });

  it('rejects an empty window', () => {
    expect(() => parseArgs(['--from', '2026-08-07', '--to', '2026-08-07'])).toThrow(/before/i);
  });

  it('rejects a date that is not YYYY-MM-DD', () => {
    expect(() => parseArgs(['--from', 'yesterday', '--to', '2026-08-07'])).toThrow(/YYYY-MM-DD/);
    expect(() => parseArgs(['--from', '2026-8-1', '--to', '2026-08-07'])).toThrow(/YYYY-MM-DD/);
    expect(() => parseArgs(['--from', '2026-08-01', '--to', 'tomorrow'])).toThrow(/YYYY-MM-DD/);
  });
});
