2026-03-14 11:00

Status: #child

Tags: [[claude-skill]] [[lox]] [[arquitetura]]
source: claude-skill

# Arquitetura Geral do Lox

O Lox e um sistema hibrido de gestao de conhecimento pessoal que conecta um Obsidian Vault local com PostgreSQL+pgvector em uma VM GCP, exposto via MCP Server acessivel por WireGuard VPN. Claude Code atua como cliente de primeira classe.

## Principio fundamental

O Obsidian Vault é a **source of truth**. O pgvector é um índice de leitura derivado dele. Toda nota nasce como arquivo `.md` no vault -- seja criada manualmente no Obsidian Desktop, seja via [[Lox - MCP Server]] pelo Claude Code.

## Componentes do sistema

O sistema e composto por 6 componentes principais que operam em duas camadas:

**Camada local:**
- Obsidian Desktop (edição manual de notas)
- Git sync (push/pull com a VM)

**Camada VM (GCP):**
- [[Lox - Banco pgvector]] (PostgreSQL 16 + pgvector, armazenamento de embeddings)
- [[Lox - Vault Watcher]] (chokidar, detecta mudanças em `.md`)
- [[Lox - Servico de Embedding]] (OpenAI text-embedding-3-small)
- [[Lox - MCP Server]] (6 tools, transporte stdio over SSH)

A comunicação entre as camadas acontece exclusivamente via [[Lox - WireGuard VPN]], sem exposição de IP publico.

## Tech stack

- **Linguagem:** TypeScript (Node.js 22 LTS)
- **Database:** PostgreSQL 16 + pgvector (`vector(1536)`, ivfflat index)
- **MCP SDK:** `@modelcontextprotocol/sdk`
- **File watcher:** chokidar v5
- **Embeddings:** OpenAI `text-embedding-3-small`
- **Infra:** GCP (Compute Engine, Secret Manager, Cloud NAT)

## Relações

- depende de: [[Lox - Infraestrutura GCP]], [[Lox - Seguranca Zero Trust]]
- contido em: [[Lox]]
- se conecta com: [[Lox - Fluxo de Dados]]

## References

- `CLAUDE.md` (raiz do projeto)
- `docs/superpowers/specs/2026-04-03-lox-brain-design.md`
- `docs/TECHNICAL_HANDOFF.md`
