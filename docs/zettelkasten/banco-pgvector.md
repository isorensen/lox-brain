2026-03-14 11:05

Status: #baby

Tags: [[claude-skill]] [[lox]] [[banco-de-dados]] [[embeddings]]
source: claude-skill

# PostgreSQL + pgvector no Lox

O banco de dados do Lox usa PostgreSQL 16 com a extensao pgvector 0.8.2 para armazenamento e busca vetorial. Escuta **somente em localhost** (127.0.0.1) como parte do modelo [[Lox - Seguranca Zero Trust]].

## Schema: vault_embeddings

```sql
CREATE TABLE vault_embeddings (
  id          UUID PRIMARY KEY,
  file_path   TEXT NOT NULL,
  title       TEXT,
  content     TEXT NOT NULL,
  tags        TEXT[],
  embedding   vector(1536),
  file_hash   TEXT NOT NULL,
  chunk_index INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(file_path, chunk_index)
);
```

A chave unica `(file_path, chunk_index)` permite que uma nota tenha multiplos chunks, cada um com seu embedding independente.

## Indices

| Tipo | Coluna | Proposito |
|------|--------|-----------|
| ivfflat (cosine) | embedding | Busca semantica via `<=>` operator, lists=100 |
| GIN | tags | Filtro por tags via `@>` operator |
| btree | updated_at DESC | Listagem de notas recentes |

O ivfflat com `lists=100` e adequado para o volume atual (~243 notas). Para vaults maiores (>10k), seria necessario HNSW.

## DbClient

A classe `DbClient` em `src/lib/db-client.ts` encapsula todas as operacoes:
- **upsertNote:** `INSERT ON CONFLICT DO UPDATE` -- idempotente
- **deleteNote:** remove por `file_path`
- **searchSemantic:** `1 - (embedding <=> $1::vector)` com `ORDER BY` cosine distance
- **searchText:** `ILIKE` com filtro opcional por tags (`@>`)
- **listRecent:** `ORDER BY updated_at DESC`
- **getFileHash / deleteChunksAbove:** suporte ao pipeline de chunking

Todas as queries usam **parameterized queries** (`$1`, `$2`, ...) -- nenhum SQL concatenado.

## Configuracao

- Database: `lox_brain` (migration pending from legacy `open_brain`)
- User: `lox` (migration pending from legacy `obsidian_brain`)
- Senha: armazenada no GCP Secret Manager (`pg-lox-password`)
- Conexao: `127.0.0.1:5432` (localhost only, SSL omitido por Zero Trust)

## Relacoes

- usado por: [[Lox - MCP Server]], [[Lox - Vault Watcher]]
- armazena output de: [[Lox - Servico de Embedding]]
- protegido por: [[Lox - Seguranca Zero Trust]]
- contido em: [[Lox]]

## References

- `packages/core/src/lib/db-client.ts`
- `packages/shared/src/types.ts` (NoteRow, SearchResult, RecentNote, PaginatedResult)
