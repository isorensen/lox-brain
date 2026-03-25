2026-03-25 11:00

Status: #baby

Tags: [[claude-skill]] [[open-brain]] [[claude-skill-system]]
source: claude-skill

# Skill obsidian-ingest

O `obsidian-ingest` e um skill do Claude Code que ingere conteudo no vault Obsidian via MCP. Opera de forma independente do Open Brain -- nao requer infraestrutura GCP, apenas acesso ao [[Open Brain - MCP Server]].

## Proposito

Permite ao Claude Code adicionar notas, processar URLs, analisar imagens, importar memorias e organizar informacoes no vault Obsidian sem que o usuario precise formatar manualmente. Aciona em frases como "add to obsidian", "save to vault", "create a note about".

## Interface primaria: MCP Tools

Usa `mcp__obsidian-brain__write_note`, `search_semantic`, `search_text`, `read_note`, `list_recent` do [[Open Brain - MCP Server]]. Filesystem direto (`~/Obsidian/iSorensen/`) apenas para binarios (imagens, PDFs).

## Workflow de ingestao

1. Leitura e compreensao total do conteudo
2. Busca de tags existentes (evitar duplicacao)
3. Busca semantica de duplicatas
4. Categorizacao e agrupamento por tema
5. Preview para confirmacao do usuario
6. Escrita no vault via `write_note`
7. Criacao de MOC files para novas tags em `3 - Tags/`

> [!NOTE]
> Nunca escreve no vault sem confirmacao explícita do usuario (preview obrigatorio).

## Convencoes do vault

- Formato: data + Status + Tags + inline Dataview fields + H1 + conteudo
- Sem YAML frontmatter -- o vault usa plain text + `[source:: value]`
- Notas de projeto prefixadas: `Open Brain - Titulo.md`
- Notas gerais: titulo descritivo em portugues, sem prefixo
- Status: `#baby` (novo), `#child` (em desenvolvimento), `#adult` (maduro)

## Roteamento de conteudo

| Tipo | Destino |
|------|---------|
| Conceito, fato, preferencia | `6 - Atomic Notes/` |
| Artigo, livro, referencia externa | `2 - Source Material/` |
| Reuniao | `7 - Meeting Notes/` |
| Ideia rapida | `1 - Fleeting Notes/` |
| Clipping web | `Clippings/` |

## Relacao com Open Brain

O `obsidian-ingest` e o antecessor conceitual do Open Brain: funciona sem infra, apenas escrevendo arquivos via MCP. O Open Brain e a evolucao -- adiciona busca semantica, acesso remoto e pipeline de indexacao automatica. Ambos compartilham o mesmo vault e formato de notas, mas sao independentes.

## Relacoes

- usa: [[Open Brain - MCP Server]]
- complementa: [[Open Brain - Skill sync-calendar]], [[Open Brain - Skill zettelkasten]]
- contido em: [[Open Brain]]

## References

- `~/.claude/skills/obsidian-ingest/SKILL.md`
