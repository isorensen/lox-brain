import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { getConfigPath } from '@lox-brain/shared';
import { getPlatform } from './utils/shell.js';

/** Relative location of the deploy/upgrade script inside an install. */
const DEPLOY_SCRIPT = path.join('infra', 'deploy.sh');

function hasDeployScript(dir: string): boolean {
  return existsSync(path.join(dir, DEPLOY_SCRIPT));
}

/**
 * Locate the Lox install directory to upgrade.
 *
 * Prefers `install_dir` from ~/.lox/config.json, then falls back to the current
 * working directory and the conventional install locations. A directory only
 * qualifies if it actually contains `infra/deploy.sh` (so we never try to
 * upgrade a half-checked-out or wrong path).
 *
 * Params are injectable for testing; they default to the real environment.
 */
export function resolveInstallDir(
  configPath: string = getConfigPath(),
  home: string = process.env.HOME ?? process.env.USERPROFILE ?? '',
  cwd: string = process.cwd(),
): string {
  if (existsSync(configPath)) {
    try {
      const cfg = JSON.parse(readFileSync(configPath, 'utf-8'));
      if (typeof cfg.install_dir === 'string' && hasDeployScript(cfg.install_dir)) {
        return cfg.install_dir;
      }
    } catch {
      /* corrupt config — fall through to conventional locations */
    }
  }

  const candidates = [
    cwd,
    path.join(home, 'obsidian_open_brain'),
    path.join(home, 'lox-brain'),
  ];
  for (const dir of candidates) {
    if (hasDeployScript(dir)) return dir;
  }

  throw new Error(
    'Could not locate a Lox install to upgrade (no infra/deploy.sh found). ' +
      'Run this on the VM that hosts Lox, or set "install_dir" in ~/.lox/config.json.',
  );
}

/** Resolve and validate the absolute path of the deploy script. */
export function resolveDeployScript(installDir: string): string {
  const script = path.join(installDir, DEPLOY_SCRIPT);
  if (!existsSync(script)) {
    throw new Error(`Deploy script not found at ${script}.`);
  }
  return script;
}

/**
 * `lox upgrade` — pull + build + (re-)apply schema + restart, self-service.
 *
 * Thin wrapper over infra/deploy.sh (the single source of truth for the
 * upgrade steps) so there is no duplicated bash/TS logic. Streams the script
 * output live via stdio inheritance.
 */
export async function runUpgrade(): Promise<void> {
  if (getPlatform() === 'windows') {
    throw new Error(
      'lox upgrade runs on the Linux VM that hosts the watcher and MCP server, not on Windows.',
    );
  }

  const installDir = resolveInstallDir();
  const script = resolveDeployScript(installDir);

  console.log(`\n  Upgrading Lox in ${installDir} …\n`);

  await new Promise<void>((resolve, reject) => {
    const child = spawn('bash', [script], { stdio: 'inherit', cwd: installDir });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Upgrade failed: infra/deploy.sh exited with code ${code}.`));
    });
  });

  console.log('\n  ✓ Lox upgraded.\n');
}
