# Phase 10: Backups, Monitoring & VM Schedule — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Set up automated PostgreSQL backups with off-site storage (GCS), VM disk snapshots, instance scheduling for cost savings, and hybrid alerting via Cloud Monitoring + Google Chat webhook.

**Architecture:** pg_dump cron → local gzip → GCS upload. GCP resource policies for snapshots and instance schedule. Hybrid alerting: Cloud Monitoring for infra metrics, shell scripts → Google Chat webhook for application events. Webhook URL stored in Secret Manager.

**Tech Stack:** Bash scripts, GCP (Cloud Storage, Compute Engine resource policies, Cloud Monitoring, Secret Manager), cron, gsutil, Google Chat webhook API

---

### Task 1: Create GCS Backup Bucket

**Context:** We need a private bucket for off-site pg_dump storage. Project: `<your-gcp-project>`, region: `us-east1`, SA: `lox-vm-sa`.

**Step 1: SSH into context and create bucket**

Run from local machine:
```bash
ssh lox-vm
```

Then on the VM, verify gcloud is authenticated:
```bash
gcloud config get-value project
# Expected: <your-gcp-project>
```

**Step 2: Create the GCS bucket**

```bash
gcloud storage buckets create gs://obsidian-brain-backups \
  --location=us-east1 \
  --uniform-bucket-level-access \
  --no-public-access-prevention=enforced \
  --default-storage-class=STANDARD
```

Wait — correction: use `--public-access-prevention=enforced`:
```bash
gcloud storage buckets create gs://obsidian-brain-backups \
  --location=us-east1 \
  --uniform-bucket-level-access \
  --public-access-prevention=enforced \
  --default-storage-class=STANDARD
```

Expected: `Creating gs://obsidian-brain-backups/...`

**Step 3: Enable versioning**

```bash
gcloud storage buckets update gs://obsidian-brain-backups --versioning
```

**Step 4: Set lifecycle policy (delete after 30 days)**

Create `/tmp/lifecycle.json`:
```json
{
  "rule": [
    {
      "action": {"type": "Delete"},
      "condition": {"age": 30}
    }
  ]
}
```

Apply:
```bash
gcloud storage buckets update gs://obsidian-brain-backups --lifecycle-file=/tmp/lifecycle.json
rm /tmp/lifecycle.json
```

**Step 5: Grant write-only access to VM service account**

```bash
gcloud storage buckets add-iam-policy-binding gs://obsidian-brain-backups \
  --member="serviceAccount:<your-vm-sa>@<your-project>.iam.gserviceaccount.com" \
  --role="roles/storage.objectCreator"
```

**Step 6: Verify access from VM**

```bash
echo "test" > /tmp/test-backup.txt
gsutil cp /tmp/test-backup.txt gs://obsidian-brain-backups/test/
gsutil ls gs://obsidian-brain-backups/test/
# Expected: gs://obsidian-brain-backups/test/test-backup.txt
gsutil rm gs://obsidian-brain-backups/test/test-backup.txt
rm /tmp/test-backup.txt
```

Note: `gsutil rm` will fail if SA only has `objectCreator`. If so, delete via console or grant temporary `objectAdmin` then revoke. The SA should NOT have delete permissions in production — this is expected.

**Step 7: Verify — list bucket settings**

```bash
gcloud storage buckets describe gs://obsidian-brain-backups --format="yaml(versioning,lifecycle,iamConfiguration)"
```

Confirm: versioning enabled, lifecycle 30-day delete, uniform bucket-level access.

---

### Task 2: Store Google Chat Webhook URL in Secret Manager

**Context:** The webhook URL must never be hardcoded in scripts. Store in GCP Secret Manager. The VM SA `lox-vm-sa` already has `secretmanager.secretAccessor` role.

**Step 1: Create the secret**

On the VM:
```bash
echo -n "YOUR_GCHAT_WEBHOOK_URL" | \
  gcloud secrets create gchat-webhook-url \
    --data-file=- \
    --replication-policy=automatic
```

Expected: `Created version [1] of the secret [gchat-webhook-url].`

**Step 2: Verify retrieval**

```bash
gcloud secrets versions access latest --secret=gchat-webhook-url
# Expected: the full webhook URL
```

**Step 3: Test sending a message**

```bash
WEBHOOK_URL=$(gcloud secrets versions access latest --secret=gchat-webhook-url)
curl -s -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d '{"text": "🧪 Test alert from lox-vm — Secret Manager + webhook working!"}'
```

