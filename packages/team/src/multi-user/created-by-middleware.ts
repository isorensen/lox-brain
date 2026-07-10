import type { PeerResolver } from './peer-resolver.js';

export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Tools that create authored content and require authorship attribution.
 * The middleware injects the resolved author's name as `_created_by` for these.
 * `update_task` is intentionally excluded — it must not overwrite the original
 * author when a different peer edits the task.
 */
const WRITE_TOOLS = new Set(['write_note', 'add_task', 'daily_log']);

/**
 * Wraps a write tool so its `_created_by` is set server-side from the caller's
 * verified identity, never from client-supplied args (anti-spoofing).
 *
 * Resolution order:
 *   (a) `getTrustedActor()` returns a name — a trusted proxy (the chat backend,
 *       authenticated by a shared secret at the HTTP layer) forwarded the real
 *       sender. This wins because on that path the caller is the backend, not the
 *       user's own WireGuard peer.
 *   (b) else the caller's WireGuard source IP resolves to a registered peer (#187).
 *   (c) else strip any client-supplied `_created_by` — the caller is unknown.
 */
export function wrapToolWithCreatedBy(
  tool: Tool,
  resolver: PeerResolver,
  getClientIp: () => string | null,
  getTrustedActor: () => string | null = () => null,
): Tool {
  if (!WRITE_TOOLS.has(tool.name)) {
    return tool;
  }

  return {
    ...tool,
    async handler(args: Record<string, unknown>): Promise<unknown> {
      // (a) A trusted proxy forwarded an authenticated sender (chat backend path).
      const actor = getTrustedActor();
      if (actor) {
        return tool.handler({ ...args, _created_by: actor });
      }
      // (b) Direct-peer path: derive identity from the caller's WireGuard IP.
      const ip = getClientIp();
      if (ip) {
        const peer = resolver.resolve(ip);
        if (peer) {
          return tool.handler({ ...args, _created_by: peer.name });
        }
      }
      // (c) Unknown caller — strip any client-supplied _created_by (anti-spoofing).
      const { _created_by: _, ...cleanArgs } = args;
      return tool.handler(cleanArgs);
    },
  };
}
