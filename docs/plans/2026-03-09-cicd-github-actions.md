# CI/CD GitHub Actions Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Automate code validation on PRs and deploy to VM on merge to main.

**Architecture:** Two GitHub Actions workflows — `ci.yml` validates PRs (build, test, coverage, audit), `deploy.yml` deploys on merge to main via `gcloud compute ssh` through IAP tunnel. GCP service account `<your-deploy-sa>` with minimal roles.

**Tech Stack:** GitHub Actions, gcloud CLI, google-github-actions/auth, IAP tunnel SSH

---

### Task 1: Create CI workflow for PRs

**Files:**
- Create: `.github/workflows/ci.yml`

**Step 1: Create the workflow file**

```yaml
name: CI

on:
  pull_request:
    branches: [main]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Type check
        run: npx tsc --noEmit

      - name: Build
        run: npm run build

      - name: Test with coverage
        run: npm run test:coverage

      - name: Security audit
        run: npm audit --audit-level=high
```

**Step 2: Verify YAML syntax**

Run: `cat .github/workflows/ci.yml | python3 -c "import sys,yaml; yaml.safe_load(sys.stdin)" && echo "YAML valid"`
Expected: "YAML valid"

**Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add PR validation workflow (build, test, coverage, audit)"
```

---

### Task 2: Create GCP Service Account (manual — user-guided)

This task requires the user to run commands. Provide instructions and wait for confirmation.

**Step 1: Create the service account**

The user runs on their local machine (with gcloud authenticated):

```bash
gcloud iam service-accounts create <your-deploy-sa> \
  --project=<your-gcp-project> \
  --display-name="GitHub Actions Deploy"
```

**Step 2: Assign minimal IAM roles**

```bash
# IAP tunnel access
gcloud projects add-iam-policy-binding <your-gcp-project> \
  --member="serviceAccount:<your-deploy-sa>@<your-project>.iam.gserviceaccount.com" \
  --role="roles/iap.tunnelResourceAccessor"

# Compute instance access (for SSH)
gcloud projects add-iam-policy-binding <your-gcp-project> \
  --member="serviceAccount:<your-deploy-sa>@<your-project>.iam.gserviceaccount.com" \
  --role="roles/compute.instanceAdmin.v1"

# Service account user (required for gcloud compute ssh)
gcloud projects add-iam-policy-binding <your-gcp-project> \
  --member="serviceAccount:<your-deploy-sa>@<your-project>.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"
```

**Step 3: Generate JSON key**

```bash
gcloud iam service-accounts keys create /tmp/<your-deploy-sa>-key.json \
  --iam-account=<your-deploy-sa>@<your-project>.iam.gserviceaccount.com
```

**Step 4: Note the key expiry date**

```bash
gcloud iam service-accounts keys list \
  --iam-account=<your-deploy-sa>@<your-project>.iam.gserviceaccount.com \
  --format="table(name.basename(), validAfterTime, validBeforeTime)"
```

Record the expiry date and update TODO.md with the actual date.

**Step 5: Add key as GitHub Secret**

```bash
# Copy key content
cat /tmp/<your-deploy-sa>-key.json | pbcopy  # macOS
# Or: cat /tmp/<your-deploy-sa>-key.json | xclip -selection clipboard  # Linux

# Add via gh CLI
gh secret set GCP_SA_KEY --repo <your-github-org>/<your-repo> < /tmp/<your-deploy-sa>-key.json
gh secret set GCP_PROJECT_ID --repo <your-github-org>/<your-repo> --body "<your-gcp-project>"
```

**Step 6: Delete local key file**

```bash
rm -f /tmp/<your-deploy-sa>-key.json
```

**Step 7: Verify secrets are set**

```bash
gh secret list --repo <your-github-org>/<your-repo>
```

Expected: `GCP_SA_KEY` and `GCP_PROJECT_ID` listed.

---

### Task 3: Configure VM for SA SSH access

The deploy SA needs to be able to SSH into the VM. The user runs:

**Step 1: Add OS Login role (allows SA to get SSH access via IAP)**

```bash
gcloud projects add-iam-policy-binding <your-gcp-project> \
  --member="serviceAccount:<your-deploy-sa>@<your-project>.iam.gserviceaccount.com" \
  --role="roles/compute.osLogin"
```

**Step 2: Verify VM has OS Login enabled**

```bash
gcloud compute instances describe lox-vm \
  --zone=us-east1-b \
  --project=<your-gcp-project> \
  --format="value(metadata.items[key='enable-oslogin'].value)"
```

If empty or false:

```bash
gcloud compute instances add-metadata lox-vm \
  --zone=us-east1-b \
  --project=<your-gcp-project> \
  --metadata enable-oslogin=TRUE
