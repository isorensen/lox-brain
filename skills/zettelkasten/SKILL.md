---
name: zettelkasten
description: Generate atomic smart notes in Zettelkasten format from project codebases, compatible with Obsidian and the Lox MCP Server
---

# Zettelkasten — Smart Notes from Code

## Configuration

This skill reads your Lox configuration from `~/.lox/config.json`:
- `vault.preset`: determines folder structure (`zettelkasten` or `para`)
- `vault.local_path`: path to your Obsidian vault (default: `~/Obsidian/Lox`)

Folder mapping by preset:
| Preset | Atomic notes folder | Tags folder |
|--------|-------------------|-------------|
| zettelkasten | `6 - Atomic Notes/` | `3 - Tags/` |
| para | `4 - Resources/Zettelkasten/` | `4 - Resources/Tags/` |

When the skill refers to "the atomic notes folder" or "the tags folder" below, it means the folder corresponding to the user's configured preset.

Content language defaults to pt-BR. Technical terms and code identifiers stay in English. If the project's primary language is different (detected from README, CLAUDE.md, or user preference), adapt accordingly.

## Purpose

Code lives in repos. Knowledge lives in people's heads — until they leave, forget, or context-switch. This skill extracts implicit knowledge from a codebase and crystallizes it into atomic, cross-linked notes following the Zettelkasten method.

