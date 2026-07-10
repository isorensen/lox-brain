import type { PeerResolver } from './peer-resolver.js';

export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Tools that create authored content and require authorship attribution.
 * The middleware injects the resolved peer's name as `_created_by` for these.
 * `update_task` is intentionally excluded — it must not overwrite the original
 * author when a different peer edits the task.
 */
const WRITE_TOOLS = new Set(['write_note', 'add_task', 'daily_log']);

export function wrapToolWithCreatedBy(
  tool: Tool,
  resolver: PeerResolver,
  getClientIp: () => string | null,
): Tool {
  if (!WRITE_TOOLS.has(tool.name)) {
    return tool;
  }

  return {
    ...tool,
    async handler(args: Record<string, unknown>): Promise<unknown> {
      const ip = getClientIp();
      if (ip) {
        const peer = resolver.resolve(ip);
        if (peer) {
          return tool.handler({ ...args, _created_by: peer.name });
        }
      }
      // Strip any client-supplied _created_by when peer is unknown (anti-spoofing).
      const { _created_by: _, ...cleanArgs } = args;
      return tool.handler(cleanArgs);
    },
  };
}
