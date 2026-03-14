2026-03-14 11:00

Status: #baby

Tags: [[claude-skill]] [[open-brain]]
source: claude-skill

# Open Brain -- Map of Content

> [!info] Projeto
> **Open Brain** e um sistema hibrido de gestao de conhecimento pessoal conectando Obsidian Vault local com PostgreSQL+pgvector em GCP VM, exposto via MCP Server acessivel por WireGuard VPN.
> Repo: `obsidian_open_brain` | Stack: TypeScript, PostgreSQL 16, pgvector, chokidar, OpenAI

---

## Visao Geral e Arquitetura

- [[arquitetura-geral]] -- Visao macro do sistema hibrido e seus componentes
- [[fluxo-de-dados]] -- Pipeline bidirecional: vault local <-> VM <-> pgvector

## Componentes Core

- [[mcp-server]] -- MCP Server com 6 tools (stdio over SSH)
- [[embedding-service]] -- Biblioteca de embeddings, parsing e chunking
- [[vault-watcher]] -- Chokidar v5 + pipeline de indexacao automatica
- [[banco-pgvector]] -- PostgreSQL 16 + pgvector, schema e DbClient

## Infraestrutura e Seguranca

- [[infraestrutura-gcp]] -- GCP VM e2-small, Cloud NAT, Secret Manager
- [[wireguard-vpn]] -- VPN 10.10.0.0/24, split tunnel, multi-client
- [[seguranca-zero-trust]] -- Zero Trust: firewall deny-all, localhost-only, path traversal prevention

## Qualidade e Deploy

- [[estrategia-testes]] -- TDD com vitest, 59 testes, cobertura 80%+
- [[cicd-github-actions]] -- CI (PR validation) + CD (deploy automatico via IAP tunnel)

---

## Grafo de conexoes

```
arquitetura-geral
  +-- fluxo-de-dados
  |     +-- vault-watcher
  |     +-- embedding-service
  |     +-- banco-pgvector
  +-- mcp-server
  |     +-- banco-pgvector
  |     +-- embedding-service
  +-- infraestrutura-gcp
  |     +-- cicd-github-actions
  +-- seguranca-zero-trust
  |     +-- wireguard-vpn
  +-- estrategia-testes
        +-- cicd-github-actions
```

---

*Zettelkasten gerado em 2026-03-14 via claude-skill (Mode 1: Full Project Scan)*
*11 notas atomicas | 15 tags | Cobertura: arquitetura, componentes, infra, seguranca, qualidade*
