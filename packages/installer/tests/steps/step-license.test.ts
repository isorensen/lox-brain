import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { InstallerContext } from '../../src/steps/types.js';

vi.mock('@inquirer/prompts', () => ({ password: vi.fn() }));

describe('stepLicense', () => {
  let privateKey: string;
  let publicKey: string;

  beforeAll(() => {
    const pair = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    privateKey = pair.privateKey;
    publicKey = pair.publicKey;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should skip if mode is personal', async () => {
    const { stepLicense } = await import('../../src/steps/step-license.js');
    const ctx: InstallerContext = { config: { mode: 'personal' }, locale: 'en' };
    const result = await stepLicense(ctx, publicKey);
    expect(result.success).toBe(true);
    expect(result.message).toContain('skip');
  });

  it('should validate and store license key for team mode', async () => {
    const { password } = await import('@inquirer/prompts');
    const token = jwt.sign(
      { org: 'credifit', max_peers: 10, expires: '2027-04-03', issued_by: 'isorensen' },
      privateKey,
      { algorithm: 'RS256', expiresIn: '365d' },
    );
    (password as any).mockResolvedValue(token);

    const { stepLicense } = await import('../../src/steps/step-license.js');
    const ctx: InstallerContext = { config: { mode: 'team' }, locale: 'en' };
    const result = await stepLicense(ctx, publicKey);

    expect(result.success).toBe(true);
    expect(ctx.config.license_key).toBe(token);
  });

  it('should return failure for invalid license key', async () => {
    const { password } = await import('@inquirer/prompts');
    (password as any).mockResolvedValue('invalid-token');

    const { stepLicense } = await import('../../src/steps/step-license.js');
    const ctx: InstallerContext = { config: { mode: 'team' }, locale: 'en' };
    const result = await stepLicense(ctx, publicKey);

    expect(result.success).toBe(false);
  });
});
