# Obsidian Open Brain — Design Document

**Data:** 2026-03-07
**Status:** Aprovado

## 1. Visao geral

Sistema hibrido de knowledge management pessoal que combina Obsidian (vault Markdown local) com PostgreSQL+pgvector (busca semantica), acessivel por qualquer IA via MCP Server.

- **Fonte da verdade:** Obsidian vault (arquivos .md)
- **pgvector:** indice de leitura, nunca escrita direta
- **Sync:** Git bidirecional (local <-> VM)
- **Acesso IA:** MCP Server na VM, acessivel via VPN

## 2. Arquitetura

```
ESCRITA HUMANA:
Obsidian local -> git push -> VM git pull -> Watcher detecta ->
  -> OpenAI embedding API -> pgvector upsert

ESCRITA VIA IA:
Claude Code -> MCP (VPN) -> VM acorda se preciso ->
  -> Obsidian CLI cria .md -> Watcher detecta ->
  -> OpenAI embedding API -> pgvector upsert ->
  -> VM git push -> Obsidian local git pull

LEITURA:
Claude Code -> MCP (VPN) -> pgvector cosine similarity -> resultado

REMOCAO:
MCP ou Obsidian local deleta .md -> git sync ->
  -> Watcher detecta remocao -> pgvector delete
```

```
Voce no computador local:
  +-- Obsidian desktop (vault local, Git sync via plugin)
  +-- Claude Code (chama MCP Server na VM via VPN)

VM (background, voce nao entra nela):
  +-- Git pull <- recebe suas edicoes do Obsidian local
  +-- Watcher -> reindexa no pgvector
  +-- MCP Server -> responde Claude Code
  +-- Obsidian CLI -> cria notas quando Claude Code pede
  +-- Git push -> notas criadas via IA voltam pro repo
        |
        v
  Obsidian local faz Git pull -> nota aparece no vault
```

## 3. Componentes e responsabilidades

| Componente | Onde roda | Responsabilidade |
|---|---|---|
| **Obsidian desktop** | Local | Escrita, reflexao, graph visual, Git push/pull |
| **Git repo privado** | GitHub/GitLab | Canal de sync entre local e VM |
| **VM (GCE)** | Cloud | PostgreSQL+pgvector, MCP Server, Watcher, Obsidian CLI, Git sync |
| **MCP Server** | VM | Expoe tools para qualquer IA client |
| **Watcher** | VM | Detecta mudancas no vault -> gera embeddings -> upsert/delete pgvector |
| **PostgreSQL + pgvector** | VM | Armazena embeddings e metadata para busca semantica |
| **OpenAI Embeddings API** | Externo | Gera vetores (text-embedding-3-small) |
| **Cloud Run (painel)** | GCP | Liga/desliga VM, API de wake-up |
| **WireGuard** | VM + Local | VPN para acesso seguro ao MCP |

## 4. Schema do PostgreSQL

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE vault_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_path TEXT UNIQUE NOT NULL,      -- path relativo no vault
    title TEXT,                           -- extraido do frontmatter ou H1
    content TEXT NOT NULL,                -- conteudo completo do .md
    tags TEXT[],                          -- extraidos do frontmatter
    embedding vector(1536),              -- text-embedding-3-small
    file_hash TEXT NOT NULL,             -- SHA256 do conteudo (evita reindexar sem mudanca)
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_embedding ON vault_embeddings
    USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE INDEX idx_tags ON vault_embeddings USING gin (tags);
CREATE INDEX idx_updated ON vault_embeddings (updated_at DESC);
```

## 5. MCP Tools

| Tool | Input | Acao | Backend |
|---|---|---|---|
| `write_note` | path, content, tags? | Cria/edita .md com frontmatter | Obsidian CLI |
| `read_note` | path | Retorna conteudo | Filesystem |
| `delete_note` | path | Remove .md | Filesystem -> Watcher limpa pgvector |
| `search_semantic` | query, limit? | Busca por significado | pgvector (cosine similarity) |
| `search_text` | query, tags? | Busca keyword/tag | pgvector (full-text + tags filter) |
| `list_recent` | limit?, days? | Notas recentes | pgvector (ORDER BY updated_at) |

## 6. Stack tecnologico

| Camada | Tecnologia |
|---|---|
| MCP Server | TypeScript (SDK oficial Anthropic) |
| Watcher | Node.js com chokidar (inotify wrapper) |
| Embeddings | OpenAI text-embedding-3-small |
| Banco | PostgreSQL 16 + pgvector |
| VM | GCE e2-small (2 vCPU, 2GB RAM) |
| VPN | WireGuard |
| Git sync | cron (pull a cada 2 min) + post-write push |

## 7. Seguranca

- VM sem IP publico — acesso apenas via VPN (WireGuard)
- PostgreSQL escuta apenas localhost (127.0.0.1)
- API keys (OpenAI, Git token) no GCP Secret Manager
- Vault em repo Git privado
- MCP Server autenticado via token (rotacao periodica)
- Backups: snapshot diario do disco da VM

## 8. Disponibilidade

- VM com auto-start via Cloud Run panel (cold start 30-60s aceitavel)
- Warm em periodos pre-determinados via cron/scheduler
- Busca e escrita dependem da VM estar ligada
- Git sync garante que o vault local esta sempre atualizado

## 9. Extensibilidade

O MCP Server e o ponto unico de acesso. Novos clients (Slack bot, ChatGPT, Cursor) se conectam sem mudancas na arquitetura.

## 10. Fora do escopo (v1)

- Slack bot ou outros clients alem do Claude Code
- Chunking inteligente de notas longas (v1 indexa nota inteira)
- UI web para busca
- Multi-user
