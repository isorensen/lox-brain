---
name: sync-calendar
description: Sync Google Calendar events to Obsidian meeting notes via the Lox MCP Server, with optional Gemini AI meeting summary integration via Gmail
---

# Sync Calendar — Google Calendar to Obsidian via Lox

Syncs Google Calendar events to Obsidian meeting notes, including Gemini AI meeting summaries when available. Uses three MCP servers: Google Calendar, Gmail, and Lox MCP Server.

## Prerequisites

- **Google Calendar MCP** — connected via Claude.ai OAuth (provides `gcal_list_events`)
- **Gmail MCP** — connected via Claude.ai OAuth (provides `gmail_search_messages`, `gmail_read_message`) — optional, needed only for Gemini meeting summaries
- **Lox MCP Server** — running and accessible (provides `write_note`, `search_text`, `read_note`)

If any required MCP server is unavailable, stop and tell the user which one is missing.

## Configuration

This skill reads calendar sync settings from `~/.lox/config.json`:

```json
{
  "sync_calendar": {
    "calendars": [
      { "id": "primary", "label": "Work" },
      { "id": "user@company.com", "label": "Secondary" }
    ],
    "timezone": "America/Sao_Paulo"
  }
}
```

If `sync_calendar` is not configured, the skill prompts the user for setup on first run.

- **`calendars`** — list of Google Calendar IDs to sync. The `id` is passed directly to `gcal_list_events`; the `label` is used in notes and the summary output.
- **`timezone`** — IANA timezone string. Defaults to the user's system timezone if omitted.

Folder mapping by preset:

| Preset | Meeting notes folder |
|--------|---------------------|
| zettelkasten | `7 - Meeting Notes/` |
| para | `2 - Projects/Meetings/` |

## Arguments

The skill receives an optional date or date range as argument:

- No argument -> today's date
- Single date -> that day (e.g., `2026-03-11`)
- Date range -> inclusive range (e.g., `2026-03-10 2026-03-12` or `2026-03-10..2026-03-12`)

Parse flexibly: accept `YYYY-MM-DD`, `DD/MM/YYYY`, `today`, `yesterday`, `last monday`, etc.

## Workflow

### Step 1: Fetch Events

Read `~/.lox/config.json` to get the `sync_calendar.calendars` list and `timezone`. For each date in the range, call `gcal_list_events` **once per calendar**. Since the calls are independent, run them **in parallel**:

```
gcal_list_events(
  calendarId: "<calendar_id>",
  timeMin: "YYYY-MM-DDT00:00:00",
  timeMax: "YYYY-MM-DDT23:59:59",
  timeZone: "<configured timezone>",
  condenseEventDetails: false   // CRITICAL: need attendees + attachments
)
```

After fetching, **merge** all results into a single list sorted by start time. Tag each event with its calendar label so it can be used in notes and the summary.

**Deduplication across calendars:** When the same event appears in multiple calendars (same `id` prefix before the underscore, OR same summary + same start time + overlapping attendees), keep only one copy. Prefer the version from the first calendar in the config list (primary).

For multi-day ranges, make a single call per calendar spanning the full range (not one call per day per calendar).

**Chunking for large ranges (> 7 days):** The Calendar API with `condenseEventDetails: false` returns very large payloads. For ranges longer than 7 days, split into weekly chunks and process each week sequentially. Present a week-by-week summary to the user and process one week at a time.

**Token overflow handling:** When API results exceed the MCP tool output limit (~100KB), the result is saved to a temporary file. Use **Python** (not jq — zsh escapes break jq filters) to extract only needed fields (`id`, `summary`, `start`, `end`, `htmlLink`, `organizer`, `attendees[:15]`, `attachments`, `selfStatus`, `isSolo`) and save to `/tmp/weekN_filtered.json`.

### Step 2: Filter Events

Remove events that should not become notes:

1. **Skip `workingLocation` events** — these are "working from home/office" status entries, not real meetings
2. **Skip declined events** — where `myResponseStatus === "declined"`
3. **Skip optional events without response** — where `myResponseStatus === "needsAction"` AND the user is marked `optional: true`
4. **Skip all-day events without attendees** — typically holidays, OOO markers, reminders
5. **Skip `birthday` events** — contact birthday reminders from Google Contacts (`eventType === "birthday"`)

**Do NOT skip solo events (no attendees, not all-day).** Personal appointments are valid notes. Tag them appropriately (e.g., `[[personal]]`, `[[health]]`, `[[fitness]]`).

**Detect duplicates:** When two events overlap in time and have similar summaries, flag them and recommend a single merged note.

Present the filtered list to the user before proceeding. Show: time, title, attendee count, calendar label, and whether Gemini notes exist. List skipped events with reasons. Wait for user confirmation before creating any notes.

