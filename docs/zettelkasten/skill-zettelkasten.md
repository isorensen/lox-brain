2026-03-25 11:00

Status: #baby

Tags: [[claude-skill]] [[lox]] [[claude-skill-system]]
source: claude-skill

# Skill zettelkasten

O `zettelkasten` e um skill do Claude Code que extrai conhecimento implicito de um codebase e cristaliza em notas atomicas interconectadas no formato Zettelkasten, compatíveis com Obsidian.

## Proposito

Transforma arquivos de codigo em conhecimento navegavel. Extrai arquitetura, decisoes de design, fluxos de dados, modelos de seguranca e padroes relevantes em notas atomicas com wikilinks bidirecionais.

## Tres modos de operacao

| Modo | Trigger | Resultado |
|------|---------|-----------|
| **Full Project Scan** | `/zettelkasten` (sem args) | 8-12 notas atomicas + MOC + tag files |
| **Topic-Focused** | `/zettelkasten <topico>` | 2-6 notas sobre o topico especifico |
| **Review** | `/zettelkasten review <path>` | Verifica e atualiza uma nota existente contra o codigo atual |

## Output local e no vault

- Local: `docs/zettelkasten/` (nomes lowercase com hifens: `arquitetura-geral.md`)
- Obsidian: `6 - Atomic Notes/` (nomes com prefixo de projeto: `Lox - Arquitetura Geral.md`)
- Tags: `docs/zettelkasten/tags/` local, `3 - Tags/` no vault
- MOC: `docs/zettelkasten/_MOC.md` local, `2 - Projects/<Project>.md` no vault

## Convencoes de wikilinks

Dois tipos distintos -- misturar cria ghost notes no Obsidian:
- **Tag links:** nome curto `[[lox]]` -> resolve para `3 - Tags/open-brain.md`
- **Inter-note links:** nome completo `[[Lox - Arquitetura Geral]]` -> resolve para `6 - Atomic Notes/Lox - Arquitetura Geral.md`

## Metadados obrigatorios

Cada nota gerada deve ter: timestamp, `Status: #baby`, Tags com `[[claude-skill]]` e `[[project-tag]]`, `source: claude-skill` (ou inline Dataview fields para vault).

## Ingestion automatica no vault

Apos gerar arquivos locais, ingere automaticamente no vault via `mcp__lox-brain__write_note`, convertendo `source: claude-skill` para `[source:: claude-skill]` + `[imported:: YYYY-MM-DD]`.

## Relacoes

- usa: [[Lox - MCP Server]]
- complementa: [[Lox - Skill obsidian-ingest]], [[Lox - Skill sync-calendar]]
- gerou: [[Lox - Arquitetura Geral]], [[Lox - Fluxo de Dados]], e todas as notas deste projeto Lox
- contido em: [[Lox]]

## References

- `~/.claude/skills/zettelkasten/SKILL.md`
