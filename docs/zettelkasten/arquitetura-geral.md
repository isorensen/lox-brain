2026-03-14 11:00

Status: #baby

Tags: [[claude-skill]] [[open-brain]] [[arquitetura]]
source: claude-skill

# Arquitetura Geral do Open Brain

O Open Brain e um sistema hibrido de gestao de conhecimento pessoal que conecta um Obsidian Vault local com PostgreSQL+pgvector em uma VM GCP, exposto via MCP Server acessivel por WireGuard VPN. Claude Code atua como cliente de primeira classe.

## Principio fundamental

O Obsidian Vault e a **source of truth**. O pgvector e um indice de leitura derivado dele. Toda nota nasce como arquivo `.md` no vault -- seja criada manualmente no Obsidian Desktop, seja via [[mcp-server]] pelo Claude Code.

## Componentes do sistema

O sistema e composto por 6 componentes principais que operam em duas camadas:

**Camada local:**
- Obsidian Desktop (edicao manual de notas)
- Git sync (push/pull com a VM)

**Camada VM (GCP):**
- [[banco-pgvector]] (PostgreSQL 16 + pgvector, armazenamento de embeddings)
- [[vault-watcher]] (chokidar, detecta mudancas em `.md`)
- [[embedding-service]] (OpenAI text-embedding-3-small)
- [[mcp-server]] (6 tools, transporte stdio over SSH)

A comunicacao entre as camadas acontece exclusivamente via [[wireguard-vpn]], sem exposicao de IP publico.

## Tech stack

- **Linguagem:** TypeScript (Node.js 22 LTS)
- **Database:** PostgreSQL 16 + pgvector (`vector(1536)`, ivfflat index)
- **MCP SDK:** `@modelcontextprotocol/sdk`
- **File watcher:** chokidar v5
- **Embeddings:** OpenAI `text-embedding-3-small`
- **Infra:** GCP (Compute Engine, Secret Manager, Cloud NAT)

## Relacoes

- depende de: [[infraestrutura-gcp]], [[seguranca-zero-trust]]
- contido em: [[_MOC]]
- se conecta com: [[fluxo-de-dados]]

## References

- `CLAUDE.md` (raiz do projeto)
- `docs/plans/2026-03-07-obsidian-open-brain-design.md`
- `docs/TECHNICAL_HANDOFF.md`
