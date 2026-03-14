2026-03-14 11:07

Status: #baby

Tags: [[claude-skill]] [[open-brain]] [[infraestrutura]] [[gcp]]
source: claude-skill

# Infraestrutura GCP do Open Brain

O Open Brain roda em uma unica VM GCP com todos os componentes co-locados. A infraestrutura foi projetada para custo minimo com seguranca maxima.

## Recursos GCP

| Recurso | Especificacao |
|---------|--------------|
| Projeto | `obsidian-open-brain` (ID: 334842260519) |
| VM | `obsidian-vm`, e2-small (2 vCPU, 2GB RAM) |
| Regiao | `us-east1-b` (South Carolina -- menor latencia para Brasil) |
| VPC | `obsidian-vpc`, subnet `10.0.0.0/24` |
| IP interno | `10.0.0.2` |
| IP publico | Nenhum (Zero Trust) |
| Cloud NAT | Outbound-only (apt, npm, git) |
| Secret Manager | 3 secrets (OpenAI key, PG password, Git token) |
| Budget | R$240/mes com alertas em 50%, 90%, 100% |

## Software na VM

- Node.js 22.22.1 (LTS)
- PostgreSQL 16.13 + pgvector 0.8.2
- WireGuard (interface `wg0`)
- Git 2.43.0
- systemd service: `obsidian-watcher.service`

## Git sync

O vault e sincronizado via git cron a cada 2 minutos (`git-sync.sh`). O repositorio privado `obsidian-git-sync` usa um fine-grained PAT com escopo minimo (Contents RW + Metadata R), armazenado no Secret Manager.

O repositorio do codigo fonte (`obsidian_open_brain`) tambem esta na VM em `~/obsidian_open_brain`, atualizado automaticamente via [[cicd-github-actions]].

## Service accounts

Duas service accounts com principio de least privilege:
- `obsidian-vm-sa`: acesso a secrets + logging
- `github-actions-deploy`: deploy via IAP tunnel SSH

Ambas com rotacao de chaves a cada 90 dias (ver [[seguranca-zero-trust]]).

## Relacoes

- hospeda: [[banco-pgvector]], [[vault-watcher]], [[mcp-server]]
- protegida por: [[seguranca-zero-trust]], [[wireguard-vpn]]
- deploy via: [[cicd-github-actions]]
- contido em: [[_MOC]]

## References

- `docs/HANDOFF.md` (notas de sessao Fase 1)
- `docs/TECHNICAL_HANDOFF.md`
