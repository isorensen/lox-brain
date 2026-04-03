2026-03-14 11:00

Status: #child

Tags: [[claude-skill]] [[lox]] [[claude code]]
source: claude-skill

# Lox -- Map of Content

> [!info] Projeto
> **Lox** (formerly Open Brain) é um sistema híbrido de gestao de conhecimento pessoal conectando Obsidian Vault local com PostgreSQL+pgvector em GCP VM, exposto via MCP Server acessivel por WireGuard VPN.
> Repo: `isorensen/lox-brain` | Stack: TypeScript, PostgreSQL 16, pgvector, chokidar, OpenAI

---

## Visao Geral e Arquitetura

- [[Lox - Arquitetura Geral]] -- Visao macro do sistema hibrido e seus componentes
- [[Lox - Fluxo de Dados]] -- Pipeline bidirecional: vault local <-> VM <-> pgvector

## Componentes Core

- [[Lox - MCP Server]] -- MCP Server com 6 tools (stdio over SSH)
- [[Lox - Servico de Embedding]] -- Biblioteca de embeddings, parsing e chunking
- [[Lox - Vault Watcher]] -- Chokidar v5 + pipeline de indexacao automatica
- [[Lox - Banco pgvector]] -- PostgreSQL 16 + pgvector, schema e DbClient

## Infraestrutura e Seguranca

- [[Lox - Infraestrutura GCP]] -- GCP VM e2-small, Cloud NAT, Secret Manager
- [[Lox - WireGuard VPN]] -- VPN 10.10.0.0/24, split tunnel, multi-client
- [[Lox - Seguranca Zero Trust]] -- Zero Trust: firewall deny-all, localhost-only, path traversal prevention

## Qualidade e Deploy

- [[Lox - Estrategia de Testes]] -- TDD com vitest, 150 testes, cobertura 80%+
- [[Lox - CI CD GitHub Actions]] -- CI (PR validation) + CD (deploy automatico via IAP tunnel)

## Skills do Sistema

- [[Lox - Skill obsidian-ingest]] -- Skill de ingestao de conteudo no vault
- [[Lox - Skill sync-calendar]] -- Skill de sincronizacao Google Calendar -> Obsidian
- [[Lox - Skill zettelkasten]] -- Skill de geracao de notas atomicas a partir de codigo

---

## Grafo de conexoes

```
Lox - Arquitetura Geral
  +-- Lox - Fluxo de Dados
  |     +-- Lox - Vault Watcher
  |     +-- Lox - Servico de Embedding
  |     +-- Lox - Banco pgvector
  +-- Lox - MCP Server
  |     +-- Lox - Banco pgvector
  |     +-- Lox - Servico de Embedding
  +-- Lox - Infraestrutura GCP
  |     +-- Lox - CI CD GitHub Actions
  +-- Lox - Seguranca Zero Trust
  |     +-- Lox - WireGuard VPN
  +-- Lox - Estrategia de Testes
  |     +-- Lox - CI CD GitHub Actions
  +-- Lox - Skill obsidian-ingest
  +-- Lox - Skill sync-calendar
  +-- Lox - Skill zettelkasten
```

---

*Zettelkasten gerado em 2026-03-14 via claude-skill (Mode 1: Full Project Scan)*
*Atualizado em 2026-03-25: correcoes de precisao + 3 notas de skills adicionadas*
*Atualizado em 2026-04-03: renomeado de Open Brain para Lox (repo: isorensen/lox-brain, monorepo, 150 testes)*
*14 notas atomicas | Cobertura: arquitetura, componentes, infra, seguranca, qualidade, skills*
