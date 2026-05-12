# VM Claude Runner — Headless scheduled MCP-aware tasks

**Status:** Draft
**Date:** 2026-05-09
**Author:** Eduardo (isorensen) + Claude Opus 4.7
**Issue:** TBD (será aberta após aprovação)

## Contexto

Hoje, tarefas como `/sync-calendar` (importar eventos do Google Calendar pro Obsidian Vault) e captura de notas Gemini de reuniões precisam ser disparadas manualmente, com o laptop ligado, conectado na VPN WireGuard, e via Claude Code interativo. Isso causa:

- Esquecimento (sync não roda em dias que o laptop fica fechado)
- Latência entre evento real e nota ingerida no vault
- Acoplamento desnecessário ao desktop pessoal

A VM `obsidian-vm` (GCE, Ubuntu 24.04) já hospeda o vault, o git sync, o pgvector, o watcher e o MCP server. Roda 24/7. Adicionar Claude Code rodando lá com OAuth seu (plano Max, sem `ANTHROPIC_API_KEY`) e systemd timers permite automação stateless e ordenada.

## Goals

- Rodar `/sync-calendar` diariamente às 06:00 e captura de Gemini notes às 19:00 sem intervenção
- Reusar plano Claude Max via OAuth — zero gasto adicional de API
- MCP `lox-brain` local (sem VPN), connectors da conta (Google Calendar, Gmail, Drive) disponíveis
- Permissions configuradas como allowlist explícita — sem `--dangerously-skip-permissions`
- Setup documentado, reproduzível em < 15 min em VM Ubuntu fresca

## Non-Goals

- Listener Telegram (tracked separadamente como Issue B; depende desta)
- Suporte multi-VM / lox-teams Credifit (follow-up se houver demanda concreta)
- Modos interativos / multi-turn (`--resume`, `--continue`)
- Email/SMS alerts em falha (calendar reminder + `systemctl status` semanal basta pra MVP pessoal)
- Egress firewall apertado (follow-up de hardening)
- Rotação automática de OAuth token

## Arquitetura

```
obsidian-vm (existente, user existente da VM — referenciado como __LOX_VM_USER__)
│
├── ~/.config/lox-claude/
│   └── settings.json        MCP allowlist (consumed by claude -p --settings)
│   └── settings.json        permissions allowlist
│
├── /etc/systemd/system/
│   ├── lox-claude-sync-calendar.service     User=__LOX_VM_USER__, Type=oneshot
│   ├── lox-claude-sync-calendar.timer       OnCalendar=*-*-* 06:00:00
│   ├── lox-claude-gemini-notes.service      User=__LOX_VM_USER__, Type=oneshot
│   └── lox-claude-gemini-notes.timer        OnCalendar=*-*-* 19:00:00
│
└── (services chamam diretamente: claude -p "/sync-calendar" --settings ~/.config/lox-claude/settings.json)
```

**Decisões de arquitetura:**

- **Dois pares `.service+.timer` flat** em vez de template `@`. Mais explícitos pra N=2; copy-paste se um dia houver um terceiro job.
- **Sem wrapper script.** `ExecStart=` chama `claude -p` diretamente; `ExecStartPre=` valida pré-condições inline.
- **Sem `runner.sh` / `healthcheck.sh` / `install.sh`.** Setup é README + comandos diretos.
- **Roda como o user existente da VM** (mesmo que roda obsidian + lox-brain + git sync hoje), não como user dedicado `lox-claude`. VM single-tenant pessoal não justifica isolamento via user. Nos unit files referenciado como placeholder `__LOX_VM_USER__`, substituído por sed no setup.
- **Logs via `journalctl`.** Sem Cloud Logging integration pra MVP pessoal.

## Componentes & arquivos

### `infra/systemd/lox-claude-sync-calendar.service`

```ini
[Unit]
Description=Lox Claude Runner — sync Google Calendar to vault
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=__LOX_VM_USER__
ExecStartPre=/usr/bin/test -x /usr/local/bin/claude
ExecStartPre=/usr/bin/test -f /home/__LOX_VM_USER__/.claude/.credentials.json
ExecStartPre=/usr/bin/test -d /home/__LOX_VM_USER__/obsidian
ExecStart=/usr/local/bin/claude -p "/sync-calendar" --settings /home/__LOX_VM_USER__/.config/lox-claude/settings.json
TimeoutStartSec=600
NoNewPrivileges=yes
ProtectSystem=strict
ReadWritePaths=/home/__LOX_VM_USER__/obsidian /home/__LOX_VM_USER__/.claude /home/__LOX_VM_USER__/.config/lox-claude /home/__LOX_VM_USER__/lox-brain

[Install]
WantedBy=multi-user.target
```

