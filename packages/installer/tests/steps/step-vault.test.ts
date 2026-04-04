import { describe, it, expect } from 'vitest';
import { isProPlanGate } from '../../src/steps/step-vault.js';

describe('isProPlanGate', () => {
  it('detects the Pro upgrade 403 from err.message', () => {
    const err = new Error(
      'Command failed: gh api repos/owner/repo/branches/main/protection -X PUT\n' +
      'gh: Upgrade to GitHub Pro or make this repository public to enable this feature. (HTTP 403)',
    );
    expect(isProPlanGate(err)).toBe(true);
  });

  it('detects the Pro upgrade 403 from err.stderr', () => {
    const err = Object.assign(new Error('Command failed'), {
      stderr: 'gh: Upgrade to GitHub Pro or make this repository public to enable this feature. (HTTP 403)',
    });
    expect(isProPlanGate(err)).toBe(true);
  });

  it('requires both HTTP 403 and the upgrade message', () => {
    expect(isProPlanGate(new Error('HTTP 403 some other 403 error'))).toBe(false);
    expect(isProPlanGate(new Error('Upgrade to GitHub Pro (HTTP 402)'))).toBe(false);
  });

  it('returns false for unrelated errors', () => {
    expect(isProPlanGate(new Error('HTTP 404 Not Found'))).toBe(false);
    expect(isProPlanGate(new Error('Network error: ECONNREFUSED'))).toBe(false);
    expect(isProPlanGate(new Error(''))).toBe(false);
  });

  it('returns false for other 403 errors (e.g. missing token scopes)', () => {
    expect(isProPlanGate(new Error('HTTP 403 Resource not accessible by personal access token'))).toBe(false);
    expect(isProPlanGate(new Error('HTTP 403 Forbidden'))).toBe(false);
  });

  it('rejects when signals are split across message and stderr (no false positive)', () => {
    // HTTP 403 in message, Pro message in stderr — should NOT match because
    // neither surface contains both signals.
    const err = Object.assign(new Error('HTTP 403 Forbidden'), {
      stderr: 'Upgrade to GitHub Pro to access this feature',
    });
    expect(isProPlanGate(err)).toBe(false);
  });

  it('returns false for non-Error values', () => {
    expect(isProPlanGate(null)).toBe(false);
    expect(isProPlanGate(undefined)).toBe(false);
    expect(isProPlanGate('some string')).toBe(false);
    expect(isProPlanGate({})).toBe(false);
  });

  it('handles objects with non-string stderr gracefully', () => {
    const err = Object.assign(new Error('Command failed'), { stderr: Buffer.from('HTTP 403') });
    // Buffer stderr is not a string — helper only checks typeof string
    expect(isProPlanGate(err)).toBe(false);
  });
});
