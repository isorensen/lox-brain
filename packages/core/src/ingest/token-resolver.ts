import type { IngestConfig, NormalizedEvent } from './types.js';

export type MintToken = (subject: string) => Promise<string>;

export interface TokenResolver {
  subjectsFor(event: NormalizedEvent): string[];
  tokenFor(subject: string): Promise<string>;
}

/**
 * Domain-wide delegation can impersonate anyone in the domain, so the organizer
 * is only used as a fallback subject when the allowlist names it. An event's
 * `organizer` field is attacker-influenceable on a shared calendar.
 */
export function createTokenResolver(config: IngestConfig, mint: MintToken): TokenResolver {
  const cache = new Map<string, Promise<string>>();
  const allowlist = new Set(config.organizerAllowlist.map((e) => e.toLowerCase()));

  return {
    subjectsFor(event: NormalizedEvent): string[] {
      const subjects = [config.impersonateSubject];
      const organizer = event.organizerEmail.toLowerCase();
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
