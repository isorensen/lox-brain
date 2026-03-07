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
| 1 | GCP Infrastructure (VPC, VM, Firewall) | PENDENTE | Gate 1 |
| 2 | WireGuard VPN | PENDENTE | Gate 2 |
| 3 | Git Vault Sync on VM | PENDENTE | Gate 3 |
| 4 | PostgreSQL + pgvector | PENDENTE | Gate 4 |
| 5 | Embedding Service (library, TDD) | PENDENTE | Gate 5 |
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

_(atualizar conforme as fases avancem)_
