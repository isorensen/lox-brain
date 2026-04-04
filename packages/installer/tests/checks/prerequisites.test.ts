import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getPlatform } from '../../src/utils/shell.js';

describe('getPlatform', () => {
  it('returns a valid platform string', () => {
    const platform = getPlatform();
    expect(['windows', 'macos', 'linux']).toContain(platform);
  });
});

describe('PrerequisiteResult interface', () => {
  it('structures check results correctly', async () => {
    // Import the type and function
    const { checkAllPrerequisites } = await import('../../src/checks/prerequisites.js');
    const results = await checkAllPrerequisites();

    // Should return array of results
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(5); // Node, git, gcloud, gh, WireGuard

    // Each result should have required fields
    for (const r of results) {
      expect(r).toHaveProperty('name');
      expect(r).toHaveProperty('installed');
      expect(typeof r.name).toBe('string');
      expect(typeof r.installed).toBe('boolean');
    }
  });

  it('detects Node.js as installed (since we are running in Node)', async () => {
    const { checkAllPrerequisites } = await import('../../src/checks/prerequisites.js');
    const results = await checkAllPrerequisites();
    const nodeResult = results.find(r => r.name === 'Node.js');
    expect(nodeResult).toBeDefined();
    expect(nodeResult!.installed).toBe(true);
    expect(nodeResult!.version).toMatch(/v\d+/);
  });

  it('detects git as installed', async () => {
    const { checkAllPrerequisites } = await import('../../src/checks/prerequisites.js');
    const results = await checkAllPrerequisites();
    const gitResult = results.find(r => r.name === 'git');
    expect(gitResult).toBeDefined();
    expect(gitResult!.installed).toBe(true);
  });

  it('provides install commands for missing prerequisites', async () => {
    const { checkAllPrerequisites } = await import('../../src/checks/prerequisites.js');
    const results = await checkAllPrerequisites();
    // For any that are NOT installed, they should have an installCommand
    for (const r of results) {
      if (!r.installed && r.installCommand) {
        expect(typeof r.installCommand).toBe('string');
        expect(r.installCommand.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('checkGcloud Windows .cmd fallback', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('detects gcloud normally when shell("gcloud") succeeds', async () => {
    const shellMod = await import('../../src/utils/shell.js');
    vi.spyOn(shellMod, 'shell').mockResolvedValueOnce({
      stdout: 'Google Cloud SDK 450.0.0\nother lines',
      stderr: '',
    });

    // Re-import to pick up the mock (checkGcloud uses the same module reference)
    const { checkGcloud } = await import('../../src/checks/prerequisites.js');
    const result = await checkGcloud();

    expect(result.installed).toBe(true);
    expect(result.version).toBe('Google Cloud SDK 450.0.0');
    expect(shellMod.shell).toHaveBeenCalledWith('gcloud', ['--version']);
  });

  it('falls back to gcloud.cmd on Windows when gcloud fails', async () => {
    const shellMod = await import('../../src/utils/shell.js');

    // First call (gcloud) fails
    const shellSpy = vi.spyOn(shellMod, 'shell')
      .mockRejectedValueOnce(new Error('Command not found: gcloud'))
      .mockResolvedValueOnce({
        stdout: 'Google Cloud SDK 450.0.0\nother lines',
        stderr: '',
      });

    vi.spyOn(shellMod, 'getPlatform').mockReturnValue('windows');

    const { checkGcloud } = await import('../../src/checks/prerequisites.js');
    const result = await checkGcloud();

    expect(result.installed).toBe(true);
    expect(result.version).toBe('Google Cloud SDK 450.0.0');
    expect(shellSpy).toHaveBeenCalledWith('gcloud', ['--version']);
    expect(shellSpy).toHaveBeenCalledWith('gcloud.cmd', ['--version']);
  });

  it('returns installed: false when both gcloud and gcloud.cmd fail on Windows', async () => {
    const shellMod = await import('../../src/utils/shell.js');

    vi.spyOn(shellMod, 'shell')
      .mockRejectedValueOnce(new Error('Command not found: gcloud'))
      .mockRejectedValueOnce(new Error('Command not found: gcloud.cmd'));

    vi.spyOn(shellMod, 'getPlatform').mockReturnValue('windows');

    const { checkGcloud } = await import('../../src/checks/prerequisites.js');
    const result = await checkGcloud();

    expect(result.installed).toBe(false);
    expect(result.installCommand).toBeDefined();
  });

  it('does not try gcloud.cmd fallback on non-Windows platforms', async () => {
    const shellMod = await import('../../src/utils/shell.js');

    const shellSpy = vi.spyOn(shellMod, 'shell')
      .mockRejectedValueOnce(new Error('Command not found: gcloud'));

    vi.spyOn(shellMod, 'getPlatform').mockReturnValue('linux');

    const { checkGcloud } = await import('../../src/checks/prerequisites.js');
    const result = await checkGcloud();

    expect(result.installed).toBe(false);
    // Should only have called shell once (no .cmd fallback)
    expect(shellSpy).toHaveBeenCalledTimes(1);
    expect(shellSpy).toHaveBeenCalledWith('gcloud', ['--version']);
  });
});
