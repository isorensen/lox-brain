import { randomBytes } from 'node:crypto';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { shell } from './shell.js';
import { t } from '../i18n/index.js';

/**
 * Map of installer step names (as passed to handleStepFailure in index.ts)
 * to their source file paths. Used to enrich auto-reported issues.
 */
const STEP_SOURCE_FILES: Record<string, string> = {
  'Prerequisites': 'packages/installer/src/steps/step-prerequisites.ts',
  'GCP Auth': 'packages/installer/src/steps/step-gcp-auth.ts',
  'GCP Project': 'packages/installer/src/steps/step-gcp-project.ts',
  'Billing': 'packages/installer/src/steps/step-billing.ts',
  'VPC Network': 'packages/installer/src/steps/step-network.ts',
  'VM Instance': 'packages/installer/src/steps/step-vm.ts',
  'VM Setup': 'packages/installer/src/steps/step-vm-setup.ts',
  'WireGuard VPN': 'packages/installer/src/steps/step-vpn.ts',
  'Vault Setup': 'packages/installer/src/steps/step-vault.ts',
  'Obsidian': 'packages/installer/src/steps/step-obsidian.ts',
  'Deploy': 'packages/installer/src/steps/step-deploy.ts',
  'MCP Server': 'packages/installer/src/steps/step-mcp.ts',
};

/**
 * Extract sub-phase name from an error message formatted as
 * "<sub-phase> failed: <error details>". Returns undefined if the
 * message doesn't follow this convention.
 */
export function extractSubPhase(message: string): string | undefined {
  const m = message.match(/^(.+?) failed: /);
  return m ? m[1] : undefined;
}

/**
 * Look up the source file path for a known installer step name.
 * Returns undefined if the step is not recognized.
 */
export function sourceFileForStep(stepName: string): string | undefined {
  return STEP_SOURCE_FILES[stepName];
}

export interface ErrorReportContext {
  stepName: string;
  errorMessage: string;
  loxVersion: string;
  os: string;
  nodeVersion: string;
}

/**
 * Sanitize private data from error messages before reporting.
 *
 * Redacts: GCP project IDs, service account emails, Windows user paths,
 * billing account IDs, and GCP project numbers.
 */
export function sanitize(text: string): string {
  let result = text;

  // GCP project IDs: --project <id> or --project=<id>
  result = result.replace(/--project[= ](\S+)/g, '--project <REDACTED>');

  // Service account emails: *@*.iam.gserviceaccount.com
  result = result.replace(
    /[\w.+-]+@[\w.-]+\.iam\.gserviceaccount\.com/g,
    '<REDACTED>@<REDACTED>.iam.gserviceaccount.com',
  );

  // Windows user paths: C:\Users\<name>\
  result = result.replace(
    /C:\\Users\\[^\\]+\\/gi,
    'C:\\Users\\<REDACTED>\\',
  );

  // Billing account IDs: XXXXXX-YYYYYY-ZZZZZZ (6 alphanum groups separated by dashes)
  result = result.replace(
    /[A-Z0-9]{6}-[A-Z0-9]{6}-[A-Z0-9]{6}/gi,
    '<REDACTED>',
  );

  // GCP project numbers: 6-12 digit sequences after project/ or project'
  result = result.replace(
    /project[/']\d{6,12}/g,
    (match) => match.replace(/\d{6,12}/, '<REDACTED>'),
  );

  return result;
}

function buildIssueBody(ctx: ErrorReportContext): string {
  const sanitizedError = sanitize(ctx.errorMessage);

  return `## Auto-reported installer failure

**Step:** ${ctx.stepName}

### Error
\`\`\`
${sanitizedError}
\`\`\`

### Environment
- **OS:** ${ctx.os}
- **Node.js:** ${ctx.nodeVersion}
- **Lox version:** ${ctx.loxVersion}

---
*This issue was automatically created by the Lox installer. Personal data has been redacted.*`;
}

/**
 * Offer the user to report a failed installer step as a GitHub issue.
 *
 * Best-effort: this function NEVER throws. If anything fails
 * (missing `gh`, network error, user declines), it silently returns.
 */
export async function offerErrorReport(ctx: ErrorReportContext): Promise<void> {
  try {
    const strings = t();

    // Dynamic import to avoid issues in test environments
    const { confirm } = await import('@inquirer/prompts');

    console.log(`\n${strings.error_report_note}`);

    const shouldReport = await confirm({
      message: strings.error_report_prompt,
      default: false,
    });

    if (!shouldReport) return;

    console.log(strings.error_report_creating);

    const title = `[Auto-report] ${ctx.stepName} failed`;
    const body = buildIssueBody(ctx);

    // Write body to a temp file to avoid multiline string truncation
    // on Windows (cmd.exe /c + execFile drops content after first newline).
    const tempFilePath = join(tmpdir(), `lox-error-report-${randomBytes(4).toString('hex')}.md`);
    try {
      writeFileSync(tempFilePath, body, 'utf-8');

      const result = await shell('gh', [
        'issue', 'create',
        '--repo', 'isorensen/lox-brain',
        '--title', title,
        '--label', 'bug',
        '--body-file', tempFilePath,
      ], { timeout: 30_000 });

      // gh issue create prints the URL to stdout
      const issueUrl = result.stdout.trim();
      if (issueUrl) {
        console.log(`${strings.error_report_created} ${issueUrl}`);
      }
    } finally {
      // Best-effort cleanup of temp file
      try { unlinkSync(tempFilePath); } catch { /* ignore */ }
    }
  } catch {
    // Best-effort: never throw
    try {
      const strings = t();
      console.log(strings.error_report_failed);
    } catch {
      // Even i18n might fail — truly silent
    }
  }
}
