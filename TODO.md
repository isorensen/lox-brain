# TODO

## Pending Phases

### Phase 10: Backups & Monitoring
- **Priority:** High
- PostgreSQL backup cron (daily pg_dump, keep 30 days)
- VM disk snapshot schedule
- Cloud Logging alerts for errors

### Phase 9: Cloud Run Panel (deferred)
- **Priority:** Low
- API endpoints: `POST /vm/start`, `POST /vm/stop`, `GET /vm/status`
- Protected by IAM (`--no-allow-unauthenticated`)
- Enables remote VM control from mobile/frontend

## Pending Improvements

### ~~Text chunking for large notes~~ — DONE (2026-03-09)
- `EmbeddingService.chunkText()`: maxTokens=4000, overlap=200, paragraph-based splitting
- Two-phase pipeline: generate all embeddings first, then batch upsert
- `chunk_index` column added to `vault_embeddings` (unique key: `file_path, chunk_index`)
- 243/243 notes indexed successfully (was 232/243 before chunking)

### ~~CI/CD auto-deploy~~ — DONE (2026-03-10)
- GitHub Actions: `ci.yml` (PR validation: build, test, coverage, audit) + `deploy.yml` (deploy on merge to main via IAP tunnel SSH)
- GCP SA `github-actions-deploy` with least-privilege roles
- Deploy: git pull, npm ci, build, restart watcher, kill MCP, health check

### SA key rotation schedule
- **Priority:** High
- `obsidian-vm-sa` key expires ~90 days from creation (2026-03-07) → **rotate by 2026-06-05**
- `github-actions-deploy` key `c3044b0c` (created 2026-03-10, no auto-expiry) → **rotate by 2026-06-08**
- Consider: automate rotation via Cloud Scheduler + Cloud Function, or at minimum set calendar reminders
- Long-term: migrate to Workload Identity Federation (keyless) for GitHub Actions

### Update google-github-actions to Node.js 24 compatible versions
- **Priority:** Medium
- **Deadline:** Before June 2, 2026
- `google-github-actions/auth@v2` and `google-github-actions/setup-gcloud@v2` use deprecated Node.js 20
- Check for v3 releases and update workflows

### Add ESLint to project
- **Priority:** Medium
- Add ESLint with TypeScript config
- Integrate into CI/CD PR validation pipeline
- Fix any existing lint issues

### ~~Search tools response size~~ — DONE (2026-03-08)
- `search_semantic`, `search_text`, `list_recent` now return metadata only by default.
- Added `offset`, `include_content`, `content_preview_length` params to all search tools.
- All search tools return `PaginatedResult { results, total, limit, offset }`.
- Use `read_note` for full content after finding notes via search.
