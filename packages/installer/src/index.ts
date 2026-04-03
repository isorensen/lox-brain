#!/usr/bin/env node

import { setLocale, t, type Locale } from './i18n/index.js';
import { renderSplash } from './ui/splash.js';

async function selectLanguage(): Promise<Locale> {
  const { select } = await import('@inquirer/prompts');
  const choice = await select<Locale>({
    message: 'Language / Idioma:',
    choices: [
      { name: 'English', value: 'en' as const },
      { name: 'Portugues (BR)', value: 'pt-br' as const },
    ],
  });
  return choice;
}

async function main(): Promise<void> {
  // Check for subcommands
  const args = process.argv.slice(2);
  if (args[0] === 'migrate') {
    console.log('lox migrate: coming soon');
    return;
  }
  if (args[0] === 'status') {
    console.log('lox status: coming soon');
    return;
  }

  const locale = await selectLanguage();
  setLocale(locale);

  console.log(renderSplash());

  const strings = t();
  console.log(`\n${strings.step_prefix} 1/12 — ${strings.step_prerequisites}\n`);
  console.log('Installer steps coming soon...\n');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
