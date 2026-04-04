import { shell } from './shell.js';
import { t } from '../i18n/index.js';

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

    const result = await shell('gh', [
      'issue', 'create',
      '--repo', 'isorensen/lox-brain',
      '--title', title,
      '--label', 'bug',
      '--body', body,
    ], { timeout: 30_000 });

    // gh issue create prints the URL to stdout
    const issueUrl = result.stdout.trim();
    if (issueUrl) {
      console.log(`${strings.error_report_created} ${issueUrl}`);
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
