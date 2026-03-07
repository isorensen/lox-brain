# Obsidian Open Brain — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a hybrid knowledge management system combining Obsidian vault (local) with PostgreSQL+pgvector (semantic search) accessible via MCP Server on a GCP VM.

**Architecture:** Obsidian vault is source of truth (Markdown files). Git syncs local <-> VM. A chokidar watcher detects vault changes and indexes them into pgvector via OpenAI embeddings. An MCP Server on the VM exposes tools (read/write/search) to any AI client via VPN.

**Tech Stack:** TypeScript (MCP Server + Watcher), PostgreSQL 16 + pgvector, OpenAI text-embedding-3-small, GCE VM, WireGuard VPN, Cloud Run (panel).

**Design doc:** `docs/plans/2026-03-07-obsidian-open-brain-design.md`

---

## Phase Overview

| Phase | Description | Type | Depends on |
|-------|-------------|------|------------|
| 1 | GCP Infrastructure (VPC, VM, Firewall) | Manual/Infra | - |
| 2 | WireGuard VPN | Manual/Infra | Phase 1 |
| 3 | Git Vault Sync on VM | Manual/Infra | Phase 2 |
| 4 | PostgreSQL + pgvector | Manual/Infra | Phase 1 |
| 5 | Embedding Service (library) | Code/TDD | Phase 4 |
| 6 | Vault Watcher | Code/TDD | Phase 5 |
| 7 | MCP Server | Code/TDD | Phase 5, 6 |
| 8 | Integration Testing (end-to-end) | Test | Phase 7 |
| 9 | Cloud Run Panel (VM start/stop) | Code/Infra | Phase 2 |
| 10 | Backups & Monitoring | Manual/Infra | Phase 4 |
| 11 | Claude Code MCP Config | Manual | Phase 7 |

---

## Phase 1: GCP Infrastructure

**Goal:** VM running, accessible only via internal network. No public IP.

### Task 1.1: Create GCP Project & Enable APIs

**Type:** Manual

**Steps:**
1. Create GCP project `obsidian-open-brain` (or use existing project)
2. Enable APIs:
   ```bash
   gcloud services enable compute.googleapis.com
   gcloud services enable secretmanager.googleapis.com
   gcloud services enable run.googleapis.com
   gcloud services enable logging.googleapis.com
   ```
3. Set default region:
   ```bash
   gcloud config set compute/region us-central1
   gcloud config set compute/zone us-central1-a
   ```

**Checkpoint:** `gcloud services list --enabled` shows all 4 APIs.

---

### Task 1.2: Create VPC Network

**Type:** Manual

**Steps:**
1. Create custom VPC:
   ```bash
   gcloud compute networks create obsidian-vpc \
     --subnet-mode=custom
   ```
2. Create subnet:
   ```bash
   gcloud compute networks subnets create obsidian-subnet \
     --network=obsidian-vpc \
     --range=10.0.0.0/24 \
     --region=us-central1
   ```

**Checkpoint:** `gcloud compute networks list` shows `obsidian-vpc`.

---

### Task 1.3: Create Firewall Rules

**Type:** Manual

**Steps:**
1. Deny all ingress by default (VPC default behavior with custom network).
2. Allow WireGuard UDP:
   ```bash
   gcloud compute firewall-rules create allow-wireguard \
     --network=obsidian-vpc \
     --allow=udp:51820 \
     --source-ranges=0.0.0.0/0 \
     --target-tags=vpn-server \
     --description="Allow WireGuard VPN connections"
   ```
3. Allow internal traffic:
   ```bash
   gcloud compute firewall-rules create allow-internal \
     --network=obsidian-vpc \
     --allow=tcp,udp,icmp \
     --source-ranges=10.0.0.0/24 \
     --description="Allow internal VPC traffic"
   ```
4. Allow SSH from IAP only (for initial setup):
   ```bash
   gcloud compute firewall-rules create allow-iap-ssh \
     --network=obsidian-vpc \
     --allow=tcp:22 \
     --source-ranges=35.235.240.0/20 \
     --target-tags=allow-iap \
     --description="Allow SSH via IAP tunnel only"
   ```

**Checkpoint:** `gcloud compute firewall-rules list --filter="network=obsidian-vpc"` shows 3 rules.

---

### Task 1.4: Create VM Instance

**Type:** Manual

**Steps:**
1. Create service account:
   ```bash
   gcloud iam service-accounts create obsidian-vm-sa \
     --display-name="Obsidian VM Service Account"
   ```
2. Grant minimal roles:
   ```bash
   gcloud projects add-iam-policy-binding PROJECT_ID \
     --member="serviceAccount:obsidian-vm-sa@PROJECT_ID.iam.gserviceaccount.com" \
     --role="roles/secretmanager.secretAccessor"

   gcloud projects add-iam-policy-binding PROJECT_ID \
     --member="serviceAccount:obsidian-vm-sa@PROJECT_ID.iam.gserviceaccount.com" \
     --role="roles/logging.logWriter"
   ```
3. Create VM:
   ```bash
   gcloud compute instances create obsidian-vm \
     --zone=us-central1-a \
     --machine-type=e2-small \
     --network=obsidian-vpc \
     --subnet=obsidian-subnet \
     --no-address \
     --tags=vpn-server,allow-iap \
     --service-account=obsidian-vm-sa@PROJECT_ID.iam.gserviceaccount.com \
     --scopes=cloud-platform \
     --image-family=ubuntu-2404-lts-amd64 \
     --image-project=ubuntu-os-cloud \
     --boot-disk-size=30GB \
     --boot-disk-type=pd-ssd
   ```

**Checkpoint:**
- `gcloud compute instances describe obsidian-vm --zone=us-central1-a` shows status RUNNING
- No external IP assigned
- SSH via IAP: `gcloud compute ssh obsidian-vm --zone=us-central1-a --tunnel-through-iap`

---

### Task 1.5: Base VM Setup

**Type:** Manual (SSH into VM via IAP)

**Steps:**
```bash
# SSH in
gcloud compute ssh obsidian-vm --zone=us-central1-a --tunnel-through-iap

# Update system
sudo apt update && sudo apt upgrade -y

# Install essentials
sudo apt install -y curl git build-essential postgresql-common

# Install Node.js 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# Verify
node --version   # v22.x
npm --version
git --version
psql --version
```