Expected: JSON response with message details. Check Google Chat Space for the message.

---

### Task 3: Create Backup Script with Notifications

**Context:** Script runs as cron job. Does pg_dump, compresses, uploads to GCS, cleans old local backups, and notifies via Google Chat webhook. Follows existing pattern from `scripts/deploy.sh` (set -euo pipefail).

**Step 1: Create backup directory on VM**

```bash
ssh lox-vm "mkdir -p /home/<user>/backups && chmod 700 /home/<user>/backups"
```

**Step 2: Create the backup script**

Create file on VM at `/home/<user>/scripts/pg-backup.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

# --- Config ---
BACKUP_DIR="/home/<user>/backups"
BUCKET="gs://obsidian-brain-backups/pg"
DB_NAME="open_brain"
RETENTION_DAYS=30
DATE=$(date +%Y-%m-%d)
BACKUP_FILE="${BACKUP_DIR}/${DB_NAME}_${DATE}.sql.gz"
LOG_FILE="${BACKUP_DIR}/backup.log"

# --- Webhook helper ---
send_alert() {
  local status="$1"
  local message="$2"
  local emoji
  if [ "$status" = "success" ]; then emoji="✅"; else emoji="🚨"; fi

  WEBHOOK_URL=$(gcloud secrets versions access latest --secret=gchat-webhook-url 2>/dev/null || true)
  if [ -n "$WEBHOOK_URL" ]; then
    curl -s -X POST "$WEBHOOK_URL" \
      -H "Content-Type: application/json" \
      -d "{\"text\": \"${emoji} *pg_dump backup — ${status}*\n${message}\nVM: lox-vm | DB: ${DB_NAME} | Date: ${DATE}\"}" \
      > /dev/null 2>&1 || true
  fi
}

# --- Main ---
echo "[$(date -Iseconds)] Starting backup of ${DB_NAME}..." | tee -a "$LOG_FILE"

# pg_dump (runs as current user, needs sudo to postgres)
if sudo -u postgres pg_dump "$DB_NAME" | gzip > "$BACKUP_FILE"; then
  chmod 600 "$BACKUP_FILE"
  SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
  echo "[$(date -Iseconds)] pg_dump OK: ${BACKUP_FILE} (${SIZE})" | tee -a "$LOG_FILE"
else
  echo "[$(date -Iseconds)] pg_dump FAILED" | tee -a "$LOG_FILE"
  send_alert "FAILURE" "pg_dump failed. Check ${LOG_FILE} on VM."
  exit 1
fi

# Upload to GCS
if gsutil cp "$BACKUP_FILE" "${BUCKET}/"; then
  echo "[$(date -Iseconds)] GCS upload OK: ${BUCKET}/${DB_NAME}_${DATE}.sql.gz" | tee -a "$LOG_FILE"
else
  echo "[$(date -Iseconds)] GCS upload FAILED" | tee -a "$LOG_FILE"
  send_alert "FAILURE" "pg_dump succeeded but GCS upload failed. Local backup preserved at ${BACKUP_FILE}."
  exit 1
fi

# Clean old local backups
DELETED=$(find "$BACKUP_DIR" -name "*.sql.gz" -mtime +${RETENTION_DAYS} -delete -print | wc -l)
echo "[$(date -Iseconds)] Cleaned ${DELETED} old local backups (>${RETENTION_DAYS} days)" | tee -a "$LOG_FILE"

# Success notification
send_alert "SUCCESS" "Backup: ${SIZE} | GCS: ${BUCKET}/ | Old cleaned: ${DELETED}"
echo "[$(date -Iseconds)] Backup complete." | tee -a "$LOG_FILE"
```

**Step 3: Make executable**

```bash
ssh lox-vm "chmod +x /home/<user>/scripts/pg-backup.sh"
```

**Step 4: Test the script manually**

```bash
ssh lox-vm "/home/<user>/scripts/pg-backup.sh"
```

Expected:
- Local file created in `/home/<user>/backups/`
- File uploaded to GCS
- Google Chat notification received
- No errors

**Step 5: Verify GCS upload**

```bash
ssh lox-vm "gsutil ls gs://obsidian-brain-backups/pg/"
# Expected: gs://obsidian-brain-backups/pg/open_brain_2026-03-10.sql.gz
```

**Step 6: Set up cron job (22h BRT = 01:00 UTC)**

```bash
ssh lox-vm 'echo "0 1 * * * /home/<user>/scripts/pg-backup.sh >> /home/<user>/backups/cron.log 2>&1" | crontab -'
```

