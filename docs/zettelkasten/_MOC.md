2026-03-14 11:00

Status: #child

Tags: [[claude-skill]] [[open-brain]] [[claude code]]
source: claude-skill

# Open Brain -- Map of Content

> [!info] Projeto
> **Open Brain** é um sistema híbrido de gestao de conhecimento pessoal conectando Obsidian Vault local com PostgreSQL+pgvector em GCP VM, exposto via MCP Server acessivel por WireGuard VPN.
> Repo: `obsidian_open_brain` | Stack: TypeScript, PostgreSQL 16, pgvector, chokidar, OpenAI

---

## Visao Geral e Arquitetura

- [[Open Brain - Arquitetura Geral]] -- Visao macro do sistema hibrido e seus componentes
- [[Open Brain - Fluxo de Dados]] -- Pipeline bidirecional: vault local <-> VM <-> pgvector

## Componentes Core

- [[Open Brain - MCP Server]] -- MCP Server com 6 tools (stdio over SSH)
- [[Open Brain - Servico de Embedding]] -- Biblioteca de embeddings, parsing e chunking
- [[Open Brain - Vault Watcher]] -- Chokidar v5 + pipeline de indexacao automatica
- [[Open Brain - Banco pgvector]] -- PostgreSQL 16 + pgvector, schema e DbClient

## Infraestrutura e Seguranca

- [[Open Brain - Infraestrutura GCP]] -- GCP VM e2-small, Cloud NAT, Secret Manager
- [[Open Brain - WireGuard VPN]] -- VPN 10.10.0.0/24, split tunnel, multi-client
- [[Open Brain - Seguranca Zero Trust]] -- Zero Trust: firewall deny-all, localhost-only, path traversal prevention

## Qualidade e Deploy

- [[Open Brain - Estrategia de Testes]] -- TDD com vitest, 59 testes, cobertura 80%+
- [[Open Brain - CI CD GitHub Actions]] -- CI (PR validation) + CD (deploy automatico via IAP tunnel)

## Skills do Sistema

- [[Open Brain - Skill obsidian-ingest]] -- Skill de ingestao de conteudo no vault
- [[Open Brain - Skill sync-calendar]] -- Skill de sincronizacao Google Calendar -> Obsidian
- [[Open Brain - Skill zettelkasten]] -- Skill de geracao de notas atomicas a partir de codigo

---

## Grafo de conexoes

```
Open Brain - Arquitetura Geral
  +-- Open Brain - Fluxo de Dados
  |     +-- Open Brain - Vault Watcher
  |     +-- Open Brain - Servico de Embedding
  |     +-- Open Brain - Banco pgvector
  +-- Open Brain - MCP Server
  |     +-- Open Brain - Banco pgvector
  |     +-- Open Brain - Servico de Embedding
  +-- Open Brain - Infraestrutura GCP
  |     +-- Open Brain - CI CD GitHub Actions
  +-- Open Brain - Seguranca Zero Trust
  |     +-- Open Brain - WireGuard VPN
  +-- Open Brain - Estrategia de Testes
  |     +-- Open Brain - CI CD GitHub Actions
  +-- Open Brain - Skill obsidian-ingest
  +-- Open Brain - Skill sync-calendar
  +-- Open Brain - Skill zettelkasten
```

---

*Zettelkasten gerado em 2026-03-14 via claude-skill (Mode 1: Full Project Scan)*
*Atualizado em 2026-03-25: correcoes de precisao + 3 notas de skills adicionadas*
*14 notas atomicas | Cobertura: arquitetura, componentes, infra, seguranca, qualidade, skills*
