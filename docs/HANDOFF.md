# Obsidian Open Brain — Session Handoff

**Projeto:** obsidian_open_brain
**Ultimo update:** 2026-03-07

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
| 6 | Vault Watcher (TDD) | PENDENTE | Gate 6 |
| 7 | MCP Server (TDD) | PENDENTE | Gate 7 |
| 8 | Integration Testing (end-to-end) | PENDENTE | Gate 8 |
| 9 | Cloud Run Panel (VM start/stop) | PENDENTE | — |
| 10 | Backups & Monitoring | PENDENTE | — |
| 11 | Claude Code MCP Config | PENDENTE | Gate 11 |

## Documentos de Referencia

- Design: `docs/plans/2026-03-07-obsidian-open-brain-design.md`
- Plano: `docs/plans/2026-03-07-obsidian-open-brain-plan.md`
- Handoff original (infra): `TECHNICAL_HANDOFF.md`

## Prompt de Retomada (colar em nova sessao)

```
Estou trabalhando no projeto obsidian_open_brain (Obsidian Open Brain).
Leia docs/HANDOFF.md para ver o status atual das fases.
Leia docs/plans/2026-03-07-obsidian-open-brain-plan.md para detalhes da fase atual.
Regra: cada fase deve estar em producao e funcional antes de avancar. Eu confirmo quando podemos ir para a proxima.
```

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
