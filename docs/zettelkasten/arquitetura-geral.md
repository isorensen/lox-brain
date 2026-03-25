2026-03-14 11:00

Status: #child

Tags: [[claude-skill]] [[open-brain]] [[arquitetura]]
source: claude-skill

# Arquitetura Geral do Open Brain

O Open Brain e um sistema hibrido de gestao de conhecimento pessoal que conecta um Obsidian Vault local com PostgreSQL+pgvector em uma VM GCP, exposto via MCP Server acessivel por WireGuard VPN. Claude Code atua como cliente de primeira classe.

## Principio fundamental

O Obsidian Vault é a **source of truth**. O pgvector é um índice de leitura derivado dele. Toda nota nasce como arquivo `.md` no vault -- seja criada manualmente no Obsidian Desktop, seja via [[Open Brain - MCP Server]] pelo Claude Code.

## Componentes do sistema

O sistema e composto por 6 componentes principais que operam em duas camadas:

**Camada local:**
- Obsidian Desktop (edição manual de notas)
- Git sync (push/pull com a VM)

**Camada VM (GCP):**
- [[Open Brain - Banco pgvector]] (PostgreSQL 16 + pgvector, armazenamento de embeddings)
- [[Open Brain - Vault Watcher]] (chokidar, detecta mudanças em `.md`)
- [[Open Brain - Servico de Embedding]] (OpenAI text-embedding-3-small)
- [[Open Brain - MCP Server]] (6 tools, transporte stdio over SSH)

A comunicação entre as camadas acontece exclusivamente via [[Open Brain - WireGuard VPN]], sem exposição de IP publico.

## Tech stack

- **Linguagem:** TypeScript (Node.js 22 LTS)
- **Database:** PostgreSQL 16 + pgvector (`vector(1536)`, ivfflat index)
- **MCP SDK:** `@modelcontextprotocol/sdk`
- **File watcher:** chokidar v5
- **Embeddings:** OpenAI `text-embedding-3-small`
- **Infra:** GCP (Compute Engine, Secret Manager, Cloud NAT)

## Relações

- depende de: [[Open Brain - Infraestrutura GCP]], [[Open Brain - Seguranca Zero Trust]]
- contido em: [[Open Brain]]
- se conecta com: [[Open Brain - Fluxo de Dados]]

## References

- `CLAUDE.md` (raiz do projeto)
- `docs/plans/2026-03-07-obsidian-open-brain-design.md`
- `docs/TECHNICAL_HANDOFF.md`