Verify:
```bash
ssh lox-vm "crontab -l"
# Expected: 0 1 * * * /home/<user>/scripts/pg-backup.sh >> /home/<user>/backups/cron.log 2>&1
```

**Step 7: Commit script to repo**

Back on local machine, create `scripts/pg-backup.sh` in the repo (same content as above) and commit:
```bash
git add scripts/pg-backup.sh
git commit -m "feat: add PostgreSQL backup script with GCS upload and Chat alerts"
```

---

### Task 4: VM Disk Snapshot Schedule (GCP Resource Policy)

**Context:** GCP resource policies automate disk snapshots. Daily at 02:00 UTC, keep 7 days. Must be run from a machine with gcloud access to the project (local machine or VM).

**Step 1: Create snapshot schedule resource policy**

From local machine (or VM):
```bash
gcloud compute resource-policies create snapshot-schedule lox-vm-daily-snapshot \
  --project=<your-gcp-project> \
  --region=us-east1 \
  --max-retention-days=7 \
  --on-source-disk-delete=keep-auto-snapshots \
  --daily-schedule \
  --start-time=02:00 \
  --storage-location=us-east1
```

Expected: `Created [lox-vm-daily-snapshot].`

**Step 2: Attach policy to VM disk**

```bash
gcloud compute disks add-resource-policies lox-vm \
  --project=<your-gcp-project> \
  --zone=us-east1-b \
  --resource-policies=lox-vm-daily-snapshot
```

Expected: `Updated [lox-vm].`

**Step 3: Verify policy**

```bash
gcloud compute resource-policies describe lox-vm-daily-snapshot \
  --project=<your-gcp-project> \
  --region=us-east1
```

Confirm: daily schedule, start 02:00, retention 7 days.

---

### Task 5: VM Instance Schedule (GCP Resource Policy)

**Context:** Schedule VM to start at 07:00 BRT (10:00 UTC) and stop at 23:00 BRT (02:00 UTC) daily. Saves ~33% on compute costs. Note: the instance schedule policy requires timezone as IANA format.

**Step 1: Create instance schedule resource policy**

```bash
gcloud compute resource-policies create vm-maintenance lox-vm-schedule \
  --project=<your-gcp-project> \
  --region=us-east1 \
  --vm-start-schedule="0 10 * * *" \
  --vm-stop-schedule="0 2 * * *" \
  --timezone="America/Sao_Paulo"
```

Expected: `Created [lox-vm-schedule].`

**Step 2: Add IAM binding for Compute Engine service agent**

The instance schedule needs the Compute Engine Service Agent to start/stop VMs:
```bash
PROJECT_NUMBER=$(gcloud projects describe <your-gcp-project> --format="value(projectNumber)")

gcloud projects add-iam-policy-binding <your-gcp-project> \
  --member="serviceAccount:service-${PROJECT_NUMBER}@compute-system.iam.gserviceaccount.com" \
  --role="roles/compute.instanceAdmin.v1"
```

**Step 3: Attach schedule to VM**

```bash
gcloud compute instances add-resource-policies lox-vm \
  --project=<your-gcp-project> \
  --zone=us-east1-b \
  --resource-policies=lox-vm-schedule
```

Expected: `Updated [lox-vm].`

**Step 4: Verify**

```bash
gcloud compute resource-policies describe lox-vm-schedule \
  --project=<your-gcp-project> \
  --region=us-east1
```

Confirm: start 10:00 UTC, stop 02:00 UTC, timezone America/Sao_Paulo.

**Step 5: Test by checking instance schedule status**

```bash
gcloud compute instances describe lox-vm \
  --project=<your-gcp-project> \
  --zone=us-east1-b \
  --format="yaml(resourcePolicies)"
```

Expected: both `lox-vm-daily-snapshot` and `lox-vm-schedule` listed.

---

### Task 6: Add Notifications to Existing Scripts

**Context:** Add Google Chat webhook notifications to `git-sync.sh` (on VM) and `scripts/deploy.sh` (in repo). Follow same pattern as pg-backup.sh.

**Step 1: Check current git-sync.sh on VM**

```bash
ssh lox-vm "cat /home/<user>/scripts/git-sync.sh"
```

Note the structure — we'll add error notification at the end.

**Step 2: Add webhook notification to git-sync.sh**

