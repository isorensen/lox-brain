import type { LoxConfig } from '@lox-brain/shared';

export interface InstallerContext {
  config: Partial<LoxConfig>;
  locale: 'en' | 'pt-br';
  gcpUsername?: string;
  gcpProjectId?: string;
  /** Actual POSIX username on the VM (resolved via SSH, not derived from email). */
  vmUser?: string;
  /** Actual $HOME on the VM (resolved via SSH). */
  vmHome?: string;
  vaultPreset?: 'zettelkasten' | 'para';
}

export interface StepResult {
  success: boolean;
  message?: string;
}

export type InstallerStep = (ctx: InstallerContext) => Promise<StepResult>;