Why Zettelkasten for code knowledge:
- **Atomic notes** force clarity — one concept per note means no buried insights
- **Cross-linking** reveals hidden relationships between components, decisions, and patterns
- **Graph View** in Obsidian turns your project into a navigable knowledge map
- **Status progression** (#baby -> #child -> #adult) tracks note maturity over time

## Modes of Operation

### Mode 1: Full Project Scan (no arguments)

Trigger: `/zettelkasten` with no arguments.

**Workflow:**

1. **Explore the codebase** — Read project structure, package.json/pyproject.toml, README, key source files, config files, tests. Use the Explore sub-agent for large codebases.
2. **Identify knowledge atoms** — Extract distinct concepts:
   - Overall architecture and system boundaries
   - Key design decisions and their rationale (ADRs if present)
   - Data flow / pipeline descriptions
   - Technology stack choices and why
   - Database schema and relationships
   - API contracts and integration points
   - Security model and access control
   - Deployment and infrastructure patterns
   - Testing strategy
   - Non-obvious patterns or conventions
3. **Generate notes** — One .md file per concept, output to `docs/zettelkasten/`.
4. **Create tag files** — .md files with content in `docs/zettelkasten/tags/` for every new tag introduced.
5. **Generate MOC** — Create `docs/zettelkasten/_MOC.md` linking all generated notes.
6. **Report** — List all created files and suggest next steps.

### Mode 2: Topic-Focused (with topic argument)

Trigger: `/zettelkasten <topic>` (e.g., `/zettelkasten OAuth authentication`).

**Workflow:**

1. **Search the codebase** for everything related to the topic — grep for keywords, read relevant files, trace call chains.
2. **Generate 2-6 atomic notes** covering different facets of the topic within the project context.
3. **Cross-link** with any existing notes in `docs/zettelkasten/` if present.
4. **Update MOC** — Append new notes to `docs/zettelkasten/_MOC.md` (create if missing).
5. **Create any new tag files** needed.

### Mode 3: Review Existing Note (with "review" keyword)

Trigger: `/zettelkasten review <path-to-note>`.

**Workflow:**

1. **Read the note** and extract its claims/descriptions.
2. **Verify against current code** — Check if described patterns, file paths, APIs, schemas still exist and are accurate.
3. **Update the note** — Fix inaccuracies, add new information, update links to renamed files.
4. **Suggest status promotion** if the note is accurate and comprehensive (e.g., #baby -> #child).
5. **Report changes** made.

---

## Output Format

### Atomic Note (for architecture, decisions, patterns, concepts)

```markdown
2026-03-08 14:30

Status: #baby

Tags: [[claude-skill]] [[project-name]] [[architecture]]
source: claude-skill

# Title — Clear and Descriptive

Content goes here. Write in the project's content language (default: pt-BR). Technical terms and code identifiers stay in English.

Use short paragraphs. Be direct. Each note covers ONE concept.

## Como funciona

Explain the mechanism. Reference specific files:

> O servico de embedding em `src/services/embedding.ts` utiliza a API da OpenAI com o modelo `text-embedding-3-small` para gerar vetores de 1536 dimensoes.

Use code blocks for important signatures or configs:

```typescript
interface EmbeddingResult {
  vector: number[];
  tokenCount: number;
}
```

## Por que essa decisao

Explain the rationale. This is the most valuable part — the WHY behind code choices.

> [!NOTE]
> Use callout boxes for important caveats or gotchas.

## Relacoes

- Depende de: [[Project Name - Outra Nota Relevante]]
- Impacta: [[Project Name - Nota Que Depende Desta]]
- Alternativa considerada: [[Project Name - Alternativa Descartada]]

## References

- [[Project Name - Nota Relacionada 1]]
- [[Project Name - Nota Relacionada 2]]
- `src/path/to/relevant/file.ts`
```

### Source Material Note (for external references cited in notes)

```markdown
---
title: "Reference Title"
source: "https://url.com"
author:
  - "[[Author Name]]"
published: 2024-01-15
created: 2026-03-08
description: "Brief description of the reference"
tags:
  - "clippings"
  - "claude-skill"
---

# Reference Title

Summary and relevance to the project.

## References

- [[note-that-cites-this]]
```

### MOC (Map of Content) — `_MOC.md`

```markdown
2026-03-08 14:30

Status: #baby

Tags: [[claude-skill]] [[project-name]] [[moc]]
source: claude-skill

# Project Name — Map of Content

> [!INFO] Projeto
> **Project Name** — breve descricao do que o projeto faz (1-2 frases).
> Todas as notas abaixo pertencem a este projeto e estao conectadas pela tag [[project-name]].

> [!NOTE]
> Mapa de conteudo gerado automaticamente pelo skill `zettelkasten`.
> Notas comecam como #baby. Promova manualmente conforme revisar.

## Arquitetura

- [[Project Name - Arquitetura Geral]] — Visao geral do sistema
- [[Project Name - Fluxo de Dados]] — Pipeline de dados
- [[Project Name - Modelo de Seguranca]] — Autenticacao e autorizacao

## Decisoes Tecnicas

- [[Project Name - Decisao Banco de Dados]] — Escolha e rationale
- [[Project Name - Decisao Stack Embedding]] — Modelo e pipeline

## Componentes

- [[Project Name - Servico de Embedding]] — Geracao de vetores
- [[Project Name - Vault Watcher]] — Deteccao de mudancas
- [[Project Name - MCP Server]] — Interface com Claude

## Infraestrutura

- [[Project Name - Deploy GCP]] — Cloud Run e IAP
- [[Project Name - VPN Wireguard]] — Acesso seguro

## Tags

- [[claude-skill]] — notas geradas por este skill
- [[project-name]] — notas deste projeto
```

### Tag File (in `docs/zettelkasten/tags/` locally, the vault's tags folder in Obsidian)

```markdown
Tags: #moc

# tag-name

Brief description of what this tag represents in the project context.
```

Tag files serve as backlink hubs in Obsidian — the "Backlinks" pane shows every note that references `[[tag-name]]`, creating an automatic index. They are NOT empty. Each tag file has a `Tags: #moc` line, H1 with the tag name, and a one-line description. This mirrors the tags folder convention in the user's vault.

Only create tag files for domain-specific concepts (e.g., `pgvector`, `embedding`, `zettelkasten`). Do NOT create tag files for generic programming concepts (e.g., `react`, `typescript`, `api`) unless they don't already exist in the vault — check first using `mcp__lox-brain__search_text` if available.

---

## File Naming Conventions

### Local files (`docs/zettelkasten/`)
- **Lowercase, hyphens for spaces**: `fluxo-de-dados.md`, `embedding-service.md`
- **MOC is always `_MOC.md`** (underscore prefix sorts it first)
- **Tag files** in `docs/zettelkasten/tags/`: same lowercase convention

### Obsidian vault files
- **Atomic notes** in the vault's atomic notes folder: Use project prefix + title case
  - Pattern: `Project Name - Note Title.md`
  - Example: `Lox - Embedding Service.md`, `MyApp - Auth Pipeline.md`
- **MOC**: `Project Name - MOC.md`
- **Tags** in the vault's tags folder: Lowercase, same as local tag file names
  - Example: `pgvector.md`, `embedding.md`

### Wikilink resolution
- Inter-note links use the Obsidian display name: `[[Project Name - Note Title]]`
- Tag links use the short name: `[[tag-name]]`
- This ensures links resolve correctly in BOTH `docs/zettelkasten/` (if opened in Obsidian as vault) AND the main Obsidian vault

## Project Identity

Every set of notes belongs to a specific project. The project tag (e.g., `[[lox]]`) is the backbone that ties all notes together in the Graph View.

How to establish project identity:
- **Detect the project name** from `package.json` (name field), `CLAUDE.md`, `README.md`, or the root folder name
- **Create a project tag file** in `docs/zettelkasten/tags/` — this is the first tag file created
- **Every note MUST include the project tag** in its Tags line, right after `[[claude-skill]]`
- **The MOC title includes the project name** (e.g., "Lox — Map of Content")
- **The MOC has a "Projeto" callout** at the top explaining what the project is in 1-2 sentences

This way, when a user opens the Graph View in Obsidian, they see the project tag as a central hub connecting all related notes. If the user has notes from multiple projects, each project forms its own cluster.

## Cross-Linking Guidelines

Cross-linking is what makes Zettelkasten powerful. Without links, notes are just files.

### Two types of wikilinks

There are two distinct types of wikilinks. Mixing them up causes ghost notes in Obsidian:

1. **Tag links** — Short names pointing to tag files in the vault's tags folder. Used in the `Tags:` metadata line and when referencing broad concepts.
   - Example: `[[pgvector]]`, `[[security]]`, `[[claude-skill]]`, `[[my-project]]`
   - These resolve to files in the tags folder: `pgvector.md`, `security.md`, etc.

2. **Inter-note links** — Full display names pointing to other atomic notes. Used in `## Relacoes`, `## References`, and inline mentions.
   - Example: `[[Project Name - Embedding Service]]`, `[[Project Name - Auth Pipeline]]`
   - These resolve to files in the atomic notes folder
   - The prefix is derived from the project name

Why this matters: if you write `[[embedding-service]]` but the vault file is named `Project Name - Embedding Service.md`, Obsidian creates an empty ghost note called `embedding-service.md` when the user clicks it. Always use the full display name for inter-note links.

### Linking rules

- **Every note MUST link to at least 2 other notes** (via `## References` or inline `[[links]]`)
- **Use inline inter-note links** when mentioning another note: "O [[Project Name - Embedding Service]] utiliza..."
- **Use tag links** only in the `Tags:` line and when referencing broad categories
- **Use the Relacoes section** for structural relationships (depends-on, impacts, alternative-to)
- **Link to the MOC** is implicit — the MOC links to notes, not the reverse
- **Always contextualize within the project**: describe a component's specific role in THIS project, not generic concepts

## Required Metadata

Every generated note MUST include:
1. Timestamp on first line (YYYY-MM-DD HH:MM)
2. `Status: #baby` (always starts as baby)
3. `Tags:` with `[[claude-skill]]` followed by `[[project-name]]` (detected from codebase) and then topic tags
4. `source: claude-skill` on the line after Tags (for local files). When writing to Obsidian vault, use Dataview inline fields instead: `[source:: claude-skill]` and `[imported:: YYYY-MM-DD]`
5. H1 title

The project tag is the anchor that groups all notes from the same project. It MUST always be present as the second tag (after `[[claude-skill]]`).

This metadata is NOT in YAML fences. This matches Obsidian's Atomic Notes convention.

## Quality Checklist

Before finalizing output, verify:
- [ ] Each note covers exactly ONE concept (atomic)
- [ ] No note exceeds ~300 lines (split if larger)
- [ ] All notes have the required metadata header
- [ ] **Project tag** (`[[project-name]]`) present in every note as second tag
- [ ] Cross-links between notes are bidirectional where appropriate
- [ ] Tag files created for every new `[[tag]]` introduced
- [ ] MOC lists all generated notes, grouped by theme
- [ ] MOC has project callout explaining what the project is
- [ ] Content language matches the project's language (default: pt-BR), code/technical terms in English
- [ ] Each note describes concepts **in the context of this specific project**, not generically
- [ ] File paths referenced in notes actually exist in the codebase
- [ ] No secrets, credentials, or sensitive data in note content
- [ ] Inter-note wikilinks use full Obsidian display names (`[[Project Name - Note Title]]`)
- [ ] Tag wikilinks use short names (`[[tag-name]]`)
- [ ] Tag files have content (Tags: #moc, H1, description) — not empty
- [ ] If Lox MCP is available, notes ingested to vault with correct paths

## Sub-Agent Delegation

For large codebases (Mode 1 full scan):
- Use **Explore** (haiku) to survey the codebase structure and identify key files
- Use **coder-sonnet** (sonnet) to generate individual notes in parallel batches
- Use the main agent to assemble the MOC and verify cross-links

For topic-focused (Mode 2):
- Use **Explore** (haiku) to find all code related to the topic
- Generate notes in the main agent (typically 2-6 notes, manageable)

For review (Mode 3):
- Handle entirely in the main agent (single note, focused task)

## Obsidian Vault Ingestion

After generating notes locally in `docs/zettelkasten/`, ingest them into the Obsidian vault using the Lox MCP server (if available). This step is automatic — do not ask the user unless MCP is unavailable.

### MCP tools used

- `mcp__lox-brain__write_note` — Write a note to the vault
- `mcp__lox-brain__search_text` — Check for existing notes/tags before creating duplicates

### Deduplication

Before creating any note or tag file in the vault, search for existing content using `mcp__lox-brain__search_text`. If a matching note already exists, update it rather than creating a duplicate.

### Naming convention for Obsidian

Local files use short names (`arquitetura-geral.md`), but Obsidian files use descriptive display names with a project prefix:

| Local file | Obsidian path |
|------------|---------------|
| `arquitetura-geral.md` | `<atomic-notes-folder>/Project Name - Arquitetura Geral.md` |
| `_MOC.md` | `<atomic-notes-folder>/Project Name - MOC.md` |

The project prefix is a short form of the project name (e.g., "Lox" for lox-brain, "MyApp" for my-app).

The `<atomic-notes-folder>` and `<tags-folder>` are determined by the user's configured preset (see Configuration section above).

### Ingestion steps

1. **Atomic notes** — Write to the vault's atomic notes folder with project prefix
2. **Tag files** — Write to the vault's tags folder (check for existing tags first to avoid overwriting)
3. **Metadata adjustment** — Replace `source: claude-skill` with Dataview inline fields:
   ```
   [source:: claude-skill]
   [imported:: YYYY-MM-DD]
   ```
   Place these lines after the `Tags:` line and before the H1 title.

### Wikilink consistency

All wikilinks in notes written to Obsidian MUST use the same full display names as the vault files. Since the local `docs/zettelkasten/` files also use these full names in their inter-note links, the content should be identical — just with the metadata adjustment above.

## Example Session

- `/zettelkasten` — Full scan. Reads config, explores codebase, generates ~8-12 atomic notes + tag files + MOC in `docs/zettelkasten/`, then ingests to vault if MCP is available.
- `/zettelkasten embedding pipeline` — Topic-focused. Searches for related code, generates 2-6 notes, cross-links with existing notes, updates MOC.
- `/zettelkasten review docs/zettelkasten/arquitetura-geral.md` — Reads the note, verifies claims against current code, fixes inaccuracies, suggests status promotion.
