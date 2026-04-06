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

## Future Integrations

### Claude Code Skills examples (bundle with the project)
- **Priority:** Medium
- **Complexity:** Low-Medium
- Evaluate shipping a small set of example Claude Code skills alongside the MCP server so users can install them with a single command.
- Rationale: Lox already exposes semantic+text search + note write/read via MCP. Skills would add reusable workflows on top (e.g. "daily note", "zettelkasten capture", "inbox triage", "weekly review"), making the combo **MCP Server + Obsidian + Claude Code Skills** a more opinionated Second-Brain toolkit.
- Deliverables to scope: `examples/skills/` folder with 3-5 starter skills, docs on installing them into `~/.claude/skills/`, optional `lox skills install` CLI command.

### Telegram Bot (ingestão interativa via celular)
- **Priority:** Medium
- **Complexity:** Medium — API oficial, gratuita, sem risco de ban
- Stack: `telegraf` (TypeScript) + OpenAI Whisper API + Claude API
- **Fluxo interativo:**
  1. Usuário envia ideia (texto ou áudio)
  2. Bot transcreve áudio (Whisper) se necessário
  3. Claude API formata como nota Obsidian (preview)
  4. Bot responde com preview + opções: Refinar / Salvar / Cancelar
  5. Usuário pode pedir refinamento ("expande", "muda título", "adiciona contexto")
  6. Bot ajusta via Claude API e mostra nova preview
  7. Ao confirmar → salva no vault → watcher embeda automaticamente
- **Caso de uso principal:** registrar ideias rápidas (texto/áudio) com follow-up e refinamento antes de salvar
- Arquitetura: bot + Claude API para formatação inteligente (conhece formato do vault)

### WhatsApp Integration (ingestão via celular)
- **Priority:** Low
- **Complexity:** High — sem API oficial gratuita para uso pessoal
- Opções: Evolution API (self-hosted, risco de ban) ou WhatsApp Business API (paga)
- Mesmo fluxo do Telegram, mas com mais infra e risco

### Google Chat Bot (ingestão via Workspace)
- **Priority:** Low
- **Complexity:** Medium — requer config no GCP Console (OAuth/SA, Pub/Sub ou webhook)
- Vantagem: já usa GCP, autenticação integrada
- Desvantagem: mais burocrático que Telegram, cards API limitada para formatting

### ~~Calendar → Obsidian Sync (Phase 1 — skill)~~ — DONE (2026-03-12)
- **Skill:** `<your-skill-path>` — on-demand via MCPs existentes (Calendar + Gmail + Obsidian Brain)
- **Battle-tested:** sync completo de março 2026 (67 eventos criados no vault)
- **12 melhorias** aplicadas com base em uso real (filtros, formato, subagentes em batch, integração Gemini AI)
- **Gemini AI meeting notes:** emails de `<meeting-notes-sender>` capturados via Gmail MCP com conteúdo completo (summary, tópicos, next steps)
- **Subagent batch processing:** eventos processados em paralelo para syncs grandes
- Branch: `feat/calendar-to-obsidian` (mergeado após docs)

### Calendar → Obsidian Automation (Phase 2 — feat/calendar-automation)
- **Priority:** Medium
- Script standalone TypeScript na VM com cron
  - Google Calendar API + Gmail API (OAuth2 direto) + escrita .md no vault
  - Roda automaticamente a cada 1-2h, sem depender de sessão Claude Code
  - Precisa: OAuth2 setup, service account ou stored credentials

### New MCP Server Tools
- **Priority:** Medium
- `search_by_tags` — query by tags (GIN index already exists)
- `get_related` — find N most similar notes by embedding distance
- `get_graph` — extract wikilinks and return connection graph
- `vault_stats` — note counts by folder, top tags, orphan notes

### Lox Local Mode
- **Priority:** Medium
- Run everything locally without GCP (PostgreSQL local, no VPN, zero cost)
- Entry-level option for users who don't want cloud infrastructure
- Installer flag: `--mode=local`

## Pending Improvements

### ~~Text chunking for large notes~~ — DONE (2026-03-09)
- `EmbeddingService.chunkText()`: maxTokens=4000, overlap=200, paragraph-based splitting
- Two-phase pipeline: generate all embeddings first, then batch upsert
- `chunk_index` column added to `vault_embeddings` (unique key: `file_path, chunk_index`)
- 243/243 notes indexed successfully (was 232/243 before chunking)

### ~~CI/CD auto-deploy~~ — DONE (2026-03-10)
- GitHub Actions: `ci.yml` (PR validation: build, test, coverage, audit) + `deploy.yml` (deploy on merge to main via IAP tunnel SSH)
- GCP SA `<your-deploy-sa>` with least-privilege roles
- Deploy: git pull, npm ci, build, restart watcher, kill MCP, health check

### SA key rotation schedule
- **Priority:** High
- `<your-vm-service-account>`: rotate every 90 days — set calendar reminders or automate via Cloud Scheduler
- `<your-deploy-sa>` (key `<key-id>`, no auto-expiry): rotate every 90 days
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
