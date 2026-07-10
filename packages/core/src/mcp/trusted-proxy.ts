import { timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';

/** Header carrying the shared secret that proves the caller is the trusted backend. */
export const PROXY_SECRET_HEADER = 'x-lox-proxy-secret';
/** Header carrying the authenticated sender's display name, forwarded by the trusted backend. */
export const ACTOR_HEADER = 'x-lox-actor';
/**
 * Upper bound on a forwarded actor name. A display name is short; anything longer
 * is a malformed/hostile backend, so we reject it rather than persist it as `created_by`.
 */
export const MAX_ACTOR_LENGTH = 200;

/**
 * Resolve the authenticated actor forwarded by a trusted proxy (the chat backend).
 *
 * Trust boundary: the forwarded `x-lox-actor` is honored ONLY when the request
 * also carries an `x-lox-proxy-secret` that matches the configured shared secret
 * (constant-time comparison). A missing, empty, mismatched, or duplicated secret
 * means the actor header is ignored entirely — preserving anti-spoofing for every
 * caller that is not the trusted backend. When no secret is configured
 * (`LOX_TRUSTED_PROXY_SECRET` unset/empty) the trusted-proxy path is disabled and
 * this always returns `null`, so shipping the MCP change before the backend starts
 * sending headers is a safe no-op.
 *
 * Accepted risk: once the secret matches, the backend is fully trusted and the
 * forwarded name is used verbatim — there is no server-side allowlist tying the
 * actor to a registered peer/user (chat senders are not WireGuard peers, so such
 * a cross-check is not possible on this path). A compromised backend could
 * therefore attribute writes to an arbitrary name. The secret is the whole trust
 * boundary; treat it accordingly (rotate, restrict egress — see `.env.example`).
 *
 * @param headers        Incoming request headers (lowercased by Node).
 * @param expectedSecret The configured `LOX_TRUSTED_PROXY_SECRET`; if unset/empty, no caller is trusted.
 * @returns The forwarded actor name (trimmed), or `null` when the request is not a trusted proxy call.
 */
export function resolveTrustedActor(
  headers: IncomingHttpHeaders,
  expectedSecret: string | undefined,
): string | null {
  // No secret configured → the trusted-proxy path is disabled; never trust a forwarded identity.
  if (!expectedSecret) return null;

  const provided = headers[PROXY_SECRET_HEADER];
  const actor = headers[ACTOR_HEADER];
  // Reject duplicated headers (arrays) and absent values.
  if (typeof provided !== 'string' || typeof actor !== 'string') return null;

  const name = actor.trim();
  if (name === '' || name.length > MAX_ACTOR_LENGTH) return null;

  if (!secretsMatch(provided, expectedSecret)) return null;
  return name;
}

/**
 * Constant-time secret comparison. Differing lengths short-circuit (the length of
 * a shared secret is not itself secret, and `timingSafeEqual` requires equal-length buffers).
 */
function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
