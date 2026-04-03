import { securityGates } from './gates.js';
import { renderBox } from '../ui/box.js';
import { t } from '../i18n/index.js';
import type { LoxConfig } from '@lox-brain/shared';

export interface AuditResult {
  name: string;
  passed: boolean;
  blocking: boolean;
}

export async function runSecurityAudit(config: LoxConfig): Promise<AuditResult[]> {
  const results: AuditResult[] = [];
  for (const gate of securityGates) {
    const passed = await gate.check(config);
    results.push({ name: gate.name, passed, blocking: gate.blocking });
  }
  return results;
}

export function renderAuditResults(results: AuditResult[]): string {
  const strings = t();
  const allPassed = results.every(r => r.passed || !r.blocking);
  const title = allPassed
    ? `${strings.security_audit_title} — ${strings.security_audit_passed}`
    : `${strings.security_audit_title} — ${strings.security_audit_failed}`;

  const lines: string[] = [title, ''];
  for (const result of results) {
    const icon = result.passed ? '*' : 'X';
    lines.push(`  ${icon} ${result.name}`);
  }
  lines.push('');
  if (allPassed) {
    lines.push('  Your brain is secure. Zero Trust verified.');
  }

  return renderBox(lines);
}

export function renderSecurityHygiene(): string {
  const strings = t();
  const lines = [
    strings.security_hygiene_title,
    '',
    `  1. ${strings.security_rule_1}`,
    `     ${strings.security_rule_1_detail}`,
    '',
    `  2. ${strings.security_rule_2}`,
    `     ${strings.security_rule_2_detail}`,
    '',
    `  3. ${strings.security_rule_3}`,
    `     ${strings.security_rule_3_detail}`,
  ];
  return renderBox(lines);
}
