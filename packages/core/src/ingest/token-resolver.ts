import type { IngestConfig, NormalizedEvent } from './types.js';

export type MintToken = (subject: string) => Promise<string>;

export interface TokenResolver {
  subjectsFor(event: NormalizedEvent): string[];
  tokenFor(subject: string): Promise<string>;
}

/**
 * Domain-wide delegation can impersonate anyone in the domain, so an event's
 * own identities are only used as fallback subjects when the allowlist names
 * them — both are attacker-influenceable on a shared calendar. The creator is
 * tried before the organizer because on a shared calendar `organizer` holds the
 * calendar's own address and only `creator` names the human who scheduled it.
 */
export function createTokenResolver(config: IngestConfig, mint: MintToken): TokenResolver {
  const cache = new Map<string, Promise<string>>();
  const allowlist = new Set(config.organizerAllowlist.map((e) => e.toLowerCase()));

  return {
    subjectsFor(event: NormalizedEvent): string[] {
      const subjects = [config.impersonateSubject];
      const capture = config.impersonateSubject.toLowerCase();
      for (const raw of [event.creatorEmail, event.organizerEmail]) {
        // Normalized, so one mailbox is one cache key however the payload cased it.
        const candidate = raw.toLowerCase();
        if (
          candidate &&
          candidate !== capture &&
          allowlist.has(candidate) &&
          !subjects.includes(candidate)
        ) {
          subjects.push(candidate);
        }
      }
      return subjects;
    },

    tokenFor(subject: string): Promise<string> {
      let pending = cache.get(subject);
      if (!pending) {
        // A rejected promise must not stay cached: during a backfill the same
        // organizer recurs across events, and one transient failure would
        // otherwise poison every later event for that subject.
        pending = mint(subject).catch((err: unknown) => {
          cache.delete(subject);
          throw err;
        });
        cache.set(subject, pending);
      }
      return pending;
    },
  };
}
