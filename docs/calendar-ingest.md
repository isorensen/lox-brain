# Calendar Ingest

Reads ceremony events from one or more configured Google Calendars, pulls the
Gemini meeting-notes Doc attached to each event from Drive, and writes (or
updates) a Markdown note per meeting into the vault. It runs in two modes:
a daily incremental window (`--since <date>`) and a historical backfill
(`--from <date> --to <date>`).

This document covers the one-time setup: creating a dedicated Google Workspace
service account, granting it domain-wide delegation with two read-only
scopes, and configuring the pipeline to point at your calendars and vault.
Every identifier below — account names, project IDs, calendar IDs, team
labels — is a placeholder. Substitute your own.

## Why a capture account

Gemini distributes meeting notes to the people **invited** to a meeting, not
to the owner of the calendar the meeting lives on. Owning or having full
access to a calendar does not grant access to the notes of a meeting you
were not invited to — Gemini notes are gated by invitee list, not calendar
ACL.

The pipeline therefore needs a dedicated Google account that is itself
invited to the recurring ceremony series it should capture. Being on the
guest list is sufficient: the account does not need to attend, and even a
declined invitation still receives the notes Doc once one is generated.

This account is referred to below as the **capture account**
(`<capture-account>@<domain>`).

## Creating the service account

Enable three APIs on the project. The pipeline calls
`iamcredentials.googleapis.com/...:signJwt` to mint its own delegated JWTs, then
reads events and exports Docs through the Calendar and Drive APIs. On a project
where any of them was never enabled, the corresponding call fails with
`SERVICE_DISABLED` (403) — and because impersonation succeeds first, the failure
surfaces only when the pipeline reaches that API, which is easy to misread as a
permissions problem:

```bash
gcloud services enable \
  iamcredentials.googleapis.com \
  calendar-json.googleapis.com \
  drive.googleapis.com \
  --project=<project>
```

Note that enabling an API can take a minute or two to propagate; a call made
immediately afterwards may still return `SERVICE_DISABLED`.

Create a dedicated service account rather than reusing an existing one:

```bash
gcloud iam service-accounts create <sa-name> \
  --project=<project> \
  --display-name="Calendar ingest"
```

Attach it to the VM the ingest job runs on (as the VM's attached service
account, or via a workload identity binding — whichever pattern the rest of
your infrastructure uses). No key file is created or exported at any point
in this setup.

Grant the service account `roles/iam.serviceAccountTokenCreator` on
**itself**, so it can call the IAM Credentials `signJwt` API to mint its own
short-lived, domain-wide-delegated JWTs:

```bash
gcloud iam service-accounts add-iam-policy-binding \
  <sa-name>@<project>.iam.gserviceaccount.com \
  --member="serviceAccount:<sa-name>@<project>.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountTokenCreator"
```

## Enabling domain-wide delegation

In the Google Workspace Admin Console (Security -> API Controls -> Domain-wide
Delegation), authorize the service account's **client ID** for exactly these
two scopes:

```
https://www.googleapis.com/auth/calendar.readonly
https://www.googleapis.com/auth/drive.readonly
```

Both scopes are read-only, and there are only two of them. Notably,
`gmail.readonly` is **not** requested, on purpose: the pipeline reads Google
Docs (the Gemini notes attachment), never e-mail, and under domain-wide
delegation `gmail.readonly` would let the service account read any mailbox
in the domain. There is no reason to grant a capability the pipeline does
not use.

**Domain-wide delegation is a broad capability and you should treat it as
one.** Once authorized, the service account can impersonate *any* account
in the domain, within the granted scopes — it is not restricted to the
capture account. The controls that keep this safe are the narrow, read-only
scope list, the deliberate absence of Gmail access, and audit logging on
the Workspace side. Review the Admin Console's audit log periodically for
this client ID.

## Auth flow (for reference — no action needed)

The pipeline never exports or stores a service-account key. At runtime it:

1. Uses the VM's attached identity (via `GoogleAuth`, no explicit
   credentials) to call `iamcredentials.signJwt` and sign a JWT asserting
   `iss`/`sub` = the service account, impersonating the capture account as
   `sub`.
2. Exchanges that signed JWT for a short-lived (1-hour) OAuth access token
   at Google's token endpoint.
3. Uses that access token for the Calendar and Drive API calls.

**Operational warning:** `GoogleAuth()` with no explicit key resolves
credentials through the standard Application Default Credentials chain —
first `GOOGLE_APPLICATION_CREDENTIALS`, then the local gcloud ADC file, then
the VM metadata server. If `GOOGLE_APPLICATION_CREDENTIALS` happens to be
set in the environment the ingest job runs in, it will silently redirect
this keyless flow to whatever key file that variable points at, defeating
the point of the keyless design. Before running the pipeline in production,
confirm the variable is **unset** on the VM:

