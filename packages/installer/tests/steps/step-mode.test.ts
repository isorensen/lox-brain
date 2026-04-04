import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { InstallerContext } from '../../src/steps/types.js';

vi.mock('@inquirer/prompts', () => ({
  select: vi.fn(),
}));

describe('stepMode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should set config.mode to personal when user selects personal', async () => {
    const { select } = await import('@inquirer/prompts');
    (select as any).mockResolvedValue('personal');
    const { stepMode } = await import('../../src/steps/step-mode.js');
    const ctx: InstallerContext = { config: {}, locale: 'en' };
    const result = await stepMode(ctx);
    expect(result.success).toBe(true);
    expect(ctx.config.mode).toBe('personal');
  });

  it('should set config.mode to team when user selects team', async () => {
    const { select } = await import('@inquirer/prompts');
    (select as any).mockResolvedValue('team');
    const { stepMode } = await import('../../src/steps/step-mode.js');
    const ctx: InstallerContext = { config: {}, locale: 'en' };
    const result = await stepMode(ctx);
    expect(result.success).toBe(true);
    expect(ctx.config.mode).toBe('team');
  });
});
