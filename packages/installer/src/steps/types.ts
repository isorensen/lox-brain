import type { LoxConfig } from '@lox-brain/shared';

export interface InstallerContext {
  config: Partial<LoxConfig>;
  locale: 'en' | 'pt-br';
  gcpUsername?: string;
  gcpProjectId?: string;
  vaultPreset?: 'zettelkasten' | 'para';
}

export interface StepResult {
  success: boolean;
  message?: string;
}

export type InstallerStep = (ctx: InstallerContext) => Promise<StepResult>;
