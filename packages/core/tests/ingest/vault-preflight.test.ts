import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, chmod, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertVaultWritable } from '../../src/scripts/ingest-calendar.js';
import type { IngestConfig } from '../../src/ingest/types.js';

const base: Omit<IngestConfig, 'vaultPath'> = {
  impersonateSubject: 'capture@example.com',
  serviceAccount: 'ingest@example.iam.gserviceaccount.com',
  notesFolder: 'Meeting Notes',
  organizerAllowlist: [],
  noteAttachmentPatterns: ['notes by gemini'],
  calendars: [],
};

describe('assertVaultWritable', () => {
  let vault: string;

  beforeEach(async () => {
    vault = await mkdtemp(join(tmpdir(), 'lox-ingest-'));
  });

  afterEach(async () => {
    await chmod(join(vault, base.notesFolder), 0o755).catch(() => {});
    await rm(vault, { recursive: true, force: true });
  });

  it('creates the notes folder on a first run and leaves no probe file behind', async () => {
    await assertVaultWritable({ ...base, vaultPath: vault });
    expect(await readdir(join(vault, base.notesFolder))).toEqual([]);
  });

  it('passes on a second run, when the folder already exists', async () => {
    await assertVaultWritable({ ...base, vaultPath: vault });
    await expect(assertVaultWritable({ ...base, vaultPath: vault })).resolves.toBeUndefined();
  });

  it('reports the path instead of creating a vault that is not there', async () => {
    const missing = join(vault, 'not-mounted');
    await expect(assertVaultWritable({ ...base, vaultPath: missing })).rejects.toThrow(missing);
    expect(await readdir(vault)).toEqual([]);
  });

  // chmod does not restrict the owner on Windows, where CI also runs the suite.
  it.skipIf(process.platform === 'win32')(
    'fails when the notes folder exists but cannot be written to',
    async () => {
      const folder = join(vault, base.notesFolder);
      await mkdir(folder);
      await chmod(folder, 0o555);
      await expect(assertVaultWritable({ ...base, vaultPath: vault })).rejects.toThrow(folder);
    },
  );
});
