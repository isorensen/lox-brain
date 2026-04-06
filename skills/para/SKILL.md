---
name: para
description: Organize content using the PARA method (Projects, Areas, Resources, Archives) in the Obsidian vault via the Lox MCP Server
---

# PARA — Content Organization for Obsidian

## Configuration

This skill reads your Lox configuration from `~/.lox/config.json`:
- `vault.preset`: must be `para` (this skill is designed for the PARA template)
- `vault.local_path`: path to your Obsidian vault (default: `~/Obsidian/Lox`)

If `vault.preset` is `zettelkasten`, this skill will warn and suggest using `/zettelkasten` instead.

Folder mapping:
| Bucket | Folder | Description |
|--------|--------|-------------|
| Projects | `2 - Projects/` | Active efforts with a deadline or deliverable |
| Areas | `3 - Areas/` | Ongoing responsibilities (no deadline) |
| Resources | `4 - Resources/` | Reference material for future use |
| Archives | `5 - Archive/` | Completed projects, inactive areas |

Content language defaults to pt-BR. Technical terms and code identifiers stay in English. If the project's primary language is different (detected from README, CLAUDE.md, or user preference), adapt accordingly.

## Purpose

The PARA method (by Tiago Forte) organizes information by actionability, not by topic. This skill automates PARA classification, note creation, lifecycle transitions, and dashboard generation inside the user's Obsidian vault via the Lox MCP Server.

Why PARA for a second brain:
- **Actionability-first** sorting ensures active work stays visible and reference material stays accessible
- **Lifecycle transitions** (Project -> Archive, Resource -> Project) keep the vault current
- **Dashboards** per bucket provide instant situational awareness
- **Cross-linking** between buckets reveals how resources feed projects and areas

## Modes of Operation

### Mode 1: Ingest (default)

Trigger: `/para` or `/para <content/url/idea>`

Given content (text, URL, idea, or pasted material), classify it into the correct PARA bucket and create a note.

**Workflow:**

1. **Receive content** — The user provides text, a URL, a concept, or raw material to capture.
2. **Classify** — Determine the correct PARA bucket using these rules:
   - **Project**: Has a deadline, deliverable, or end state. Ask: "Can this be completed?"
   - **Area**: Ongoing responsibility with a standard to maintain. Ask: "Is this something I maintain indefinitely?"
   - **Resource**: Reference material, topic of interest, useful information. Ask: "Might I need this later?"
   - **Archive**: Completed or inactive. Ask: "Is this done or no longer relevant?"
   - If ambiguous, ask the user. Never guess between Project and Area.
3. **Check for duplicates** — Use `mcp__lox-brain__search_text` to find existing notes on the same topic. If found, offer to update instead of creating a new note.
4. **Create note** — Write the note to the correct folder using `mcp__lox-brain__write_note`.
5. **Cross-link** — Search for related notes in other buckets and add `[[wikilinks]]` in the Related section.
6. **Report** — Show the created file path, bucket classification, and any cross-links added.

### Mode 2: Review

Trigger: `/para review`

Scan existing notes and suggest reclassifications based on staleness and activity patterns.

**Workflow:**

1. **List recent notes** — Use `mcp__lox-brain__list_recent` and `mcp__lox-brain__search_text` to gather notes across all PARA folders.
2. **Analyze each bucket:**
   - **Projects**: Flag notes older than 30 days without updates as candidates for Archive.
   - **Areas**: Flag notes that have acquired a deadline or deliverable as candidates for Project.
   - **Resources**: Flag notes being actively referenced or edited as candidates for Project promotion.
   - **Archives**: Flag notes recently referenced as candidates for reactivation.
3. **Present recommendations** — Show a table of suggested moves with rationale:
   ```
   | Note | Current Bucket | Suggested Bucket | Reason |
   ```
4. **Execute moves** — After user confirmation, update the note's `para_bucket` field, move the file to the new folder, and update any dashboard notes.

### Mode 3: Dashboard

Trigger: `/para dashboard` or `/para dashboard <bucket>`

