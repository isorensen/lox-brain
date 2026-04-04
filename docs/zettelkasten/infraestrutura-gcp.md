2026-03-14 11:07

Status: #baby

Tags: [[claude-skill]] [[lox]] [[infraestrutura]] [[gcp]]
source: claude-skill

# Infraestrutura GCP do Lox

O Lox roda em uma unica VM GCP com todos os componentes co-locados. A infraestrutura foi projetada para custo minimo com seguranca maxima.

## Recursos GCP

| Recurso | Especificacao |
|---------|--------------|
| Projeto | `<your-gcp-project>` |
| VM | `lox-vm`, e2-small (2 vCPU, 2GB RAM) |
| Regiao | `us-east1-b` (South Carolina -- menor latencia para Brasil) |
| VPC | `<your-vpc-name>`, subnet `10.0.0.0/24` |
| IP interno | `10.0.0.2` |
| IP publico | Nenhum (Zero Trust) |
| Cloud NAT | Outbound-only (apt, npm, git) |
| Secret Manager | 3 secrets (OpenAI key, PG password, Git token) |
| Budget | ~US$18/month (GCE e2-small + storage) |

## Software na VM

- Node.js 22.22.1 (LTS)
- PostgreSQL 16.13 + pgvector 0.8.2
- WireGuard (interface `wg0`)
- Git 2.43.0
- systemd service: `lox-watcher.service` (replaced `obsidian-watcher.service`)

## Git sync

O vault e sincronizado via git cron a cada 2 minutos (`git-sync.sh`). O repositorio privado `<your-vault-repo>` usa um fine-grained PAT com escopo minimo (Contents RW + Metadata R), armazenado no Secret Manager.

O repositorio do codigo fonte (`lox-brain`) esta na VM em `~/lox-brain`, atualizado automaticamente via [[Lox - CI CD GitHub Actions]].

## Service accounts

Duas service accounts com principio de least privilege:
- `lox-vm-sa`: acesso a secrets + logging
- `<your-deploy-sa>`: deploy via IAP tunnel SSH

Ambas com rotacao de chaves a cada 90 dias (ver [[Lox - Seguranca Zero Trust]]).

## Relacoes

- hospeda: [[Lox - Banco pgvector]], [[Lox - Vault Watcher]], [[Lox - MCP Server]]
- protegida por: [[Lox - Seguranca Zero Trust]], [[Lox - WireGuard VPN]]
- deploy via: [[Lox - CI CD GitHub Actions]]
- contido em: [[Lox]]

## References

- `docs/HANDOFF.md` (notas de sessao Fase 1)
- `docs/TECHNICAL_HANDOFF.md`