SSH into VM and edit `/home/<user>/scripts/git-sync.sh`. Add at the top (after shebang):
```bash
send_alert() {
  local message="$1"
  WEBHOOK_URL=$(gcloud secrets versions access latest --secret=gchat-webhook-url 2>/dev/null || true)
  if [ -n "$WEBHOOK_URL" ]; then
    curl -s -X POST "$WEBHOOK_URL" \
      -H "Content-Type: application/json" \
      -d "{\"text\": \"🚨 *Git Sync FAILURE*\n${message}\nVM: lox-vm\"}" \
      > /dev/null 2>&1 || true
  fi
}
```

Add a trap or error handler so that if any git command fails, it sends the alert. For example, add before the git commands:
```bash
trap 'send_alert "Git sync failed at $(date -Iseconds). Check logs."' ERR
```

**Step 3: Add webhook notification to deploy.sh**

Edit `scripts/deploy.sh` in the repo. Add the same `send_alert` function and add notifications:
- On failure: `send_alert "Deploy FAILURE" "Deploy failed. Check /tmp/deploy.log on VM."`
- On success: `send_alert "SUCCESS" "Deploy completed successfully."`

Add at the end of deploy.sh, before the `DEPLOY_SUCCESS` echo:
```bash
# --- Webhook notification ---
send_alert() {
  local status="$1"
  local message="$2"
  local emoji
  if [ "$status" = "success" ]; then emoji="✅"; else emoji="🚨"; fi

  WEBHOOK_URL=$(gcloud secrets versions access latest --secret=gchat-webhook-url 2>/dev/null || true)
  if [ -n "$WEBHOOK_URL" ]; then
    curl -s -X POST "$WEBHOOK_URL" \
      -H "Content-Type: application/json" \
      -d "{\"text\": \"${emoji} *Deploy — ${status}*\n${message}\nVM: lox-vm\"}" \
      > /dev/null 2>&1 || true
  fi
}

# Move send_alert to top of script and add trap:
trap 'send_alert "FAILURE" "Deploy failed. Check /tmp/deploy.log."' ERR
```

Actually, restructure: put `send_alert` function at the top of the script (after `set -euo pipefail`), add `trap ... ERR`, and add success notification before `DEPLOY_SUCCESS`.

**Step 4: Commit deploy.sh changes**

```bash
git add scripts/deploy.sh
git commit -m "feat: add Google Chat webhook notifications to deploy script"
```

---

### Task 7: Watcher Health Check with Notifications

**Context:** Create a simple health check script that verifies the watcher systemd service is running and alerts if it's down. Run via cron every 5 minutes.

**Step 1: Create health check script on VM**

Create `/home/<user>/scripts/health-check.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

send_alert() {
  local message="$1"
  WEBHOOK_URL=$(gcloud secrets versions access latest --secret=gchat-webhook-url 2>/dev/null || true)
  if [ -n "$WEBHOOK_URL" ]; then
    curl -s -X POST "$WEBHOOK_URL" \
      -H "Content-Type: application/json" \
      -d "{\"text\": \"🚨 *Health Check ALERT*\n${message}\nVM: lox-vm | Time: $(date -Iseconds)\"}" \
      > /dev/null 2>&1 || true
  fi
}

# Check watcher service
if ! systemctl is-active --quiet obsidian-watcher; then
  send_alert "obsidian-watcher service is DOWN! Attempting restart..."
  sudo systemctl restart obsidian-watcher
  sleep 5
  if systemctl is-active --quiet obsidian-watcher; then
    send_alert "obsidian-watcher auto-restarted successfully."
  else
    send_alert "obsidian-watcher FAILED to restart. Manual intervention needed."
  fi
fi

# Check disk usage
DISK_USAGE=$(df / --output=pcent | tail -1 | tr -d ' %')
if [ "$DISK_USAGE" -gt 80 ]; then
  send_alert "Disk usage at ${DISK_USAGE}% — above 80% threshold!"
fi
```

**Step 2: Make executable**

```bash
ssh lox-vm "chmod +x /home/<user>/scripts/health-check.sh"
```

**Step 3: Test manually**

```bash
ssh lox-vm "/home/<user>/scripts/health-check.sh"
# Expected: no output if everything is healthy (no alert sent)
```

**Step 4: Add to cron (every 5 minutes)**

```bash
ssh lox-vm 'crontab -l | { cat; echo "*/5 * * * * /home/<user>/scripts/health-check.sh >> /home/<user>/backups/health.log 2>&1"; } | crontab -'
```