```

**Step 3: Grant sudo for systemctl restart**

The SA will SSH as a generated OS Login user. To allow `sudo systemctl restart`, the user must SSH into the VM and configure sudoers:

```bash
ssh lox-vm
# On the VM:
sudo bash -c 'echo "ALL ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart obsidian-watcher, /usr/bin/systemctl is-active obsidian-watcher" > /etc/sudoers.d/github-deploy'
sudo chmod 440 /etc/sudoers.d/github-deploy
sudo visudo -c  # validate syntax
```

---

### Task 4: Create Deploy workflow

**Files:**
- Create: `.github/workflows/deploy.yml`

**Step 1: Create the workflow file**

```yaml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Authenticate to GCP
        uses: google-github-actions/auth@v2
        with:
          credentials_json: '${{ secrets.GCP_SA_KEY }}'

      - name: Setup gcloud
        uses: google-github-actions/setup-gcloud@v2

      - name: Deploy to VM
        run: |
          gcloud compute ssh lox-vm \
            --zone=us-east1-b \
            --project=${{ secrets.GCP_PROJECT_ID }} \
            --tunnel-through-iap \
            --command="cd ~/lox-brain && git pull origin main && npm ci --omit=dev && npm run build && sudo systemctl restart obsidian-watcher && pkill -f 'tsx src/mcp/index.ts' || true"

      - name: Health check
        run: |
          gcloud compute ssh lox-vm \
            --zone=us-east1-b \
            --project=${{ secrets.GCP_PROJECT_ID }} \
            --tunnel-through-iap \
            --command="systemctl is-active obsidian-watcher"
```

**Step 2: Verify YAML syntax**

Run: `cat .github/workflows/deploy.yml | python3 -c "import sys,yaml; yaml.safe_load(sys.stdin)" && echo "YAML valid"`
Expected: "YAML valid"

**Step 3: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: add deploy workflow (SSH via IAP on merge to main)"
```

---

### Task 5: Configure branch protection

The user configures via GitHub CLI or web UI:

**Step 1: Enable branch protection on main**

```bash
gh api repos/<your-github-org>/<your-repo>/branches/main/protection \
  --method PUT \
  --field required_status_checks='{"strict":true,"contexts":["validate"]}' \
  --field enforce_admins=true \
  --field required_pull_request_reviews='{"required_approving_review_count":0}' \
  --field restrictions=null
```

Note: `required_approving_review_count: 0` means PRs are required but self-merge is allowed (solo developer). The CI check "validate" must pass.

**Step 2: Verify protection is set**

```bash
gh api repos/<your-github-org>/<your-repo>/branches/main/protection
```

---

### Task 6: End-to-end test

**Step 1: Create a test branch and PR**

```bash
git checkout -b test/ci-validation
echo "# CI test" >> CI_TEST.md
git add CI_TEST.md
git commit -m "test: verify CI workflow"
git push -u origin test/ci-validation
gh pr create --title "test: verify CI workflow" --body "Testing CI pipeline. Delete after."
```

**Step 2: Verify CI runs on PR**

```bash
gh pr checks $(gh pr list --head test/ci-validation --json number -q '.[0].number')
```

Wait for all checks to pass. If any fail, investigate and fix.

**Step 3: Merge PR to trigger deploy**

```bash
gh pr merge $(gh pr list --head test/ci-validation --json number -q '.[0].number') --merge
```

**Step 4: Verify deploy workflow runs**

```bash
gh run list --workflow=deploy.yml --limit=1
```

Wait for completion. Check status:

```bash
gh run view $(gh run list --workflow=deploy.yml --limit=1 --json databaseId -q '.[0].databaseId')
```

**Step 5: Clean up test file**

```bash
git checkout main
git pull
git rm CI_TEST.md
git commit -m "chore: remove CI test file"
git push
```

---

### Task 7: Update documentation

**Files:**
- Modify: `TODO.md` — add CI/CD as DONE, update SA key expiry date
- Modify: `CHANGELOG.md` — add CI/CD entry
- Modify: `docs/HANDOFF.md` — add session notes

**Step 1: Update TODO.md**

Add under Pending Improvements:

```markdown
### ~~CI/CD auto-deploy~~ — DONE (2026-03-09)
- GitHub Actions: `ci.yml` (PR validation) + `deploy.yml` (deploy on merge to main)
- GCP SA `<your-deploy-sa>` with IAP tunnel SSH
- Branch protection: CI must pass before merge
```

**Step 2: Update CHANGELOG.md**

Add entry for the CI/CD feature.

**Step 3: Commit**

```bash
git add TODO.md CHANGELOG.md docs/HANDOFF.md
git commit -m "docs: add CI/CD documentation"
```