```bash
echo "${GOOGLE_APPLICATION_CREDENTIALS:-<unset>}"
```

## Configuring

Copy the example config and fill it in:

```bash
cp packages/core/config.json.example ~/.lox/config.json
```

```json
{
  "calendar_ingest": {
    "impersonate_subject": "<capture-account>@<domain>",
    "service_account": "<sa-name>@<project>.iam.gserviceaccount.com",
    "notes_folder": "7 - Meeting Notes",
    "vault_path": "/home/<user>/obsidian",
    "organizer_allowlist": ["<organizer>@<domain>"],
    "note_attachment_patterns": [
      "anotações do gemini",
      "anotacoes do gemini",
      "notes by gemini"
    ],
    "calendars": [
      { "id": "<calendar-id>", "label": "<squad-label>" },
      { "id": "<calendar-id>", "label": "" }
    ]
  }
}
```

Field notes:

- `impersonate_subject` — the capture account's e-mail. This is who the
  service account impersonates via domain-wide delegation.
- `service_account` — the service account created above.
- `notes_folder` — vault-relative folder new meeting notes are written to.
- `vault_path` — absolute path to the vault on the machine running the job.
  **If you run this under the systemd unit below, this value must match the
  unit's `ReadWritePaths` exactly.** The loader does not validate or cross-check
  it against the unit file — nothing will warn you if they diverge. The unit
  runs with `ProtectSystem=strict`, which makes the entire filesystem
  read-only except the paths listed in `ReadWritePaths`, so if `vault_path`
  points anywhere else, every note write fails. When you install the unit
  (see "Running as a systemd timer" below), edit its `ReadWritePaths` line to
  match your `vault_path`, not the other way around.
- `organizer_allowlist` — a security boundary, not a convenience list. By
  default the pipeline only ever impersonates `impersonate_subject` (the
  capture account). When the capture account cannot read an event's notes, it
  falls back to two other identities the event carries, in this order: the
  event's **creator**, then its **organizer**. Neither field is something you
  fully control — anyone who can put an event on a watched calendar sets both
  — so each is used **only** when that exact e-mail is listed here. An address
  not on the list is never impersonated, and if no allowlisted identity can
  read the notes either, the event degrades to a skeleton note (see
  Troubleshooting).

  Both identities are tried because they are not interchangeable. On a
  personal calendar they are the same person. On a **shared team calendar**,
  which is what most ceremony calendars are, they are not: `organizer` holds
  the calendar's own address — a `...@group.calendar.google.com` identity that
  belongs to no one and can read nothing — and the human who scheduled the
  ceremony appears only as the `creator`. Allowlisting the organizer alone
  would therefore never help on exactly the calendars that need it.

  Add an address here only when a ceremony's notes genuinely require it —
  most setups can leave this empty.
