2026-03-14 11:02

Status: #child

Tags: [[claude-skill]] [[open-brain]] [[mcp]] [[typescript]]
source: claude-skill

# MCP Server do Open Brain

O MCP Server e a interface entre Claude Code e o vault. Implementado com `@modelcontextprotocol/sdk`, usa transporte stdio over SSH -- o Claude Code invoca o servidor sob demanda via conexão SSH pela [[Open Brain - WireGuard VPN]].

## 6 Tools disponíveis

| Tool | Descricao |
|------|-----------|
| `write_note` | Cria ou sobrescreve nota `.md` no vault |
| `read_note` | Le conteudo de uma nota |
| `delete_note` | Remove nota do vault |
| `search_semantic` | Busca por similaridade vetorial (cosine distance) |
| `search_text` | Busca textual case-insensitive (ILIKE) com filtro por tags |
| `list_recent` | Lista notas mais recentes por `updated_at` |

## Segurança: safePath()

Toda operação de filesystem passa pela funcao `safePath()` que:
- Resolve o caminho relativo contra o vault root (`path.resolve`)
- Verifica que o caminho resultante esta **dentro** do diretório do vault (prefix check com `path.sep`)
- Rejeita null bytes (`\0`) no path
- Impede path traversal (`../`)

## Transporte stdio over SSH

O MCP Server nao roda como daemon -- e iniciado sob demanda pelo Claude Code via SSH:

```
ssh obsidian-vm "cd ~/obsidian_open_brain && export $(cat .env | xargs) && npx tsx src/mcp/index.ts"
```

Isso significa que após deploy de código na VM, o processo antigo precisa ser morto (`pkill -f "tsx src/mcp/index.ts"`) e o Claude Code precisa reconectar.

## Respostas otimizadas

Os tools de busca (`search_semantic`, `search_text`, `list_recent`) retornam **somente metadata** por padrão (sem content). O workflow recomendado e: buscar notas via search, depois usar `read_note` para conteúdo completo. Parâmetros opcionais: `offset`, `include_content`, `content_preview_length`.

Todos retornam `PaginatedResult { results, total, limit, offset }`.

## Relações

- depende de: [[Open Brain - Banco pgvector]], [[Open Brain - Servico de Embedding]]
- protegido por: [[Open Brain - Seguranca Zero Trust]]
- parte de: [[Open Brain - Arquitetura Geral]]
- contido em: [[Open Brain]]

## References

- `src/mcp/index.ts` (entry point, Pool config, env validation)
- `src/mcp/tools.ts` (createTools, safePath, 6 handlers)
- `src/lib/types.ts` (SearchOptions, PaginatedResult)
