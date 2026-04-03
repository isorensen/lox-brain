import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Pool } from 'pg';

vi.mock('pg', () => {
  const MockPool = vi.fn();
  return { Pool: MockPool };
});

// Must re-import after mock setup so the mock is used
vi.mock('@lox-brain/shared', async () => {
  const actual = await vi.importActual<typeof import('@lox-brain/shared')>('@lox-brain/shared');
  return actual;
});

describe('createPool', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.DB_HOST;
    delete process.env.DB_PORT;
    delete process.env.DB_NAME;
    delete process.env.DB_USER;
    delete process.env.PG_PASSWORD;
  });

  afterEach(() => {
    // Restore only the keys we touch
    process.env.DB_HOST = originalEnv.DB_HOST;
    process.env.DB_PORT = originalEnv.DB_PORT;
    process.env.DB_NAME = originalEnv.DB_NAME;
    process.env.DB_USER = originalEnv.DB_USER;
    process.env.PG_PASSWORD = originalEnv.PG_PASSWORD;
  });

  it('throws when no password provided and PG_PASSWORD is unset', async () => {
    const { createPool } = await import('../../src/lib/create-pool.js');
    expect(() => createPool()).toThrow('PG_PASSWORD');
  });

  it('uses default values from DEFAULT_CONFIG with explicit password', async () => {
    const { createPool } = await import('../../src/lib/create-pool.js');
    createPool({ password: 'test_pass' });
    expect(Pool).toHaveBeenCalledWith({
      host: '127.0.0.1',
      port: 5432,
      database: 'lox_brain',
      user: 'lox',
      password: 'test_pass',
    });
  });

  it('uses env vars as fallback when no config provided', async () => {
    process.env.DB_HOST = '10.0.0.5';
    process.env.DB_PORT = '5433';
    process.env.DB_NAME = 'custom_db';
    process.env.DB_USER = 'custom_user';
    process.env.PG_PASSWORD = 'env_secret';

    const { createPool } = await import('../../src/lib/create-pool.js');
    createPool();
    expect(Pool).toHaveBeenCalledWith({
      host: '10.0.0.5',
      port: 5433,
      database: 'custom_db',
      user: 'custom_user',
      password: 'env_secret',
    });
  });

  it('explicit config overrides env vars', async () => {
    process.env.DB_HOST = 'env-host';
    process.env.DB_PORT = '9999';
    process.env.DB_NAME = 'env_db';
    process.env.DB_USER = 'env_user';
    process.env.PG_PASSWORD = 'env_pass';

    const { createPool } = await import('../../src/lib/create-pool.js');
    createPool({
      host: 'config-host',
      port: 6543,
      database: 'config_db',
      user: 'config_user',
      password: 'config_pass',
    });

    expect(Pool).toHaveBeenCalledWith({
      host: 'config-host',
      port: 6543,
      database: 'config_db',
      user: 'config_user',
      password: 'config_pass',
    });
  });

  it('allows partial config — missing fields fall back to env then defaults', async () => {
    process.env.DB_NAME = 'env_db';
    process.env.PG_PASSWORD = 'env_pass';

    const { createPool } = await import('../../src/lib/create-pool.js');
    createPool({ host: 'partial-host' });

    expect(Pool).toHaveBeenCalledWith({
      host: 'partial-host',
      port: 5432,
      database: 'env_db',
      user: 'lox',
      password: 'env_pass',
    });
  });
});