**Checkpoint:** All commands return valid versions.

---

## GATE 1: Pause here. Verify VM is running, accessible via IAP SSH, no public IP, Node.js installed. Only proceed after manual confirmation.

---

## Phase 2: WireGuard VPN

**Goal:** Secure VPN tunnel between your local machine and the VM.

### Task 2.1: Install & Configure WireGuard on VM

**Type:** Manual (SSH into VM)

**Steps:**
```bash
# Install WireGuard
sudo apt install -y wireguard

# Generate server keys
wg genkey | sudo tee /etc/wireguard/server_private.key | wg pubkey | sudo tee /etc/wireguard/server_public.key
sudo chmod 600 /etc/wireguard/server_private.key

# Get the private key for config
SERVER_PRIVATE_KEY=$(sudo cat /etc/wireguard/server_private.key)

# Create config
sudo tee /etc/wireguard/wg0.conf << EOF
[Interface]
PrivateKey = $SERVER_PRIVATE_KEY
Address = 10.10.0.1/24
ListenPort = 51820
PostUp = iptables -A FORWARD -i wg0 -j ACCEPT; iptables -t nat -A POSTROUTING -o ens4 -j MASQUERADE
PostDown = iptables -D FORWARD -i wg0 -j ACCEPT; iptables -t nat -D POSTROUTING -o ens4 -j MASQUERADE

# Client will be added in next step
EOF

# Enable IP forwarding
echo "net.ipv4.ip_forward=1" | sudo tee -a /etc/sysctl.conf
sudo sysctl -p

# Start WireGuard
sudo systemctl enable wg-quick@wg0
sudo systemctl start wg-quick@wg0
```

**Checkpoint:** `sudo wg show` displays interface wg0 with listening port 51820.

---

### Task 2.2: Configure WireGuard Client (local machine)

**Type:** Manual (on your local machine)

**Steps:**
1. Install WireGuard on local machine
2. Generate client keys:
   ```bash
   wg genkey | tee client_private.key | wg pubkey | tee client_public.key
   ```
3. On the VM, add client peer:
   ```bash
   sudo wg set wg0 peer CLIENT_PUBLIC_KEY allowed-ips 10.10.0.2/32
   ```
   Also add the `[Peer]` block to `/etc/wireguard/wg0.conf` for persistence.
4. Create client config (`wg-obsidian.conf`):
   ```ini
   [Interface]
   PrivateKey = CLIENT_PRIVATE_KEY
   Address = 10.10.0.2/24
   DNS = 1.1.1.1

   [Peer]
   PublicKey = SERVER_PUBLIC_KEY
   Endpoint = VM_EXTERNAL_IP:51820
   AllowedIPs = 10.10.0.0/24
   PersistentKeepalive = 25
   ```
   **Note:** The VM needs a static external IP for WireGuard only. Create one:
   ```bash
   gcloud compute addresses create obsidian-vpn-ip --region=us-central1
   gcloud compute instances add-access-config obsidian-vm \
     --zone=us-central1-a \
     --access-config-name="vpn-only" \
     --address=STATIC_IP
   ```
   The firewall rules ensure only UDP 51820 is reachable on this IP.

