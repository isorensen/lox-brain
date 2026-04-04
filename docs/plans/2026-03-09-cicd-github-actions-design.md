# CI/CD with GitHub Actions — Design

## Overview

Two GitHub Actions workflows for the Open Brain project:

1. **`ci.yml`** — runs on PRs targeting `main` — validates code quality
2. **`deploy.yml`** — runs on push/merge to `main` — deploys to VM via GCP IAP

## Workflow 1: CI (Pull Requests)

**Trigger:** `pull_request` targeting `main`

**Steps:**
1. Checkout code
2. Setup Node.js 22
3. `npm ci`
4. `npm run build` (tsc)
5. `npm test`
6. `npm run test:coverage` (fail if below 80%)
7. `npm audit --audit-level=high`

**Branch protection:** Configure GitHub to require this check to pass before merge.

## Workflow 2: Deploy (merge to main)

**Trigger:** `push` to `main`

**Authentication:** `google-github-actions/auth` with SA key JSON as GitHub Secret.

**Steps:**
1. Authenticate with GCP via SA `<your-deploy-sa>`
2. Setup `gcloud` CLI
3. SSH via IAP tunnel to VM and execute:
   ```bash
   cd ~/lox-brain
   git pull origin main
   npm ci --production
   npm run build
   sudo systemctl restart obsidian-watcher
   pkill -f "tsx src/mcp/index.ts" || true
   systemctl is-active obsidian-watcher  # health check
   ```

## Service Account

- **Name:** `<your-deploy-sa>`
- **Project:** `<your-gcp-project>`
- **Roles (minimal):**
  - `roles/compute.instanceAdmin.v1` (SSH access to VM)
  - `roles/iap.tunnelResourceAccessor` (IAP tunnel access)
- **Key:** JSON format, stored as GitHub Secret `GCP_SA_KEY`
- **Rotation:** Every 90 days (tracked in TODO.md)

## GitHub Secrets

| Secret | Value |
|--------|-------|
| `GCP_SA_KEY` | Service account key JSON |
| `GCP_PROJECT_ID` | `<your-gcp-project>` |

## Security Considerations

- No additional firewall ports required (uses existing IAP)
- Service account follows least-privilege principle (SSH via IAP only)
- Key rotation every 90 days
- Branch protection prevents merge without green CI
- Tests and audit run in PR, not on VM (no secrets exposed during validation)
- Long-term: migrate to Workload Identity Federation for keyless auth

## Architecture

```
GitHub PR --> CI workflow (build, test, coverage, audit)
                |
                v (must pass)
GitHub merge to main --> Deploy workflow
                            |
                            v
                google-github-actions/auth (SA key)
                            |
                            v
                gcloud compute ssh --tunnel-through-iap
                            |
                            v
                VM: git pull, npm ci, build, restart watcher, kill MCP
                            |
                            v
                Health check: systemctl is-active obsidian-watcher
```
