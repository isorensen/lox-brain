import { describe, it, expect, vi, beforeAll } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { registerTeamFeatures } from '../src/index.js';
import type { LoxConfig } from '@lox-brain/shared';

describe('registerTeamFeatures', () => {
  let publicKey: string;
  let privateKey: string;

  beforeAll(() => {
    const pair = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    publicKey = pair.publicKey;
    privateKey = pair.privateKey;
  });

  function makeConfig(overrides: Partial<LoxConfig> = {}): LoxConfig {
    return {
      version: '0.1.0',
      mode: 'team',
      gcp: { project: 'test', region: 'us', zone: 'us-a', vm_name: 'vm', service_account: 'sa' },
      database: { host: '127.0.0.1', port: 5432, name: 'lox_brain', user: 'lox' },
      vpn: {
        server_ip: '10.10.0.1',
        subnet: '10.10.0.0/24',
        listen_port: 51820,
        peers: [{ name: 'eduardo', ip: '10.10.0.2', public_key: 'k1', added_at: '2026-04-03' }],
      },
      vault: { repo: 'repo', local_path: '/vault', preset: 'zettelkasten' },
      install_dir: '/opt/lox',
      installed_at: '2026-04-03',
      ...overrides,
    } as LoxConfig;
  }

  it('should return success:false when mode is personal', async () => {
    const config = makeConfig({ mode: 'personal' });
    const result = await registerTeamFeatures({} as any, config, [], publicKey);
    expect(result.success).toBe(false);
    expect(result.error).toContain('personal');
  });

  it('should return success:false when license key is missing', async () => {
    const config = makeConfig();
    const result = await registerTeamFeatures({} as any, config, [], publicKey);
    expect(result.success).toBe(false);
    expect(result.error).toContain('license');
  });

  it('should return success:false when license key is invalid', async () => {
    const config = makeConfig();
    (config as any).license_key = 'invalid-token';
    const result = await registerTeamFeatures({} as any, config, [], publicKey);
    expect(result.success).toBe(false);
    expect(result.error).toContain('license');
  });

  it('should return success:true with valid license and team mode', async () => {
    const token = jwt.sign(
      { org: 'credifit', max_peers: 10, expires: '2027-04-03', issued_by: 'isorensen' },
      privateKey,
      { algorithm: 'RS256', expiresIn: '365d' },
    );
    const config = makeConfig();
    (config as any).license_key = token;

    const mockTool = { name: 'write_note', description: 'Write', inputSchema: {}, handler: vi.fn() };
    const result = await registerTeamFeatures({} as any, config, [mockTool], publicKey);

    expect(result.success).toBe(true);
    expect(result.org).toBe('credifit');
    expect(result.peersRegistered).toBe(1);
  });

  it('should return wrapped tools and team tools', async () => {
    const token = jwt.sign(
      { org: 'credifit', max_peers: 10, expires: '2027-04-03', issued_by: 'isorensen' },
      privateKey,
      { algorithm: 'RS256', expiresIn: '365d' },
    );
    const config = makeConfig();
    (config as any).license_key = token;

    const mockTool = { name: 'write_note', description: 'Write', inputSchema: {}, handler: vi.fn() };
    const mockDbClient = { listRecent: vi.fn(), searchByAuthor: vi.fn() } as any;

    const result = await registerTeamFeatures({} as any, config, [mockTool], publicKey, {
      dbClient: mockDbClient,
    });

    expect(result.tools).toBeDefined();
    const toolNames = result.tools!.map(t => t.name);
    expect(toolNames).toContain('write_note');
    expect(toolNames).toContain('list_team_activity');
    expect(toolNames).toContain('search_by_author');
  });
});