**Checkpoint:**
- From local machine: `ping 10.10.0.1` (VM's WireGuard IP) returns replies
- From VM: `ping 10.10.0.2` (your WireGuard IP) returns replies

---

## GATE 2: Pause here. VPN must be working bidirectionally. Test from local machine AND from VM. Only proceed after manual confirmation.

---

## Phase 3: Git Vault Sync on VM

**Goal:** Vault cloned on VM, Git sync working.

### Task 3.1: Create Private Git Repo (if needed)

**Type:** Manual

**Steps:**
1. Create private repo on GitHub/GitLab for your vault (if not already done)
2. Generate a deploy key or personal access token with repo scope
3. Store the token in GCP Secret Manager:
   ```bash
   echo -n "ghp_YOUR_TOKEN" | gcloud secrets create git-vault-token \
     --data-file=- \
     --replication-policy=automatic
   ```

**Checkpoint:** `gcloud secrets versions access latest --secret=git-vault-token` returns the token.

---

### Task 3.2: Clone Vault on VM

**Type:** Manual (SSH into VM)

**Steps:**
```bash
# Get token from Secret Manager
GIT_TOKEN=$(gcloud secrets versions access latest --secret=git-vault-token)

# Clone vault
mkdir -p /home/$USER/obsidian
cd /home/$USER/obsidian
git clone https://x-access-token:${GIT_TOKEN}@github.com/YOUR_USER/YOUR_VAULT_REPO.git vault

# Configure git
cd vault
git config user.name "Obsidian VM"
git config user.email "obsidian-vm@noreply"
```

**Checkpoint:** `ls /home/$USER/obsidian/vault/` shows your vault files.

---

### Task 3.3: Git Sync Cron

**Type:** Manual (SSH into VM)

**Steps:**
Create sync script:
```bash
cat > /home/$USER/obsidian/git-sync.sh << 'SCRIPT'
#!/bin/bash
cd /home/$USER/obsidian/vault

GIT_TOKEN=$(gcloud secrets versions access latest --secret=git-vault-token)
git remote set-url origin https://x-access-token:${GIT_TOKEN}@github.com/YOUR_USER/YOUR_VAULT_REPO.git

# Pull remote changes
git pull --rebase --autostash 2>&1 | logger -t obsidian-git-sync

# Push local changes (from MCP writes)
git add -A
if ! git diff --cached --quiet; then
  git commit -m "auto-sync from VM $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  git push 2>&1 | logger -t obsidian-git-sync
fi
SCRIPT

chmod +x /home/$USER/obsidian/git-sync.sh
```

Add to cron (every 2 minutes):
```bash
(crontab -l 2>/dev/null; echo "*/2 * * * * /home/$USER/obsidian/git-sync.sh") | crontab -
```

**Checkpoint:**
1. Edit a note in local Obsidian, push via Git plugin
2. Wait 2 minutes
3. On VM: `cat /home/$USER/obsidian/vault/YOUR_EDITED_NOTE.md` shows the change

---

## GATE 3: Pause here. Verify Git sync works in both directions (local -> VM and VM -> local). Only proceed after manual confirmation.

---

## Phase 4: PostgreSQL + pgvector

**Goal:** PostgreSQL running on the VM with pgvector extension, schema created.

### Task 4.1: Install PostgreSQL 16 + pgvector

**Type:** Manual (SSH into VM)

**Steps:**
```bash
# Add PostgreSQL repo
sudo sh -c 'echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo gpg --dearmor -o /etc/apt/trusted.gpg.d/postgresql.gpg
sudo apt update

# Install PostgreSQL 16 + dev headers
sudo apt install -y postgresql-16 postgresql-server-dev-16

# Install pgvector
sudo apt install -y postgresql-16-pgvector

# Ensure PostgreSQL listens only on localhost (default, but verify)
sudo grep "listen_addresses" /etc/postgresql/16/main/postgresql.conf
# Should show: listen_addresses = 'localhost' (or be commented out, which defaults to localhost)

# Start & enable
sudo systemctl enable postgresql
sudo systemctl start postgresql
```

**Checkpoint:** `sudo -u postgres psql -c "SELECT version();"` returns PostgreSQL 16.x.

---

### Task 4.2: Create Database & Schema

**Type:** Manual (SSH into VM)

**Steps:**
```bash
# Create user and database
sudo -u postgres psql << 'SQL'
CREATE USER obsidian_brain WITH PASSWORD 'GENERATE_STRONG_PASSWORD_HERE';
CREATE DATABASE open_brain OWNER obsidian_brain;
\c open_brain
CREATE EXTENSION IF NOT EXISTS vector;
SQL

# Store password in Secret Manager
echo -n "GENERATED_PASSWORD" | gcloud secrets create pg-obsidian-password \
  --data-file=- \
  --replication-policy=automatic

# Apply schema
sudo -u postgres psql -d open_brain << 'SQL'
CREATE TABLE vault_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_path TEXT UNIQUE NOT NULL,
    title TEXT,
    content TEXT NOT NULL,
    tags TEXT[],
    embedding vector(1536),
    file_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_embedding ON vault_embeddings
    USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE INDEX idx_tags ON vault_embeddings USING gin (tags);
CREATE INDEX idx_updated ON vault_embeddings (updated_at DESC);

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO obsidian_brain;
GRANT USAGE ON SCHEMA public TO obsidian_brain;
SQL
```

**Checkpoint:**
```bash
PGPASSWORD=YOUR_PASSWORD psql -h localhost -U obsidian_brain -d open_brain -c "\dt"
# Should show vault_embeddings table
PGPASSWORD=YOUR_PASSWORD psql -h localhost -U obsidian_brain -d open_brain -c "SELECT * FROM pg_extension WHERE extname = 'vector';"
# Should show vector extension
```

---

## GATE 4: Pause here. Verify PostgreSQL is running, pgvector extension loaded, schema created, user can connect. Only proceed after manual confirmation.

---

## Phase 5: Embedding Service (library)

**Goal:** TypeScript library that generates embeddings and performs CRUD on pgvector. TDD.

### Task 5.1: Initialize TypeScript Project

**Type:** Code

**Files:**
- Create: `src/` directory structure
- Create: `package.json`
- Create: `tsconfig.json`

**Steps:**
```bash
# On your local machine, in the obsidian_open_brain project
mkdir -p src/lib src/mcp src/watcher tests
npm init -y
npm install typescript @types/node tsx vitest --save-dev
npm install pg openai crypto
npm install @types/pg --save-dev
```

Create `tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

Create `vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
});
```

**Checkpoint:** `npx tsc --noEmit` passes with no errors.

---

### Task 5.2: Embedding Service — Tests First

**Files:**
- Create: `tests/lib/embedding-service.test.ts`
- Create: `src/lib/embedding-service.ts`

**Step 1: Write the failing test**

```typescript
// tests/lib/embedding-service.test.ts
import { describe, it, expect, vi } from 'vitest';
import { EmbeddingService } from '../src/lib/embedding-service';

