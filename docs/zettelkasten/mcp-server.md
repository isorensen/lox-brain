2026-03-14 11:02

Status: #child

Tags: [[claude-skill]] [[lox]] [[mcp]] [[typescript]]
source: claude-skill

# MCP Server do Lox

O MCP Server e a interface entre os clientes (Claude Code, integrações de backend) e o vault. Implementado com `@modelcontextprotocol/sdk`, suporta **dois transportes** selecionados por `MCP_TRANSPORT`: `stdio` (modo pessoal) e `http` (modo team).

## Transportes

- **`stdio` (default, modo pessoal)** — o Claude Code inicia o servidor sob demanda como processo filho e fala via stdin/stdout. Single-user, sem daemon.
- **`http` (modo team)** — daemon de longa duração (`lox-mcp.service`) que faz bind em `MCP_HOST` (default `127.0.0.1`; em multi-user aponta para a interface da [[Lox - WireGuard VPN]]), porta `MCP_PORT` (default `3100`). Usa `StreamableHTTPServerTransport` com sessão (`sessionIdGenerator` gera um session ID por cliente — modo stateless quebra o health check do Claude Code). O IP de origem do chamador vem de `req.socket.remoteAddress` para atribuição de identidade.

## Tools

Os handlers base vivem em `packages/core/src/mcp/tools.ts` (`createTools`). No modo team, o pacote `@lox-brain/team` adiciona os team tools e envolve os writes com o middleware de autoria.

**Core (11):**

| Tool | Descricao |
|------|-----------|
| `write_note` | Cria ou sobrescreve nota `.md` no vault |
| `read_note` | Le conteudo de uma nota |
| `delete_note` | Remove nota do vault |
| `search_semantic` | Busca por similaridade vetorial (cosine distance) |
| `search_text` | Busca textual case-insensitive (ILIKE) com filtro por tags |
| `list_recent` | Lista notas mais recentes por `updated_at` |
| `add_task` | Cria uma task (autoria via `created_by`) |
| `list_tasks` | Lista tasks com filtros (status, `assigned_to`, etc.) |
| `update_task` | Atualiza uma task (não sobrescreve o autor original) |
| `complete_task` | Marca uma task como concluída |
| `daily_log` | Anexa uma entrada ao daily log (autoria via `created_by`) |

**Team (2), apenas no modo team** (`packages/team/src/mcp-extensions/team-tools.ts`):

| Tool | Descricao |
|------|-----------|
| `list_team_activity` | Atividade recente agregada por autor |
| `search_by_author` | Busca notas filtradas por autor |

## Identidade e autoria (`created_by`)

Writes autorados (`write_note`, `add_task`, `daily_log`) recebem `created_by` resolvido **server-side**, nunca a partir de args do cliente. A ordem de resolução (trusted-proxy actor → WireGuard peer → stripped) está detalhada em [[Lox - Atribuicao de Identidade created_by]].

## Segurança: safePath()

Toda operação de filesystem passa pela funcao `safePath()` que:
- Resolve o caminho relativo contra o vault root (`path.resolve`)
- Verifica que o caminho resultante esta **dentro** do diretório do vault (prefix check com `path.sep`)
- Rejeita null bytes (`\0`) no path
- Impede path traversal (`../`)

## Respostas otimizadas

Os tools de busca (`search_semantic`, `search_text`, `list_recent`) retornam **somente metadata** por padrão (sem content). O workflow recomendado e: buscar notas via search, depois usar `read_note` para conteúdo completo. Parâmetros opcionais: `offset`, `include_content`, `content_preview_length`.

Todos retornam `PaginatedResult { results, total, limit, offset }`.

## Relações

- depende de: [[Lox - Banco pgvector]], [[Lox - Servico de Embedding]]
- protegido por: [[Lox - Seguranca Zero Trust]]
- atribui autoria via: [[Lox - Atribuicao de Identidade created_by]]
- parte de: [[Lox - Arquitetura Geral]]
- contido em: [[Lox]]

## References

- `packages/core/src/mcp/index.ts` (entry point, seleção de transporte, sessões HTTP, `clientIpStorage`/`actorStorage`)
- `packages/core/src/mcp/tools.ts` (createTools, safePath, handlers core)
- `packages/core/src/mcp/transports.ts` (TransportConfig, getTransportConfig)
- `packages/team/src/mcp-extensions/team-tools.ts` (team tools)
- `packages/shared/src/types.ts` (SearchOptions, PaginatedResult)
