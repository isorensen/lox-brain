2026-03-14 11:01

Status: #baby

Tags: [[claude-skill]] [[open-brain]] [[data-flow]] [[arquitetura]]
source: claude-skill

# Fluxo de Dados do Open Brain

O pipeline de dados do Open Brain opera em dois sentidos: edicao local para indexacao, e criacao remota via Claude Code para o vault.

## Fluxo direto (local para index)

```
Edicao no Obsidian Desktop
  -> git push
    -> VM git pull (cron 2min via git-sync.sh)
      -> Vault Watcher detecta mudanca (.md)
        -> EmbeddingService.parseNote() extrai metadata
        -> EmbeddingService.chunkText() divide em chunks (max 4000 tokens)
        -> EmbeddingService.computeHash() gera SHA256
        -> Hash comparado com DB (skip se igual)
        -> OpenAI text-embedding-3-small gera vector(1536)
        -> DbClient.upsertNote() persiste no pgvector
```

## Fluxo reverso (Claude Code para vault)

```
Claude Code
  -> MCP Server (write_note via stdio over SSH)
    -> Arquivo .md criado no vault da VM
      -> Vault Watcher detecta criacao
        -> Pipeline de embedding (mesmo fluxo acima)
          -> git push (cron 2min)
            -> Obsidian Desktop git pull
```

## Otimizacao por hash

O [[vault-watcher]] compara o SHA256 do conteudo atual com o hash armazenado no [[banco-pgvector]] via `DbClient.getFileHash()`. Se o hash e identico, o arquivo e ignorado -- evitando chamadas desnecessarias a API da OpenAI e escritas no banco.

## Two-phase pipeline

O [[embedding-service]] usa um pipeline de duas fases para garantir consistencia: primeiro gera todos os embeddings (fase que pode falhar por erro de API), e so depois faz o batch upsert no banco. Isso evita estado parcial no caso de falha da OpenAI.

## Text chunking

Notas longas sao divididas em chunks de ate 4000 tokens estimados (3 chars/token para texto multilingue), com overlap de 200 tokens entre chunks para manter contexto semantico. Cada chunk recebe um `chunk_index` e e armazenado como linha separada no banco.

## Relacoes

- depende de: [[vault-watcher]], [[embedding-service]], [[banco-pgvector]]
- complementa: [[arquitetura-geral]]
- contido em: [[_MOC]]

## References

- `src/watcher/vault-watcher.ts` (pipeline principal)
- `src/lib/embedding-service.ts` (chunking e hash)
- `docs/plans/2026-03-08-text-chunking-design.md`
