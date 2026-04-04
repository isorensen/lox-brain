import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { InstallerContext } from '../../src/steps/types.js';

vi.mock('@inquirer/prompts', () => ({ input: vi.fn(), number: vi.fn() }));
vi.mock('node:child_process', () => ({
  execFileSync: vi.fn((cmd: string, args?: string[]) => {
    if (cmd === 'wg' && args?.[0] === 'genkey') return Buffer.from('fake-private-key\n');
    if (cmd === 'wg' && args?.[0] === 'pubkey') return Buffer.from('fake-public-key\n');
    return Buffer.from('');
  }),
}));
vi.mock('node:fs', () => ({ mkdirSync: vi.fn(), writeFileSync: vi.fn() }));

describe('stepPeers', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('should skip if mode is personal', async () => {
    const { stepPeers } = await import('../../src/steps/step-peers.js');
    const ctx: InstallerContext = { config: { mode: 'personal' }, locale: 'en' };
    const result = await stepPeers(ctx);
    expect(result.success).toBe(true);
    expect(result.message).toContain('skip');
  });

  it('should collect peers and store in config', async () => {
    const { input, number: numberPrompt } = await import('@inquirer/prompts');
    (numberPrompt as any).mockResolvedValue(2);
    (input as any)
      .mockResolvedValueOnce('eduardo').mockResolvedValueOnce('eduardo@credifit.com.br')
      .mockResolvedValueOnce('matheus').mockResolvedValueOnce('matheus@credifit.com.br');

    const { stepPeers } = await import('../../src/steps/step-peers.js');
    const ctx: InstallerContext = {
      config: {
        mode: 'team',
        vpn: { server_ip: '10.10.0.1', subnet: '10.10.0.0/24', listen_port: 51820, peers: [] },
      },
      locale: 'en',
    };
    const result = await stepPeers(ctx);

    expect(result.success).toBe(true);
    expect(ctx.config.vpn!.peers).toHaveLength(2);
    expect(ctx.config.vpn!.peers![0].name).toBe('eduardo');
    expect(ctx.config.vpn!.peers![0].ip).toBe('10.10.0.2');
    expect(ctx.config.vpn!.peers![1].ip).toBe('10.10.0.3');
  });

  it('should write .conf files', async () => {
    const { input, number: numberPrompt } = await import('@inquirer/prompts');
    (numberPrompt as any).mockResolvedValue(1);
    (input as any).mockResolvedValueOnce('eduardo').mockResolvedValueOnce('eduardo@credifit.com.br');
    const { writeFileSync, mkdirSync } = await import('node:fs');

    const { stepPeers } = await import('../../src/steps/step-peers.js');
    const ctx: InstallerContext = {
      config: {
        mode: 'team',
        vpn: { server_ip: '10.10.0.1', subnet: '10.10.0.0/24', listen_port: 51820, peers: [] },
      },
      locale: 'en',
    };
    await stepPeers(ctx);

    expect(mkdirSync).toHaveBeenCalledWith(expect.stringContaining('output'), { recursive: true });
    expect(writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('eduardo.conf'), expect.stringContaining('[Interface]'),
    );
  });
});
