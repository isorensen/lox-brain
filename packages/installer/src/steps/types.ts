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
  /**
   * Mark a failure as user-actionable (VPN not active, missing prereq,
   * missing config field the user must supply, etc.) — something the
   * user can fix and retry, NOT a bug in the installer. When true,
   * `handleStepFailure` prints the guidance message and persists state
   * for the resume feature, but skips the "Would you like to report
   * this issue on GitHub?" prompt. Defaults to false/undefined, meaning
   * the failure IS reportable (unknown crashes, transient infra errors,
   * unexpected state). See #96.
   *
   * DO NOT use actionable:true to suppress noise on real crashes or on
   * errors the user cannot resolve without diagnostic work (API enable
   * failures, SSH drops, unexpected exit codes, state corruption). The
   * bar is: "is there ONE concrete thing the user can do RIGHT NOW to
   * fix this and retry?" If the answer requires reading logs or
   * debugging, the failure is NOT actionable.
   */
  actionable?: boolean;
}

export type InstallerStep = (ctx: InstallerContext) => Promise<StepResult>;
