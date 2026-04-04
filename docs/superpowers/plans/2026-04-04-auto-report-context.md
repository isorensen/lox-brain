# Auto-Report Context Enrichment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enrich auto-generated GitHub issue bodies with sub-phase name and source file path, so triagers can locate the failure without asking.

**Architecture:** Two new pure helpers in `error-report.ts` + new optional fields in `ErrorReportContext` + updated body builder + updated call site in `index.ts`. No refactor of `StepResult`.

**Tech Stack:** TypeScript, vitest, Node 22

---

### Task 1: Add `extractSubPhase` and `sourceFileForStep` helpers (TDD)

**Files:**
- Modify: `packages/installer/src/utils/error-report.ts`
- Modify: `packages/installer/tests/utils/error-report.test.ts`

- [ ] **Step 1: Write failing tests**

Add a new `describe` block at the bottom of `packages/installer/tests/utils/error-report.test.ts`:

```typescript
import { extractSubPhase, sourceFileForStep } from '../../src/utils/error-report.js';

describe('extractSubPhase', () => {
  it('extracts sub-phase from "<phase> failed: <error>" format', () => {
    expect(extractSubPhase('Creating database and schema failed: ERROR: role lox already exists'))
      .toBe('Creating database and schema');
  });

  it('extracts multi-word sub-phase with spaces', () => {
    expect(extractSubPhase('SSH warm-up failed: Connection reset'))
      .toBe('SSH warm-up');
  });

  it('uses non-greedy match to capture shortest prefix before "failed:"', () => {
    expect(extractSubPhase('Phase A failed: something failed: deeper'))
      .toBe('Phase A');
  });

  it('returns undefined when message has no "failed:" marker', () => {
    expect(extractSubPhase('Unknown error')).toBeUndefined();
  });

  it('returns undefined on empty string', () => {
    expect(extractSubPhase('')).toBeUndefined();
  });
});

describe('sourceFileForStep', () => {
  it('maps known step names to source files', () => {
    expect(sourceFileForStep('VM Setup')).toBe('packages/installer/src/steps/step-vm-setup.ts');
    expect(sourceFileForStep('GCP Auth')).toBe('packages/installer/src/steps/step-gcp-auth.ts');
    expect(sourceFileForStep('WireGuard VPN')).toBe('packages/installer/src/steps/step-vpn.ts');
    expect(sourceFileForStep('MCP Server')).toBe('packages/installer/src/steps/step-mcp.ts');
  });

  it('returns undefined for unknown step names', () => {
    expect(sourceFileForStep('NonExistent')).toBeUndefined();
    expect(sourceFileForStep('')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/eduardosorensen/iDev.nosync/iSorensen/OPEN_BRAIN/lox-brain && npm run test --workspace=packages/installer -- --run --reporter=verbose -t "extractSubPhase|sourceFileForStep" 2>&1 | tail -30`

Expected: FAIL — the helpers don't exist yet (compile error or "not a function").

- [ ] **Step 3: Implement helpers in `error-report.ts`**

Add these exports near the top of `packages/installer/src/utils/error-report.ts` (after imports, before `sanitize`):

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace=packages/installer -- --run --reporter=verbose -t "extractSubPhase|sourceFileForStep" 2>&1 | tail -30`

Expected: all new tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/installer/src/utils/error-report.ts packages/installer/tests/utils/error-report.test.ts
git commit -m "feat: add extractSubPhase and sourceFileForStep helpers (#51)"
```

---

### Task 2: Extend `ErrorReportContext` and `buildIssueBody` (TDD)

**Files:**
- Modify: `packages/installer/src/utils/error-report.ts`
- Modify: `packages/installer/tests/utils/error-report.test.ts`

- [ ] **Step 1: Write failing test for enriched issue body**

Since `buildIssueBody` is not exported, test it indirectly via the existing `offerErrorReport` integration tests, OR export `buildIssueBody` for testing.

**Decision: export `buildIssueBody`** — it's a pure function and testing it directly is clearer than mock gymnastics. Rename to be clear that it's exported for testing.

Add these tests to `packages/installer/tests/utils/error-report.test.ts`:

```typescript
import { buildIssueBody } from '../../src/utils/error-report.js';

describe('buildIssueBody', () => {
  const baseCtx = {
    stepName: 'VM Setup',
    errorMessage: 'Creating database and schema failed: ERROR: role lox already exists',
    loxVersion: '0.3.4',
    os: 'darwin arm64',
    nodeVersion: 'v22.16.0',
  };

  it('includes sub-phase line when subPhase is provided', () => {
    const body = buildIssueBody({ ...baseCtx, subPhase: 'Creating database and schema' });
    expect(body).toContain('**Sub-phase:** Creating database and schema');
  });

  it('includes source file line when sourceFile is provided', () => {
    const body = buildIssueBody({
      ...baseCtx,
      sourceFile: 'packages/installer/src/steps/step-vm-setup.ts',
    });
    expect(body).toContain('**Source:** `packages/installer/src/steps/step-vm-setup.ts`');
  });

  it('omits sub-phase line when subPhase is undefined', () => {
    const body = buildIssueBody(baseCtx);
    expect(body).not.toContain('**Sub-phase:**');
  });

  it('omits source file line when sourceFile is undefined', () => {
    const body = buildIssueBody(baseCtx);
    expect(body).not.toContain('**Source:**');
  });

  it('still includes all original fields', () => {
    const body = buildIssueBody({
      ...baseCtx,
      subPhase: 'x',
      sourceFile: 'y',
    });
    expect(body).toContain('**Step:** VM Setup');
    expect(body).toContain('**OS:** darwin arm64');
    expect(body).toContain('**Node.js:** v22.16.0');
    expect(body).toContain('**Lox version:** 0.3.4');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace=packages/installer -- --run --reporter=verbose -t "buildIssueBody" 2>&1 | tail -30`