Generate or update an overview note (MOC-style) for one or all PARA buckets.

**Workflow:**

1. **Scan bucket folder(s)** — List all notes in the target bucket folder(s).
2. **Generate dashboard note** — Create a MOC-style note per bucket:
   - `2 - Projects/_Dashboard.md`
   - `3 - Areas/_Dashboard.md`
   - `4 - Resources/_Dashboard.md`
   - `5 - Archive/_Dashboard.md`
3. **Include metadata** — Each dashboard lists notes grouped by status (#baby, #child, #adult), with last-updated dates and brief descriptions extracted from note content.
4. **Cross-bucket links** — If a Project references a Resource, show that link in both dashboards.
5. **Write to vault** — Use `mcp__lox-brain__write_note` to create/update the dashboard files.

---

## Output Format

### PARA Note

```markdown
# Note Title

**Date:** 2026-04-05
**Status:** #baby
**Bucket:** Project | Area | Resource | Archive
**Tags:** [[tag1]] [[tag2]]

[source:: user-input | url | claude-skill]
[imported:: 2026-04-05]
[para_bucket:: projects | areas | resources | archives]

## Content

Main content goes here. Write in the project's content language (default: pt-BR).
Technical terms and code identifiers stay in English.

Use short paragraphs. Be direct. One main topic per note.

> [!NOTE]
> Use callout boxes for important caveats or context.

## Related
- [[Other Note in Same Bucket]]
- [[Note in Different Bucket]]
```

### Dashboard Note

```markdown
# Projects Dashboard

**Updated:** 2026-04-05
**Bucket:** Projects
**Tags:** [[para]] [[dashboard]]

[source:: claude-skill]
[para_bucket:: projects]

> [!INFO]
> Dashboard gerado automaticamente pelo skill `para`.
> Mostra todos os projetos ativos com status e ultima atualizacao.

## Active (#baby / #child)

- [[Project Note 1]] — Brief description (updated: 2026-04-01)
- [[Project Note 2]] — Brief description (updated: 2026-03-28)

## Mature (#adult)

- [[Project Note 3]] — Brief description (updated: 2026-03-15)

## Candidates for Archive

- [[Stale Project]] — No updates in 45 days. Consider archiving.
```

---

## File Naming Conventions

### Vault files
- **Notes** in bucket folders: Title case, descriptive names
  - Pattern: `<bucket-folder>/Note Title.md`
  - Example: `2 - Projects/Website Redesign.md`, `4 - Resources/Git Workflow Guide.md`
- **Dashboards** always use `_Dashboard.md` (underscore prefix sorts first)
  - Example: `2 - Projects/_Dashboard.md`

### Wikilink resolution
- Inter-note links use the Obsidian display name: `[[Note Title]]`
- If the note is in a subfolder, Obsidian resolves by filename alone — no folder prefix needed in wikilinks
- Tag links use short names: `[[para]]`, `[[dashboard]]`

## PARA Classification Rules

Use these rules to classify content. When in doubt, ask the user.

| Signal | Bucket | Example |
|--------|--------|---------|
| Has a deadline or due date | Project | "Launch site by May 15" |
| Has a clear deliverable | Project | "Write API documentation" |
| Can be marked as "done" | Project | "Migrate database to v2" |
| Ongoing responsibility | Area | "Health", "Finances", "Team management" |
| Standard to maintain | Area | "Code quality", "Home maintenance" |
| No end date | Area | "Professional development" |
| Interesting topic | Resource | "Machine learning resources" |
| Future reference | Resource | "Design patterns cheat sheet" |
| External material | Resource | "Article about distributed systems" |
| Project completed | Archive | "Q1 2026 report (delivered)" |
| Area no longer relevant | Archive | "Old apartment maintenance" |
| Resource outdated | Archive | "Deprecated API docs" |

## Lifecycle Transitions

Notes move between buckets as their status changes. This skill supports these transitions:

| Transition | Trigger | Action |
|------------|---------|--------|
| Project -> Archive | Project completed or abandoned | Move file, update `para_bucket`, update dashboards |
| Area -> Project | Area acquires a deadline | Move file, update `para_bucket`, add deadline to note |
| Resource -> Project | Resource becomes active work | Move file, update `para_bucket`, set status to #baby |
| Archive -> Project | Archived item reactivated | Move file, update `para_bucket`, reset status to #baby |
| Project -> Area | Deadline removed, becomes ongoing | Move file, update `para_bucket` |

When moving a note:
1. Read the note content with `mcp__lox-brain__read_note`
2. Update the `para_bucket` inline field
3. Update the `**Bucket:**` metadata line
4. Write to the new location with `mcp__lox-brain__write_note`
5. Update both source and destination dashboards

## Required Metadata

Every generated note MUST include:
1. H1 title
2. `**Date:**` with creation date (YYYY-MM-DD)
3. `**Status:**` with `#baby` (always starts as baby)
4. `**Bucket:**` with the PARA bucket name (Project, Area, Resource, or Archive)
5. `**Tags:**` with relevant `[[wikilinks]]`
6. `[source:: user-input | url | claude-skill]` (Dataview inline field)
7. `[imported:: YYYY-MM-DD]` (Dataview inline field)
8. `[para_bucket:: projects | areas | resources | archives]` (Dataview inline field)

The `para_bucket` field enables Dataview queries to list notes by bucket across the vault.

## MCP Tools Used

- `mcp__lox-brain__write_note` — Write a note to the vault
- `mcp__lox-brain__search_text` — Search for existing notes, check duplicates, find cross-links
- `mcp__lox-brain__read_note` — Read note content for review or transitions
- `mcp__lox-brain__list_recent` — List recently modified notes for review mode

### Deduplication

Before creating any note, search for existing content using `mcp__lox-brain__search_text`. If a matching note exists in the same bucket, update it. If it exists in a different bucket, ask the user whether to update in place or move it.

## Sub-Agent Delegation

For **Ingest mode** (single note):
- Handle entirely in the main agent (single note, focused task)

For **Review mode** (vault-wide scan):
- Use **Explore** (haiku) to list and categorize notes across all PARA folders
- Use **coder-sonnet** (sonnet) to generate the recommendations table
- Use the main agent to present results and execute confirmed moves

For **Dashboard mode**:
- Use **Explore** (haiku) to scan bucket folders and extract note metadata
- Use **coder-sonnet** (sonnet) to generate dashboard notes in parallel (one per bucket)
- Use the main agent to write dashboards to vault via MCP

## Quality Checklist

Before finalizing output, verify:
- [ ] Note is placed in the correct PARA bucket folder
- [ ] All required metadata fields are present (Date, Status, Bucket, Tags, source, imported, para_bucket)
- [ ] `para_bucket` inline field matches the actual folder placement
- [ ] Duplicate check performed via `mcp__lox-brain__search_text` before creating
- [ ] Cross-links added in the Related section where appropriate
- [ ] Wikilinks use Obsidian display names (filename without extension)
- [ ] Content language matches the project's language (default: pt-BR), technical terms in English
- [ ] No secrets, credentials, or sensitive data in note content
- [ ] Dashboard notes updated if a new note was added to a bucket
- [ ] Lifecycle transitions update both source and destination dashboards
- [ ] Status always starts as `#baby` for new notes

## Example Session

- `/para` — User provides content interactively. Skill asks for text/URL/idea, classifies it, creates note in the correct bucket.
- `/para Build CI/CD pipeline for staging by April 30` — Ingest mode. Classifies as Project (has deadline), creates note in `2 - Projects/`, cross-links with related resources.
- `/para https://martinfowler.com/articles/microservices.html` — Ingest mode. Classifies as Resource, creates note in `4 - Resources/` with summary and source link.
- `/para review` — Review mode. Scans all buckets, presents reclassification suggestions, executes after confirmation.
- `/para dashboard` — Dashboard mode. Generates/updates `_Dashboard.md` for all four buckets.
- `/para dashboard projects` — Dashboard mode for Projects only. Updates `2 - Projects/_Dashboard.md`.
