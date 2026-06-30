import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveInstallDir, resolveDeployScript } from '../src/upgrade.js';

async function makeInstall(root: string, name: string): Promise<string> {
  const dir = path.join(root, name);
  await mkdir(path.join(dir, 'infra'), { recursive: true });
  await writeFile(path.join(dir, 'infra', 'deploy.sh'), '#!/usr/bin/env bash\n');
  return dir;
}

describe('resolveInstallDir', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'lox-upgrade-'));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  // An empty cwd so the first fallback candidate (process.cwd()) never matches
  // the real repo checkout during tests.
  const noCwd = () => path.join(tmp, 'no-cwd');

  it('uses install_dir from config when it has a deploy script', async () => {
    const installDir = await makeInstall(tmp, 'from-config');
    const configPath = path.join(tmp, 'config.json');
    await writeFile(configPath, JSON.stringify({ install_dir: installDir }));

    expect(resolveInstallDir(configPath, tmp, noCwd())).toBe(installDir);
  });

  it('falls back to ~/obsidian_open_brain when config is absent', async () => {
    const installDir = await makeInstall(tmp, 'obsidian_open_brain');

    // non-existent config path -> fall through to home candidates
    expect(resolveInstallDir(path.join(tmp, 'nope.json'), tmp, noCwd())).toBe(installDir);
  });

  it('ignores a config whose install_dir lacks a deploy script', async () => {
    const fallback = await makeInstall(tmp, 'lox-brain');
    const configPath = path.join(tmp, 'config.json');
    await writeFile(configPath, JSON.stringify({ install_dir: path.join(tmp, 'ghost') }));

    expect(resolveInstallDir(configPath, tmp, noCwd())).toBe(fallback);
  });

  it('tolerates a corrupt config and still falls back', async () => {
    const fallback = await makeInstall(tmp, 'obsidian_open_brain');
    const configPath = path.join(tmp, 'config.json');
    await writeFile(configPath, '{ not valid json');

    expect(resolveInstallDir(configPath, tmp, noCwd())).toBe(fallback);
  });

  it('prefers the current working directory when it is an install', async () => {
    const cwdInstall = await makeInstall(tmp, 'cwd-install');
    expect(resolveInstallDir(path.join(tmp, 'nope.json'), tmp, cwdInstall)).toBe(cwdInstall);
  });

  it('throws an actionable error when no install is found', () => {
    expect(() => resolveInstallDir(path.join(tmp, 'nope.json'), tmp, noCwd())).toThrow(/Could not locate a Lox install/);
  });
});

describe('resolveDeployScript', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'lox-upgrade-'));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('returns the script path when present', async () => {
    const dir = await makeInstall(tmp, 'install');
    expect(resolveDeployScript(dir)).toBe(path.join(dir, 'infra', 'deploy.sh'));
  });

  it('throws when the deploy script is missing', () => {
    expect(() => resolveDeployScript(path.join(tmp, 'empty'))).toThrow(/Deploy script not found/);
  });
});
