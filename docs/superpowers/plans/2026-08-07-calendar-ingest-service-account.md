# Calendar Ingest via Service Account — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ingest team ceremony meeting notes into a team vault by reading the Gemini notes Doc directly from Google Drive, using a keyless service account with domain-wide delegation.

**Architecture:** A new `packages/core/src/ingest/` module with five focused units — config loading, keyless DWD auth, Calendar listing, Gemini Doc export/parse, and note building/writing. A CLI entrypoint drives them over a date window, so the same code serves both the daily incremental run and the one-shot historical backfill. `note-builder` is pure (event + notes → Markdown string), which keeps naming and templating testable without network.

**Tech Stack:** TypeScript (Node 22 LTS), vitest, `google-auth-library`, `@googleapis/calendar`, `@googleapis/drive`.

**Spec:** `docs/superpowers/specs/2026-08-07-calendar-ingest-service-account-design.md`

## Global Constraints

- **Public repository.** No real e-mail addresses, calendar IDs, domain names, squad labels, or account names in any committed file — including tests and fixtures. Use placeholders (`<capture-account>@<domain>`, `<calendar-id>`, `<squad-label>`).
- **Test fixtures must be anonymized** before being committed: names, e-mails and meeting content replaced with fictional values.
- **Coverage target: 80%** (project standard). `npm run test:coverage` must not regress.
- **OAuth scopes are exactly two:** `https://www.googleapis.com/auth/calendar.readonly` and `https://www.googleapis.com/auth/drive.readonly`. **Never add `gmail.readonly`** — under domain-wide delegation it would allow reading any mailbox in the domain.
- **No exported service-account key.** Auth uses the attached SA plus IAM Credentials `signJwt`.
- **Commits in English, imperative mood.** Do not commit without asking the user first.
- Vault notes use **inline Dataview fields, never YAML frontmatter**.
- Run `npx tsc --noEmit` before considering any task complete.

---

### Task 1: Configuration loading and open-source boundary

**Files:**
- Create: `packages/core/src/ingest/types.ts`
- Create: `packages/core/src/ingest/config.ts`
- Create: `packages/core/config.json.example`
- Modify: `.gitignore`
- Test: `packages/core/tests/ingest/config.test.ts`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: `loadIngestConfig(raw: unknown): IngestConfig` and the types `IngestConfig`, `CalendarConfig`, `NormalizedEvent`, `GeminiNotes`, `NoteDecision` used by every later task.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/tests/ingest/config.test.ts
import { describe, it, expect } from 'vitest';
import { loadIngestConfig } from '../../src/ingest/config.js';

const valid = {
  calendar_ingest: {
    impersonate_subject: 'capture@example.com',
    service_account: 'sa@proj.iam.gserviceaccount.com',
    notes_folder: '7 - Meeting Notes',
    vault_path: '/tmp/vault',
    organizer_allowlist: ['owner@example.com'],
    note_attachment_patterns: ['anotações do gemini', 'notes by gemini'],
    calendars: [
      { id: 'cal-a', label: 'Alpha' },
      { id: 'cal-b', label: '' },
    ],
  },
};