### `infra/systemd/lox-claude-sync-calendar.timer`

```ini
[Unit]
Description=Daily sync of Google Calendar to Obsidian vault at 06:00

[Timer]
OnCalendar=*-*-* 06:00:00 America/Sao_Paulo
Persistent=true
Unit=lox-claude-sync-calendar.service

[Install]
WantedBy=timers.target
```

`gemini-notes` é análogo, com `OnCalendar=*-*-* 19:00:00` e mesmo prompt `/sync-calendar`. Razão de ter duas execuções da mesma skill: a passada da manhã captura eventos novos do dia; a passada da noite recolhe Gemini notes que só chegam após as reuniões do dia terminarem (Gemini summaries são produzidos com lag pós-reunião). Nome `gemini-notes` reflete o propósito da execução, não comando diferente.

### `infra/vm-claude/settings.json.example`

Allowlist mínima inicial. Iterada conforme primeiros runs reportarem permissions necessárias:

```json
{
  "permissions": {
    "allow": [
      "mcp__lox-brain__write_note",
      "mcp__lox-brain__read_note",
      "mcp__lox-brain__search_text",
      "mcp__lox-brain__search_semantic",
      "mcp__lox-brain__list_recent",
      "mcp__claude_ai_Google_Calendar__list_events",
      "mcp__claude_ai_Google_Calendar__get_event",
      "mcp__claude_ai_Google_Calendar__list_calendars",
      "mcp__claude_ai_Gmail__search_threads",
      "mcp__claude_ai_Gmail__get_thread",
      "mcp__claude_ai_Google_Drive__read_file_content",
      "Read"
    ]
  }
}
```

Princípio: começar tight, expandir quando run reportar `Permission denied: <tool>`. Não pré-autorizar especulativo.

### `infra/vm-claude/README.md`

Documenta:
1. Pré-requisitos (Claude Code instalado, MCPs `lox-brain` configurados)
2. Login OAuth: `claude login` (device-code flow em VM headless) — popula `~/.claude/.credentials.json` (mode 0600). É a fonte de auth usada pelo runner.
3. Salvar token em `~/.config/lox-claude/env`
4. Copiar `settings.json.example` → `~/.config/lox-claude/settings.json`
5. `sudo cp infra/systemd/* /etc/systemd/system/`
6. `sudo systemctl daemon-reload && sudo systemctl enable --now lox-claude-sync-calendar.timer lox-claude-gemini-notes.timer`
7. Verificação: `systemctl list-timers | grep lox-claude`
8. Renovação anual do token + lembrete no Google Calendar
9. Troubleshooting: `journalctl -u lox-claude-sync-calendar.service -n 50`

### `ROADMAP.md`

Adiciona em Phase 2 (Community):
- [ ] **VM Headless Runner** — systemd timers + Claude Code OAuth pra automação de skills agendadas (sync-calendar, etc.) sem laptop ligado

## Modelo de auth

- `claude login` (device-code flow em VM headless, uma vez via SSH) popula `~/.claude/.credentials.json` (mode 0600). Claude Code lê esse arquivo automaticamente quando invocado como o user dono — sem necessidade de env var.