**Bulk confirmation for large ranges:** For ranges > 7 days, after the first week's confirmation, ask if they want to approve remaining weeks in bulk or review week by week.

### Step 3: Check for Gemini Notes

**Only search Gmail for events that have a Gemini attachment.** Check the `attachments` array for items with title containing specifically "Anotacoes do Gemini" (or "Gemini notes" in English, depending on Google account language). **Warning:** Other attachments like "Notes -- Weekly Meeting" or "Meeting notes" are Google Docs collaborative notes, NOT Gemini AI summaries — do not search Gmail for these.

For events WITH the Gemini attachment, search Gmail:

```
gmail_search_messages(
  q: "from:gemini-notes@google.com subject:\"<event summary>\"",
  maxResults: 3
)
```

Then read the most recent matching email:

```
gmail_read_message(messageId: "<id from search>")
```

**For recurring events:** Add a date filter to get the correct occurrence:

```
gmail_search_messages(
  q: "from:gemini-notes@google.com subject:\"<event summary>\" after:YYYY/MM/DD before:YYYY/MM/DD",
  maxResults: 3
)
```

**Skip Gmail for future events:** Do not search Gmail for events after today's date.

**Fallback strategy:** If Gmail search returns no results, try broadening (remove date filter, search by partial subject). If still nothing, proceed without Gemini notes and include a callout prompting manual entry.

**Parallelization:** Launch all Gmail searches and vault duplicate checks in parallel.

### Step 4: Check for Existing Notes

Start with a single broad search to find all existing calendar-imported notes:

```
obsidian search_text(query: "calendar_event_id", limit: 50)
```

This returns all notes that have a `calendar_event_id` field. Match events by ID or title locally in-memory. Only fall back to individual per-event searches if the broad search returns 50+ results.

**Cross-calendar dedup:** The existing-note check applies regardless of which calendar the current event comes from. The `calendar_event_id` prefix match (before the underscore) is the primary dedup key; title + time overlap is the fallback.

**If a note exists:**
1. Read the existing note with `read_note`
2. Classify the note's state:
   - **Enriched** (status `#child` or `#adult`, or has manually-written content beyond the template) -> recommend **skip**
   - **Skeleton** (status `#baby`, only template structure) -> recommend **complement** if new Gemini data is available (promote to `#child`), otherwise **skip**
   - **Outdated** (has Gemini content but event was updated since) -> recommend **update**
3. Show the user a summary table with recommendations
4. Ask for confirmation — never overwrite without explicit approval

**If no note exists:** proceed to create it.

**All notes already exist?** If every event already has a note and none need updating, show the summary and finish.

### Step 5: Create Meeting Note

#### Batch creation with subagents

For ranges with many events (>5), delegate note creation to subagents in batches of 5-8 events. Each subagent receives the filtered event JSON, Gemini notes content, and the note template. Use `mode: auto` and `model: sonnet` for efficiency.

#### File path

Use the meeting notes folder from the configured preset (default: `7 - Meeting Notes/`):

```
<meeting_notes_folder>/YYYY-MM-DD <Title>.md
```

Where `<Title>` is the event summary, cleaned and enriched:
- Replace `|`, `/`, `\`, `:`, `*`, `?`, `"`, `<`, `>` with ` - ` or remove them
- Keep accents and non-ASCII characters
- Spaces are fine (Obsidian handles them)
- **Enrich generic titles:** If the summary is vague (e.g., "1-1", "Sync", "Quick chat"), append the other participant's name (for 1-1s) or the organizer's name
- Trim trailing whitespace from summaries
- **Filename collision handling:** When multiple events on the same day have identical titles, disambiguate with a time suffix: `2026-03-04 Topic (morning).md` and `2026-03-04 Topic (afternoon).md`

#### Note format

The vault uses **plain text + Dataview inline fields**, NOT YAML frontmatter. Never pass the `tags` parameter to `write_note` (it generates YAML frontmatter).

**Status field:** Use `#child` when Gemini notes are available. Use `#baby` when no Gemini notes (skeleton only). Solo/personal events always get `#baby`.

