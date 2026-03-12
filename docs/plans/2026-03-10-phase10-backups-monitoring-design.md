# Phase 10: Backups, Monitoring & VM Schedule — Design

**Date:** 2026-03-10
**Status:** Approved

## 1. PostgreSQL Backup (pg_dump + GCS)

- Script `/home/sorensen/scripts/pg-backup.sh`
- Executes `pg_dump open_brain | gzip` as postgres user
- Local destination: `/home/sorensen/backups/open_brain_YYYY-MM-DD.sql.gz`
- Upload to GCS: `gsutil cp` to `gs://obsidian-brain-backups/pg/`
- Schedule: daily at 22h BRT (01:00 UTC) via cron
- Retention: 30 days (local `find -mtime +30 -delete`, GCS lifecycle policy)
- Notification: curl to Google Chat webhook on success or failure
- Permissions: backup files `chmod 600`

## 2. GCS Backup Bucket

- Bucket: `obsidian-brain-backups` (us-east1, Standard storage)
- Uniform bucket-level access (no public ACLs)
- Encryption: Google-managed (default)
- Lifecycle policy: delete objects older than 30 days
- Versioning: enabled (protects against corrupted overwrites)
- Access: `obsidian-vm-sa` with `roles/storage.objectCreator` only (write-only, no list/delete)
- Network: VM accesses GCS via Google Private Access (internal traffic)

## 3. VM Disk Snapshot (GCP native)

- Resource policy: `obsidian-vm-daily-snapshot`
- Schedule: daily at 02:00 UTC (after pg_dump completes at 01:00 UTC)
- Retention: 7 days (auto-delete by GCP)
- Applied to: boot disk of `obsidian-vm`

## 4. VM Instance Schedule (GCP native)

- Resource policy: `obsidian-vm-schedule`
- Start: 07:00 BRT (10:00 UTC)
- Stop: 23:00 BRT (02:00 UTC)
- Timezone: America/Sao_Paulo
- Ad-hoc control remains for Phase 9 (Cloud Run Panel, future)

## 5. Alerts — Hybrid Approach

### Cloud Monitoring (infrastructure)

- Disk utilization > 80%
- VM up/down (uptime check)

### Scripts → Google Chat webhook (application)

- pg_dump backup: success/failure (from pg-backup.sh)
- Watcher restart/crash (systemd health check or ExecStartPost)
- Deploy notifications (add webhook call to deploy.sh)
- OpenAI embedding errors (periodic health check)
- Git sync failures (add notification to git-sync.sh)

### Webhook

- Google Chat Space webhook URL
- Stored in GCP Secret Manager (secret: `gchat-webhook-url`), never hardcoded
- Helper function or script snippet for consistent message formatting

## 6. Security

- Webhook URL in Secret Manager (not hardcoded in scripts)
- Backup files: `chmod 600` (owner-only read/write)
- pg_dump via local socket (no credentials exposed)
- GCS bucket: private, uniform access, no public ACLs
- SA `obsidian-vm-sa`: only `storage.objectCreator` on backup bucket (least privilege)
- GCS accessed via Google Private Access (no public internet)
- Snapshot policy managed by GCP (no credentials needed)

## 7. Timeline of Daily Operations (UTC)

| Time (UTC) | Time (BRT) | Event |
|------------|------------|-------|
| 01:00 | 22:00 | pg_dump backup + GCS upload |
| 02:00 | 23:00 | VM stops (instance schedule) |
| 02:00 | 23:00 | Disk snapshot (GCP policy) |
| 10:00 | 07:00 | VM starts (instance schedule) |

## 8. Cost Estimate

- GCS Standard (us-east1): ~$0.02/GB/month. Daily pg_dump ~5MB compressed → ~$0.003/month
- Disk snapshots: ~$0.026/GB/month for changed blocks. 7 days retention → minimal
- Instance schedule savings: VM off ~8h/day → ~33% reduction on compute costs
- Cloud Monitoring: free tier covers basic alerting
