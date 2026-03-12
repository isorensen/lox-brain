# Obsidian Open Brain — Session Handoff

**Projeto:** obsidian_open_brain
**Ultimo update:** 2026-03-08

## Regra de Ouro

**NENHUMA fase avanca sem confirmacao explicita do usuario.**
Cada fase deve estar EM PRODUCAO e FUNCIONAL antes de prosseguir.
O usuario trabalha junto, configura manualmente o que for necessario, testa, e so entao diz "proximo".

## Status das Fases

| Fase | Descricao | Status | Gate |
|------|-----------|--------|------|
| 1 | GCP Infrastructure (VPC, VM, Firewall) | COMPLETA | Gate 1 |
| 2 | WireGuard VPN | COMPLETA | Gate 2 |
| 3 | Git Vault Sync on VM | COMPLETA | Gate 3 |
| 4 | PostgreSQL + pgvector | COMPLETA | Gate 4 |
| 5 | Embedding Service (library, TDD) | COMPLETA | Gate 5 |
| 6 | Vault Watcher (TDD) | COMPLETA | Gate 6 |
| 7 | MCP Server (TDD) | COMPLETA | Gate 7 |
| 8 | Integration Testing (end-to-end) | COMPLETA | Gate 8 |
| 9 | Cloud Run Panel (VM start/stop) | PENDENTE | — |
| 10 | Backups & Monitoring | PENDENTE | — |
| 11 | Claude Code MCP Config | COMPLETA | Gate 11 |

## Documentos de Referencia

- Design: `docs/plans/2026-03-07-obsidian-open-brain-design.md`
- Plano: `docs/plans/2026-03-07-obsidian-open-brain-plan.md`
- Handoff original (infra): `TECHNICAL_HANDOFF.md`

## Notas de Sessao

### 2026-03-07 — Fase 1 completa
- Projeto: `obsidian-open-brain` (project number: 334842260519)
- Regiao: `us-east1-b` (South Carolina — menor latencia para Brasil, mesma faixa de preco)
- VPC: `obsidian-vpc`, subnet `10.0.0.0/24`
- Firewall: deny-all default + 3 regras (WireGuard UDP 51820, internal, IAP SSH)
- Default VPC deletada (Zero Trust hardening)
- VM: `obsidian-vm`, e2-small, IP interno `10.0.0.2`, sem IP publico
- Service account: `obsidian-vm-sa` (roles: secretmanager.secretAccessor, logging.logWriter)
- Cloud NAT: outbound-only internet (apt/npm/git sem expor IP publico)
- Budget: R$240/mes com alertas em 50%, 90%, 100%
- Base setup: Node.js 22.22.1, npm 10.9.4, git 2.43.0
- Proxima fase: Fase 2 (WireGuard VPN)

### 2026-03-07 — Fase 2 completa
- IP estatico: `34.75.93.58` (vinculado a VM, firewall so permite UDP 51820)
- WireGuard server: `10.10.0.1/24`, porta 51820, interface wg0
- WireGuard client: `10.10.0.2/24`, config em `/etc/wireguard/wg-obsidian.conf`
- Split tunnel: so trafego 10.10.0.0/24 passa pela VPN
- Latencia: ~153ms (Brasil → us-east1)
- Bidirecional: client→server OK, server→client OK
- Proxima fase: Fase 3 (Git Vault Sync)

### 2026-03-07 — Fase 3 completa
- Repo: `github.com/isorensen/obsidian-git-sync.git` (privado)
- Token: fine-grained PAT no GCP Secret Manager (`git-vault-token`), escopo minimo (Contents RW + Metadata R)
- Vault clonado em `/home/sorensen/obsidian/vault/`
- Cron sync a cada 2 min (`git-sync.sh`), token limpo da URL apos cada sync
- Git identity: "Obsidian VM" / obsidian-vm@noreply
- Proxima fase: Fase 4 (PostgreSQL + pgvector)

