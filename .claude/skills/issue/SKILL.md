---
name: issue
description: Handle GitHub issues end-to-end for the lox-brain project. Use this skill whenever the user mentions an issue number, asks to fix a bug, wants to work on a GitHub issue, says "issue", "#17", "#21", or refers to any open issue. Also trigger when the user asks to check open issues, triage bugs, or work on reported problems. Supports "issue new <description>" to create a new issue and start working on it. This skill ensures nothing is missed — version bumps, changelog, tests, code review, PR, release, and cleanup.
---

# /issue — GitHub Issue Handler

End-to-end workflow for resolving GitHub issues in the lox-brain monorepo. Covers everything from reading the issue to creating the GitHub Release.

## Usage modes

- `/issue <number>` — Work on an existing issue (full workflow below)
- `/issue new <description>` — Create a new issue and optionally start working on it
- `/issue` (no args) — List open issues and ask which to work on

## Why this skill exists

Handling issues in this project requires a specific checklist that is easy to forget partially. Past incidents:
- Version hardcoded in `LOX_VERSION` and `DEFAULT_CONFIG.version` was not updated alongside `package.json`, causing the splash screen to show the wrong version for multiple releases.
- Windows `.cmd` fix was shipped but didn't actually work because `execFile()` can't run `.cmd` files — unit tests with mocks passed but real execution failed.
- Code review findings were not addressed before merge.

This skill encodes the full checklist so nothing slips through.

## Creating a new issue (`/issue new`)

When the user provides a description for a new issue:

1. **Determine issue type**: bug, feature, or enhancement based on the description.
2. **Draft the issue** using the repo's issue templates. Create via:
   ```
   gh issue create --title "<title>" --body "<body>" --label <bug|enhancement>
   ```
3. **Show the created issue URL** to the user.
4. **Ask**: "Want to start working on this issue now?" If yes, proceed with the full workflow below using the new issue number.

Keep the title concise (<70 chars). Use the description body to include context, expected behavior, and any relevant details the user provided.

## Working on an issue (`/issue <number>`)

### Phase 0 — Orient (if context is fresh)

If you're starting with a clean conversation and don't yet know this codebase, do this FIRST before reading the issue:

1. **Read `CLAUDE.md`** — project overview, architecture (Obsidian vault <-> VM via WireGuard <-> MCP server), monorepo layout, tech stack (TypeScript + Node 22 + PostgreSQL 16 + pgvector + vitest), security constraints (Zero Trust, no public IPs, no hardcoded secrets).
2. **Scan `packages/`** — `ls packages/` shows which packages exist. Key packages:
   - `installer/` — cross-platform setup wizard (user flow, runs locally on user machine)
   - `core/` — MCP server, vault watcher, embedding service (runs on GCP VM)
   - `shared/` — constants, types shared across packages
   - `cli/` — `lox` command-line tool (lox status, lox migrate)
3. **Know where fixes live**: installer bugs -> `packages/installer/src/steps/step-*.ts`; MCP/DB bugs -> `packages/core/src/`; version/constants -> `packages/shared/`.
4. **Know the cross-platform pitfalls**: `shell()` in `packages/installer/src/utils/shell.ts` wraps commands with `cmd.exe /c` on Windows. `execFile` with arrays does NOT resolve `.cmd`/`.bat` — always use `shell()` or `execSync` with a string for Windows compatibility.

Skip this phase if you already have this context loaded from earlier in the conversation.

### Phase 1 — Understand

1. **Read the issue**: `gh issue view <number> --comments` — understand the bug/feature, environment, steps to reproduce. **Always include `--comments`** to see the full conversation.
2. **Scan for private data in comments**: Check every comment for sensitive information:
   - GCP project numbers, project IDs, billing account IDs
   - Service account emails, API keys, tokens, Help Tokens
   - Windows user paths (`C:\Users\<name>\...`)
   - IP addresses, SSH keys, credentials of any kind
   - If found: **delete the comment** (`gh api repos/OWNER/REPO/issues/comments/ID -X DELETE`) and **create a replacement comment** summarizing the content without the sensitive data. Only repo admins can delete others' comments.
3. **Read related code**: Explore the files involved before proposing changes. Never modify code you haven't read.
4. **Check for related issues**: `gh issue list --state open` — are there duplicates or related issues?