describe('loadIngestConfig', () => {
  it('parses a valid config', () => {
    const cfg = loadIngestConfig(valid);
    expect(cfg.calendars).toHaveLength(2);
    expect(cfg.calendars[1].label).toBe('');
    expect(cfg.impersonateSubject).toBe('capture@example.com');
  });

  it('defaults attachment patterns when omitted', () => {
    const raw = structuredClone(valid);
    delete (raw.calendar_ingest as Record<string, unknown>).note_attachment_patterns;
    expect(loadIngestConfig(raw).noteAttachmentPatterns).toContain('anotações do gemini');
  });

  it('throws when the calendar_ingest section is missing', () => {
    expect(() => loadIngestConfig({})).toThrow(/calendar_ingest/);
  });

  it('throws when a calendar has no id', () => {
    const raw = structuredClone(valid);
    raw.calendar_ingest.calendars = [{ id: '', label: 'x' }];
    expect(() => loadIngestConfig(raw)).toThrow(/calendar id/i);
  });

  it('throws when impersonate_subject is missing', () => {
    const raw = structuredClone(valid);
    raw.calendar_ingest.impersonate_subject = '';
    expect(() => loadIngestConfig(raw)).toThrow(/impersonate_subject/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=packages/core -- tests/ingest/config.test.ts`
Expected: FAIL — cannot resolve `../../src/ingest/config.js`

- [ ] **Step 3: Write the types**

```ts
// packages/core/src/ingest/types.ts
export interface CalendarConfig {
  id: string;
  /** Filename suffix used to disambiguate ceremonies across squads. Empty = no suffix. */
  label: string;
}

export interface IngestConfig {
  impersonateSubject: string;
  serviceAccount: string;
  notesFolder: string;
  vaultPath: string;
  /** Accounts the backfill may impersonate as event organizers. */
  organizerAllowlist: string[];
  /** Lowercase substrings that identify a Gemini notes attachment. */
  noteAttachmentPatterns: string[];
  calendars: CalendarConfig[];
}

export interface EventAttendee {
  email: string;
  displayName?: string;
  responseStatus?: string;
  organizer?: boolean;
  self?: boolean;
}

export interface EventAttachment {
  title: string;
  fileUrl: string;
}

export interface NormalizedEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  htmlLink: string;
  organizerEmail: string;
  calendarId: string;
  calendarLabel: string;
  attendees: EventAttendee[];
  attachments: EventAttachment[];
  /** Response status of the capture account, or 'observer' when not invited. */
  attendance: string;
}

export interface GeminiNotes {
  summary: string;
  nextSteps: string[];
  details: string[];
  docUrls: string[];
}

export type NoteDecision =
  | { action: 'create'; path: string; content: string }
  | { action: 'complement'; path: string; content: string }
  | { action: 'skip'; path: string; reason: string };
```

- [ ] **Step 4: Write the config loader**

```ts
// packages/core/src/ingest/config.ts
import type { IngestConfig } from './types.js';

const DEFAULT_PATTERNS = ['anotações do gemini', 'anotacoes do gemini', 'notes by gemini'];

function str(section: Record<string, unknown>, key: string, required = true): string {
  const value = section[key];
  if (typeof value === 'string' && value.length > 0) return value;
  if (required) throw new Error(`calendar_ingest.${key} is required`);
  return '';
}

export function loadIngestConfig(raw: unknown): IngestConfig {
  const root = (raw ?? {}) as Record<string, unknown>;
  const section = root.calendar_ingest as Record<string, unknown> | undefined;
  if (!section) throw new Error('calendar_ingest section is missing from config');

  const calendarsRaw = Array.isArray(section.calendars) ? section.calendars : [];
  if (calendarsRaw.length === 0) throw new Error('calendar_ingest.calendars must not be empty');

  const calendars = calendarsRaw.map((entry) => {
    const item = (entry ?? {}) as Record<string, unknown>;
    const id = typeof item.id === 'string' ? item.id : '';
    if (!id) throw new Error('every calendar entry needs a non-empty calendar id');
    return { id, label: typeof item.label === 'string' ? item.label : '' };
  });

  const patterns = Array.isArray(section.note_attachment_patterns)
    ? (section.note_attachment_patterns as string[])
    : DEFAULT_PATTERNS;

  return {
    impersonateSubject: str(section, 'impersonate_subject'),
    serviceAccount: str(section, 'service_account'),
    notesFolder: str(section, 'notes_folder', false) || '7 - Meeting Notes',
    vaultPath: str(section, 'vault_path'),
    organizerAllowlist: Array.isArray(section.organizer_allowlist)
      ? (section.organizer_allowlist as string[])
      : [],
    noteAttachmentPatterns: patterns.map((p) => p.toLowerCase()),
    calendars,
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test --workspace=packages/core -- tests/ingest/config.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 6: Create the example config with placeholders only**

```jsonc
// packages/core/config.json.example
// Copy to ~/.lox/config.json and fill in. Never commit the filled version.
{
  "calendar_ingest": {
    "impersonate_subject": "<capture-account>@<domain>",
    "service_account": "<sa-name>@<project>.iam.gserviceaccount.com",
    "notes_folder": "7 - Meeting Notes",
    "vault_path": "/home/<user>/obsidian",
    "organizer_allowlist": ["<organizer>@<domain>"],
    "note_attachment_patterns": ["anotações do gemini", "notes by gemini"],
    "calendars": [
      { "id": "<calendar-id>", "label": "<squad-label>" },
      { "id": "<calendar-id>", "label": "" }
    ]
  }
}
```

- [ ] **Step 7: Close the gitignore gap**

The repo currently ignores neither `config.json` nor `.lox/`. A local config placed inside the repo would be committed by accident. Append to `.gitignore`:

```gitignore
# Local runtime config (never commit; see config.json.example)
config.json
.lox/
!**/config.json.example
```

Verify: `git check-ignore -v packages/core/config.json` must now report a match, and `git check-ignore packages/core/config.json.example` must report nothing.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/ingest/types.ts packages/core/src/ingest/config.ts \
        packages/core/config.json.example packages/core/tests/ingest/config.test.ts .gitignore
git commit -m "feat(ingest): add calendar ingest config schema and loader"
```

---

### Task 2: Note builder — naming, template and Dataview fields

**Files:**
- Create: `packages/core/src/ingest/note-builder.ts`
- Test: `packages/core/tests/ingest/note-builder.test.ts`

**Interfaces:**
- Consumes: `NormalizedEvent`, `GeminiNotes` from Task 1.
- Produces: `buildNoteFilename(event: NormalizedEvent): string` and `buildNoteContent(event: NormalizedEvent, notes: GeminiNotes | null): string`.

This unit is pure — no network, no filesystem. It encodes the two naming decisions from the spec: the squad suffix comes from config (not from the event, whose organizer name is unstable), and it is omitted when the label is empty.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/tests/ingest/note-builder.test.ts
import { describe, it, expect } from 'vitest';
import { buildNoteFilename, buildNoteContent } from '../../src/ingest/note-builder.js';
import type { NormalizedEvent, GeminiNotes } from '../../src/ingest/types.js';

const base: NormalizedEvent = {
  id: 'evt-1',
  summary: 'Daily meeting',
  start: '2026-07-15T09:00:00-03:00',
  end: '2026-07-15T09:10:00-03:00',
  htmlLink: 'https://calendar.example/evt-1',
  organizerEmail: 'owner@example.com',
  calendarId: 'cal-a',
  calendarLabel: 'Alpha',
  attendees: [
    { email: 'ana@example.com', displayName: 'Ana Lima', responseStatus: 'accepted', organizer: true },
    { email: 'bo@example.com', displayName: 'Bo Reis', responseStatus: 'declined' },
  ],
  attachments: [],
  attendance: 'observer',
};

const notes: GeminiNotes = {
  summary: 'Team aligned on the release cut.',
  nextSteps: ['[Ana Lima] Freeze the branch by Friday'],
  details: ['Release scope was reduced to two items.'],
  docUrls: ['https://docs.example/d/1'],
};

describe('buildNoteFilename', () => {
  it('appends the calendar label to disambiguate across squads', () => {
    expect(buildNoteFilename(base)).toBe('2026-07-15 Daily meeting - Alpha.md');
  });

  it('omits the suffix when the label is empty', () => {
    expect(buildNoteFilename({ ...base, calendarLabel: '' }))
      .toBe('2026-07-15 Daily meeting.md');
  });

  it('replaces filesystem-forbidden characters', () => {
    const e = { ...base, summary: 'Review: API / Dash', calendarLabel: '' };
    expect(buildNoteFilename(e)).toBe('2026-07-15 Review - API - Dash.md');
  });

  it('preserves accents', () => {
    const e = { ...base, summary: 'Retrospectiva Ágil', calendarLabel: '' };
    expect(buildNoteFilename(e)).toBe('2026-07-15 Retrospectiva Ágil.md');
  });
});

describe('buildNoteContent', () => {
  it('marks the note as #child and includes Gemini sections when notes exist', () => {
    const md = buildNoteContent(base, notes);
    expect(md).toContain('Status: #child');
    expect(md).toContain('[calendar_event_id:: evt-1]');
    expect(md).toContain('[attendance:: observer]');
    expect(md).toContain('Team aligned on the release cut.');
    expect(md).toContain('- [ ] Freeze the branch by Friday');
    expect(md).toContain('[responsible:: Ana Lima]');
  });

  it('marks the note as #baby with a callout when notes are absent', () => {
    const md = buildNoteContent(base, null);
    expect(md).toContain('Status: #baby');
    expect(md).toContain('Sem notas automaticas');
  });

  it('never emits YAML frontmatter', () => {
    expect(buildNoteContent(base, notes).startsWith('---')).toBe(false);
  });

  it('renders attendee response status as icons and links them', () => {
    const md = buildNoteContent(base, null);
    expect(md).toContain('[[Ana Lima]] ✅ (organizador)');
    expect(md).toContain('[[Bo Reis]] ❌');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=packages/core -- tests/ingest/note-builder.test.ts`
Expected: FAIL — cannot resolve `note-builder.js`

- [ ] **Step 3: Write the implementation**

```ts
// packages/core/src/ingest/note-builder.ts
import type { NormalizedEvent, GeminiNotes } from './types.js';

const STATUS_ICON: Record<string, string> = {
  accepted: '✅',
  declined: '❌',
  tentative: '❓',
  needsAction: '⏳',
};

function isoDate(value: string): string {
  return value.slice(0, 10);
}

function isoTime(value: string): string {
  return value.slice(11, 16);
}

function sanitize(title: string): string {
  return title
    .replace(/[|/\\:*?"<>]/g, ' - ')
    .replace(/ - (?: - )+/g, ' - ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildNoteFilename(event: NormalizedEvent): string {
  const title = sanitize(event.summary || 'Sem titulo');
  const suffix = event.calendarLabel ? ` - ${sanitize(event.calendarLabel)}` : '';
  return `${isoDate(event.start)} ${title}${suffix}.md`;
}

function renderAttendees(event: NormalizedEvent): string {
  if (event.attendees.length === 0) return '_Sem participantes registrados._';
  return event.attendees
    .map((a) => {
      const name = a.displayName || a.email.split('@')[0].replace(/[._]/g, ' ');
      const icon = STATUS_ICON[a.responseStatus ?? 'needsAction'] ?? '⏳';
      const org = a.organizer ? ' (organizador)' : '';
      return `- [[${name}]] ${icon}${org}`;
    })
    .join('\n');
}

function renderNextSteps(nextSteps: string[]): string {
  if (nextSteps.length === 0) return '_Nenhuma acao registrada._';
  return nextSteps
    .map((item) => {
      const match = item.match(/^\[([^\]]+)\]\s*(.+)$/);
      if (!match) return `- [ ] ${item}`;
      return `- [ ] ${match[2]} [responsible:: ${match[1]}]`;
    })
    .join('\n');
}

export function buildNoteContent(event: NormalizedEvent, notes: GeminiNotes | null): string {
  const status = notes ? '#child' : '#baby';
  const topics = notes
    ? [
        `**Resumo (Gemini):** ${notes.summary}`,
        '',
        ...notes.details.map((d) => `- ${d}`),
      ].join('\n')
    : [
        '> [!NOTE] Sem notas automaticas',
        '> Este evento nao possui anotacoes do Gemini. Adicione suas notas manualmente abaixo.',
      ].join('\n');

  const refs = [`- [Evento no Google Calendar](${event.htmlLink})`];
  for (const url of notes?.docUrls ?? []) {
    refs.push(`- [Anotacoes do Gemini (Google Doc)](${url})`);
  }

  return [
    `${isoDate(event.start)} ${isoTime(event.start)}`,
    `Status: ${status}`,
    `Tags: [[meeting]]${event.calendarLabel ? ` [[${event.calendarLabel}]]` : ''}`,
    '',
    '[source:: google-calendar]',
    `[imported:: ${isoDate(new Date().toISOString())}]`,
    `[calendar_event_id:: ${event.id}]`,
    `[calendar_source:: ${event.calendarLabel}]`,
    `[attendance:: ${event.attendance}]`,
    '',
    `# 📅 ${isoDate(event.start)} 🕒 ${isoTime(event.start)}`,
    '',
    `## 📝 Reuniao: ${event.summary}`,
    '',
    '### 👥 Participantes:',
    renderAttendees(event),
    '',
    '### 📌 Topicos Discutidos:',
    topics,
    '',
    '### ✅ Acoes e Proximos Passos:',
    renderNextSteps(notes?.nextSteps ?? []),
    '',
    '### 📂 Referencias e Anexos:',
    refs.join('\n'),
    '',
  ].join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=packages/core -- tests/ingest/note-builder.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Type check and commit**

```bash
npx tsc --noEmit
git add packages/core/src/ingest/note-builder.ts packages/core/tests/ingest/note-builder.test.ts
git commit -m "feat(ingest): build meeting notes with calendar-label disambiguation"
```

---

### Task 3: Keyless domain-wide delegation auth

**Files:**
- Create: `packages/core/src/ingest/auth.ts`
- Modify: `packages/core/package.json` (add `google-auth-library`)
- Test: `packages/core/tests/ingest/auth.test.ts`

**Interfaces:**
- Consumes: `IngestConfig` from Task 1.
- Produces: `getAccessToken(serviceAccount: string, subject: string, deps?: AuthDeps): Promise<string>` and the exported constant `SCOPES: readonly string[]`.

The SA is attached to the VM, so there is no key file. To impersonate a user we build the JWT claim set ourselves, have IAM Credentials sign it, then exchange it for an access token.

- [ ] **Step 1: Add the dependency**

```bash
npm install google-auth-library --workspace=packages/core
```

- [ ] **Step 2: Write the failing test**

Dependencies are injected so the test makes no network calls.

```ts
// packages/core/tests/ingest/auth.test.ts
import { describe, it, expect, vi } from 'vitest';
import { getAccessToken, SCOPES } from '../../src/ingest/auth.js';

function deps(overrides = {}) {
  return {
    signJwt: vi.fn().mockResolvedValue('signed.jwt.value'),
    exchange: vi.fn().mockResolvedValue('ya29.token'),
    now: () => 1_000_000,
    ...overrides,
  };
}

describe('getAccessToken', () => {
  it('requests exactly the two readonly scopes', async () => {
    const d = deps();
    await getAccessToken('sa@proj.iam.gserviceaccount.com', 'capture@example.com', d);
    const payload = JSON.parse(d.signJwt.mock.calls[0][1]);
    expect(payload.scope.split(' ').sort()).toEqual([...SCOPES].sort());
  });

  it('never requests any gmail scope', async () => {
    const d = deps();
    await getAccessToken('sa@proj.iam.gserviceaccount.com', 'capture@example.com', d);
    const payload = JSON.parse(d.signJwt.mock.calls[0][1]);
    expect(payload.scope).not.toContain('gmail');
  });

  it('sets sub to the impersonated subject and iss to the service account', async () => {
    const d = deps();
    await getAccessToken('sa@proj.iam.gserviceaccount.com', 'capture@example.com', d);
    const payload = JSON.parse(d.signJwt.mock.calls[0][1]);
    expect(payload.sub).toBe('capture@example.com');
    expect(payload.iss).toBe('sa@proj.iam.gserviceaccount.com');
    expect(payload.exp).toBe(1_000_000 + 3600);
  });

  it('exchanges the signed jwt for an access token', async () => {
    const d = deps();
    const token = await getAccessToken('sa@proj.iam.gserviceaccount.com', 'capture@example.com', d);
    expect(d.exchange).toHaveBeenCalledWith('signed.jwt.value');
    expect(token).toBe('ya29.token');
  });

  it('propagates a signing failure', async () => {
    const d = deps({ signJwt: vi.fn().mockRejectedValue(new Error('permission denied')) });
    await expect(
      getAccessToken('sa@proj.iam.gserviceaccount.com', 'capture@example.com', d),
    ).rejects.toThrow(/permission denied/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test --workspace=packages/core -- tests/ingest/auth.test.ts`
Expected: FAIL — cannot resolve `auth.js`

- [ ] **Step 4: Write the implementation**

```ts
// packages/core/src/ingest/auth.ts
import { GoogleAuth } from 'google-auth-library';

export const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
] as const;

const IAM_HOST = 'https://iamcredentials.googleapis.com';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export interface AuthDeps {
  signJwt: (serviceAccount: string, payload: string) => Promise<string>;
  exchange: (signedJwt: string) => Promise<string>;
  now: () => number;
}

async function defaultSignJwt(serviceAccount: string, payload: string): Promise<string> {
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const client = await auth.getClient();
  const res = await client.request<{ signedJwt: string }>({
    url: `${IAM_HOST}/v1/projects/-/serviceAccounts/${serviceAccount}:signJwt`,
    method: 'POST',
    data: { payload },
  });
  return res.data.signedJwt;
}

async function defaultExchange(signedJwt: string): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: signedJwt,
    }),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) throw new Error('token exchange returned no access_token');
  return body.access_token;
}

const DEFAULTS: AuthDeps = {
  signJwt: defaultSignJwt,
  exchange: defaultExchange,
  now: () => Math.floor(Date.now() / 1000),
};

export async function getAccessToken(
  serviceAccount: string,
  subject: string,
  deps: AuthDeps = DEFAULTS,
): Promise<string> {
  const iat = deps.now();
  const payload = JSON.stringify({
    iss: serviceAccount,
    sub: subject,
    scope: SCOPES.join(' '),
    aud: TOKEN_URL,
    iat,
    exp: iat + 3600,
  });
  const signed = await deps.signJwt(serviceAccount, payload);
  return deps.exchange(signed);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test --workspace=packages/core -- tests/ingest/auth.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 6: Commit**

```bash
npx tsc --noEmit
git add packages/core/src/ingest/auth.ts packages/core/tests/ingest/auth.test.ts \
        packages/core/package.json package-lock.json
git commit -m "feat(ingest): add keyless domain-wide delegation auth"
```

---

### Task 4: Calendar source

**Files:**
- Create: `packages/core/src/ingest/calendar-source.ts`
- Test: `packages/core/tests/ingest/calendar-source.test.ts`

**Interfaces:**
- Consumes: `CalendarConfig`, `NormalizedEvent` from Task 1.
- Produces: `listEvents(fetchPage: FetchPage, calendar: CalendarConfig, from: string, to: string, captureAccount: string): Promise<NormalizedEvent[]>`, where `FetchPage = (calendarId: string, params: Record<string, string>) => Promise<RawPage>`.

`attendance` is resolved here: the capture account's own `responseStatus` when it is in the attendee list, otherwise `observer`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/tests/ingest/calendar-source.test.ts
import { describe, it, expect, vi } from 'vitest';
import { listEvents } from '../../src/ingest/calendar-source.js';

const cal = { id: 'cal-a', label: 'Alpha' };

function page(items: unknown[], nextPageToken?: string) {
  return { items, nextPageToken };
}

const rawEvent = {
  id: 'evt-1',
  summary: 'Daily meeting',
  htmlLink: 'https://calendar.example/evt-1',
  start: { dateTime: '2026-07-15T09:00:00-03:00' },
  end: { dateTime: '2026-07-15T09:10:00-03:00' },
  organizer: { email: 'owner@example.com' },
  attendees: [{ email: 'ana@example.com', responseStatus: 'accepted' }],
  attachments: [{ title: 'Anotações do Gemini', fileUrl: 'https://docs.example/d/1' }],
};

describe('listEvents', () => {
  it('normalizes an event and attaches the calendar label', async () => {
    const fetchPage = vi.fn().mockResolvedValue(page([rawEvent]));
    const [event] = await listEvents(fetchPage, cal, '2026-07-01', '2026-08-01', 'capture@example.com');
    expect(event.id).toBe('evt-1');
    expect(event.calendarLabel).toBe('Alpha');
    expect(event.attachments[0].fileUrl).toBe('https://docs.example/d/1');
  });

  it('marks attendance as observer when the capture account is not an attendee', async () => {
    const fetchPage = vi.fn().mockResolvedValue(page([rawEvent]));
    const [event] = await listEvents(fetchPage, cal, '2026-07-01', '2026-08-01', 'capture@example.com');
    expect(event.attendance).toBe('observer');
  });

  it('uses the capture account response status when it is invited', async () => {
    const invited = {
      ...rawEvent,
      attendees: [...rawEvent.attendees, { email: 'capture@example.com', responseStatus: 'declined' }],
    };
    const fetchPage = vi.fn().mockResolvedValue(page([invited]));
    const [event] = await listEvents(fetchPage, cal, '2026-07-01', '2026-08-01', 'capture@example.com');
    expect(event.attendance).toBe('declined');
  });

  it('follows pagination until no token remains', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(page([rawEvent], 'tok'))
      .mockResolvedValueOnce(page([{ ...rawEvent, id: 'evt-2' }]));
    const events = await listEvents(fetchPage, cal, '2026-07-01', '2026-08-01', 'capture@example.com');
    expect(events.map((e) => e.id)).toEqual(['evt-1', 'evt-2']);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('skips cancelled events and all-day entries without attendees', async () => {
    const fetchPage = vi.fn().mockResolvedValue(
      page([
        { ...rawEvent, id: 'c1', status: 'cancelled' },
        { id: 'allday', summary: 'Feriado', start: { date: '2026-07-15' }, end: { date: '2026-07-16' } },
        rawEvent,
      ]),
    );
    const events = await listEvents(fetchPage, cal, '2026-07-01', '2026-08-01', 'capture@example.com');
    expect(events.map((e) => e.id)).toEqual(['evt-1']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=packages/core -- tests/ingest/calendar-source.test.ts`
Expected: FAIL — cannot resolve `calendar-source.js`

- [ ] **Step 3: Write the implementation**

```ts
// packages/core/src/ingest/calendar-source.ts
import type { CalendarConfig, NormalizedEvent, EventAttendee } from './types.js';

export interface RawPage {
  items?: unknown[];
  nextPageToken?: string;
}

export type FetchPage = (calendarId: string, params: Record<string, string>) => Promise<RawPage>;

function resolveAttendance(attendees: EventAttendee[], captureAccount: string): string {
  const self = attendees.find((a) => a.email?.toLowerCase() === captureAccount.toLowerCase());
  if (!self) return 'observer';
  return self.responseStatus === 'needsAction' ? 'none' : (self.responseStatus ?? 'none');
}

export async function listEvents(
  fetchPage: FetchPage,
  calendar: CalendarConfig,
  from: string,
  to: string,
  captureAccount: string,
): Promise<NormalizedEvent[]> {
  const events: NormalizedEvent[] = [];
  let pageToken: string | undefined;

  do {
    const params: Record<string, string> = {
      timeMin: `${from}T00:00:00Z`,
      timeMax: `${to}T00:00:00Z`,
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '250',
    };
    if (pageToken) params.pageToken = pageToken;

    const page = await fetchPage(calendar.id, params);
    for (const item of page.items ?? []) {
      const raw = item as Record<string, any>;
      if (raw.status === 'cancelled') continue;

      const attendees: EventAttendee[] = Array.isArray(raw.attendees) ? raw.attendees : [];
      const startDateTime = raw.start?.dateTime;
      // All-day entries have `date` instead of `dateTime`; keep them only when someone was invited.
      if (!startDateTime && attendees.length === 0) continue;

      events.push({
        id: String(raw.id),
        summary: String(raw.summary ?? 'Sem titulo'),
        start: startDateTime ?? `${raw.start?.date}T00:00:00`,
        end: raw.end?.dateTime ?? `${raw.end?.date}T00:00:00`,
        htmlLink: String(raw.htmlLink ?? ''),
        organizerEmail: String(raw.organizer?.email ?? ''),
        calendarId: calendar.id,
        calendarLabel: calendar.label,
        attendees,
        attachments: Array.isArray(raw.attachments) ? raw.attachments : [],
        attendance: resolveAttendance(attendees, captureAccount),
      });
    }
    pageToken = page.nextPageToken;
  } while (pageToken);

  return events;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=packages/core -- tests/ingest/calendar-source.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit
git add packages/core/src/ingest/calendar-source.ts packages/core/tests/ingest/calendar-source.test.ts
git commit -m "feat(ingest): list and normalize calendar events"
```

---

### Task 5: Gemini Doc discovery, export and parsing

**Files:**
- Create: `packages/core/src/ingest/gemini-doc.ts`
- Create: `packages/core/tests/fixtures/gemini-notes-ptbr.txt`
- Test: `packages/core/tests/ingest/gemini-doc.test.ts`

**Interfaces:**
- Consumes: `NormalizedEvent`, `GeminiNotes`, `IngestConfig` from Task 1.
- Produces: `findNoteAttachments(event, patterns): EventAttachment[]`, `extractFileId(fileUrl: string): string | null`, `parseGeminiDoc(text: string): Omit<GeminiNotes, 'docUrls'>`, and `fetchNotes(exportDoc, event, patterns): Promise<GeminiNotes | null>` where `ExportDoc = (fileId: string) => Promise<string>`.

This is the only fragile parsing in the system, so it is isolated here and covered by a fixture. Attachment matching is case-insensitive substring (spec discovery 7) — exact-title matching silently loses events.

- [ ] **Step 1: Create the anonymized fixture**

Fictional content only — no real names, e-mails or discussion.

```text
# Observações

jul. 15, 2026

## Daily meeting

### Resumo

Equipe alinhou o corte da release e reduziu o escopo.

### Próximas etapas

  - [Ana Lima] Congelar a branch: Fechar a branch de release ate sexta.
  - [Bo Reis] Revisar os testes de carga antes do corte.

### Detalhes

  - **Escopo da release**: O escopo foi reduzido para dois itens.
  - **Riscos**: Dependencia externa ainda sem data confirmada.

Revise as anotações do Gemini para checar se estão corretas.
```

- [ ] **Step 2: Write the failing test**

```ts
// packages/core/tests/ingest/gemini-doc.test.ts
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  findNoteAttachments,
  extractFileId,
  parseGeminiDoc,
  fetchNotes,
} from '../../src/ingest/gemini-doc.js';
import type { NormalizedEvent } from '../../src/ingest/types.js';

const PATTERNS = ['anotações do gemini', 'notes by gemini'];
const fixture = readFileSync(join(__dirname, '../fixtures/gemini-notes-ptbr.txt'), 'utf8');

const event = {
  id: 'evt-1',
  attachments: [
    { title: 'Planilha de Acompanhamento', fileUrl: 'https://docs.example/spreadsheets/d/x/edit' },
    { title: 'Anotações do Gemini', fileUrl: 'https://docs.example/document/d/doc1/edit' },
  ],
} as unknown as NormalizedEvent;

describe('findNoteAttachments', () => {
  it('matches by case-insensitive substring, not exact title', () => {
    const e = {
      attachments: [
        { title: 'Sprint Review - 2025/07/01 16:27 GMT-03:00 - Anotações do Gemini', fileUrl: 'u1' },
      ],
    } as unknown as NormalizedEvent;
    expect(findNoteAttachments(e, PATTERNS)).toHaveLength(1);
  });

  it('matches the English variant', () => {
    const e = { attachments: [{ title: 'Notes by Gemini', fileUrl: 'u1' }] } as unknown as NormalizedEvent;
    expect(findNoteAttachments(e, PATTERNS)).toHaveLength(1);
  });

  it('ignores unrelated attachments', () => {
    expect(findNoteAttachments(event, PATTERNS)).toHaveLength(1);
  });

  it('returns every notes doc when an event carries several', () => {
    const e = {
      attachments: [
        { title: 'Anotações do Gemini', fileUrl: 'u1' },
        { title: 'Anotações do Gemini', fileUrl: 'u2' },
      ],
    } as unknown as NormalizedEvent;
    expect(findNoteAttachments(e, PATTERNS)).toHaveLength(2);
  });
});

describe('extractFileId', () => {
  it('pulls the id out of a Docs URL', () => {
    expect(extractFileId('https://docs.example/document/d/abc123/edit?usp=x')).toBe('abc123');
  });

  it('returns null for an unrecognized URL', () => {
    expect(extractFileId('https://example.com/nope')).toBeNull();
  });
});

describe('parseGeminiDoc', () => {
  it('extracts the summary', () => {
    expect(parseGeminiDoc(fixture).summary).toContain('Equipe alinhou o corte da release');
  });

  it('extracts next steps preserving the responsible marker', () => {
    const { nextSteps } = parseGeminiDoc(fixture);
    expect(nextSteps).toHaveLength(2);
    expect(nextSteps[0]).toMatch(/^\[Ana Lima\]/);
  });

  it('extracts detail bullets', () => {
    expect(parseGeminiDoc(fixture).details.length).toBeGreaterThanOrEqual(2);
  });

  it('returns empty sections for unparseable text without throwing', () => {
    const parsed = parseGeminiDoc('conteudo sem estrutura');
    expect(parsed.nextSteps).toEqual([]);
    expect(parsed.details).toEqual([]);
  });
});

describe('fetchNotes', () => {
  it('returns null when the event has no notes attachment', async () => {
    const e = { attachments: [] } as unknown as NormalizedEvent;
    expect(await fetchNotes(vi.fn(), e, PATTERNS)).toBeNull();
  });

  it('concatenates details from multiple docs and keeps every url', async () => {
    const e = {
      attachments: [
        { title: 'Anotações do Gemini', fileUrl: 'https://docs.example/document/d/d1/edit' },
        { title: 'Anotações do Gemini', fileUrl: 'https://docs.example/document/d/d2/edit' },
      ],
    } as unknown as NormalizedEvent;
    const exportDoc = vi.fn().mockResolvedValue(fixture);
    const notes = await fetchNotes(exportDoc, e, PATTERNS);
    expect(exportDoc).toHaveBeenCalledTimes(2);
    expect(notes?.docUrls).toHaveLength(2);
    expect(notes?.details.length).toBeGreaterThanOrEqual(4);
  });

  it('returns null when every export fails, so the caller writes a skeleton', async () => {
    const exportDoc = vi.fn().mockRejectedValue(new Error('403'));
    expect(await fetchNotes(exportDoc, event, PATTERNS)).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test --workspace=packages/core -- tests/ingest/gemini-doc.test.ts`
Expected: FAIL — cannot resolve `gemini-doc.js`

- [ ] **Step 4: Write the implementation**

```ts
// packages/core/src/ingest/gemini-doc.ts
import type { EventAttachment, GeminiNotes, NormalizedEvent } from './types.js';

export type ExportDoc = (fileId: string) => Promise<string>;

export function findNoteAttachments(
  event: NormalizedEvent,
  patterns: string[],
): EventAttachment[] {
  return (event.attachments ?? []).filter((a) => {
    const title = (a.title ?? '').toLowerCase();
    return patterns.some((p) => title.includes(p));
  });
}

export function extractFileId(fileUrl: string): string | null {
  return fileUrl.match(/\/d\/([a-zA-Z0-9_-]+)/)?.[1] ?? null;
}

function sectionLines(text: string, heading: RegExp): string[] {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => heading.test(l));
  if (start === -1) return [];
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,3}\s/.test(line)) break;
    const trimmed = line.trim();
    if (trimmed) out.push(trimmed);
  }
  return out;
}

function stripBullet(line: string): string {
  return line.replace(/^[-*]\s*/, '').replace(/\\\[/g, '[').replace(/\\\]/g, ']').trim();
}

export function parseGeminiDoc(text: string): Omit<GeminiNotes, 'docUrls'> {
  const summary = sectionLines(text, /^#{1,3}\s*\**Resumo\**/i).join(' ').trim();
  const nextSteps = sectionLines(text, /^#{1,3}\s*\**Pr[óo]ximas etapas\**/i)
    .filter((l) => /^[-*]/.test(l))
    .map(stripBullet);
  const details = sectionLines(text, /^#{1,3}\s*\**Detalhes\**/i)
    .filter((l) => /^[-*]/.test(l))
    .map(stripBullet);
  return { summary, nextSteps, details };
}

export async function fetchNotes(
  exportDoc: ExportDoc,
  event: NormalizedEvent,
  patterns: string[],
): Promise<GeminiNotes | null> {
  const attachments = findNoteAttachments(event, patterns);
  if (attachments.length === 0) return null;

  const merged: GeminiNotes = { summary: '', nextSteps: [], details: [], docUrls: [] };
  let anySucceeded = false;

  for (const attachment of attachments) {
    const fileId = extractFileId(attachment.fileUrl);
    if (!fileId) continue;
    try {
      const parsed = parseGeminiDoc(await exportDoc(fileId));
      anySucceeded = true;
      merged.docUrls.push(attachment.fileUrl);
      merged.summary = merged.summary
        ? `${merged.summary} ${parsed.summary}`.trim()
        : parsed.summary;
      merged.nextSteps.push(...parsed.nextSteps);
      merged.details.push(...parsed.details);
    } catch {
      // An inaccessible Doc means the capture account was not invited to that
      // series. Degrade to a skeleton note; the CLI summary reports it.
    }
  }

  return anySucceeded ? merged : null;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test --workspace=packages/core -- tests/ingest/gemini-doc.test.ts`
Expected: PASS (13 tests)

- [ ] **Step 6: Commit**

```bash
npx tsc --noEmit
git add packages/core/src/ingest/gemini-doc.ts packages/core/tests/ingest/gemini-doc.test.ts \
        packages/core/tests/fixtures/gemini-notes-ptbr.txt
git commit -m "feat(ingest): discover, export and parse Gemini notes docs"
```

---

### Task 6: Vault writer with idempotency

**Files:**
- Create: `packages/core/src/ingest/vault-writer.ts`
- Test: `packages/core/tests/ingest/vault-writer.test.ts`

**Interfaces:**
- Consumes: `NormalizedEvent`, `GeminiNotes`, `NoteDecision` from Task 1; `buildNoteFilename`, `buildNoteContent` from Task 2.
- Produces: `decideNote(readFile, event, notes, notesFolder): Promise<NoteDecision>` where `ReadFile = (path: string) => Promise<string | null>`, and `applyDecision(writeFile, decision): Promise<void>`.

Dedup key is `calendar_event_id`, read from the canonical path — deterministic and O(1). Text search is deliberately not used: it is `ILIKE` over chunked content and can return zero for an ID that exists.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/tests/ingest/vault-writer.test.ts
import { describe, it, expect, vi } from 'vitest';
import { decideNote, applyDecision } from '../../src/ingest/vault-writer.js';
import type { NormalizedEvent, GeminiNotes } from '../../src/ingest/types.js';

const event: NormalizedEvent = {
  id: 'evt-1',
  summary: 'Daily meeting',
  start: '2026-07-15T09:00:00-03:00',
  end: '2026-07-15T09:10:00-03:00',
  htmlLink: 'https://calendar.example/evt-1',
  organizerEmail: 'owner@example.com',
  calendarId: 'cal-a',
  calendarLabel: 'Alpha',
  attendees: [],
  attachments: [],
  attendance: 'observer',
};

const notes: GeminiNotes = { summary: 'ok', nextSteps: [], details: ['d'], docUrls: ['u'] };
const FOLDER = '7 - Meeting Notes';

describe('decideNote', () => {
  it('creates when no note exists at the canonical path', async () => {
    const read = vi.fn().mockResolvedValue(null);
    const d = await decideNote(read, event, notes, FOLDER);
    expect(d.action).toBe('create');
    expect(d.path).toBe('7 - Meeting Notes/2026-07-15 Daily meeting - Alpha.md');
  });

  it('skips when an enriched note for the same event already exists', async () => {
    const read = vi.fn().mockResolvedValue('Status: #child\n[calendar_event_id:: evt-1]\n');
    expect((await decideNote(read, event, notes, FOLDER)).action).toBe('skip');
  });

  it('complements a skeleton once Gemini notes arrive', async () => {
    const read = vi.fn().mockResolvedValue('Status: #baby\n[calendar_event_id:: evt-1]\n');
    const d = await decideNote(read, event, notes, FOLDER);
    expect(d.action).toBe('complement');
    if (d.action === 'complement') expect(d.content).toContain('Status: #child');
  });

  it('skips a skeleton when there are still no notes', async () => {
    const read = vi.fn().mockResolvedValue('Status: #baby\n[calendar_event_id:: evt-1]\n');
    expect((await decideNote(read, event, null, FOLDER)).action).toBe('skip');
  });

  it('disambiguates with a time suffix when a different event owns the path', async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce('Status: #child\n[calendar_event_id:: other]\n')
      .mockResolvedValueOnce(null);
    const d = await decideNote(read, event, notes, FOLDER);
    expect(d.action).toBe('create');
    expect(d.path).toContain('(09-00)');
  });
});

describe('applyDecision', () => {
  it('writes for create and complement', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    await applyDecision(write, { action: 'create', path: 'p', content: 'c' });
    expect(write).toHaveBeenCalledWith('p', 'c');
  });

  it('does not write for skip', async () => {
    const write = vi.fn();
    await applyDecision(write, { action: 'skip', path: 'p', reason: 'exists' });
    expect(write).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=packages/core -- tests/ingest/vault-writer.test.ts`
Expected: FAIL — cannot resolve `vault-writer.js`

- [ ] **Step 3: Write the implementation**

```ts
// packages/core/src/ingest/vault-writer.ts
import type { GeminiNotes, NormalizedEvent, NoteDecision } from './types.js';
import { buildNoteFilename, buildNoteContent } from './note-builder.js';

export type ReadFile = (path: string) => Promise<string | null>;
export type WriteFile = (path: string, content: string) => Promise<void>;

function eventIdOf(content: string): string | null {
  return content.match(/\[calendar_event_id::\s*([^\]]+)\]/)?.[1]?.trim() ?? null;
}

export async function decideNote(
  readFile: ReadFile,
  event: NormalizedEvent,
  notes: GeminiNotes | null,
  notesFolder: string,
): Promise<NoteDecision> {
  const filename = buildNoteFilename(event);
  let path = `${notesFolder}/${filename}`;
  let existing = await readFile(path);

  if (existing && eventIdOf(existing) !== event.id) {
    // Two different events canonicalize to the same filename; disambiguate by start time.
    const time = event.start.slice(11, 16).replace(':', '-');
    path = `${notesFolder}/${filename.replace(/\.md$/, ` (${time}).md`)}`;
    existing = await readFile(path);
  }

  if (!existing) {
    return { action: 'create', path, content: buildNoteContent(event, notes) };
  }

  const isSkeleton = existing.includes('Status: #baby');
  if (isSkeleton && notes) {
    return { action: 'complement', path, content: buildNoteContent(event, notes) };
  }
  return { action: 'skip', path, reason: isSkeleton ? 'skeleton, no notes yet' : 'already enriched' };
}

export async function applyDecision(writeFile: WriteFile, decision: NoteDecision): Promise<void> {
  if (decision.action === 'skip') return;
  await writeFile(decision.path, decision.content);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=packages/core -- tests/ingest/vault-writer.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit
git add packages/core/src/ingest/vault-writer.ts packages/core/tests/ingest/vault-writer.test.ts
git commit -m "feat(ingest): write vault notes idempotently by calendar event id"
```

---

### Task 7: CLI entrypoint wiring everything together

**Files:**
- Create: `packages/core/src/scripts/ingest-calendar.ts`
- Modify: `packages/core/package.json` (add `ingest-calendar` script and the two googleapis deps)
- Test: `packages/core/tests/ingest/cli-args.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–6.
- Produces: `parseArgs(argv: string[]): { from: string; to: string; dryRun: boolean }` (exported for testing) and the executable script.

Only argument parsing is unit-tested; the wiring is exercised by the `--dry-run` acceptance step.

- [ ] **Step 1: Add dependencies**

```bash
npm install @googleapis/calendar @googleapis/drive --workspace=packages/core
```

- [ ] **Step 2: Write the failing test**

```ts
// packages/core/tests/ingest/cli-args.test.ts
import { describe, it, expect } from 'vitest';
import { parseArgs } from '../../src/scripts/ingest-calendar.js';

describe('parseArgs', () => {
  it('reads an explicit window', () => {
    const a = parseArgs(['--from', '2025-06-01', '--to', '2026-08-07']);
    expect(a).toMatchObject({ from: '2025-06-01', to: '2026-08-07', dryRun: false });
  });

  it('honours --dry-run', () => {
    expect(parseArgs(['--from', '2026-01-01', '--to', '2026-01-02', '--dry-run']).dryRun).toBe(true);
  });

  it('expands --since into a window ending tomorrow', () => {
    const a = parseArgs(['--since', '2026-08-01']);
    expect(a.from).toBe('2026-08-01');
    expect(a.to > a.from).toBe(true);
  });

  it('rejects a window with no dates', () => {
    expect(() => parseArgs([])).toThrow(/--from|--since/);
  });

  it('rejects an inverted window', () => {
    expect(() => parseArgs(['--from', '2026-08-07', '--to', '2026-01-01'])).toThrow(/before/i);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test --workspace=packages/core -- tests/ingest/cli-args.test.ts`
Expected: FAIL — cannot resolve `ingest-calendar.js`

- [ ] **Step 4: Write the implementation**

```ts
// packages/core/src/scripts/ingest-calendar.ts
import { readFile as fsReadFile, writeFile as fsWriteFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { calendar as calendarApi } from '@googleapis/calendar';
import { drive as driveApi } from '@googleapis/drive';
import { loadIngestConfig } from '../ingest/config.js';
import { getAccessToken } from '../ingest/auth.js';
import { listEvents } from '../ingest/calendar-source.js';
import { fetchNotes } from '../ingest/gemini-doc.js';
import { decideNote, applyDecision } from '../ingest/vault-writer.js';

export function parseArgs(argv: string[]): { from: string; to: string; dryRun: boolean } {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };
  const dryRun = argv.includes('--dry-run');
  const since = get('--since');
  const from = get('--from') ?? since;
  if (!from) throw new Error('provide --from <YYYY-MM-DD> --to <YYYY-MM-DD>, or --since <YYYY-MM-DD>');

  let to = get('--to');
  if (!to) {
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    to = tomorrow.toISOString().slice(0, 10);
  }
  if (to <= from) throw new Error('--from must be before --to (the window is [from, to))');
  return { from, to, dryRun };
}

async function main(): Promise<void> {
  const { from, to, dryRun } = parseArgs(process.argv.slice(2));
  const configPath = join(homedir(), '.lox', 'config.json');
  const config = loadIngestConfig(JSON.parse(await fsReadFile(configPath, 'utf8')));

  const token = await getAccessToken(config.serviceAccount, config.impersonateSubject);
  const cal = calendarApi({ version: 'v3', headers: { Authorization: `Bearer ${token}` } });
  const drv = driveApi({ version: 'v3', headers: { Authorization: `Bearer ${token}` } });

  const fetchPage = async (calendarId: string, params: Record<string, string>) => {
    const res = await cal.events.list({ calendarId, ...params } as never);
    return { items: res.data.items ?? [], nextPageToken: res.data.nextPageToken ?? undefined };
  };
  const exportDoc = async (fileId: string): Promise<string> => {
    const res = await drv.files.export({ fileId, mimeType: 'text/plain' }, { responseType: 'text' });
    return String(res.data);
  };

  const readFile = async (rel: string): Promise<string | null> => {
    try {
      return await fsReadFile(join(config.vaultPath, rel), 'utf8');
    } catch {
      return null;
    }
  };
  const writeFile = async (rel: string, content: string): Promise<void> => {
    const abs = join(config.vaultPath, rel);
    await mkdir(dirname(abs), { recursive: true });
    await fsWriteFile(abs, content, 'utf8');
  };

  const tally = { created: 0, complemented: 0, skipped: 0 };
  const inaccessible: string[] = [];

  for (const calendar of config.calendars) {
    const events = await listEvents(fetchPage, calendar, from, to, config.impersonateSubject);
    for (const event of events) {
      const notes = await fetchNotes(exportDoc, event, config.noteAttachmentPatterns);
      if (!notes && event.attachments.length > 0) {
        inaccessible.push(`${event.start.slice(0, 10)} ${event.summary}`);
      }
      const decision = await decideNote(readFile, event, notes, config.notesFolder);
      if (!dryRun) await applyDecision(writeFile, decision);

      if (decision.action === 'create') tally.created += 1;
      else if (decision.action === 'complement') tally.complemented += 1;
      else tally.skipped += 1;

      console.log(`${dryRun ? '[dry-run] ' : ''}${decision.action.padEnd(11)} ${decision.path}`);
    }
  }

  console.log(
    `\nIngest complete ${from}..${to} — created ${tally.created}, ` +
      `complemented ${tally.complemented}, skipped ${tally.skipped}`,
  );
  if (inaccessible.length > 0) {
    console.log(
      `\n${inaccessible.length} event(s) had a notes attachment we could not read — ` +
        'the capture account is probably not invited to those series:',
    );
    for (const item of inaccessible) console.log(`  - ${item}`);
  }
}

// Only run when invoked directly, so tests can import parseArgs.
if (process.argv[1]?.endsWith('ingest-calendar.ts') || process.argv[1]?.endsWith('ingest-calendar.js')) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test --workspace=packages/core -- tests/ingest/cli-args.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 6: Register the npm scripts**

Add to `packages/core/package.json` `scripts`:

```json
"ingest-calendar": "tsx src/scripts/ingest-calendar.ts",
"ingest-calendar:prod": "node dist/scripts/ingest-calendar.js"
```

- [ ] **Step 7: Verify the whole suite and coverage**

```bash
npm run test --workspace=packages/core
npm run test:coverage --workspace=packages/core
```
Expected: all green, coverage ≥ 80%.

- [ ] **Step 8: Commit**

```bash
npx tsc --noEmit
git add packages/core/src/scripts/ingest-calendar.ts packages/core/tests/ingest/cli-args.test.ts \
        packages/core/package.json package-lock.json
git commit -m "feat(ingest): add ingest-calendar CLI with dry-run mode"
```

---

### Task 8: Public setup documentation

**Files:**
- Create: `docs/calendar-ingest.md`
- Modify: `README.md` (link the new doc from the features/docs list)

**Interfaces:**
- Consumes: the CLI and config from Tasks 1 and 7.
- Produces: no code.

This is the "document the mechanism, not the values" requirement. A reader from any organization must be able to reproduce the setup; nobody must be able to infer this deployment's internal team topology.

- [ ] **Step 1: Write the document**

`docs/calendar-ingest.md` must cover, using placeholders only:

1. **What it does** — reads ceremony events from configured calendars, pulls the Gemini notes Doc from Drive, writes Markdown notes into the vault. Works for both a daily window and a historical backfill.
2. **Why a capture account** — Gemini distributes notes to *invitees*, not calendar owners. A dedicated account is invited to the ceremony series so the pipeline can read them. Being invited is enough; attending is not required.
3. **Creating the service account** — `gcloud iam service-accounts create <sa-name>`; attach it to the VM; grant `roles/iam.serviceAccountTokenCreator` on itself so it can call `signJwt`. State explicitly that **no key is exported**.
4. **Enabling domain-wide delegation** — in the Admin Console, authorize the SA's client ID for exactly these two scopes:
   ```
   https://www.googleapis.com/auth/calendar.readonly
   https://www.googleapis.com/auth/drive.readonly
   ```
   With a security note: `gmail.readonly` is deliberately **not** requested; under DWD it would permit reading any mailbox in the domain, and this pipeline reads Docs, never e-mail. Also note plainly that DWD lets the SA impersonate any account within the granted scopes — the controls are the readonly scopes, the absence of Gmail, and audit logging.
5. **Configuring** — copy `packages/core/config.json.example` to `~/.lox/config.json` and fill it in; explain that `label` disambiguates ceremonies that share a title across teams and can be empty.
6. **Inviting the capture account** — invite it to the recurring *series*, not to individual occurrences. Recommend announcing to the teams first: the account shows up in the guest list and turning on automatic note-taking is visible to every participant.
7. **Running** — `--dry-run` first, then the real window; `--since` for the daily run.
8. **Troubleshooting** — the "notes attachment we could not read" list means the capture account is not invited to that series.

- [ ] **Step 2: Verify no identifiers leaked**

```bash
grep -nE '@[a-z0-9.-]+\.(com|br|org)|c_[a-z0-9]{15,}|meet\.google\.com/[a-z]{3}-' docs/calendar-ingest.md
```
Expected: no output (a `<placeholder>@<domain>` form produces none).

- [ ] **Step 3: Commit**

```bash
git add docs/calendar-ingest.md README.md
git commit -m "docs: add calendar ingest setup guide"
```

---

### Task 9: systemd timer for the daily run

**Files:**
- Create: `infra/systemd/lox-calendar-ingest.service`
- Create: `infra/systemd/lox-calendar-ingest.timer`
- Modify: `docs/calendar-ingest.md` (install instructions)

**Interfaces:**
- Consumes: the `ingest-calendar:prod` script from Task 7.
- Produces: no code.

Follows the existing unit conventions: `__LOX_VM_USER__` placeholder substituted at install time, explicit `America/Sao_Paulo` in `OnCalendar=`, `Persistent=true`.

- [ ] **Step 1: Write the service unit**

```ini
# infra/systemd/lox-calendar-ingest.service
[Unit]
Description=Lox calendar ingest (team ceremonies -> vault)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=__LOX_VM_USER__
WorkingDirectory=/home/__LOX_VM_USER__/lox-brain
ExecStartPre=/usr/bin/test -f /home/__LOX_VM_USER__/.lox/config.json
ExecStart=/usr/bin/npm run ingest-calendar:prod --workspace=packages/core -- --since yesterday
TimeoutStartSec=900
NoNewPrivileges=yes
ProtectSystem=strict
ReadWritePaths=/home/__LOX_VM_USER__/obsidian
```

Note: `--since yesterday` is not parsed by `parseArgs`, which expects `YYYY-MM-DD`. Resolve the date in the unit instead:

```ini
ExecStart=/bin/sh -c '/usr/bin/npm run ingest-calendar:prod --workspace=packages/core -- --since "$(date -d yesterday +%%F)"'
```

- [ ] **Step 2: Write the timer unit**

```ini
# infra/systemd/lox-calendar-ingest.timer
[Unit]
Description=Run Lox calendar ingest daily

[Timer]
OnCalendar=*-*-* 20:00:00 America/Sao_Paulo
Persistent=true

[Install]
WantedBy=timers.target
```

20:00 is chosen because Gemini summaries land after meetings end; an evening run catches the same day's ceremonies. The ingest is idempotent, so re-running is safe.

- [ ] **Step 3: Document the install and verify**

Append to `docs/calendar-ingest.md`:

```bash
sed "s/__LOX_VM_USER__/$USER/g" infra/systemd/lox-calendar-ingest.service \
  | sudo tee /etc/systemd/system/lox-calendar-ingest.service > /dev/null
sudo cp infra/systemd/lox-calendar-ingest.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now lox-calendar-ingest.timer
systemctl list-timers lox-calendar-ingest.timer
sudo systemctl start lox-calendar-ingest.service && journalctl -u lox-calendar-ingest -n 50
```

- [ ] **Step 4: Commit**

```bash
git add infra/systemd/lox-calendar-ingest.service infra/systemd/lox-calendar-ingest.timer docs/calendar-ingest.md
git commit -m "feat(infra): add systemd timer for daily calendar ingest"
```

---

### Task 10: Stop discarding declined events in the sync-calendar skill

**Files:**
- Modify: `skills/sync-calendar/SKILL.md`

**Interfaces:**
- Consumes: nothing.
- Produces: no code.

Independent of the ingest pipeline; requested for the personal vault so meetings the user did not attend still become notes.

- [ ] **Step 1: Replace the exclusion rules**

In the filtering step, remove "Skip declined events" and "Skip optional events without response". Replace with a rule that keeps them and records the status:

> **Record attendance instead of discarding.** Do not skip declined or unanswered events — they are still meetings that happened and may carry Gemini notes worth reading. Emit `[attendance:: <status>]` in the Dataview block, where `<status>` is `accepted`, `declined`, `tentative`, `none` (invited, never answered) or `observer` (not in the attendee list at all). This makes "what happened without me" a Dataview query.

Keep the genuine noise filters: `workingLocation`, `birthday`, and all-day events with no attendees.

- [ ] **Step 2: Add the field to the templates**

Add `[attendance:: <status>]` to the Dataview block of both the meeting template and the solo/personal template, right after `[calendar_source::]`.

- [ ] **Step 3: Remove the hardcoded identifiers from the versioned skill**

The versioned skill must contain no real addresses. In the Calendars section, replace any concrete address with placeholders and state that the calendar list is read from `~/.lox/config.json`.

Verify:

```bash
grep -nE '@[a-z0-9.-]+\.(com|br|org)' skills/sync-calendar/SKILL.md | grep -v 'gemini-notes@google.com'
```
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add skills/sync-calendar/SKILL.md
git commit -m "feat(skill): keep declined meetings and record attendance status"
```

---

### Task 11: Organizer fallback for the historical backfill

**Files:**
- Create: `packages/core/src/ingest/token-resolver.ts`
- Modify: `packages/core/src/scripts/ingest-calendar.ts` (use the resolver for Doc export)
- Test: `packages/core/tests/ingest/token-resolver.test.ts`

**Interfaces:**
- Consumes: `getAccessToken` from Task 3; `IngestConfig`, `NormalizedEvent` from Task 1.
- Produces: `createTokenResolver(config, mint): TokenResolver` where `MintToken = (subject: string) => Promise<string>` and `TokenResolver = { subjectsFor(event: NormalizedEvent): string[]; tokenFor(subject: string): Promise<string> }`.

The capture account is only invited from the rollout date onward, so historical Docs are unreadable as that subject. The organizer of each past ceremony *was* an invitee — impersonating them recovers the history. Organizers differ across series, so the subject is resolved per event, restricted to a configured allowlist. An organizer outside the allowlist is never impersonated: the event degrades to a skeleton note.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/tests/ingest/token-resolver.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createTokenResolver } from '../../src/ingest/token-resolver.js';
import type { IngestConfig, NormalizedEvent } from '../../src/ingest/types.js';

const config = {
  impersonateSubject: 'capture@example.com',
  organizerAllowlist: ['owner@example.com'],
} as IngestConfig;

const event = { organizerEmail: 'owner@example.com' } as NormalizedEvent;

describe('subjectsFor', () => {
  it('tries the capture account first', () => {
    const r = createTokenResolver(config, vi.fn());
    expect(r.subjectsFor(event)[0]).toBe('capture@example.com');
  });

  it('falls back to the organizer when allowlisted', () => {
    const r = createTokenResolver(config, vi.fn());
    expect(r.subjectsFor(event)).toEqual(['capture@example.com', 'owner@example.com']);
  });

  it('omits an organizer that is not allowlisted', () => {
    const r = createTokenResolver(config, vi.fn());
    const stranger = { organizerEmail: 'stranger@example.com' } as NormalizedEvent;
    expect(r.subjectsFor(stranger)).toEqual(['capture@example.com']);
  });

  it('does not duplicate when the organizer is the capture account', () => {
    const r = createTokenResolver(config, vi.fn());
    const self = { organizerEmail: 'capture@example.com' } as NormalizedEvent;
    expect(r.subjectsFor(self)).toEqual(['capture@example.com']);
  });
});

describe('tokenFor', () => {
  it('mints once per subject and caches', async () => {
    const mint = vi.fn().mockResolvedValue('tok');
    const r = createTokenResolver(config, mint);
    await r.tokenFor('capture@example.com');
    await r.tokenFor('capture@example.com');
    expect(mint).toHaveBeenCalledTimes(1);
  });

  it('mints separately for different subjects', async () => {
    const mint = vi.fn().mockResolvedValue('tok');
    const r = createTokenResolver(config, mint);
    await r.tokenFor('a@example.com');
    await r.tokenFor('b@example.com');
    expect(mint).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=packages/core -- tests/ingest/token-resolver.test.ts`
Expected: FAIL — cannot resolve `token-resolver.js`

- [ ] **Step 3: Write the implementation**

```ts
// packages/core/src/ingest/token-resolver.ts
import type { IngestConfig, NormalizedEvent } from './types.js';

export type MintToken = (subject: string) => Promise<string>;

export interface TokenResolver {
  subjectsFor(event: NormalizedEvent): string[];
  tokenFor(subject: string): Promise<string>;
}

export function createTokenResolver(config: IngestConfig, mint: MintToken): TokenResolver {
  const cache = new Map<string, Promise<string>>();
  const allowlist = new Set(config.organizerAllowlist.map((e) => e.toLowerCase()));

  return {
    subjectsFor(event: NormalizedEvent): string[] {
      const subjects = [config.impersonateSubject];
      const organizer = (event.organizerEmail ?? '').toLowerCase();
      if (
        organizer &&
        organizer !== config.impersonateSubject.toLowerCase() &&
        allowlist.has(organizer)
      ) {
        subjects.push(event.organizerEmail);
      }
      return subjects;
    },

    tokenFor(subject: string): Promise<string> {
      let pending = cache.get(subject);
      if (!pending) {
        pending = mint(subject);
        cache.set(subject, pending);
      }
      return pending;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=packages/core -- tests/ingest/token-resolver.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Wire it into the CLI**

In `packages/core/src/scripts/ingest-calendar.ts`, replace the single-token Drive client with a per-subject export that walks the resolver's subjects in order. Replace the `exportDoc` definition and the `fetchNotes` call site:

```ts
import { createTokenResolver } from '../ingest/token-resolver.js';

const resolver = createTokenResolver(config, (subject) =>
  getAccessToken(config.serviceAccount, subject),
);

const exportDocAs = (subject: string) => async (fileId: string): Promise<string> => {
  const token = await resolver.tokenFor(subject);
  const client = driveApi({ version: 'v3', headers: { Authorization: `Bearer ${token}` } });
  const res = await client.files.export({ fileId, mimeType: 'text/plain' }, { responseType: 'text' });
  return String(res.data);
};

// Replaces the previous single `fetchNotes(exportDoc, ...)` call:
let notes = null;
for (const subject of resolver.subjectsFor(event)) {
  notes = await fetchNotes(exportDocAs(subject), event, config.noteAttachmentPatterns);
  if (notes) break;
}
```

The Calendar client keeps using the capture account, which is enough — calendar read access comes from the calendar's own sharing, not from meeting attendance.

- [ ] **Step 6: Verify the suite still passes**

```bash
npm run test --workspace=packages/core
npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/ingest/token-resolver.ts packages/core/tests/ingest/token-resolver.test.ts \
        packages/core/src/scripts/ingest-calendar.ts
git commit -m "feat(ingest): fall back to event organizer for historical backfill"
```

---

## Acceptance

Before opening the PR:

- [ ] `npm run test --workspace=packages/core` — all green
- [ ] `npm run test:coverage --workspace=packages/core` — ≥ 80%
- [ ] `npx tsc --noEmit` — clean
- [ ] `npm audit` — no new advisories from the three added dependencies
- [ ] `git grep -nE '@[a-z0-9.-]+\.(com|br|org)|c_[a-z0-9]{15,}' -- ':!*.lock' | grep -v 'gemini-notes@google.com'` — no organization identifiers anywhere in the tree
- [ ] `npm run ingest-calendar -- --from <recent> --to <recent+3d> --dry-run` — output matches the calendar
- [ ] Version bump in root + `packages/*` `package.json`, and a CHANGELOG entry (project convention; docs-only commits are exempt but this PR ships code)

## Rollout order

The code can be built before any calendar change. Ship in this order:

1. Tasks 1–10 merged, with the dry-run acceptance passing against a window that already has accessible notes.
2. Announce to the teams.
3. Enable automatic note-taking and invite the capture account on **one** series; wait for the next occurrence.
4. Verify with `--dry-run` over that date; if the notes come through, expand to the remaining series.
5. Run the backfill: `--from 2025-06-01 --to <today>`. Expect 70–85 events. Re-run once to confirm the second pass reports only skips.
6. Enable the timer.