### 2026-03-07 — Fase 4 completa
- PostgreSQL 16.13, pgvector 0.8.2
- Escuta somente em localhost (Zero Trust)
- DB: `open_brain`, user: `obsidian_brain`
- Senha no Secret Manager: `pg-obsidian-password`
- Tabela: `vault_embeddings` (UUID PK, file_path UNIQUE, embedding vector(1536), tags TEXT[], file_hash)
- Indices: ivfflat cosine (lists=100), GIN tags, btree updated_at DESC
- Proxima fase: Fase 5 (Embedding Service — codigo TDD)

### 2026-03-07 — Fase 5 completa
- TypeScript project setup: Node16, strict mode, vitest com coverage v8 (threshold 80%)
- EmbeddingService: generateEmbedding (OpenAI text-embedding-3-small), parseNote (frontmatter + YAML list tags + H1 fallback), computeHash (SHA256)
- DbClient: upsertNote (ON CONFLICT), deleteNote, searchSemantic (cosine), searchText (ILIKE + tags @>), listRecent, getFileHash
- 21 testes passando, tsc --noEmit limpo, 0 vulnerabilidades npm audit
- Code review: blocker corrigido (guard empty OpenAI response), YAML list tags, quoted titles, limit validation, error path tests
- OpenAI API key no Secret Manager: `openai-api-key`
- Proxima fase: Fase 6 (Vault Watcher)

### 2026-03-08 — Fase 6 completa
- VaultWatcher class: shouldProcess (filtra .md, ignora .obsidian/.git), handleFileChange (hash skip, parse, embed, upsert), handleFileDelete
- Entry point com chokidar v5 (dynamic import ESM/CJS), handlers DRY via processFile()
- Error handling: console.error no catch (nao silencia falhas), erros de delete propagados ao caller
- UUID gerado no watcher (descartado no UPDATE via ON CONFLICT, documentado com comentario)
- Embedding text: filter(Boolean).join('\n') — sem \n extra quando titulo e null
- 33 testes passando (12 novos), tsc --noEmit limpo, 0 vulnerabilidades
- Code review: 2 blockers + 3 issues + 3 suggestions corrigidos antes do commit
- Scripts npm: `watcher` (tsx dev), `watcher:prod` (node dist)
- Proxima fase: Fase 7 (MCP Server)

### 2026-03-08 — Fase 7 completa
- MCP Server com 6 tools: write_note, read_note, delete_note, search_semantic, search_text, list_recent
- createTools() com safePath() anti-traversal (path.resolve + prefix check + null-byte rejection)
- Runtime type guards nos handlers (sem `as string` casts)
- Entry point stdio transport (@modelcontextprotocol/sdk), env var validation na startup
- Pool config: 127.0.0.1:5432 explicito, SSL omitido (localhost Zero Trust)
- 59 testes passando (26 novos MCP), tsc --noEmit limpo, 0 vulnerabilidades
- Code review: 5 issues + 4 suggestions corrigidos antes do commit
- Scripts npm: `mcp` (tsx dev), `mcp:prod` (node dist)
- Proxima fase: Fase 8 (Integration Testing)

### 2026-03-08 — Fase 8 completa
- Repo clonado na VM: `~/obsidian_open_brain` (branch feat/v0)
- Token `git-vault-token` atualizado com acesso ao repo `obsidian_open_brain`
- .env criado na VM com VAULT_PATH, PG_PASSWORD, OPENAI_API_KEY (via Secret Manager)
- Script `index-vault.ts`: indexou 181/186 notas (5 falharam por exceder 8192 tokens — chunking pendente, ver TODO.md)
- Watcher testado ao vivo: criacao e remocao de nota detectadas e refletidas no DB
- MCP Server testado via JSON-RPC stdin: retornou 6 tools corretamente
- Pendencia: implementar text chunking para notas longas (TODO.md)
- Proximas fases: Fase 9 (Cloud Run Panel, deferivel), Fase 10 (Backups), Fase 11 (Claude Code MCP Config)

