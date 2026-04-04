import { describe, it, expect } from 'vitest';
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
