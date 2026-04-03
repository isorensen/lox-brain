2026-03-14 11:04

Status: #baby

Tags: [[claude-skill]] [[lox]] [[watcher]] [[data-flow]]
source: claude-skill

# Vault Watcher do Lox

O Vault Watcher e o componente que detecta mudancas em arquivos `.md` no vault e dispara o pipeline de indexacao. Implementado em duas partes: a classe `VaultWatcher` (logica pura) e o entry point com chokidar (I/O).

## VaultWatcher class

Definida em `src/watcher/vault-watcher.ts`, recebe `EmbeddingService` e `DbClient` por injecao de dependencia.

**shouldProcess(filePath):** Filtra arquivos para indexacao -- aceita apenas `.md` e ignora diretorios `.obsidian/` e `.git/`.

**handleFileChange(filePath, content):** Pipeline principal:
1. Calcula hash SHA256 do conteudo
2. Compara com hash existente no banco (`getFileHash`)
3. Se igual, retorna sem acao (skip)
4. Parse da nota (frontmatter, titulo, tags)
5. Chunk do conteudo (se necessario)
6. **Fase 1:** Gera todos os embeddings (pode falhar -- nenhuma escrita no banco)
7. **Fase 2:** Upsert de todos os chunks no banco
8. Remove chunks orfaos (`deleteChunksAbove`)

**handleFileDelete(filePath):** Remove todos os chunks da nota do banco.

## Entry point (chokidar v5)

O entry point em `src/watcher/index.ts` usa chokidar v5 via dynamic import (ESM-only, projeto e CommonJS):
- `awaitWriteFinish: { stabilityThreshold: 500 }` -- espera arquivo estabilizar antes de processar
- `ignoreInitial: true` -- nao reprocessa arquivos existentes no startup
- Eventos: `add`, `change`, `unlink`

## Execucao

Roda como systemd service (`lox-watcher.service`) na VM, iniciado automaticamente no boot. Nao precisa ser reiniciado manualmente -- o deploy via [[Lox - CI CD GitHub Actions]] cuida do restart.

## Error handling

Erros no pipeline de indexacao sao logados via `console.error` mas nao derrubam o watcher. Erros de delete sao propagados ao caller.

## Relacoes

- usa: [[Lox - Servico de Embedding]], [[Lox - Banco pgvector]]
- parte do pipeline: [[Lox - Fluxo de Dados]]
- deploy via: [[Lox - CI CD GitHub Actions]]
- contido em: [[Lox]]

## References

- `packages/core/src/watcher/vault-watcher.ts` (logica)
- `packages/core/src/watcher/index.ts` (entry point chokidar)