### Phase 2 — Branch

4. **Create branch** from `main` with naming convention:
   - `fix/<description>` for bugs
   - `feat/<description>` for features
   - `refactor/<description>` for refactoring
   - `chore/<description>` for maintenance

### Phase 3 — Implement (TDD)

5. **Write tests first** — cover the bug scenario or new feature behavior.
6. **Implement the fix** — delegate to `coder-opus` for complex changes, `coder-sonnet` for simple edits.
7. **Run tests**: `npm run test --workspaces` — all must pass.
8. **Run type check**: `npx tsc --noEmit --project packages/shared/tsconfig.json && npx tsc --noEmit --project packages/core/tsconfig.json && npx tsc --noEmit --project packages/installer/tsconfig.json`

### Phase 4 — Version & Docs

9. **Bump version** in ALL `package.json` files (SemVer: patch for fixes, minor for features, major for breaking):
   - `package.json` (root)
   - `packages/core/package.json`
   - `packages/shared/package.json`
   - `packages/installer/package.json`

   `LOX_VERSION` reads from `packages/shared/package.json` dynamically — no manual update needed. But **verify** it's still dynamic (not hardcoded) with: `grep -n 'LOX_VERSION' packages/shared/src/constants.ts`

10. **Update CHANGELOG.md** — add entry under new version heading with `### Fixed`, `### Changed`, `### Added` as appropriate. Reference issue numbers.

11. **Grep for stale version references** — this is critical:
    ```
    grep -r "OLD_VERSION" packages/ --include="*.ts" --include="*.json" -l
    ```
    Check for hardcoded version strings in source code, tests, and config files. Fix any that still reference the old version.

### Phase 5 — Review

12. **Run tests again** after version bump to confirm nothing broke.
13. **Code review** — delegate to `code-reviewer` agent (model: sonnet). The goal is **no remaining comments**. If there are findings:
    - Fix all real issues (not just nits)
    - Re-run tests after fixes
    - Only proceed when review is clean

### Phase 6 — Ship

14. **Ask user for commit confirmation** — NEVER auto-commit.
15. **Commit** with descriptive message referencing issue number(s): `Closes #N`
16. **Push** and **create PR** via `gh pr create`.
17. **Watch CI**: `gh pr checks <number> --watch` — wait for `validate` to pass.
18. **Merge** when CI passes: `gh pr merge <number> --merge`
19. **Create GitHub Release**: `gh release create vX.Y.Z` with CHANGELOG entry as notes.
20. **Cleanup**: switch to main, pull, delete local and remote branch.

## Checklist summary (quick reference)

```
[ ] (If fresh context) Read CLAUDE.md, scan packages/
[ ] Read issue on GitHub
[ ] Create branch (fix/, feat/, etc.)
[ ] Write tests first (TDD)
[ ] Implement fix
[ ] All tests pass
[ ] Type check clean
[ ] Version bump (all 4 package.json files)
[ ] Verify LOX_VERSION is dynamic (not hardcoded)
[ ] Grep for stale version references
[ ] Update CHANGELOG.md
[ ] Code review (code-reviewer agent) — no comments
[ ] User confirms commit
[ ] Push + PR
[ ] CI passes
[ ] Merge
[ ] GitHub Release (vX.Y.Z)
[ ] Delete branch (local + remote)
```

## Windows-specific awareness

Many issues in this project stem from Windows compatibility. When fixing installer bugs:
- Remember that `shell()` in `utils/shell.ts` wraps commands with `cmd.exe /c` on Windows
- `execSync` with string commands uses the system shell (works on Windows)
- `execFile` with arrays does NOT resolve `.cmd`/`.bat` — that's why `shell()` has the wrapper
- Always consider: "would this work on Windows?" when touching installer code
- The reporter (Lara) tests on Windows 11 — she is the primary Windows validation path

## Anti-patterns to avoid

- **Never ship a fix without verifying it works end-to-end** — mocked unit tests can pass while the real execution fails (learned from the `gcloud.cmd` incident).
- **Never assume version is updated everywhere** — always grep for the old version string.
- **Never skip code review** — it catches real issues (ENOENT masking, import ordering, missing test paths).
- **Never commit without user confirmation**.
- **Never force-push to main**.