describe('EmbeddingService', () => {
  it('should generate an embedding vector from text', async () => {
    const mockOpenAI = {
      embeddings: {
        create: vi.fn().mockResolvedValue({
          data: [{ embedding: new Array(1536).fill(0.1) }],
        }),
      },
    };

    const service = new EmbeddingService(mockOpenAI as any);
    const result = await service.generateEmbedding('test note content');

    expect(result).toHaveLength(1536);
    expect(mockOpenAI.embeddings.create).toHaveBeenCalledWith({
      model: 'text-embedding-3-small',
      input: 'test note content',
    });
  });

  it('should extract title from frontmatter', () => {
    const service = new EmbeddingService({} as any);
    const content = `---
title: My Note
tags: [test, demo]
---
# Content here`;

    const metadata = service.parseNote(content);
    expect(metadata.title).toBe('My Note');
    expect(metadata.tags).toEqual(['test', 'demo']);
  });

  it('should extract title from first H1 if no frontmatter title', () => {
    const service = new EmbeddingService({} as any);
    const content = `# My Heading\n\nSome content`;

    const metadata = service.parseNote(content);
    expect(metadata.title).toBe('My Heading');
    expect(metadata.tags).toEqual([]);
  });

  it('should compute file hash', () => {
    const service = new EmbeddingService({} as any);
    const hash1 = service.computeHash('content A');
    const hash2 = service.computeHash('content B');
    const hash1b = service.computeHash('content A');

    expect(hash1).not.toBe(hash2);
    expect(hash1).toBe(hash1b);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/embedding-service.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
// src/lib/embedding-service.ts
import { createHash } from 'crypto';
import OpenAI from 'openai';

interface NoteMetadata {
  title: string | null;
  tags: string[];
  content: string;
}

export class EmbeddingService {
  constructor(private openai: OpenAI) {}

  async generateEmbedding(text: string): Promise<number[]> {
    const response = await this.openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
    });
    return response.data[0].embedding;
  }

  parseNote(rawContent: string): NoteMetadata {
    let title: string | null = null;
    let tags: string[] = [];
    let content = rawContent;

    // Parse frontmatter
    const frontmatterMatch = rawContent.match(/^---\n([\s\S]*?)\n---/);
    if (frontmatterMatch) {
      const fm = frontmatterMatch[1];

      const titleMatch = fm.match(/^title:\s*(.+)$/m);
      if (titleMatch) title = titleMatch[1].trim();

      const tagsMatch = fm.match(/^tags:\s*\[([^\]]*)\]$/m);
      if (tagsMatch) {
        tags = tagsMatch[1].split(',').map((t) => t.trim()).filter(Boolean);
      }

      content = rawContent.slice(frontmatterMatch[0].length).trim();
    }

    // Fallback: first H1
    if (!title) {
      const h1Match = content.match(/^#\s+(.+)$/m);
      if (h1Match) title = h1Match[1].trim();
    }

    return { title, tags, content };
  }

  computeHash(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/embedding-service.test.ts`
Expected: 4 tests PASS

**Step 5: Commit**

```bash
git add src/lib/embedding-service.ts tests/lib/embedding-service.test.ts package.json tsconfig.json vitest.config.ts
git commit -m "feat: add EmbeddingService with parsing and hashing"
```

---

### Task 5.3: Database Client — Tests First

**Files:**
- Create: `tests/lib/db-client.test.ts`
- Create: `src/lib/db-client.ts`

**Step 1: Write the failing test**

```typescript
// tests/lib/db-client.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DbClient } from '../src/lib/db-client';

const mockPool = {
  query: vi.fn(),
};

describe('DbClient', () => {
  let db: DbClient;

  beforeEach(() => {
    vi.clearAllMocks();
    db = new DbClient(mockPool as any);
  });

  it('should upsert a note embedding', async () => {
    mockPool.query.mockResolvedValue({ rows: [{ id: 'uuid-1' }] });

    await db.upsertNote({
      filePath: 'notes/test.md',
      title: 'Test',
      content: 'content',
      tags: ['test'],
      embedding: new Array(1536).fill(0.1),
      fileHash: 'abc123',
    });

    expect(mockPool.query).toHaveBeenCalledOnce();
    const call = mockPool.query.mock.calls[0];
    expect(call[0]).toContain('INSERT INTO vault_embeddings');
    expect(call[0]).toContain('ON CONFLICT (file_path)');
  });

  it('should delete a note by file path', async () => {
    mockPool.query.mockResolvedValue({ rowCount: 1 });

    await db.deleteNote('notes/test.md');

    const call = mockPool.query.mock.calls[0];
    expect(call[0]).toContain('DELETE FROM vault_embeddings');
    expect(call[1]).toEqual(['notes/test.md']);
  });

  it('should search semantically', async () => {
    mockPool.query.mockResolvedValue({
      rows: [
        { file_path: 'notes/a.md', title: 'A', content: 'aaa', tags: [], similarity: 0.9 },
      ],
    });

    const results = await db.searchSemantic(new Array(1536).fill(0.1), 5);

    expect(results).toHaveLength(1);
    expect(results[0].file_path).toBe('notes/a.md');
    const call = mockPool.query.mock.calls[0];
    expect(call[0]).toContain('1 - (embedding <=> $1)');
  });

  it('should get hash for a file path', async () => {
    mockPool.query.mockResolvedValue({ rows: [{ file_hash: 'abc123' }] });

    const hash = await db.getFileHash('notes/test.md');
    expect(hash).toBe('abc123');
  });

  it('should return null hash for unknown file', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });

    const hash = await db.getFileHash('notes/unknown.md');
    expect(hash).toBeNull();
  });

  it('should list recent notes', async () => {
    mockPool.query.mockResolvedValue({
      rows: [
        { file_path: 'notes/a.md', title: 'A', updated_at: '2026-03-07' },
      ],
    });

    const results = await db.listRecent(10);
    expect(results).toHaveLength(1);
  });

  it('should search by text and tags', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });

    await db.searchText('keyword', ['tag1']);

    const call = mockPool.query.mock.calls[0];
    expect(call[0]).toContain('content ILIKE');
    expect(call[0]).toContain('tags @>');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/db-client.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
// src/lib/db-client.ts
import { Pool } from 'pg';

interface NoteRow {
  filePath: string;
  title: string | null;
  content: string;
  tags: string[];
  embedding: number[];
  fileHash: string;
}

interface SearchResult {
  file_path: string;
  title: string | null;
  content: string;
  tags: string[];
  similarity: number;
}

export class DbClient {
  constructor(private pool: Pool) {}

  async upsertNote(note: NoteRow): Promise<void> {
    const sql = `
      INSERT INTO vault_embeddings (file_path, title, content, tags, embedding, file_hash, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, now())
      ON CONFLICT (file_path) DO UPDATE SET
        title = EXCLUDED.title,
        content = EXCLUDED.content,
        tags = EXCLUDED.tags,
        embedding = EXCLUDED.embedding,
        file_hash = EXCLUDED.file_hash,
        updated_at = now()
    `;
    await this.pool.query(sql, [
      note.filePath,
      note.title,
      note.content,
      note.tags,
      JSON.stringify(note.embedding),
      note.fileHash,
    ]);
  }

  async deleteNote(filePath: string): Promise<void> {
    await this.pool.query('DELETE FROM vault_embeddings WHERE file_path = $1', [filePath]);
  }

  async searchSemantic(embedding: number[], limit: number): Promise<SearchResult[]> {
    const sql = `
      SELECT file_path, title, content, tags,
             1 - (embedding <=> $1) AS similarity
      FROM vault_embeddings
      ORDER BY embedding <=> $1
      LIMIT $2
    `;
    const result = await this.pool.query(sql, [JSON.stringify(embedding), limit]);
    return result.rows;
  }

  async getFileHash(filePath: string): Promise<string | null> {
    const result = await this.pool.query(
      'SELECT file_hash FROM vault_embeddings WHERE file_path = $1',
      [filePath]
    );
    return result.rows[0]?.file_hash ?? null;
  }

  async listRecent(limit: number): Promise<any[]> {
    const result = await this.pool.query(
      'SELECT file_path, title, tags, updated_at FROM vault_embeddings ORDER BY updated_at DESC LIMIT $1',
      [limit]
    );
    return result.rows;
  }

  async searchText(query: string, tags?: string[]): Promise<SearchResult[]> {
    let sql = `
      SELECT file_path, title, content, tags, 0 AS similarity
      FROM vault_embeddings
      WHERE content ILIKE $1
    `;
    const params: any[] = [`%${query}%`];

    if (tags && tags.length > 0) {
      sql += ` AND tags @> $2`;
      params.push(tags);
    }

    sql += ' ORDER BY updated_at DESC LIMIT 20';
    const result = await this.pool.query(sql, params);
    return result.rows;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/db-client.test.ts`
Expected: 7 tests PASS

**Step 5: Commit**

```bash
git add src/lib/db-client.ts tests/lib/db-client.test.ts
git commit -m "feat: add DbClient with upsert, delete, search operations"
```

---

### Task 5.4: Store OpenAI API Key in Secret Manager

**Type:** Manual

**Steps:**
```bash
echo -n "sk-YOUR_OPENAI_KEY" | gcloud secrets create openai-api-key \
  --data-file=- \
  --replication-policy=automatic
```

**Checkpoint:** `gcloud secrets versions access latest --secret=openai-api-key` returns the key.

---

## GATE 5: Pause here. Run full test suite: `npx vitest run`. All tests must pass. Verify OpenAI key is in Secret Manager. Only proceed after manual confirmation.

---

## Phase 6: Vault Watcher

**Goal:** Service that watches vault directory for file changes and indexes/removes from pgvector.

### Task 6.1: Watcher — Tests First

**Files:**
- Create: `tests/watcher/vault-watcher.test.ts`
- Create: `src/watcher/vault-watcher.ts`

**Step 1: Write the failing test**

```typescript
// tests/watcher/vault-watcher.test.ts
import { describe, it, expect, vi } from 'vitest';
import { VaultWatcher } from '../src/watcher/vault-watcher';

describe('VaultWatcher', () => {
  const mockEmbeddingService = {
    parseNote: vi.fn().mockReturnValue({ title: 'Test', tags: ['t'], content: 'c' }),
    generateEmbedding: vi.fn().mockResolvedValue(new Array(1536).fill(0.1)),
    computeHash: vi.fn().mockReturnValue('hash123'),
  };

  const mockDbClient = {
    getFileHash: vi.fn().mockResolvedValue(null),
    upsertNote: vi.fn().mockResolvedValue(undefined),
    deleteNote: vi.fn().mockResolvedValue(undefined),
  };

  it('should index a new file', async () => {
    const watcher = new VaultWatcher(
      '/vault',
      mockEmbeddingService as any,
      mockDbClient as any,
    );

    await watcher.handleFileChange('/vault/notes/test.md', 'raw content');

    expect(mockEmbeddingService.computeHash).toHaveBeenCalledWith('raw content');
    expect(mockDbClient.getFileHash).toHaveBeenCalledWith('notes/test.md');
    expect(mockEmbeddingService.generateEmbedding).toHaveBeenCalled();
    expect(mockDbClient.upsertNote).toHaveBeenCalled();
  });

  it('should skip indexing if hash unchanged', async () => {
    mockDbClient.getFileHash.mockResolvedValueOnce('hash123');

    const watcher = new VaultWatcher(
      '/vault',
      mockEmbeddingService as any,
      mockDbClient as any,
    );

    await watcher.handleFileChange('/vault/notes/test.md', 'raw content');

    expect(mockEmbeddingService.generateEmbedding).not.toHaveBeenCalled();
    expect(mockDbClient.upsertNote).not.toHaveBeenCalled();
  });

  it('should handle file deletion', async () => {
    const watcher = new VaultWatcher(
      '/vault',
      mockEmbeddingService as any,
      mockDbClient as any,
    );

    await watcher.handleFileDelete('/vault/notes/test.md');

    expect(mockDbClient.deleteNote).toHaveBeenCalledWith('notes/test.md');
  });

  it('should ignore non-markdown files', async () => {
    const watcher = new VaultWatcher(
      '/vault',
      mockEmbeddingService as any,
      mockDbClient as any,
    );

    const shouldProcess = watcher.shouldProcess('/vault/image.png');
    expect(shouldProcess).toBe(false);
  });

  it('should ignore .obsidian directory', async () => {
    const watcher = new VaultWatcher(
      '/vault',
      mockEmbeddingService as any,
      mockDbClient as any,
    );

    const shouldProcess = watcher.shouldProcess('/vault/.obsidian/config.json');
    expect(shouldProcess).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/watcher/vault-watcher.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
// src/watcher/vault-watcher.ts
import path from 'path';
import { EmbeddingService } from '../lib/embedding-service';
import { DbClient } from '../lib/db-client';

export class VaultWatcher {
  constructor(
    private vaultPath: string,
    private embeddingService: EmbeddingService,
    private dbClient: DbClient,
  ) {}

  shouldProcess(filePath: string): boolean {
    if (!filePath.endsWith('.md')) return false;
    const relative = path.relative(this.vaultPath, filePath);
    if (relative.startsWith('.obsidian')) return false;
    if (relative.startsWith('.git')) return false;
    return true;
  }

  private relativePath(filePath: string): string {
    return path.relative(this.vaultPath, filePath);
  }

  async handleFileChange(filePath: string, content: string): Promise<void> {
    const relative = this.relativePath(filePath);
    const newHash = this.embeddingService.computeHash(content);
    const existingHash = await this.dbClient.getFileHash(relative);

    if (existingHash === newHash) return;

    const metadata = this.embeddingService.parseNote(content);
    const embedding = await this.embeddingService.generateEmbedding(
      `${metadata.title ?? ''}\n${metadata.content}`
    );

    await this.dbClient.upsertNote({
      filePath: relative,
      title: metadata.title,
      content: metadata.content,
      tags: metadata.tags,
      embedding,
      fileHash: newHash,
    });
  }

  async handleFileDelete(filePath: string): Promise<void> {
    await this.dbClient.deleteNote(this.relativePath(filePath));
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/watcher/vault-watcher.test.ts`
Expected: 5 tests PASS

**Step 5: Commit**

```bash
git add src/watcher/vault-watcher.ts tests/watcher/vault-watcher.test.ts
git commit -m "feat: add VaultWatcher with change detection and hash skip"
```

---

### Task 6.2: Watcher Entry Point (chokidar)

**Files:**
- Create: `src/watcher/index.ts`

**Steps:**
```bash
npm install chokidar
```

```typescript
// src/watcher/index.ts
import chokidar from 'chokidar';
import { readFile } from 'fs/promises';
import { Pool } from 'pg';
import OpenAI from 'openai';
import { EmbeddingService } from '../lib/embedding-service';
import { DbClient } from '../lib/db-client';
import { VaultWatcher } from './vault-watcher';

const VAULT_PATH = process.env.VAULT_PATH!;

const pool = new Pool({
  host: 'localhost',
  database: 'open_brain',
  user: 'obsidian_brain',
  password: process.env.PG_PASSWORD,
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const embeddingService = new EmbeddingService(openai);
const dbClient = new DbClient(pool);
const watcher = new VaultWatcher(VAULT_PATH, embeddingService, dbClient);

console.log(`Watching vault at: ${VAULT_PATH}`);

const fsWatcher = chokidar.watch(VAULT_PATH, {
  ignored: [/(^|[\/\\])\../, /node_modules/],
  persistent: true,
  ignoreInitial: true,
  awaitWriteFinish: { stabilityThreshold: 500 },
});

fsWatcher
  .on('add', async (filePath) => {
    if (!watcher.shouldProcess(filePath)) return;
    const content = await readFile(filePath, 'utf-8');
    await watcher.handleFileChange(filePath, content);
    console.log(`Indexed: ${filePath}`);
  })
  .on('change', async (filePath) => {
    if (!watcher.shouldProcess(filePath)) return;
    const content = await readFile(filePath, 'utf-8');
    await watcher.handleFileChange(filePath, content);
    console.log(`Re-indexed: ${filePath}`);
  })
  .on('unlink', async (filePath) => {
    if (!watcher.shouldProcess(filePath)) return;
    await watcher.handleFileDelete(filePath);
    console.log(`Removed: ${filePath}`);
  });
```

**Checkpoint:** This is tested manually in Phase 8 (integration). No unit test needed — it's a thin wiring layer.

**Commit:**
```bash
git add src/watcher/index.ts
git commit -m "feat: add watcher entry point with chokidar"
```

---

## GATE 6: Pause here. Run full test suite: `npx vitest run`. All tests must pass. Only proceed after manual confirmation.

---

## Phase 7: MCP Server

**Goal:** MCP Server exposing 6 tools, connectable by Claude Code.

### Task 7.1: Install MCP SDK

**Steps:**
```bash
npm install @modelcontextprotocol/sdk
```

---

### Task 7.2: MCP Server — Tests First

**Files:**
- Create: `tests/mcp/mcp-tools.test.ts`
- Create: `src/mcp/tools.ts`

**Step 1: Write the failing test**

```typescript
// tests/mcp/mcp-tools.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createTools } from '../src/mcp/tools';

describe('MCP Tools', () => {
  const mockDbClient = {
    searchSemantic: vi.fn().mockResolvedValue([
      { file_path: 'notes/a.md', title: 'A', content: 'aaa', tags: [], similarity: 0.9 },
    ]),
    searchText: vi.fn().mockResolvedValue([]),
    listRecent: vi.fn().mockResolvedValue([]),
  };

  const mockEmbeddingService = {
    generateEmbedding: vi.fn().mockResolvedValue(new Array(1536).fill(0.1)),
  };

  it('should define all 6 tools', () => {
    const tools = createTools(mockDbClient as any, mockEmbeddingService as any, '/vault');
    const toolNames = tools.map((t) => t.name);

    expect(toolNames).toContain('write_note');
    expect(toolNames).toContain('read_note');
    expect(toolNames).toContain('delete_note');
    expect(toolNames).toContain('search_semantic');
    expect(toolNames).toContain('search_text');
    expect(toolNames).toContain('list_recent');
    expect(toolNames).toHaveLength(6);
  });

  it('search_semantic should call embedding service then db', async () => {
    const tools = createTools(mockDbClient as any, mockEmbeddingService as any, '/vault');
    const searchTool = tools.find((t) => t.name === 'search_semantic')!;

    const result = await searchTool.handler({ query: 'test query', limit: 5 });

    expect(mockEmbeddingService.generateEmbedding).toHaveBeenCalledWith('test query');
    expect(mockDbClient.searchSemantic).toHaveBeenCalled();
    expect(result).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mcp/mcp-tools.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
// src/mcp/tools.ts
import { readFile, writeFile, unlink, mkdir } from 'fs/promises';
import path from 'path';
import { DbClient } from '../lib/db-client';
import { EmbeddingService } from '../lib/embedding-service';

interface Tool {
  name: string;
  description: string;
  inputSchema: object;
  handler: (args: any) => Promise<any>;
}

export function createTools(
  dbClient: DbClient,
  embeddingService: EmbeddingService,
  vaultPath: string,
): Tool[] {
  return [
    {
      name: 'write_note',
      description: 'Create or update a Markdown note in the Obsidian vault',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path in vault (e.g. notes/my-note.md)' },
          content: { type: 'string', description: 'Markdown content' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags' },
        },
        required: ['path', 'content'],
      },
      handler: async (args: { path: string; content: string; tags?: string[] }) => {
        const fullPath = path.join(vaultPath, args.path);
        await mkdir(path.dirname(fullPath), { recursive: true });

        let finalContent = args.content;
        if (args.tags && args.tags.length > 0) {
          const frontmatter = `---\ntags: [${args.tags.join(', ')}]\n---\n`;
          if (!finalContent.startsWith('---')) {
            finalContent = frontmatter + finalContent;
          }
        }

        await writeFile(fullPath, finalContent, 'utf-8');
        return { success: true, path: args.path };
      },
    },
    {
      name: 'read_note',
      description: 'Read a note from the Obsidian vault by path',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path in vault' },
        },
        required: ['path'],
      },
      handler: async (args: { path: string }) => {
        const fullPath = path.join(vaultPath, args.path);
        const content = await readFile(fullPath, 'utf-8');
        return { path: args.path, content };
      },
    },
    {
      name: 'delete_note',
      description: 'Delete a note from the Obsidian vault',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path in vault' },
        },
        required: ['path'],
      },
      handler: async (args: { path: string }) => {
        const fullPath = path.join(vaultPath, args.path);
        await unlink(fullPath);
        return { success: true, deleted: args.path };
      },
    },
    {
      name: 'search_semantic',
      description: 'Search notes by meaning using semantic similarity',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural language search query' },
          limit: { type: 'number', description: 'Max results (default 5)' },
        },
        required: ['query'],
      },
      handler: async (args: { query: string; limit?: number }) => {
        const embedding = await embeddingService.generateEmbedding(args.query);
        const results = await dbClient.searchSemantic(embedding, args.limit ?? 5);
        return { results };
      },
    },
    {
      name: 'search_text',
      description: 'Search notes by keyword and/or tags',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Keyword to search' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags' },
        },
        required: ['query'],
      },
      handler: async (args: { query: string; tags?: string[] }) => {
        const results = await dbClient.searchText(args.query, args.tags);
        return { results };
      },
    },
    {
      name: 'list_recent',
      description: 'List recently updated notes',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max results (default 10)' },
        },
      },
      handler: async (args: { limit?: number }) => {
        const results = await dbClient.listRecent(args.limit ?? 10);
        return { results };
      },
    },
  ];
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/mcp/mcp-tools.test.ts`
Expected: 2 tests PASS

**Step 5: Commit**

```bash
git add src/mcp/tools.ts tests/mcp/mcp-tools.test.ts
git commit -m "feat: add MCP tools definition with handlers"
```

---

### Task 7.3: MCP Server Entry Point

**Files:**
- Create: `src/mcp/index.ts`

**Step 1: Write implementation**

```typescript
// src/mcp/index.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { Pool } from 'pg';
import OpenAI from 'openai';
import { EmbeddingService } from '../lib/embedding-service';
import { DbClient } from '../lib/db-client';
import { createTools } from './tools';

const VAULT_PATH = process.env.VAULT_PATH!;

const pool = new Pool({
  host: 'localhost',
  database: 'open_brain',
  user: 'obsidian_brain',
  password: process.env.PG_PASSWORD,
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const embeddingService = new EmbeddingService(openai);
const dbClient = new DbClient(pool);
const tools = createTools(dbClient, embeddingService, VAULT_PATH);

const server = new Server(
  { name: 'obsidian-open-brain', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = tools.find((t) => t.name === request.params.name);
  if (!tool) {
    return { content: [{ type: 'text', text: `Unknown tool: ${request.params.name}` }], isError: true };
  }

  try {
    const result = await tool.handler(request.params.arguments ?? {});
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (error: any) {
    return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Obsidian Open Brain MCP Server running on stdio');
}

main().catch(console.error);
```

**Commit:**
```bash
git add src/mcp/index.ts
git commit -m "feat: add MCP server entry point with stdio transport"
```

---

## GATE 7: Pause here. Run full test suite: `npx vitest run`. All tests must pass. Run `npx tsc --noEmit` to verify types. Only proceed after manual confirmation.

---

## Phase 8: Integration Testing (end-to-end)

**Goal:** Deploy code to VM, verify full flow works.

### Task 8.1: Deploy Code to VM

**Type:** Manual

**Steps:**
1. Push obsidian_open_brain repo to GitHub (private)
2. Clone on VM:
   ```bash
   cd /home/$USER
   git clone https://github.com/YOUR_USER/obsidian_open_brain.git
   cd obsidian_open_brain
   npm install
   ```
3. Create `.env` file on VM (never committed):
   ```bash
   cat > /home/$USER/obsidian_open_brain/.env << 'EOF'
   VAULT_PATH=/home/$USER/obsidian/vault
   PG_PASSWORD=YOUR_PG_PASSWORD
   OPENAI_API_KEY=YOUR_OPENAI_KEY
   EOF
   ```
   Or load from Secret Manager in a startup script.

---

### Task 8.2: Initial Vault Indexing

**Type:** Manual

**Steps:**
Create a one-time indexing script:
```bash
# src/scripts/index-vault.ts (create this file)
```

```typescript
// src/scripts/index-vault.ts
import { readFile } from 'fs/promises';
import { Pool } from 'pg';
import OpenAI from 'openai';
import { glob } from 'glob';
import { EmbeddingService } from '../lib/embedding-service';
import { DbClient } from '../lib/db-client';
import { VaultWatcher } from '../watcher/vault-watcher';

async function main() {
  const vaultPath = process.env.VAULT_PATH!;
  const pool = new Pool({
    host: 'localhost', database: 'open_brain',
    user: 'obsidian_brain', password: process.env.PG_PASSWORD,
  });
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const embeddingService = new EmbeddingService(openai);
  const dbClient = new DbClient(pool);
  const watcher = new VaultWatcher(vaultPath, embeddingService, dbClient);

  const files = await glob(`${vaultPath}/**/*.md`, { ignore: ['**/.obsidian/**', '**/.git/**'] });
  console.log(`Found ${files.length} markdown files to index`);

  for (const file of files) {
    if (!watcher.shouldProcess(file)) continue;
    const content = await readFile(file, 'utf-8');
    await watcher.handleFileChange(file, content);
    console.log(`Indexed: ${file}`);
  }

  await pool.end();
  console.log('Done!');
}

main().catch(console.error);
```

Run:
```bash
npx tsx src/scripts/index-vault.ts
```

**Checkpoint:**
```bash
PGPASSWORD=YOUR_PASSWORD psql -h localhost -U obsidian_brain -d open_brain \
  -c "SELECT count(*) FROM vault_embeddings;"
# Should show number of indexed notes

PGPASSWORD=YOUR_PASSWORD psql -h localhost -U obsidian_brain -d open_brain \
  -c "SELECT file_path, title FROM vault_embeddings LIMIT 5;"
# Should show your note titles
```

---

### Task 8.3: Test Watcher Live

**Type:** Manual

**Steps:**
1. Start watcher:
   ```bash
   npx tsx src/watcher/index.ts
   ```
2. In another terminal, create a test note:
   ```bash
   echo "# Test Note\n\nThis is a watcher test." > /home/$USER/obsidian/vault/test-watcher.md
   ```
3. Watcher should log: `Indexed: /home/.../test-watcher.md`
4. Verify in database:
   ```bash
   PGPASSWORD=YOUR_PASSWORD psql -h localhost -U obsidian_brain -d open_brain \
     -c "SELECT file_path, title FROM vault_embeddings WHERE file_path LIKE '%test-watcher%';"
   ```
5. Delete the test note:
   ```bash
   rm -f /home/$USER/obsidian/vault/test-watcher.md
   ```
6. Watcher should log: `Removed: ...test-watcher.md`
7. Verify removed from database.

---

### Task 8.4: Test MCP Server

**Type:** Manual

**Steps:**
1. Start MCP server locally for testing:
   ```bash
   VAULT_PATH=/home/$USER/obsidian/vault \
   PG_PASSWORD=YOUR_PASSWORD \
   OPENAI_API_KEY=YOUR_KEY \
   npx tsx src/mcp/index.ts
   ```
2. Test with a simple JSON-RPC request (pipe to stdin):
   ```bash
   echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | \
     VAULT_PATH=/home/$USER/obsidian/vault \
     PG_PASSWORD=YOUR_PASSWORD \
     OPENAI_API_KEY=YOUR_KEY \
     npx tsx src/mcp/index.ts
   ```
   Should return list of 6 tools.

**Checkpoint:** MCP server responds with tool definitions.

---

## GATE 8: Pause here. Full integration verified: Watcher indexes files, MCP server responds, database has embeddings. Only proceed after manual confirmation.

---

## Phase 9: Cloud Run Panel (VM start/stop)

**Goal:** Simple API to start/stop the VM remotely.

> **Note:** This phase follows the same architecture from TECHNICAL_HANDOFF.md. Implementation details TBD based on existing Cloud Run panel design. Can be deferred if manual VM start/stop via `gcloud` is acceptable for v1.

### Task 9.1: Minimal Cloud Run API

**Type:** Code (can be deferred)

Minimal endpoints:
- `POST /vm/start` — starts the VM
- `POST /vm/stop` — stops the VM
- `GET /vm/status` — returns VM status

Protected by Google IAM (`--no-allow-unauthenticated`).

---

## Phase 10: Backups & Monitoring

### Task 10.1: PostgreSQL Backup Cron

**Type:** Manual

**Steps:**
```bash
# Create backup script
cat > /home/$USER/obsidian/pg-backup.sh << 'SCRIPT'
#!/bin/bash
BACKUP_DIR="/home/$USER/obsidian/backups"
mkdir -p "$BACKUP_DIR"
PGPASSWORD=$(gcloud secrets versions access latest --secret=pg-obsidian-password) \
  pg_dump -h localhost -U obsidian_brain open_brain | gzip > "$BACKUP_DIR/open_brain_$(date +%Y%m%d_%H%M%S).sql.gz"
# Keep only last 30 backups
ls -t "$BACKUP_DIR"/*.sql.gz | tail -n +31 | xargs rm -f 2>/dev/null
SCRIPT

chmod +x /home/$USER/obsidian/pg-backup.sh

# Daily at 3 AM
(crontab -l 2>/dev/null; echo "0 3 * * * /home/$USER/obsidian/pg-backup.sh") | crontab -
```

---

### Task 10.2: VM Disk Snapshot Schedule

**Type:** Manual

```bash
gcloud compute resource-policies create snapshot-schedule obsidian-daily-snapshot \
  --region=us-central1 \
  --max-retention-days=14 \
  --daily-schedule \
  --start-time=04:00

gcloud compute disks add-resource-policies obsidian-vm \
  --zone=us-central1-a \
  --resource-policies=obsidian-daily-snapshot
```

**Checkpoint:** `gcloud compute resource-policies list` shows the policy.

---

## Phase 11: Claude Code MCP Configuration

**Goal:** Configure Claude Code on your local machine to use the MCP server on the VM.

### Task 11.1: Systemd Services on VM

**Type:** Manual

Create systemd services so MCP server and watcher start automatically:

```bash
# Watcher service
sudo tee /etc/systemd/system/obsidian-watcher.service << EOF
[Unit]
Description=Obsidian Vault Watcher
After=postgresql.service

[Service]
User=$USER
WorkingDirectory=/home/$USER/obsidian_open_brain
EnvironmentFile=/home/$USER/obsidian_open_brain/.env
ExecStart=/usr/bin/npx tsx src/watcher/index.ts
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl enable obsidian-watcher
sudo systemctl start obsidian-watcher
```

**Checkpoint:** `sudo systemctl status obsidian-watcher` shows active.

---

### Task 11.2: Configure Claude Code MCP Client

**Type:** Manual (on local machine)

Add to `~/.claude/claude_desktop_config.json` (or equivalent):

```json
{
  "mcpServers": {
    "obsidian-open-brain": {
      "command": "ssh",
      "args": [
        "-o", "StrictHostKeyChecking=no",
        "USER@10.10.0.1",
        "cd /home/USER/obsidian_open_brain && VAULT_PATH=/home/USER/obsidian/vault PG_PASSWORD=PW OPENAI_API_KEY=KEY npx tsx src/mcp/index.ts"
      ]
    }
  }
}
```

**Alternative:** Use a TCP transport instead of SSH-over-stdio if preferred.

**Checkpoint:**
1. Ensure VPN is connected
2. In Claude Code, verify the MCP server tools are listed
3. Test: ask Claude Code to `search_semantic` for a topic you know is in your vault
4. Test: ask Claude Code to `write_note` a test note
5. Verify the test note appears in your local Obsidian after git sync

---

## GATE 11 (FINAL): Full end-to-end flow working. Claude Code can read, write, and search your vault semantically via MCP. Watcher indexes changes. Git syncs bidirectionally. Backups are running. System is complete.

---

## Summary of Manual Checkpoints

| Gate | What to verify |
|------|----------------|
| 1 | VM running, IAP SSH, no public IP, Node.js installed |
| 2 | VPN bidirectional ping working |
| 3 | Git sync local <-> VM working both ways |
| 4 | PostgreSQL running, pgvector loaded, schema created |
| 5 | All unit tests pass, OpenAI key in Secret Manager |
| 6 | All unit tests pass (embedding + db + watcher) |
| 7 | All tests pass, `tsc --noEmit` clean |
| 8 | Integration: watcher indexes, MCP responds, DB has embeddings |
| 11 | Claude Code connects to MCP, full read/write/search works |