```markdown
YYYY-MM-DD HH:MM

Status: #child (if Gemini notes available) or #baby (if no Gemini notes)

Tags: [[meeting]] [[calendar-label-tag]] [[meeting-type-tag]] [[gemini-notes]]

[source:: google-calendar]
[imported:: YYYY-MM-DD]
[calendar_event_id:: <event id>]
[calendar_source:: <calendar label>]

# <emoji> YYYY-MM-DD <emoji> HH:MM

## <emoji> Meeting: <Event Title>

### Related companies:

- [[Company1]]
- [[Company2]]

### <emoji> Attendees:

- [[Name1]] (organizer) <status>
- [[Name2]] <status>

---

### <emoji> Topics Discussed:

<If Gemini notes available: structured summary with numbered topics>
<If no Gemini notes: callout below>

> [!NOTE] No automatic notes
> This event does not have Gemini notes. Add your notes manually below.

---

### <emoji> Actions and Next Steps:

<If Gemini notes have action items: checklist with responsible and due>

- [ ] Action description
  [responsible:: Person Name]
  [due:: ]

---

### <emoji> References and Attachments:

- [Google Calendar Event](<calendar event link>)
- [Gemini Notes (Google Doc)](<doc link if available>)

## Key Topics

> [!NOTE] Guidance
> After the meeting, identify the most important topics and insights. Each should become a separate Atomic Note, linked back to this one.

- [[Key topic 1]]
- [[Key topic 2]]
```

#### Personal/solo event format

For events without attendees, use a simplified template — no Attendees, no Companies, no Actions:

```markdown
YYYY-MM-DD HH:MM

Status: #baby

Tags: [[personal]] [[relevant-tag]]

[source:: google-calendar]
[imported:: YYYY-MM-DD]
[calendar_event_id:: <event id>]
[calendar_source:: <calendar label>]

# <emoji> YYYY-MM-DD <emoji> HH:MM — <Event Title>

<description if available, or location>

---

### <emoji> References and Attachments:

- [Google Calendar Event](<calendar event link>)
```

Tag personal events contextually: `[[health]]` for medical, `[[fitness]]` for gym, `[[personal]]` as default.

#### Emoji usage

Use the same emojis as the existing vault template:
- Title line: calendar date, clock time
- Meeting section: memo
- Attendees: people
- Topics: pushpin
- Actions: checkmark
- References: folder

#### Attendee status mapping

Map `responseStatus` from the Calendar API:
- `accepted` -> checkmark
- `declined` -> cross
- `tentative` -> question
- `needsAction` -> hourglass

Mark the organizer with `(organizer)`.

**Attendee truncation:** For events with more than 15 attendees, list only the first 15 (prioritizing the organizer and accepted attendees) and add a note: `... and X more attendees`.

#### People wikilinks

Every attendee name in the Attendees section is wrapped in `[[wikilinks]]`. This connects meeting notes to people notes in the vault's Graph View.

**Name resolution:** Use the attendee's display name from the Calendar API. If only an email is available, derive the name from the email prefix (e.g., `carlos.gomes@company.com` -> `Carlos Gomes`). Capitalize properly, remove email suffixes.

**No automatic people note creation.** The skill only creates the wikilink — the user can click stubs later.

**Self-exclusion:** Do NOT create a wikilink for the user's own name (`self: true` attendee). List them as plain text.

#### Tags

Always include `[[meeting]]`. Add contextual tags based on:
- Calendar label from config -> `[[calendar-label]]` (lowercase, hyphenated)
- Company names from attendees' email domains or event description -> `[[company-name]]`
- If Gemini notes present -> `[[gemini-notes]]`
- Meeting type if identifiable: `[[1-1]]`, `[[sprint]]`, `[[standup]]`, `[[review]]`, etc.

#### Gemini summary formatting

When Gemini notes are available, structure the "Topics Discussed" section as:

```markdown
**Summary (Gemini):** <one-line overall summary>

1. **<Topic Title>**
   <Topic details as paragraph>

2. **<Topic Title>**
   <Topic details as paragraph>
```

Extract action items into the "Actions and Next Steps" section as checkboxes with `[responsible::]` and `[due::]` Dataview fields.

#### Key Topics section

If Gemini notes are available, suggest 2-4 key topics as wikilinks based on the main themes discussed. If no Gemini notes, leave placeholder wikilinks.

### Step 6: Summary

After processing all events, show a summary:

Show: created notes (with calendar label and Gemini notes indicator), skipped (already existed), skipped (user choice), and deduplicated events.

## Edge Cases

- **Recurring events:** Each occurrence gets its own note (date in filename differentiates them)
- **Events spanning midnight:** Use the start date for the filename
- **Multiple Gemini emails for same event:** Use the most recent one
- **Event title with date already:** Don't duplicate the date prefix
- **Same-day duplicate titles:** Append time-of-day suffix (morning/afternoon) or time (HH:MM) to the filename
- **Token overflow on Calendar API:** Process the saved file with Python to extract structured event data (see Step 1)

## What This Skill Does NOT Do

- Does not create MOC files in tag folders (that's obsidian-ingest's job)
- Does not process past events automatically — always requires user invocation
- Does not modify events in Google Calendar
- Does not send emails or calendar responses
