# Idempotent Installer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the installer's VM Setup step (Step 8) idempotent so re-running the installer never fails due to pre-existing PostgreSQL roles, databases, or stale temp files.

**Architecture:** Replace `CREATE USER`/`CREATE DATABASE` with PostgreSQL `DO $$ ... EXCEPTION` blocks and `|| true` guards. Add pre-clone cleanup for pgvector. No new files — only modifying `step-vm-setup.ts` and its test file.

**Tech Stack:** TypeScript, PostgreSQL PL/pgSQL, vitest

---

### Task 1: Write failing tests for idempotent DB setup script

**Files:**
- Modify: `packages/installer/tests/steps/step-vm-setup.test.ts:373-386`

- [ ] **Step 1: Add test — DB setup script uses idempotent role creation**

Add this test inside the existing `describe('stepVmSetup -- DB setup phase')` block (after line 385):

```typescript
  it('uses idempotent role creation (DO block with EXCEPTION)', async () => {
    mockAllPhasesSuccess();

    await stepVmSetup(makeCtx());

    // DB setup is the 7th phase script (index 6)
    const dbScriptContent = writeFileSyncMock.mock.calls[TOTAL_SSH_PHASES - 1][1] as string;
    // Must use DO $$ block with EXCEPTION for idempotent role creation
    expect(dbScriptContent).toContain('DO');
    expect(dbScriptContent).toContain('EXCEPTION WHEN duplicate_object');
    expect(dbScriptContent).toContain('ALTER USER lox');
    // Must NOT use bare CREATE USER (without exception handling)
    expect(dbScriptContent).not.toMatch(/CREATE USER lox[^]*?;\s*"\s*&&\s*sudo/);
  });
```

- [ ] **Step 2: Add test — DB setup script uses idempotent database creation**

Add immediately after the previous test:

```typescript
  it('uses idempotent database creation (|| true guard)', async () => {
    mockAllPhasesSuccess();

    await stepVmSetup(makeCtx());

    const dbScriptContent = writeFileSyncMock.mock.calls[TOTAL_SSH_PHASES - 1][1] as string;
    // createdb with || true, OR a DO block / IF NOT EXISTS guard
    expect(dbScriptContent).toMatch(/createdb.*\|\| true|CREATE DATABASE.*IF NOT EXISTS|DO.*CREATE DATABASE.*EXCEPTION/s);
  });
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /Users/eduardosorensen/iDev.nosync/iSorensen/OPEN_BRAIN/lox-brain && npm run test --workspace=packages/installer -- --run --reporter=verbose 2>&1 | tail -30`

Expected: The two new tests FAIL because `buildDbSetupScript()` still uses bare `CREATE USER` and `CREATE DATABASE`.

- [ ] **Step 4: Commit failing tests**

```bash
git add packages/installer/tests/steps/step-vm-setup.test.ts
git commit -m "test: add failing tests for idempotent DB setup script (#50)"
```

---

### Task 2: Make `buildDbSetupScript()` idempotent

**Files:**
- Modify: `packages/installer/src/steps/step-vm-setup.ts:298-329`

- [ ] **Step 1: Replace `buildDbSetupScript()` with idempotent SQL**

Replace the function body at lines 298-329 with:

```typescript
function buildDbSetupScript(dbPassword: string): string {
  // Escape single quotes in password for SQL safety
  const escapedPw = dbPassword.replace(/'/g, "''");

  return [
    'set -euo pipefail',

    // Configure PostgreSQL: listen on localhost only (Zero Trust)
    "sudo sed -i \"s/#listen_addresses = 'localhost'/listen_addresses = 'localhost'/\" /etc/postgresql/16/main/postgresql.conf",
    'sudo systemctl restart postgresql',

    // Create DB user (idempotent: update password if role already exists)
    `sudo -u postgres psql -c "DO \\$\\$ BEGIN CREATE USER ${DB_USER} WITH PASSWORD '${escapedPw}'; EXCEPTION WHEN duplicate_object THEN ALTER USER ${DB_USER} WITH PASSWORD '${escapedPw}'; END \\$\\$;"`,

    // Create database (idempotent: suppress error if already exists)
    `sudo -u postgres createdb --owner=${DB_USER} ${DB_NAME} 2>/dev/null || true`,

    // Enable pgvector extension (already idempotent)
    `sudo -u postgres psql -d ${DB_NAME} -c "CREATE EXTENSION IF NOT EXISTS vector;"`,

    // Apply schema (already idempotent — all IF NOT EXISTS)
    `sudo -u postgres psql -d ${DB_NAME} -c "
      CREATE TABLE IF NOT EXISTS vault_embeddings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        file_path TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        tags TEXT[] NOT NULL DEFAULT '{}',
        embedding vector(1536),
        file_hash TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_embedding_cosine ON vault_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
      CREATE INDEX IF NOT EXISTS idx_tags ON vault_embeddings USING gin (tags);
      CREATE INDEX IF NOT EXISTS idx_updated_at ON vault_embeddings (updated_at DESC);
    "`,
  ].join(' && ');
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd /Users/eduardosorensen/iDev.nosync/iSorensen/OPEN_BRAIN/lox-brain && npm run test --workspace=packages/installer -- --run --reporter=verbose 2>&1 | tail -30`

Expected: All tests PASS, including the two new idempotency tests.

- [ ] **Step 3: Run type check**

Run: `cd /Users/eduardosorensen/iDev.nosync/iSorensen/OPEN_BRAIN/lox-brain && npx tsc --noEmit --project packages/installer/tsconfig.json`

Expected: Clean, no errors.

- [ ] **Step 4: Update existing test assertion**

The existing test at line 381 asserts `expect(dbScriptContent).toContain('CREATE USER lox')`. This still holds (the string appears inside the DO block). Verify it passes — no change needed. But if the assertion format changed, update it to match.

- [ ] **Step 5: Commit implementation**

```bash
git add packages/installer/src/steps/step-vm-setup.ts
git commit -m "fix: make DB setup idempotent — CREATE USER/DATABASE safe on re-run (#50)"
```

---

### Task 3: Fix pgvector clone idempotency

**Files:**
- Modify: `packages/installer/src/steps/step-vm-setup.ts:78-84`
- Modify: `packages/installer/tests/steps/step-vm-setup.test.ts`

- [ ] **Step 1: Add failing test for pgvector pre-clone cleanup**

Add a new `describe` block after the `DB setup phase` describe:

```typescript
describe('stepVmSetup -- pgvector phase idempotency', () => {
  it('cleans up /tmp/pgvector before git clone to handle interrupted previous runs', async () => {
    mockAllPhasesSuccess();

    await stepVmSetup(makeCtx());

    // pgvector is the 4th phase script (index 3)
    const pgvectorScript = writeFileSyncMock.mock.calls[3][1] as string;
    // rm -rf /tmp/pgvector must appear BEFORE git clone
    const rmIndex = pgvectorScript.indexOf('rm -rf /tmp/pgvector');
    const cloneIndex = pgvectorScript.indexOf('git clone');
    expect(rmIndex).toBeGreaterThan(-1);
    expect(cloneIndex).toBeGreaterThan(-1);
    expect(rmIndex).toBeLessThan(cloneIndex);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/eduardosorensen/iDev.nosync/iSorensen/OPEN_BRAIN/lox-brain && npm run test --workspace=packages/installer -- --run --reporter=verbose -t "pgvector phase idempotency" 2>&1 | tail -20`

Expected: FAIL — the `rm -rf` currently appears only after the clone, not before.

- [ ] **Step 3: Add pre-clone cleanup to pgvector commands**

In `step-vm-setup.ts`, modify the pgvector phase commands array (lines 79-84):

```typescript
  {
    name: 'vm_phase_pgvector',
    commands: [
      'sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq build-essential git',
      'rm -rf /tmp/pgvector',
      'cd /tmp && git clone --branch v0.8.0 https://github.com/pgvector/pgvector.git',
      'cd /tmp/pgvector && make && sudo make install',
      'rm -rf /tmp/pgvector',
    ],
    timeout: 300_000, // 5 min — compiling from source
  },
```

- [ ] **Step 4: Run all tests to verify everything passes**

Run: `cd /Users/eduardosorensen/iDev.nosync/iSorensen/OPEN_BRAIN/lox-brain && npm run test --workspace=packages/installer -- --run --reporter=verbose 2>&1 | tail -30`

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/installer/src/steps/step-vm-setup.ts packages/installer/tests/steps/step-vm-setup.test.ts
git commit -m "fix: add pgvector pre-clone cleanup for interrupted re-runs (#50)"
```

---

### Task 4: Version bump, CHANGELOG, and code review

**Files:**
- Modify: `package.json` (root)
- Modify: `packages/core/package.json`
- Modify: `packages/shared/package.json`
- Modify: `packages/installer/package.json`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Bump version 0.3.2 -> 0.3.3 in all package.json files**

Update `"version"` field in these 4 files:
- `package.json` (root): `"0.3.2"` -> `"0.3.3"`
- `packages/core/package.json`: `"0.3.2"` -> `"0.3.3"`
- `packages/shared/package.json`: `"0.3.2"` -> `"0.3.3"`
- `packages/installer/package.json`: `"0.3.2"` -> `"0.3.3"`

- [ ] **Step 2: Verify LOX_VERSION is dynamic**

Run: `grep -n 'LOX_VERSION' packages/shared/src/constants.ts`

Expected: Should read version from `package.json` dynamically, not a hardcoded string.

- [ ] **Step 3: Grep for stale version references**

Run: `grep -r "0.3.2" packages/ --include="*.ts" --include="*.json" -l`

Fix any remaining references to `0.3.2` in source code (not in CHANGELOG or lock files).

- [ ] **Step 4: Update CHANGELOG.md**

Add entry under `## [Unreleased]` or create `## [0.3.3]` section:

```markdown
## [0.3.3] — 2026-04-04

### Fixed
- Installer VM Setup step now idempotent — re-running no longer fails with `role "lox" already exists` (#50)
- pgvector compilation phase handles interrupted previous runs by cleaning `/tmp/pgvector` before clone
```

- [ ] **Step 5: Run full test suite**

Run: `cd /Users/eduardosorensen/iDev.nosync/iSorensen/OPEN_BRAIN/lox-brain && npm run test --workspaces -- --run 2>&1 | tail -20`

Expected: All tests pass across all workspaces.

- [ ] **Step 6: Run type check across all packages**

Run: `npx tsc --noEmit --project packages/shared/tsconfig.json && npx tsc --noEmit --project packages/core/tsconfig.json && npx tsc --noEmit --project packages/installer/tsconfig.json`

Expected: Clean, no errors.

- [ ] **Step 7: Code review**

Delegate to `code-reviewer` agent (model: sonnet). Address all findings before proceeding.

- [ ] **Step 8: Commit version bump and CHANGELOG**

```bash
git add package.json packages/*/package.json CHANGELOG.md
git commit -m "chore: bump version to 0.3.3 and update CHANGELOG (#50)"
```
