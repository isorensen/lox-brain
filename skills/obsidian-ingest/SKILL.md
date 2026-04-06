---
name: obsidian-ingest
description: Ingest URLs, images, files, and text into the Obsidian vault with semantic deduplication, categorization, and structured note creation via the Lox MCP Server
---

# Obsidian Ingest — Knowledge Base Pipeline

## Configuration

This skill reads your Lox configuration from `~/.lox/config.json`:
- `vault.preset`: determines folder structure (`zettelkasten` or `para`)
- `vault.local_path`: path to your Obsidian vault (default: `~/Obsidian/Lox`)

The skill adapts folder routing based on your preset. See the folder mapping table below.

### Folder Mapping by Preset

| Folder role | `zettelkasten` | `para` |
|---|---|---|
| Atomic notes | `6 - Atomic Notes/` | `4 - Resources/Notes/` |
| Source material | `2 - Source Material/` | `4 - Resources/Sources/` |
| Meeting notes | `7 - Meeting Notes/` | `2 - Projects/Meetings/` |
| Fleeting notes | `1 - Fleeting Notes/` | `1 - Inbox/` |
| Tags (MOCs) | `3 - Tags/` | `4 - Resources/Tags/` |
| Attachments | `attachments/` | `attachments/` |
| Clippings | `Clippings/` | `1 - Inbox/Clippings/` |

## Vault Access

The primary interface is the **lox-brain MCP server**, which already knows the vault path and provides safe read/write/search operations. Use MCP tools for everything except binary files (images, PDFs).

### MCP Tools (primary)

| Tool | Use for |
|---|---|
| `mcp__lox-brain__write_note` | Write/overwrite a note. Pass `file_path` (relative, e.g. `6 - Atomic Notes/My Note.md`) and `content` with the full formatted note. **Do NOT pass `tags`** — the vault uses inline tags, not YAML frontmatter. |
| `mcp__lox-brain__search_semantic` | Check for duplicates before creating notes (superior to text search) |
| `mcp__lox-brain__search_text` | Find existing tags, specific terms, or exact matches |
| `mcp__lox-brain__read_note` | Read an existing note's content |
| `mcp__lox-brain__list_recent` | See recently modified notes for context |

### Filesystem (fallback only)

Use direct filesystem access (read `vault.local_path` from `~/.lox/config.json`) only for:
- Copying binary files (images, PDFs) to `attachments/`
- Listing directory contents when MCP doesn't cover it
- Bulk operations where MCP would be too slow

## Note Format

Every note written to the vault must follow this exact structure. The vault does NOT use YAML frontmatter — it uses plain text headers and Dataview inline fields.

**Example of a real note:**

~~~markdown
2026-03-08 14:30

Status: #baby

Tags: [[IA]] [[linux]] [[tools]]

[source:: chatgpt]
[imported:: 2026-03-08]

# Development Environment Preferences

Preferred language is TypeScript. Uses Arch Linux with a tiling WM and Claude Code as the primary coding assistant.

- Prefers dark mode in all editors
- Uses pytest for Python tests
- Prefers receiving only modified sections when updating scripts

## References

- [[Obsidian]] as note-taking system
~~~

**Field reference:**
- **Status:** `#baby` (new/unreviewed), `#child` (developing), `#adult` (mature)
- **Source:** `chatgpt`, `drive`, `web`, `manual`, `image`
- **Tags:** `[[wikilinks]]` pointing to MOC documents in the Tags folder
- **Inline fields:** `[source:: value]`, `[imported:: date]`, optionally `[url:: ...]`, `[original_file:: ...]`

## Routing

Route content to the correct folder based on your preset (see folder mapping above):

| Content Type | Destination folder role |
|---|---|
| Concept, fact, preference, personal knowledge | Atomic notes |
| Article, law, book summary, external reference | Source material (`{subtype}/`) |
| Meeting record | Meeting notes |
| Quick idea, unprocessed thought | Fleeting notes |
| Web page clipping | Clippings |

Subtypes for Source Material: `AI Analysis/`, `Articles/`, `Laws/`, `Books/`, `Other/`, `Podcasts/`, `Videos/`

## Processing Workflow

### For any input:

1. **Read and understand** the content fully before doing anything
2. **Check existing tags:** use `mcp__lox-brain__search_text` to find existing tags in the vault — always reuse existing tags when possible
3. **Check for duplicates:** use `mcp__lox-brain__search_semantic` with key phrases from the content — semantic search catches duplicates even when wording differs
4. **Categorize and group** — if the input contains multiple distinct topics, group them into separate notes by theme
5. **Preview** — always show the user what notes will be created (title, destination, tags, brief content summary) and ask for confirmation before writing anything
6. **Write notes** via `mcp__lox-brain__write_note` after user confirms — pass the fully formatted content (with date header, Status, Tags, inline fields) in the `content` parameter; do NOT pass the `tags` parameter
7. **Create MOC files** for any new tags: use `mcp__lox-brain__write_note` to create an empty `.md` in the Tags folder for each tag that doesn't exist yet
8. **Confirm** what was created — list file paths, tags used, and any new MOCs created

### Input-specific handling:

