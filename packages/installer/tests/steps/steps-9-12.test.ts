import { describe, it, expect } from 'vitest';

/**
 * These tests verify that step modules 9-12 and post-install export
 * the expected functions with correct signatures. They do NOT execute
 * the steps (which require GitHub CLI, GCP credentials, interactive
 * prompts, and real infrastructure).
 */

describe('Installer steps 9-12 — module structure', () => {
  it('step-vault exports stepVault function', async () => {
    const mod = await import('../../src/steps/step-vault.js');
    expect(mod.stepVault).toBeDefined();
    expect(typeof mod.stepVault).toBe('function');
  });

  it('step-obsidian exports stepObsidian function', async () => {
    const mod = await import('../../src/steps/step-obsidian.js');
    expect(mod.stepObsidian).toBeDefined();
    expect(typeof mod.stepObsidian).toBe('function');
  });

  it('step-deploy exports stepDeploy function', async () => {
    const mod = await import('../../src/steps/step-deploy.js');
    expect(mod.stepDeploy).toBeDefined();
    expect(typeof mod.stepDeploy).toBe('function');
  });

  it('step-mcp exports stepMcp function', async () => {
    const mod = await import('../../src/steps/step-mcp.js');
    expect(mod.stepMcp).toBeDefined();
    expect(typeof mod.stepMcp).toBe('function');
  });

  it('step-post-install exports runPostInstall function', async () => {
    const mod = await import('../../src/steps/step-post-install.js');
    expect(mod.runPostInstall).toBeDefined();
    expect(typeof mod.runPostInstall).toBe('function');
  });
});
