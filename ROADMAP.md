# Roadmap

> Public roadmap for Lox. Phases are not strict timelines — priorities shift based on community feedback.

## Phase 0 — Generalization (Pre-Launch)

Transform a personal project into a first-class open source product.

- [x] Unique name (Lox — resolves the previous "Open Brain" conflict)
- [x] MIT License
- [x] Cross-platform installer (`packages/installer`) — Windows, macOS, Linux
- [x] `.env.example` with documented variables (`packages/core/.env.example`)
- [x] Monorepo structure (`packages/shared`, `packages/core`, `packages/installer`)
- [x] CI/CD via GitHub Actions (`ci.yml` for PR validation, `deploy.yml` for VM sync)
- [x] Contributing guide + Code of Conduct
- [x] README rewrite with ASCII logo, badges, and clear value proposition
- [ ] **Docker Compose one-click setup** — `docker compose up` for the full stack (pgvector, watcher, embedding service, MCP server)
- [ ] **Ollama support** — local embeddings without OpenAI dependency (privacy-first)
- [ ] **Remove VPN/VM coupling** — abstract network config to support any environment (local-only, cloud, VPN)

## Phase 1 — Launch

First wave of public traction.

- [ ] Show HN post
- [ ] Reddit posts (r/ObsidianMD, r/selfhosted, r/LocalLLaMA, r/pkm)
- [ ] Product Hunt launch (logo, screenshots, tagline)
- [ ] Obsidian community plugin (MCP companion)
- [ ] Blog post walking through architecture + setup
- [ ] Demo video (30-second GIF)

## Phase 2 — Community

Build ecosystem and contributor base.

- [ ] Discord server (general, support, showcase, development)
- [ ] Plugin system — allow new MCP tools via plugins
- [ ] Documentation site (Docusaurus or similar)
- [ ] Multi-LLM support — Claude, GPT-4, Llama3, Mistral via Ollama
- [ ] Public GitHub Projects board

## Phase 3 — Managed Hosting (Optional SaaS Layer)

Offer a hosted option for users who don't want to self-host.

- [ ] Landing page with waitlist
- [ ] Managed hosting tier (pgvector, embeddings, watcher)
- [ ] Billing and subscription management
- [ ] Web dashboard — status, usage metrics, search UI
- [ ] Free trial

## Phase 4 — Scale

Advanced features for power users and teams.

- [ ] Teams/collaboration — multi-user note access, permissions
- [ ] Public API — programmatic access, webhooks
- [ ] Advanced AI features — summarization, multi-modal embeddings
- [ ] Mobile companion app — read-only semantic search
- [ ] Enterprise options — SSO, audit logs, SLA

---

## How to contribute

See [CONTRIBUTING.md](CONTRIBUTING.md) for issue/PR guidelines. Feedback on this roadmap is welcome via GitHub Discussions or issues tagged `roadmap`.