- **Pasted text / memories:** Parse the format (bullets, timestamped entries, sections), group by theme, create one Atomic Note per theme
- **URLs:** Use WebFetch to extract content, create note in Source Material (`Articles/`) or Clippings
- **Images:** Analyze with Read tool, copy to `attachments/` as `YYYY-MM-DD-description.ext`, create referencing note with `![[attachments/filename]]`
- **PDF files:** See detailed handling below.
- **Markdown files:** Review content, add vault header, detect subtype, route to correct folder
- **Bulk/batch:** For large inputs, process in chunks and confirm with user between chunks

### File Naming Convention

File names appear as-is in Graph View and file explorer. They must be **descriptive and contextualized**, not generic.

**Rules:**
- **Project-related notes** must be prefixed with the project name: `Project Name - Topic Description.md`
  - Example: `Lox - General Architecture.md`, `Lox - MCP Server and Tools.md`
  - This groups related notes visually in Graph View and file explorer
- **General knowledge notes** use a descriptive title without prefix: `Development Environment Preferences.md`
- **No generic names** like `db-client.md`, `mcp-server.md`, `index.md` — always add context
- **Spaces, not hyphens** in file names (Obsidian handles spaces well)
- **Wikilinks must match file names exactly** (without `.md`): `[[Lox - General Architecture]]`

**Bad examples:** `general-architecture.md`, `data-flow.md`, `embedding-service.md`
**Good examples:** `Lox - General Architecture.md`, `Lox - Data Flow.md`, `Lox - Embedding Service.md`

### PDF File Handling

PDFs require text extraction before ingestion. Follow this sequence:

#### 1. Locate the file (Unicode filename issues)

Filenames with accented characters downloaded from macOS or the web may use NFD Unicode normalization (combining characters), making them invisible to direct path lookups. If `Read` fails to find the file:

```python
import subprocess, os

# List actual filenames in the directory (bypasses NFD issues)
result = subprocess.run(['python3', '-c',
    'import os; [print(repr(f)) for f in os.listdir("/path/to/dir")]'],
    capture_output=True, text=True)
print(result.stdout)
```

Then use the exact path from that output (including any escaped characters).

#### 2. Extract text

Prefer `pdftotext` (poppler-utils) — it preserves structure better than Python libraries:

```python
import subprocess

result = subprocess.run(
    ['pdftotext', '-layout', '/exact/path/to/file.pdf', '-'],
    capture_output=True, text=True
)
extracted_text = result.stdout
```

If `pdftotext` is unavailable, fall back to `pdfminer.six` or `pypdf`:

```python
# pypdf fallback
import subprocess
result = subprocess.run(['python3', '-c', """
import pypdf, sys
reader = pypdf.PdfReader('/exact/path/to/file.pdf')
text = '\\n'.join(page.extract_text() or '' for page in reader.pages)
print(text)
"""], capture_output=True, text=True)
extracted_text = result.stdout
```

#### 3. Clean extracted text

Raw PDF text commonly contains layout artifacts. Clean before converting to Markdown:

- Remove repeated headers/footers that appear on every page (identify by repetition)
- Collapse sequences of blank lines into a single blank line
- Remove hyphenated line-breaks (`word-\nbreak` -> `wordbreak`)
- Preserve intentional section structure (headings, bullet lists, numbered lists)
- Tables extracted as plain text: render as Markdown tables if structure is clear, otherwise use a code block

#### 4. Extract embedded images

PDFs often contain screenshots, charts, or evidence images that carry information not present in the text. Extract them with `pdfimages` (poppler-utils):

```bash
mkdir -p /tmp/pdf_images
pdfimages -png /exact/path/to/file.pdf /tmp/pdf_images/img
```

Then review each extracted image:
- **Read each image** with the Read tool to visually inspect it
- **Filter out decorative images** (logos, icons, backgrounds) — these are typically small (<5KB) and repeated across pages
- **Keep evidence/content images** (screenshots, charts, tables, diagrams) — these are usually larger and unique
- **Copy relevant images** to vault attachments with descriptive names: `YYYY-MM-DD-context-description.png`
- **Embed in the note** using `![[attachments/YYYY-MM-DD-context-description.png]]` at the appropriate section

This step matters because `pdftotext` only captures text — embedded screenshots, log captures, and visual evidence would be lost without it.

#### 5. Copy original PDF to vault attachments

```bash
# Read vault path from config: jq -r '.vault.local_path' ~/.lox/config.json
cp "/exact/path/to/Report.pdf" "$VAULT_PATH/attachments/YYYY-MM-DD-description.pdf"
```

Use ASCII-safe naming for the vault copy: `YYYY-MM-DD-descriptive-title.pdf` (no accents, no spaces).

#### 6. Note structure for PDF ingestion

Add these inline fields to the note:

```
[source:: pdf]
[original_file:: YYYY-MM-DD-descriptive-title.pdf]
[imported:: YYYY-MM-DD]
```

Route to Source Material (`Other/`) unless content clearly maps to a more specific subtype (e.g., `Articles/`, `Laws/`).

---

### Critical rules:

- **Never write to vault without user confirmation.** Always preview first.
- **Preserve information.** When summarizing, keep all facts — don't lose details.
- **One concept per Atomic Note** — if a topic has sub-themes, create linked notes.
