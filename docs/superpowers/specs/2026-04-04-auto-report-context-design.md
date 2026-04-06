# Auto-Report Context Enrichment — Design Spec

**Issue:** #51
**Date:** 2026-04-04
**Approach:** Minimal — parse existing message + map step name to source file. No refactor of `StepResult`.

## Problem

Auto-reported installer failures (e.g. #50) contain only `Step: VM Setup` + raw error message. Readers must ask "which sub-phase? which file?" to triage. Stack traces are not available because step functions return `{success, message: string}` — errors are stringified before reaching the reporter.

## Scope

Cover the 2 high-value fields achievable without refactoring step contracts:

1. **Sub-phase name** — extracted from error message format `"<sub-phase> failed: <error>"`
2. **Source file path** — derived from `stepName` via a fixed map

Stack traces and command extraction are out of scope (would require refactoring `StepResult` across 13 step files).

## Design

### `packages/installer/src/utils/error-report.ts`

Extend `ErrorReportContext` interface:

```typescript
export interface ErrorReportContext {
  stepName: string;
  errorMessage: string;
  loxVersion: string;
  os: string;
  nodeVersion: string;
  subPhase?: string;     // NEW
  sourceFile?: string;   // NEW
}
```

Add two exported pure helpers:

```typescript
export function extractSubPhase(message: string): string | undefined {
  const m = message.match(/^(.+?) failed: /);
  return m ? m[1] : undefined;
}

export function sourceFileForStep(stepName: string): string | undefined {
  return STEP_SOURCE_FILES[stepName];
}
```

Static map `STEP_SOURCE_FILES` covers all 12 steps from `index.ts`:
Prerequisites, GCP Auth, GCP Project, Billing, VPC Network, VM Instance, VM Setup, WireGuard VPN, Vault Setup, Obsidian, Deploy, MCP Server.

Update `buildIssueBody()` to emit `**Sub-phase:**` and `**Source:**` lines when the fields are present. Omit them when `undefined` so existing call sites continue to work.

### `packages/installer/src/index.ts`

In `handleStepFailure`, call the helpers and pass both fields:

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

### Testing

Unit tests for the two pure helpers + one integration test verifying that `buildIssueBody` includes the new lines when fields are present and omits them when absent.

Representative test cases:
- `extractSubPhase('Creating database and schema failed: ERROR: role ...')` → `'Creating database and schema'`
- `extractSubPhase('SSH warm-up failed: Connection reset')` → `'SSH warm-up'`
- `extractSubPhase('Unknown error')` → `undefined`
- `sourceFileForStep('VM Setup')` → `'packages/installer/src/steps/step-vm-setup.ts'`
- `sourceFileForStep('NonExistent')` → `undefined`

## Version bump

0.3.3 → 0.3.4 (patch — user-visible improvement, no behavior change).

## Out of scope

- Stack trace capture (would require refactoring `StepResult` to carry `Error` objects)
- Command/SQL extraction from failure sites
- i18n for the new labels (follows existing pattern — labels are English in the issue body)
- Auto-assignment or label enrichment on the GitHub issue
