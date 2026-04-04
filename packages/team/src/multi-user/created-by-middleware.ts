import type { PeerResolver } from './peer-resolver.js';

export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

const WRITE_TOOLS = new Set(['write_note']);

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
      return tool.handler(args);
    },
  };
}
