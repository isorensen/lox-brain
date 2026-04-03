import { setLocale, type Locale } from '../i18n/index.js';
import type { InstallerContext, StepResult } from './types.js';

export async function stepLanguage(ctx: InstallerContext): Promise<StepResult> {
  const { select } = await import('@inquirer/prompts');
  const locale = await select<Locale>({
    message: 'Language / Idioma:',
    choices: [
      { name: 'English', value: 'en' },
      { name: 'Português (BR)', value: 'pt-br' },
    ],
  });

  setLocale(locale);
  ctx.locale = locale;
  return { success: true };
}
