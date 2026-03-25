2026-03-14 11:09

Status: #baby

Tags: [[claude-skill]] [[open-brain]] [[testes]] [[typescript]]
source: claude-skill

# Estrategia de Testes do Open Brain

O projeto segue ciclo TDD rigoroso com cobertura minima de 80%. Todos os componentes foram desenvolvidos test-first usando vitest.

## Stack de testes

- **Framework:** vitest 4.x
- **Coverage:** `@vitest/coverage-v8` (threshold 80%)
- **Execucao:** `npm test` (vitest run), `npm run test:coverage`

## Distribuicao dos testes

O projeto tem **59 testes** distribuidos em tres areas:

| Area | Testes | Cobre |
|------|--------|-------|
| `tests/lib/` | 21 | EmbeddingService (parseNote, chunkText, computeHash, generateEmbedding) + DbClient (upsert, delete, search, pagination) |
| `tests/watcher/` | 12 | VaultWatcher (shouldProcess, handleFileChange com hash skip, handleFileDelete, two-phase pipeline) |
| `tests/mcp/` | 26 | createTools (6 tools), safePath (path traversal, null bytes), addFrontmatter, input validation |

## Patterns usados

- **Mocks via injecao de dependencia:** todas as classes recebem dependencias no construtor (`OpenAI`, `Pool`). Testes usam mocks sem monkey-patching.
- **Happy path + edge cases + error paths:** cada funcao testada nos tres cenarios.
- **Code review gates:** antes de cada commit, code review identifica blockers e issues que devem ser corrigidos e testados.

## Integracao com CI/CD

O [[Open Brain - CI CD GitHub Actions]] roda `npm run test:coverage` em todo PR para `main`. O threshold de 80% e enforced -- PR que baixa cobertura nao passa no CI.

Adicionalmente, `tsc --noEmit`, `npm run build` e `npm audit --audit-level=high` rodam no mesmo pipeline.

## Relacoes

- valida: [[Open Brain - Servico de Embedding]], [[Open Brain - Vault Watcher]], [[Open Brain - MCP Server]]
- integrado com: [[Open Brain - CI CD GitHub Actions]]
- contido em: [[Open Brain]]

## References

- `vitest.config.ts`
- `tests/` (diretorio completo de testes)
- `package.json` (scripts test e test:coverage)
