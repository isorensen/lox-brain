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
