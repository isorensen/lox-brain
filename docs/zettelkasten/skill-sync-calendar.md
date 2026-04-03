2026-03-25 11:00

Status: #baby

Tags: [[claude-skill]] [[lox]] [[claude-skill-system]] [[google-calendar]]
source: claude-skill

# Skill sync-calendar

O `sync-calendar` e um skill do Claude Code que sincroniza eventos do Google Calendar para notas de reuniao no vault Obsidian, incluindo resumos do Gemini AI quando disponíveis.

## Proposito

Automatiza a criacao de meeting notes a partir de eventos do Google Calendar. Aciona em frases como "sync calendar", "import meetings", "calendar to obsidian". Aceita data ou intervalo de datas como argumento.

## MCPs utilizados

- **Google Calendar** (`gcal_list_events`) -- busca eventos do periodo
- **Gmail** (`gmail_search_messages`, `gmail_read_message`) -- busca resumos do Gemini AI
- **Lox Brain** (`search_text`, `write_note`, `read_note`) -- verifica duplicatas e persiste notas

## Workflow de 6 steps

1. **Fetch events** -- `gcal_list_events` com `condenseEventDetails: false` para ter attendees + attachments
2. **Filter** -- remove workingLocation, declined, optional sem resposta, all-day sem attendees, birthdays
3. **Check Gemini notes** -- busca email `from:gemini-notes@google.com` apenas para eventos com attachment "Anotações do Gemini"
4. **Check existing notes** -- busca por `calendar_event_id` no vault para detectar duplicatas
5. **Create notes** -- template rico com participantes, topicos discutidos, acoes e proximos passos
6. **Summary** -- lista do que foi criado, atualizado e pulado

## Formato das notas criadas

Destino: `7 - Meeting Notes/YYYY-MM-DD <Titulo>.md`

Estrutura: data + Status `#baby` + Tags `[[meeting]]` + inline fields (`[source:: google-calendar]`, `[calendar_event_id:: ...]`) + secoes Participantes, Topicos Discutidos, Acoes e Proximos Passos, Referencias.

Quando Gemini notes estao disponiveis, "Topicos Discutidos" e preenchido com o resumo estruturado do AI. Sem Gemini, usa callout de entrada manual.

## Otimizacoes de performance

- Chunking por semanas para intervalos > 7 dias (Calendar API retorna payloads gigantes)
- Python para processar arquivos de resposta (evita problemas de escape do zsh com `!=` no jq)
- Buscas no Gmail e verificacoes de duplicata em paralelo
- Subagentes em batches de 5-8 eventos para intervalos longos

## Relacoes

- usa: [[Lox - MCP Server]]
- complementa: [[Lox - Skill obsidian-ingest]], [[Lox - Skill zettelkasten]]
- contido em: [[Lox]]

## References

- `~/.claude/skills/sync-calendar/SKILL.md`