> **Abandonamos `claude setup-token` + `CLAUDE_CODE_OAUTH_TOKEN`** após validar empiricamente no exploration test do #171 que o token gerado é rejeitado como `Invalid bearer token` mesmo em contexto válido. Provavelmente relacionado à [anthropics/claude-code#50743](https://github.com/anthropics/claude-code/issues/50743) (OAuth refresh quebrado em headless Linux). Tentar usar `setup-token` mascarava um bug; usar `credentials.json` direto é mais simples e funciona.
- Token vai pra `~/.config/lox-claude/env` (mode 0600) do user da VM
- systemd roda `claude -p` como `User=__LOX_VM_USER__`, e Claude lê `~/.claude/.credentials.json` automaticamente desse user. Sem `EnvironmentFile`.
- Em ~11 meses, lembrete no Google Calendar dispara renovação manual
- Detecção de expiração: `journalctl` mostrará `401 Invalid bearer token`; usuário roda `claude login` de novo (refresh automático em headless é unreliable per #50743).

**Por que NÃO `setup-token`:** empiricamente o token é rejeitado como `Invalid bearer token` (#50743). `claude login` + `credentials.json` é o caminho que efetivamente funciona, com trade-off de re-login manual ocasional quando o refresh interno falhar.

## Permissions & Security

- **Allowlist explícita** em `settings.json` (acima). Sem deny, sem `--dangerously-skip-permissions`.
- **Hardening systemd mínimo**: `User=__LOX_VM_USER__`, `NoNewPrivileges=yes`, `ProtectSystem=strict`, `ReadWritePaths=` limitado a `/home/__LOX_VM_USER__/obsidian` + `/home/__LOX_VM_USER__/.claude` + `/home/__LOX_VM_USER__/.config/lox-claude` + `/home/__LOX_VM_USER__/lox-brain`.
- **Token storage**: `~/.config/lox-claude/env` mode 0600 owner = user da VM. Sem GCP Secret Manager pra MVP — VPN-only VM single-tenant não justifica.
- **Trust boundary**: a allowlist é a defesa primária contra prompt injection (ex: evento de calendar com payload malicioso). Nada na allowlist atual permite `Bash`, `Write`, `WebFetch`, ou exfiltração — só leitura via MCPs específicos.

## Observabilidade

- `journalctl -u lox-claude-sync-calendar.service` — logs completos
- `systemctl list-timers` — quando próxima execução
- `systemctl --failed` — checagem manual semanal
- Sintoma de falha de longo prazo: novos eventos não aparecem no vault → user nota durante uso normal

Sem alerting ativo. É escolha consciente: 2 jobs/dia, vault é checado humanamente em uso normal, blast radius de falha = "evento ausente até user notar". Não justifica setup de SMTP/Cloud Monitoring na VM.

## Acceptance Criteria

- [ ] `sudo systemctl start lox-claude-sync-calendar.service` executa, termina exit 0
- [ ] `journalctl -u lox-claude-sync-calendar.service` mostra log do `claude -p` com tool calls esperados (list_events, write_note)
- [ ] `systemctl list-timers` mostra ambos os timers ativos com next-run em 06:00 e 19:00
- [ ] Sem `~/.claude/.credentials.json`: `ExecStartPre` falha, `claude -p` não é invocado
- [ ] Após 24h ativo: vault tem nota(s) de evento(s) do dia (validação manual)
- [ ] README permite alguém com VM Ubuntu fresca completar setup em < 15 min

## Out of Scope (follow-ups potenciais)

| Item | Quando vale revisitar |
|---|---|
| Listener Telegram (Issue B) | Depois que esta issue mergiar; começa com spike empírico |
| Suporte VM Credifit / lox-teams | Se houver pedido concreto de outro deployment |
| Cloud Logging + alertas | Se confiabilidade virar problema (MVP rodando 30+ dias com falhas silenciosas) |
| Rotação automática de token | Se issue #28827 for resolvida upstream |
| Egress firewall granular | Audit de segurança ou se VM virar multi-tenant |

## Riscos abertos

1. **MCP servers e skills NÃO são configurados por este runner** (confirmado empiricamente no exploration test do #171). A VM Claude Code precisa do `mcp__lox-brain__*` registrado via `claude mcp add`, dos managed connectors (Google Calendar, Gmail, Drive) configurados separadamente, e da skill `/sync-calendar` (ou outra) instalada em `~/.claude/skills/`. Sem isso, `claude -p "/sync-calendar"` retorna `Unknown command`. Trabalho de setup tracked separadamente — esta issue apenas entrega o framework systemd + auth.
2. **Plugins/connectors em headless**: documentação confirma OAuth funciona, mas comportamento exato dos `mcp__claude_ai_*` em `claude -p` headless ainda não validado end-to-end (depende do #1 acima estar resolvido).
2. **Rate limit do plano Max**: 50 RPM típico. 2 runs/dia, ~50 calls cada = 100 calls/dia. Folgadíssimo. Sem risco real.
3. **ToS Anthropic**: uso pessoal autônomo via OAuth Max está dentro do "uso ordinário e individual". Não escalar pra alta frequência sem migrar pra API key.
4. **Token expirando silenciosamente**: lembrete manual no calendar é mitigação suficiente; piora de UX só se user esquecer 30+ dias.
