import { describe, it, expect } from 'vitest';
import { renderAuditResults, renderSecurityHygiene } from '../../src/security/audit.js';
import type { AuditResult } from '../../src/security/audit.js';

describe('renderAuditResults', () => {
  it('renders all-passed audit', () => {
    const results: AuditResult[] = [
      { name: 'VM public IP restricted to VPN endpoint', passed: true, blocking: true },
      { name: 'Firewall: deny-all', passed: true, blocking: true },
    ];
    const output = renderAuditResults(results);
    expect(output).toContain('passed');
    expect(output).toContain('VM public IP restricted to VPN endpoint');
    expect(output).toContain('Zero Trust');
  });

  it('renders failed blocking audit', () => {
    const results: AuditResult[] = [
      { name: 'VM public IP restricted to VPN endpoint', passed: false, blocking: true },
      { name: 'Cloud Logging', passed: true, blocking: false },
    ];
    const output = renderAuditResults(results);
    expect(output).toContain('failed');
    expect(output).toContain('VM public IP restricted to VPN endpoint');
    expect(output).not.toContain('Zero Trust');
  });

  it('non-blocking failure does not fail overall audit', () => {
    const results: AuditResult[] = [
      { name: 'VM public IP restricted to VPN endpoint', passed: true, blocking: true },
      { name: 'Cloud Logging', passed: false, blocking: false },
    ];
    const output = renderAuditResults(results);
    expect(output).toContain('passed');
    expect(output).toContain('Zero Trust');
  });
});

describe('renderSecurityHygiene', () => {
  it('renders 3 security rules', () => {
    const output = renderSecurityHygiene();
    expect(output).toContain('vault');
    expect(output).toContain('token');
    expect(output).toContain('VPN');
  });
});