Verify:
```bash
ssh lox-vm "crontab -l"
# Expected: both pg-backup and health-check entries
```

**Step 5: Commit health check script to repo**

```bash
git add scripts/health-check.sh
git commit -m "feat: add health check script with watcher monitoring and disk alerts"
```

---

### Task 8: Cloud Monitoring Alerting Policies

**Context:** Set up Cloud Monitoring for infrastructure-level alerts. These complement the script-based alerts for application events.

**Step 1: Create notification channel for Google Chat webhook**

Cloud Monitoring doesn't natively support Google Chat webhooks as notification channels. Two options:
- **Option A:** Use a Cloud Function as a webhook proxy (Cloud Monitoring → Pub/Sub → Cloud Function → Google Chat)
- **Option B:** Skip Cloud Monitoring alerts and rely solely on the script-based health checks (Task 7 already covers disk usage and watcher status)

**Recommendation:** Go with Option B. The health-check.sh script already monitors disk usage (>80%) and watcher status every 5 minutes. Adding Cloud Monitoring for the same checks adds complexity without significant benefit for a single-VM setup. Cloud Monitoring is more valuable when managing multiple VMs or needing historical dashboards.

If the user wants Cloud Monitoring later, it can be added as a separate enhancement.

**Step 2: (If Option B accepted) Skip — already covered by Task 7**

Note in design doc that Cloud Monitoring was deferred in favor of script-based monitoring for simplicity. Can be revisited if more VMs are added or if historical dashboards become needed.

---

### Task 9: Update Documentation

**Context:** Update project docs to reflect Phase 10 completion.

**Step 1: Update HANDOFF.md**

Add session notes for Phase 10:
```markdown
### 2026-03-10 — Phase 10 complete
- PostgreSQL backup: daily pg_dump at 22h BRT → local + GCS (`gs://obsidian-brain-backups/pg/`)
- GCS bucket: private, versioned, 30-day lifecycle, write-only SA access
- VM disk snapshots: daily at 02:00 UTC, 7-day retention (GCP resource policy)
- VM instance schedule: start 07:00 BRT, stop 23:00 BRT (~33% compute savings)
- Health check: cron every 5min, monitors watcher service + disk usage
- Notifications: Google Chat webhook via Secret Manager for backup/deploy/health events
- Webhook URL in Secret Manager: `gchat-webhook-url`
```

Update Phase 10 status to COMPLETA in the table.

**Step 2: Update TODO.md**

Mark Phase 10 as DONE with date. Add any new items discovered during implementation.

**Step 3: Update CHANGELOG.md**

Add entry:
```markdown
## v0.4.0 — 2026-03-10

### Added
- PostgreSQL daily backup with GCS off-site storage (30-day retention)
- VM disk snapshot schedule (daily, 7-day retention)
- VM instance schedule for cost optimization (07:00-23:00 BRT)
- Health check monitoring (watcher service + disk usage)
- Google Chat webhook notifications for backup, deploy, and health events
```

**Step 4: Commit documentation**

```bash
git add docs/HANDOFF.md TODO.md CHANGELOG.md
git commit -m "docs: update documentation for Phase 10 completion"
```

---

## Summary of Deliverables

| # | Task | Type | Where |
|---|------|------|-------|
| 1 | GCS backup bucket | GCP config | Cloud Storage |
| 2 | Webhook secret | GCP config | Secret Manager |
| 3 | pg-backup.sh | Script + cron | VM + repo |
| 4 | Disk snapshot schedule | GCP resource policy | Compute Engine |
| 5 | VM instance schedule | GCP resource policy | Compute Engine |
| 6 | Notification in deploy.sh & git-sync.sh | Script update | VM + repo |
| 7 | health-check.sh | Script + cron | VM + repo |
| 8 | Cloud Monitoring | Deferred | — |
| 9 | Documentation | Docs update | repo |

## Important Notes

- **VM must be running** for Tasks 1-3, 6-7 (SSH access needed)
- **VPN must be active** for SSH via `ssh lox-vm`
- **Task order matters:** Task 2 (webhook secret) must be done before Task 3 (backup script uses it)
- **crontab warning:** Task 6 Step 4 appends to crontab — verify existing entries aren't duplicated
- **Instance schedule timing:** After Task 5, the VM will auto-stop at 02:00 UTC. Plan work accordingly.
- **Backup timing:** pg_dump at 01:00 UTC runs 1 hour before VM auto-stop at 02:00 UTC. Sufficient margin for dump + upload.