- `note_attachment_patterns` — lowercase substrings matched against
  attachment titles to identify the Gemini notes Doc (locale-dependent;
  add your organization's variant if it differs).
- `calendars` — one entry per calendar to ingest. `label` disambiguates
  ceremonies that share the same title across different teams (e.g. two
  teams both running a "Planning" or "Retro" series) and is folded into the
  generated note's filename. It may be left empty when a calendar's
  ceremony titles are already unique.

Never commit the filled-in `~/.lox/config.json` — it is outside the repo by
design (`~/.lox/`), but treat it as containing sensitive configuration.

## Inviting the capture account

Invite `<capture-account>@<domain>` to each recurring ceremony **series**
you want captured — not to individual occurrences. Inviting a single
occurrence only grants access to that one event's notes.

Before inviting the account to a team's series, **tell the team first.**
The capture account will appear in the meeting's guest list like any other
invitee, and turning on Gemini's automatic note-taking is visible to every
participant in the meeting. Treat this as a heads-up, not a silent change.

## Running

Dry-run first, against a small window, to confirm calendars and credentials
resolve correctly without writing anything:

```bash
npm run ingest-calendar --workspace=packages/core -- --from 2026-08-01 --to 2026-08-02 --dry-run
```

Then run for real:

```bash
npm run ingest-calendar --workspace=packages/core -- --from 2026-08-01 --to 2026-08-02
```

For the daily incremental job, use `--since` instead of `--from`/`--to`; it
defaults the window's end to tomorrow (UTC):

```bash
npm run ingest-calendar --workspace=packages/core -- --since 2026-08-06
```

The production build runs the compiled script instead of `tsx`:

```bash
npm run ingest-calendar:prod --workspace=packages/core -- --since 2026-08-06
```

Each run prints one line per event (`created` / `complemented` / `skipped`
and the note path) and a summary count at the end.

For a historical backfill, add `--only-with-notes` so an event with no
Gemini notes produces no note file at all, instead of a skeleton:

```bash
npm run ingest-calendar --workspace=packages/core -- --from 2025-06-01 --to 2026-08-01 --only-with-notes
```

Skeletons make sense for the daily run — a meeting that just happened may
get its Gemini notes hours later, and the skeleton is complemented once
they arrive. In a backfill over meetings from months ago, a note-less event
will never gain notes, so the skeleton is permanent noise; the flag counts
those events instead of writing them. Leave the flag off for the daily
incremental job.

### Keep a backfill under an hour

The access token is minted once at startup and is valid for one hour; the
pipeline does not refresh it and does not retry. A run still going after that
hour gets a 401 on every remaining Calendar and Drive call, and — because an
unreadable Doc degrades to a skeleton rather than aborting — it would quietly
write `#baby` notes for its entire second half.

A few hundred events finish well inside the hour, so this only matters for a
large historical backfill. Split one into several `--from`/`--to` windows and
run them one at a time. If a window does overrun, the events it damaged are
listed in the "could not read" summary and re-running that window repairs
them (untouched skeletons are complemented, not duplicated).

## Troubleshooting

If the end-of-run summary lists events under **"had a notes attachment we
could not read"**, each entry ends with the error that caused it, and the
error tells you which of two very different problems you have:

- A **permission error** (`403 caller does not have permission`, `404`) means
  the impersonated account is not on that ceremony's guest list. Invite the
  capture account to the series and re-run; already-processed events are safe
  to re-ingest, since existing notes are complemented rather than duplicated.
  If the series predates the capture account and you cannot retroactively be
  invited, add the person who scheduled it (the event's creator) to
  `organizer_allowlist` instead.
- An **auth error** (`unauthorized_client`, `invalid_grant`, `SERVICE_DISABLED`)
  means the delegation setup itself is wrong, and it will affect every event,
  not just those series. Recheck the two scopes authorized against the service
  account's client ID in the Admin Console, that `impersonate_subject` is a real
  Workspace user in the domain, and that the IAM Credentials API is enabled.

A re-run only complements a note the pipeline itself wrote and nobody has
edited since. Once you type your own text into a `#baby` note, the pipeline
stops touching it — that note is reported as `skipped` with the reason
`skeleton was edited by hand`, and its Gemini notes will never be filled in
automatically. Fetch the Doc yourself in that case.

If a series produces no note at all and doesn't show up in that list
either, check the event has a Gemini notes attachment whose title matches
one of `note_attachment_patterns` — Gemini's default attachment title is
locale-dependent.

If the run fails on the **first note it tries to write**, with a permission
or read-only-filesystem error — even though `vault_path` looks correct and
the directory is writable when you `touch` a file there by hand — suspect a
mismatch between `vault_path` in the config and `ReadWritePaths` in the
systemd unit. `ProtectSystem=strict` makes everything outside
`ReadWritePaths` read-only from the unit's perspective regardless of the
directory's real permissions, so a manual write test as your own user will
succeed while the unit's write still fails. Check
`systemctl cat lox-calendar-ingest.service` and confirm `ReadWritePaths`
matches `vault_path` byte for byte.

## Running as a systemd timer

Install the daily incremental job as a systemd service + timer on the VM:

The unit runs the compiled entrypoint directly, so build first — the unit
refuses to start when `packages/core/dist/scripts/ingest-calendar.js` is
missing:

```bash
npm run build --workspace=packages/shared
npm run build --workspace=packages/core
```

```bash
sed "s/__LOX_VM_USER__/$USER/g" infra/systemd/lox-calendar-ingest.service \
  | sudo tee /etc/systemd/system/lox-calendar-ingest.service > /dev/null
sudo cp infra/systemd/lox-calendar-ingest.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now lox-calendar-ingest.timer
systemctl list-timers lox-calendar-ingest.timer
sudo systemctl start lox-calendar-ingest.service && journalctl -u lox-calendar-ingest -n 50
```

The timer fires daily at 20:00 America/Sao_Paulo — evening, so that day's
Gemini summaries (which land after meetings end) are already available for
the ingest to pick up. The ingest is idempotent, so a timer misfire or a
manual re-run from `systemctl start` never duplicates notes; already-ingested
events are complemented, not re-created.
