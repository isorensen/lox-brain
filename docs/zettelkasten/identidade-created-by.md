2026-07-10 14:30

Status: #baby

Tags: [[claude-skill]] [[lox]] [[mcp]] [[seguranca]]
source: claude-skill

# Atribuição de Identidade (`created_by`)

No modo team, todo write autorado precisa registrar **quem** o criou. O Lox resolve `created_by` **server-side, por requisição**, e nunca confia em um `_created_by` vindo nos args do cliente (anti-spoofing). Aplica-se a `write_note`, `add_task` e `daily_log`.

## Como funciona

O middleware `wrapToolWithCreatedBy` (`packages/team/src/multi-user/created-by-middleware.ts`) resolve a identidade nesta ordem:

1. **Trusted-proxy actor** — um chamador que apresenta um `X-Lox-Proxy-Secret` válido (comparado em tempo constante com `LOX_TRUSTED_PROXY_SECRET`) pode encaminhar um header `X-Lox-Actor` com o nome do remetente autenticado. Serve para integrações de backend (ex.: um chat bot) que alcançam o MCP pela rede privada **sem** serem um peer WireGuard registrado.
2. **WireGuard peer** — senão, o IP de origem do chamador (`req.socket.remoteAddress`) é resolvido para um peer registrado via `PeerResolver`.
3. **Stripped** — senão, qualquer `_created_by` do cliente é removido (chamador desconhecido).

```
trusted actor  →  WireGuard peer  →  stripped
```

## Por que essa decisão

O modelo original (#187) derivava a identidade **apenas** do IP WireGuard. Isso quebrava para writes que chegam por um proxy backend, que conecta pela VPC e não é um peer — a resolução falhava e `created_by` ficava `null` (#191). O trusted-proxy adiciona um canal confiável para carregar a identidade real do usuário, escopado a um único chamador autenticado por segredo compartilhado.

O actor (`clientIpStorage`/`actorStorage`, ambos `AsyncLocalStorage` por requisição em `packages/core/src/mcp/index.ts`) é capturado no handler HTTP: o `X-Lox-Proxy-Secret` é comparado com `timingSafeEqual`; só em match o `X-Lox-Actor` é honrado.

> [!NOTE]
> O segredo é toda a fronteira de confiança. Um segredo ausente/vazio/errado/duplicado faz o header do actor ser ignorado por completo — peers normais não conseguem forjar `created_by`. Com `LOX_TRUSTED_PROXY_SECRET` não configurado, o caminho inteiro é no-op (permite subir o MCP antes do backend enviar headers, sem janela de brecha).

> [!WARNING]
> Uma vez que o segredo confere, o backend é totalmente confiado: não há allowlist ligando o `X-Lox-Actor` a um peer/usuário registrado (remetentes de chat não são peers WireGuard). Um backend comprometido poderia atribuir writes a um nome arbitrário. Cada atribuição via trusted-proxy é registrada em log de auditoria (sem logar o segredo). Nome do actor tem limite de 200 chars.

## Relações

- implementado em: [[Lox - MCP Server]]
- parte de: [[Lox - Seguranca Zero Trust]]
- contido em: [[Lox]]

## References

- `packages/team/src/multi-user/created-by-middleware.ts` (ordem de resolução)
- `packages/core/src/mcp/trusted-proxy.ts` (`resolveTrustedActor`, comparação em tempo constante)
- `packages/core/src/mcp/index.ts` (`actorStorage`, captura do header, log de auditoria)
- `packages/core/.env.example` (`LOX_TRUSTED_PROXY_SECRET` e trust boundary)
- [[Lox - MCP Server]]
