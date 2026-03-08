# TODO

## Pending Phases

### Phase 10: Backups & Monitoring
- **Priority:** High
- PostgreSQL backup cron (daily pg_dump, keep 30 days)
- VM disk snapshot schedule
- Cloud Logging alerts for errors

### Phase 9: Cloud Run Panel (deferred)
- **Priority:** Low
- API endpoints: `POST /vm/start`, `POST /vm/stop`, `GET /vm/status`
- Protected by IAM (`--no-allow-unauthenticated`)
- Enables remote VM control from mobile/frontend

## Pending Improvements

### Text chunking for large notes
- **Priority:** Medium
- **Context:** During initial vault indexing (Phase 8), 5 notes exceeded OpenAI `text-embedding-3-small` token limit (8192 tokens). These are long legal/regulatory documents (leis, resoluções, portarias).
- **Solution:** Implement text chunking in `EmbeddingService` — split large texts into chunks (e.g. 6000 tokens with overlap), generate embedding per chunk, store multiple rows per note or average the embeddings.
- **Affected notes (initial indexing):**
  - `2 - Source Material/Leis e Resoluções/Lei 10820 compilado.md` (13257 tokens)
  - `2 - Source Material/Leis e Resoluções/PORTARIA MTE Nº 435, DE 20 DE MARÇO DE 2025.md` (13062 tokens)
  - `2 - Source Material/Leis e Resoluções/Resolução BCB n 352 de 23 11 2023.md` (45576 tokens)
  - `2 - Source Material/Leis e Resoluções/Resolução CMN n 4966 de 25 11 2021.md` (34907 tokens)
  - `2 - Source Material/Livros/Ismail_et_al-Exponential Organizations.md` (9297 tokens)
- **Re-index:** After implementing chunking, re-run `npm run index-vault` — the script is idempotent (hash-based skip), so only missing/changed notes will be re-embedded.

### list_recent response size
- **Priority:** Low
- `list_recent` returns full note content, which can be very large. Consider returning only metadata (file_path, title, tags, updated_at) with content available via `read_note`.
