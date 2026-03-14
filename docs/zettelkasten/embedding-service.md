2026-03-14 11:03

Status: #baby

Tags: [[claude-skill]] [[open-brain]] [[embeddings]] [[typescript]]
source: claude-skill

# Embedding Service do Open Brain

O `EmbeddingService` e a biblioteca central que transforma notas Markdown em vetores semanticos. Definido em `src/lib/embedding-service.ts`, encapsula tres responsabilidades atomicas.

## Responsabilidades

### 1. generateEmbedding(text)

Chama a API da OpenAI com modelo `text-embedding-3-small`, que retorna vetores de dimensao 1536. O limite de tokens do modelo e 8192, mas o chunking limita a entrada a ~4000 tokens para margem de seguranca.

### 2. parseNote(rawContent)

Extrai metadata de notas Markdown:
- **Titulo:** primeiro tenta YAML frontmatter (`title:`), fallback para primeiro H1 (`# Titulo`)
- **Tags:** suporta formato inline (`tags: [a, b]`) e YAML list (`tags:\n  - a\n  - b`)
- **Content:** tudo apos o frontmatter (ou conteudo completo se nao houver frontmatter)

Retorna `NoteMetadata { title, tags, content }`.

### 3. chunkText(text, maxTokens, overlapTokens)

Divide textos longos em chunks menores para respeitar o limite de tokens da API:
- **maxTokens:** 4000 (padrao) -- conservador para texto multilingue (pt-BR com acentos)
- **overlapTokens:** 200 (padrao) -- mantem contexto semantico entre chunks
- **Estimativa:** ~3 chars por token (conservador para portugues)
- **Estrategia:** split por paragrafos (`\n\n`), com force-split por caracteres para paragrafos gigantes

### 4. computeHash(content)

SHA256 do conteudo para detectar mudancas. Usado pelo [[vault-watcher]] para skip de arquivos inalterados -- evita chamadas desnecessarias a API da OpenAI.

## Design decisions

- **Injecao de dependencia:** recebe `OpenAI` client no construtor (testavel com mocks)
- **Sem side effects:** nao acessa banco nem filesystem -- pure library
- **3 chars/token:** estimativa conservadora que funciona bem para texto multilingue com acentos e caracteres especiais

## Relacoes

- usado por: [[vault-watcher]], [[mcp-server]]
- persiste via: [[banco-pgvector]]
- parte do pipeline: [[fluxo-de-dados]]
- contido em: [[_MOC]]

## References

- `src/lib/embedding-service.ts`
- `src/lib/types.ts` (NoteMetadata interface)
- `docs/plans/2026-03-08-text-chunking-design.md`
