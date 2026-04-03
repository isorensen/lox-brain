import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { renderBox } from './ui/box.js';
import type { LoxConfig } from '@lox-brain/shared';
import { DEFAULT_CONFIG, getConfigPath } from '@lox-brain/shared';

interface OldInstallation {
  installDir: string;
  vmUser: string;
  dbName: string;
  dbUser: string;
}

export function detectOldInstallation(): OldInstallation | null {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const candidates = [
    path.join(home, 'obsidian_open_brain'),
    path.join(home, 'lox-brain'),
  ];

  for (const dir of candidates) {
    const pkgPath = path.join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        if (pkg.name === 'obsidian_open_brain') {
          return {
            installDir: dir,
            vmUser: path.basename(path.dirname(dir)) || 'user',
            dbName: 'open_brain',
            dbUser: 'obsidian_brain',
          };
        }
      } catch { /* not a valid installation */ }
    }
  }

  return null;
}

export async function runMigration(): Promise<void> {
  console.log(renderBox(['Lox Migration', '', 'Migrating from obsidian_open_brain to Lox...']));

  const old = detectOldInstallation();
  if (!old) {
    console.log('\n  No obsidian_open_brain installation found.\n');
    return;
  }

  console.log(`\n  Found old installation at: ${old.installDir}`);
  console.log(`  DB: ${old.dbName} / User: ${old.dbUser}\n`);

  const { confirm } = await import('@inquirer/prompts');
  const proceed = await confirm({ message: 'Generate ~/.lox/config.json from current values?' });
  if (!proceed) return;

  const config: LoxConfig = {
    ...(DEFAULT_CONFIG as LoxConfig),
    database: {
      host: '127.0.0.1',
      port: 5432,
      name: old.dbName,
      user: old.dbUser,
    },
    install_dir: old.installDir,
    installed_at: new Date().toISOString(),
  };

  const configPath = getConfigPath();
  const configDir = path.dirname(configPath);
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log(`\n  Config written to: ${configPath}`);

  console.log('\n  Manual steps remaining:');
  console.log('  1. On VM: sudo systemctl edit lox-watcher (update paths)');
  console.log('  2. On VM: git remote set-url origin https://github.com/<user>/lox-brain.git');
  console.log('  3. Local: claude mcp remove obsidian-brain && claude mcp add lox-brain ...');
  console.log('');
}
