import { select } from '@inquirer/prompts';
import { t } from '../i18n/index.js';
import type { InstallerContext, StepResult } from './types.js';

export async function stepMode(ctx: InstallerContext): Promise<StepResult> {
  const strings = t();
  const mode = await select<'personal' | 'team'>({
    message: strings.mode_prompt,
    choices: [
      { name: `${strings.mode_personal} — ${strings.mode_personal_desc}`, value: 'personal' as const },
      { name: `${strings.mode_team} — ${strings.mode_team_desc}`, value: 'team' as const },
    ],
  });
  ctx.config.mode = mode;
  return { success: true };
}
