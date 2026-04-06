# Idempotent Installer — Design Spec

**Issue:** #50 — VM Setup fails on re-run (`role "lox" already exists`)
**Date:** 2026-04-04
**Approach:** (B) Re-apply everything idempotently — all commands run every time but never fail if resources already exist.

## Problem

The installer's Step 8 (VM Setup) fails on second execution because `CREATE USER lox` and `CREATE DATABASE lox_brain` error when the role/database already exist. The `set -euo pipefail` directive causes the entire DB setup script to abort on the first failure.

This blocks re-installation for both the primary user and third-party testers (Lara on Windows) who need to re-run after fixing errors.

## Design

### 1. `buildDbSetupScript()` — Idempotent SQL (step-vm-setup.ts:298-329)

**Current (broken on re-run):**
```bash
sudo -u postgres psql -c "CREATE USER lox WITH PASSWORD '${pw}';"
sudo -u postgres psql -c "CREATE DATABASE lox_brain OWNER lox;"
```

**New (idempotent):**
```bash
# Create role or update password if already exists
sudo -u postgres psql -c "DO \$\$ BEGIN
  CREATE USER lox WITH PASSWORD '${pw}';
EXCEPTION WHEN duplicate_object THEN
  ALTER USER lox WITH PASSWORD '${pw}';
END \$\$;"

# Create database only if it doesn't exist (createdb exits 0 either way)
sudo -u postgres createdb --owner=lox lox_brain 2>/dev/null || true
```

**Why this approach:**
- `DO $$ ... EXCEPTION WHEN duplicate_object` is the standard PostgreSQL pattern for idempotent role creation. It also updates the password on re-run, which is correct behavior (Secret Manager gets a new version each run).
- `createdb ... 2>/dev/null || true` suppresses the "already exists" error. The `|| true` ensures `set -e` doesn't abort. Using `createdb` is simpler than a PL/pgSQL block for databases.
- The `CREATE EXTENSION IF NOT EXISTS vector` and all `CREATE TABLE/INDEX IF NOT EXISTS` statements are already idempotent — no changes needed.

### 2. pgvector clone cleanup (step-vm-setup.ts:79-84)

**Current:** `git clone` fails if `/tmp/pgvector` exists from an interrupted previous run.

**Fix:** Add `rm -rf /tmp/pgvector` before the clone:
```typescript
commands: [
  'sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq build-essential git',
  'rm -rf /tmp/pgvector',  // clean up interrupted previous run
  'cd /tmp && git clone --branch v0.8.0 https://github.com/pgvector/pgvector.git',
  'cd /tmp/pgvector && make && sudo make install',
  'rm -rf /tmp/pgvector',
],
```

### 3. Tests — Re-run scenario

Add test cases in `step-vm-setup.test.ts` that verify:
- `buildDbSetupScript()` output contains `DO $$ BEGIN` / `EXCEPTION WHEN duplicate_object` pattern
- `buildDbSetupScript()` output contains `|| true` for createdb
- pgvector phase commands include pre-clone cleanup (`rm -rf /tmp/pgvector` before `git clone`)

## What does NOT change

| Component | Why no change needed |
|-----------|---------------------|
| Phases 1-3 (apt-get update, Node.js, PostgreSQL) | `apt-get install` is naturally idempotent |
| Phase 5 (SSH hardening) | `sed -i` replacements are idempotent |
| Phase 6 (WireGuard install) | `apt-get install` is naturally idempotent |
| Secret Manager (lines 457-491) | Already has try/catch on `secrets create` |
| Steps 9, 10, 12 (VPN, Vault, Deploy) | Out of scope — separate issues if needed |

## Out of scope

- Phase skip/checkpoint system (YAGNI — idempotency makes this unnecessary)
- VPN key regeneration protection (separate concern, not in issue #50)
- Deploy step overwrite protection (separate concern)

## Version bump

Patch bump (fix): current version -> +0.0.1 across all 4 package.json files.
