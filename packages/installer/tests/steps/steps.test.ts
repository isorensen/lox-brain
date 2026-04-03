import { describe, it, expect } from 'vitest';

/**
 * These tests verify that step modules export the expected functions
 * with correct signatures. They do NOT execute the steps (which require
 * GCP credentials, interactive prompts, and real infrastructure).
 */

describe('Installer steps — module structure', () => {
  it('types.ts exports InstallerContext and StepResult types', async () => {
    const types = await import('../../src/steps/types.js');
    // Type-only exports won't appear at runtime, but the module should load
    expect(types).toBeDefined();
  });

  it('step-language exports stepLanguage function', async () => {
    const mod = await import('../../src/steps/step-language.js');
    expect(mod.stepLanguage).toBeDefined();
    expect(typeof mod.stepLanguage).toBe('function');
  });

  it('step-prerequisites exports stepPrerequisites function', async () => {
    const mod = await import('../../src/steps/step-prerequisites.js');
    expect(mod.stepPrerequisites).toBeDefined();
    expect(typeof mod.stepPrerequisites).toBe('function');
  });

  it('step-gcp-auth exports stepGcpAuth function', async () => {
    const mod = await import('../../src/steps/step-gcp-auth.js');
    expect(mod.stepGcpAuth).toBeDefined();
    expect(typeof mod.stepGcpAuth).toBe('function');
  });

  it('step-gcp-project exports stepGcpProject function', async () => {
    const mod = await import('../../src/steps/step-gcp-project.js');
    expect(mod.stepGcpProject).toBeDefined();
    expect(typeof mod.stepGcpProject).toBe('function');
  });

  it('step-billing exports stepBilling function', async () => {
    const mod = await import('../../src/steps/step-billing.js');
    expect(mod.stepBilling).toBeDefined();
    expect(typeof mod.stepBilling).toBe('function');
  });

  it('step-network exports stepNetwork function', async () => {
    const mod = await import('../../src/steps/step-network.js');
    expect(mod.stepNetwork).toBeDefined();
    expect(typeof mod.stepNetwork).toBe('function');
  });

  it('step-vm exports stepVm function', async () => {
    const mod = await import('../../src/steps/step-vm.js');
    expect(mod.stepVm).toBeDefined();
    expect(typeof mod.stepVm).toBe('function');
  });

  it('step-vm-setup exports stepVmSetup function', async () => {
    const mod = await import('../../src/steps/step-vm-setup.js');
    expect(mod.stepVmSetup).toBeDefined();
    expect(typeof mod.stepVmSetup).toBe('function');
  });

  it('step-vpn exports stepVpn function', async () => {
    const mod = await import('../../src/steps/step-vpn.js');
    expect(mod.stepVpn).toBeDefined();
    expect(typeof mod.stepVpn).toBe('function');
  });
});
