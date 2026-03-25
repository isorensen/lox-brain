# Academia Credifit Presentation — Second Brain: De Smart Notes a um Cérebro Aumentado por IA

## Overview

Single-file HTML presentation (dark theme, arrow-key navigation) for the "Academia Credifit" biweekly technical event. 25 minutes of content + 5 minutes Q&A. Audience: technical developers familiar with infra, backend, VPN, etc.

## Structure

### Part 1: Slides (15min)

| # | Slide | Time | Content |
|---|-------|------|---------|
| 1 | **Cover** | — | Title: "Second Brain: De Smart Notes a um Cérebro Aumentado por IA". Presenter name. Credifit + LinkPJ logos. Date. |
| 2 | **O Problema** | 1.5min | Information fragmentation: Slack, emails, meetings, docs, code. Quote: *"Open tasks tend to occupy our short-term memory — until they are done"* (Zeigarnik effect, Ahrens). |
| 3 | **Smart Notes (antes da IA)** | 2min | Book "How to Take Smart Notes" by Sönke Ahrens, Zettelkasten method, Obsidian as tool. Atomic notes, wiki-links, Graph View concept. Quote: *"If you want to learn something for the long run, you have to write it down."* |
| 4 | **A Evolução: Open Brain** | 1.5min | From manual notes → system with semantic search, automatic ingestion, AI as collaborator. Quote from user's own note: *"Precisamos aprender a ser ajudados pela IA, mas sem que ela nos substitua."* |
| 5 | **Arquitetura** | 3min | Animated/visual diagram: Obsidian Local ↔ Git Sync ↔ VM GCP (PostgreSQL+pgvector, Vault Watcher, Embedding Service) ↔ WireGuard VPN ↔ Claude Code MCP Server. Zero Trust principles highlighted. |
| 6 | **Embedding Pipeline** | 2min | Flow: .md file → frontmatter parse → OpenAI text-embedding-3-small → vector(1536) → pgvector ivfflat index. Cosine similarity search. |
| 7 | **MCP Server & Tools** | 2min | 6 tools: write_note, read_note, delete_note, search_semantic, search_text, list_recent. Claude Code as native MCP client. Stdio transport over SSH. |
| 8 | **Skills & Automations** | 3min | `/obsidian-ingest` (URLs, files, images → structured vault notes), `/sync-calendar` (Google Calendar → meeting notes with Gemini AI summaries, 67 events synced), `/zettelkasten` (codebase → atomic knowledge notes with wiki-links). |

### Part 2: Live Demo (8min)

| # | Step | Time | Action |
|---|------|------|--------|
| 1 | **Graph View** | 2min | Open Obsidian, show the graph of connections, navigate tag clusters |
| 2 | **Semantic Search** | 2min | In terminal, call Claude Code → MCP `search_semantic` with natural language query, show ranked results |
| 3 | **Create note live** | 2min | Use `write_note` or `/obsidian-ingest`, show note appearing in Obsidian in real-time |
| 4 | **Zettelkasten** | 2min | Show atomic notes generated from a codebase with wiki-links and tags |

### Part 3: Closing (2min)

- Numbers: 4,463 notes, 1,384 attachments, 11,766 total files in vault
- Code quality: 59 tests, 80%+ coverage
- Next steps: automated backups, monitoring, sync-calendar as cron
- Closing quote: *"The richer the slip-box becomes, the richer your own thinking becomes"* — Ahrens

### Q&A (5min)

## Visual Design Requirements

- **Dark theme** — impactful, modern, high contrast
- **Logos**: Credifit SVG (`assets/credifit-logo.svg`) and LinkPJ PNG (`assets/linkpj-logo.png`)
- **Architecture diagram** as central visual element (CSS/SVG animated)
- **Typography**: clean, large, readable at screen-share resolution
- **Navigation**: arrow keys (left/right), progress indicator
- **Single HTML file** with embedded CSS/JS — no external dependencies
- Smooth transitions between slides
- Code snippets with syntax highlighting (dark theme consistent)

## Key Quotes (from user's Obsidian vault)

1. *"Open tasks tend to occupy our short-term memory — until they are done."* — Ahrens (Zeigarnik effect)
2. *"If you want to learn something for the long run, you have to write it down."* — Ahrens
3. *"Precisamos aprender a ser ajudados pela IA, mas sem que ela nos substitua."* — Eduardo Sorensen
4. *"The richer the slip-box becomes, the richer your own thinking becomes."* — Ahrens
5. *"Tools are only as good as your ability to work with them."* — Ahrens
6. *"We have to choose between feeling smarter or becoming smarter."* — Ahrens

## Architecture Diagram Data

```
Local (Obsidian Desktop + iPhone)
  ↕ Git Sync (cron 2min)
VM GCP (e2-small, us-east1-b)
  ├── PostgreSQL 16 + pgvector (localhost only, SSL)
  ├── Vault Watcher (chokidar → detect .md changes)
  ├── Embedding Service (OpenAI text-embedding-3-small → vector(1536))
  ├── MCP Server (TypeScript, stdio transport, 6 tools)
  └── systemd (auto-restart)
WireGuard VPN (10.10.0.0/24, UDP 51820)
  ├── VM: 10.10.0.1
  ├── Arch Linux: 10.10.0.2
  └── Mac: 10.10.0.3
Claude Code (MCP Client via SSH over VPN)
```

## Technical Details for Slides

- **Database**: PostgreSQL 16 + pgvector extension, vector(1536), ivfflat index (cosine), GIN on tags
- **Language**: TypeScript, Node.js 22 LTS
- **Testing**: vitest, TDD, 80%+ coverage
- **CI/CD**: GitHub Actions (build, tsc, test, npm audit, deploy via IAP SSH)
- **Security**: Zero Trust, no public IP, WireGuard-only access, GCP Secret Manager for secrets

## Assets

- `apresentacao_academia/assets/credifit-logo.svg` — Credifit logo (color RGB)
- `apresentacao_academia/assets/linkpj-logo.png` — LinkPJ logo

## Output

Single file: `apresentacao_academia/index.html`
