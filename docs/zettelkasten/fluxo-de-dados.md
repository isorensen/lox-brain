2026-03-14 11:01

Status: #child

Tags: [[claude-skill]] [[open-brain]] [[data-flow]] [[arquitetura]]
source: claude-skill

# Fluxo de Dados do Open Brain

O pipeline de dados do Open Brain opera em dois sentidos: edição local para indexação, e criação remota via Claude Code para o vault.

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

## Otimização por hash

O [[Open Brain - Vault Watcher]] compara o SHA256 do conteúdo atual com o hash armazenado no [[Open Brain - Banco pgvector]] via `DbClient.getFileHash()`. Se o hash e identico, o arquivo e ignorado -- evitando chamadas desnecessárias a API da OpenAI e escritas no banco.

## Two-phase pipeline

O [[Open Brain - Servico de Embedding]] usa um pipeline de duas fases para garantir consistência: primeiro gera todos os embeddings (fase que pode falhar por erro de API), e so depois faz o batch upsert no banco. Isso evita estado parcial no caso de falha da OpenAI.

## Text chunking

Notas longas sao divididas em chunks de ate 4000 tokens estimados (3 chars/token para texto multilingue), com overlap de 200 tokens entre chunks para manter contexto semântico. Cada chunk recebe um `chunk_index` e e armazenado como linha separada no banco.

## Relações

- depende de: [[Open Brain - Vault Watcher]], [[Open Brain - Servico de Embedding]], [[Open Brain - Banco pgvector]]
- complementa: [[Open Brain - Arquitetura Geral]]
- contido em: [[Open Brain]]

## References

- `src/watcher/vault-watcher.ts` (pipeline principal)
- `src/lib/embedding-service.ts` (chunking e hash)
- `docs/plans/2026-03-08-text-chunking-design.md`