Expected: FAIL — `buildIssueBody` is not exported.

- [ ] **Step 3: Update `ErrorReportContext` interface**

In `packages/installer/src/utils/error-report.ts`, add two optional fields to the interface (around line 8):

```typescript
export interface ErrorReportContext {
  stepName: string;
  errorMessage: string;
  loxVersion: string;
  os: string;
  nodeVersion: string;
  subPhase?: string;
  sourceFile?: string;
}
```

- [ ] **Step 4: Export and update `buildIssueBody`**

Change `function buildIssueBody` to `export function buildIssueBody` and update the body to conditionally emit the new lines. Replace the entire function with:

```typescript
export function buildIssueBody(ctx: ErrorReportContext): string {
  const sanitizedError = sanitize(ctx.errorMessage);

  const subPhaseLine = ctx.subPhase ? `**Sub-phase:** ${ctx.subPhase}\n` : '';
  const sourceLine = ctx.sourceFile ? `**Source:** \`${ctx.sourceFile}\`\n` : '';

  return `## Auto-reported installer failure

**Step:** ${ctx.stepName}
${subPhaseLine}${sourceLine}
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
```

Note: the lines are templated with trailing `\n` inside the string so they produce clean output when present, and empty string when absent (no extra blank line).

- [ ] **Step 5: Run all tests in the file**

Run: `npm run test --workspace=packages/installer -- --run --reporter=verbose 2>&1 | tail -40`

Expected: all tests PASS (new + existing).

- [ ] **Step 6: Run type check**

Run: `npx tsc --noEmit --project packages/installer/tsconfig.json`

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/installer/src/utils/error-report.ts packages/installer/tests/utils/error-report.test.ts
git commit -m "feat: enrich issue body with sub-phase and source file (#51)"
```

---

### Task 3: Wire up enriched context in `index.ts`

**Files:**
- Modify: `packages/installer/src/index.ts`

- [ ] **Step 1: Update `handleStepFailure` to pass new fields**

In `packages/installer/src/index.ts`, update the import on line 18:

```typescript
import { offerErrorReport, extractSubPhase, sourceFileForStep } from './utils/error-report.js';
```

Replace the `offerErrorReport` call inside `handleStepFailure` (lines 24-30) with:

```typescript
  await offerErrorReport({
    stepName,
    errorMessage: message ?? 'Unknown error',
    subPhase: extractSubPhase(message ?? ''),
    sourceFile: sourceFileForStep(stepName),
    loxVersion: LOX_VERSION,
    os: `${process.platform} ${process.arch}`,
    nodeVersion: process.version,
  });
```

- [ ] **Step 2: Run full test suite**

Run: `npm run test --workspaces -- --run 2>&1 | tail -20`

Expected: all tests pass.

- [ ] **Step 3: Run type check across all packages**

Run: `npx tsc --noEmit --project packages/shared/tsconfig.json && npx tsc --noEmit --project packages/core/tsconfig.json && npx tsc --noEmit --project packages/installer/tsconfig.json`

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/installer/src/index.ts
git commit -m "feat: enrich auto-report with sub-phase and source file at call site (#51)"
```

---

### Task 4: Version bump, CHANGELOG, final review

**Files:**
- Modify: `package.json`, `packages/core/package.json`, `packages/shared/package.json`, `packages/installer/package.json`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Bump version 0.3.3 → 0.3.4**

Update `"version"` field in all 4 package.json files.

- [ ] **Step 2: Grep for stale version refs**

Run: `grep -r "0.3.3" packages/ --include="*.ts" --include="*.json" -l`

Expected: only the 4 package.json files. Fix any others found.

- [ ] **Step 3: Update CHANGELOG.md**

Add new section between `## [Unreleased]` and `## [0.3.3]`:

```markdown
## [0.3.4] — 2026-04-04

### Changed
- Auto-reported installer failures now include the sub-phase name and source file path, making issues easier to triage (#51)
```

- [ ] **Step 4: Run full test suite + type check**

Run: `npm run test --workspaces -- --run && npx tsc --noEmit --project packages/shared/tsconfig.json && npx tsc --noEmit --project packages/core/tsconfig.json && npx tsc --noEmit --project packages/installer/tsconfig.json`

Expected: all pass, clean.

- [ ] **Step 5: Code review**

Delegate to `code-reviewer` agent. Address any findings.

- [ ] **Step 6: Commit**

```bash
git add package.json packages/*/package.json CHANGELOG.md
git commit -m "chore: bump version to 0.3.4 and update CHANGELOG (#51)"
```