### 2026-03-08 — Systemd + Fase 11 completa
- Systemd service `obsidian-watcher.service`: watcher inicia automaticamente no boot (enabled)
- MCP Server nao precisa de systemd — e invocado sob demanda pelo Claude Code via SSH
- SSH config local: `Host obsidian-vm` aponta para `10.10.0.1` via VPN (chave `google_compute_engine`)
- Claude Code MCP config (scope user): `claude mcp add --scope user obsidian-brain -- ssh obsidian-vm "cd ... && export $(cat .env | xargs) && npx tsx src/mcp/index.ts"`
- 6 tools testadas e funcionais: search_semantic, search_text, list_recent, read_note, write_note, delete_note
- Busca semantica por "cafe" retornou notas corretas com similarity scores
- Proximas fases pendentes: Fase 9 (Cloud Run Panel, deferida), Fase 10 (Backups & Monitoring)

### 2026-03-08 — Search optimization deployed
- search_semantic, search_text, list_recent: retornam **somente metadata** por padrao (sem content)
- Novos params em todos os search tools: `offset`, `include_content`, `content_preview_length`
- searchText: limite padrao alterado de 50 para 20
- Todos os search tools retornam `PaginatedResult { results, total, limit, offset }`
- Workflow recomendado: search para descobrir notas → read_note para conteudo completo
- Operacional: MCP server roda via stdio over SSH. Apos mudancas de codigo na VM, matar processo antigo (`pkill -f "tsx src/mcp/index.ts"`) e reconectar via `/mcp` no Claude Code

### 2026-03-10 — CI/CD GitHub Actions completa
- CI workflow (`ci.yml`): build + tsc --noEmit + test:coverage (80%) + npm audit em PRs para main
- Deploy workflow (`deploy.yml`): gcloud compute ssh via IAP tunnel no merge para main
- Deploy steps: git pull, npm ci --omit=dev, build, systemctl restart obsidian-watcher, pkill MCP
- Health check: verifica que watcher esta ativo apos deploy
- SA `github-actions-deploy`: roles iap.tunnelResourceAccessor, compute.instanceAdmin.v1, iam.serviceAccountUser, compute.osLogin
- SA key rotation: manual a cada 90 dias (proximo: 2026-06-08), tracked em TODO.md
- Branch protection nao disponivel (requer GitHub Pro) — CI roda mas merge nao e bloqueado
- Warning: google-github-actions v2 usa Node.js 20 deprecated (deadline: junho 2026)
- Proxima fase pendente: Fase 10 (Backups & Monitoring)

### 2026-03-12 — sync-calendar skill COMPLETA (branch feat/calendar-to-obsidian)
- **Status:** skill battle-tested e pronta para uso. 67 eventos sincronizados (marco 2026 completo).
- **Skill path:** `~/.claude/skills/sync-calendar/SKILL.md`
- **Fluxo validado (end-to-end):**
  1. `gcal_list_events` → eventos com attendees + metadata
  2. `gmail_search_messages` (from:gemini-notes@google.com + titulo) → encontra email com notas Gemini
  3. `gmail_read_message` → conteudo completo (summary, topicos, next steps com responsaveis)
  4. `obsidian search_text` → verifica duplicatas no vault
  5. `obsidian write_note` → cria nota em `7 - Meeting Notes/`
- **12 melhorias aplicadas com base em uso real:**
  - Filtros de eventos (sem participacao, recusados, opcionais nao aceitos)
  - Subagent batch processing para syncs grandes (paralelismo)
  - Integracao completa com Gemini AI meeting notes via Gmail
  - Formato correto: plain text + Dataview inline fields (sem YAML frontmatter)
  - Tags como wikilinks `[[tag]]` para `3 - Tags/`
- **Automacao (proximo passo):** branch `feat/calendar-automation` — script TypeScript standalone na VM com cron a cada 1-2h

## Prompt de Retomada — Proxima Sessao

```
Estou trabalhando no projeto obsidian_open_brain (Obsidian Open Brain).
Leia docs/HANDOFF.md para ver o status atual.

Opcoes para proxima sessao:
1. feat/calendar-automation — script TypeScript standalone na VM com cron (Google Calendar API + Gmail API + OAuth2 setup)
2. Phase 10 (Backups & Monitoring) — pg_dump cron, VM snapshot schedule, Cloud Logging alerts
3. ESLint — adicionar ao projeto e integrar no CI/CD

Regra: cada fase deve estar em producao e funcional antes de avancar.
```
