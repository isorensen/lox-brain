import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import OpenAI from 'openai';
import { LOX_MCP_SERVER_NAME, LOX_VERSION } from '@lox-brain/shared';
import { EmbeddingService } from '../lib/embedding-service.js';
import { DbClient } from '../lib/db-client.js';
import { createPool } from '../lib/create-pool.js';
import { createTools } from './tools.js';
import { getTransportConfig } from './transports.js';

const clientIpStorage = new AsyncLocalStorage<string>();

export { clientIpStorage };

const VAULT_PATH = process.env.VAULT_PATH;
if (!VAULT_PATH) {
  console.error('VAULT_PATH environment variable is required');
  process.exit(1);
}
if (!process.env.OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY environment variable is required');
  process.exit(1);
}
if (!process.env.PG_PASSWORD) {
  console.error('PG_PASSWORD environment variable is required');
  process.exit(1);
}

const pool = createPool();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const embeddingService = new EmbeddingService(openai);
const dbClient = new DbClient(pool);
const tools = createTools(dbClient, embeddingService, VAULT_PATH);

const server = new Server(
  { name: LOX_MCP_SERVER_NAME, version: LOX_VERSION },
  { capabilities: { tools: {} } },
);

let activeTools = tools;

/** Factory: create a fresh MCP Server with tool handlers bound to the shared activeTools array. */
function createMcpServer(): Server {
  const srv = new Server(
    { name: LOX_MCP_SERVER_NAME, version: LOX_VERSION },
    { capabilities: { tools: {} } },
  );

  srv.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: activeTools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  srv.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = activeTools.find((t) => t.name === request.params.name);
    if (!tool) {
      return {
        content: [{ type: 'text' as const, text: `Unknown tool: ${request.params.name}` }],
        isError: true,
      };
    }

    try {
      const result = await tool.handler((request.params.arguments ?? {}) as Record<string, unknown>);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text' as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  return srv;
}

// Register handlers on the global server instance (used by stdio mode only).
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: activeTools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = activeTools.find((t) => t.name === request.params.name);
  if (!tool) {
    return {
      content: [{ type: 'text' as const, text: `Unknown tool: ${request.params.name}` }],
      isError: true,
    };
  }

  try {
    const result = await tool.handler((request.params.arguments ?? {}) as Record<string, unknown>);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text' as const, text: `Error: ${message}` }],
      isError: true,
    };
  }
});

async function loadTeamFeatures(): Promise<void> {
  const LOX_MODE = process.env.LOX_MODE ?? 'personal';
  if (LOX_MODE !== 'team') return;

  try {
    const { registerTeamFeatures } = await import('@lox-brain/team');
    const { readFileSync } = await import('node:fs');
    const { getConfigPath } = await import('@lox-brain/shared');

    const configPath = getConfigPath();
    const configRaw = readFileSync(configPath, 'utf-8');
    const config = JSON.parse(configRaw);

    const PUBLIC_KEY = process.env.LOX_LICENSE_PUBLIC_KEY ?? '';

    const transportConfig = getTransportConfig();
    let clientIpGetter: (() => string | null) | undefined;
    if (transportConfig.type === 'http') {
      clientIpGetter = () => clientIpStorage.getStore() ?? null;
    }

    const result = await registerTeamFeatures(server, config, tools, PUBLIC_KEY, {
      getClientIp: clientIpGetter,
      dbClient,
    });

    if (result.success && result.tools) {
      activeTools = result.tools;
      console.error(`Lox Team Mode active: org=${result.org}, peers=${result.peersRegistered}`);
    } else {
      console.error(`Lox Team Mode not loaded: ${result.error}`);
    }
  } catch (err: unknown) {
    console.error('Failed to load team features:', err);
  }
}

async function main(): Promise<void> {
  try {
    await dbClient.reindexEmbeddings();
    console.error('Reindexed ivfflat embedding index');
  } catch (err) {
    console.error('Warning: failed to reindex embedding index:', err instanceof Error ? err.message : err);
  }

  await loadTeamFeatures();

  const transportConfig = getTransportConfig();

  if (transportConfig.type === 'stdio') {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('Lox Brain MCP Server running on stdio');
  } else {
    // Session-based transport — each client gets a unique session ID.
    // Stateless mode (sessionIdGenerator: undefined) has a known SDK bug
    // where session validation never succeeds, breaking Claude Code health
    // checks. Session mode fixes this and enables GET-based SSE streaming.
    const sessions = new Map<string, { server: Server; transport: StreamableHTTPServerTransport }>();

    const httpServer = createServer(async (req, res) => {
      // Inject the caller's IP so PeerResolver can identify the peer.
      const clientIp = req.socket.remoteAddress ?? '';
      req.headers['x-real-ip'] = clientIp;

      const sessionId = req.headers['mcp-session-id'] as string | undefined;

      if (sessionId && sessions.has(sessionId)) {
        // Existing session — route to its transport.
        const session = sessions.get(sessionId)!;
        await clientIpStorage.run(clientIp, async () => {
          await session.transport.handleRequest(req, res);
        });
      } else if (req.method === 'POST') {
        // New session — create a dedicated Server + Transport pair.
        // Each session gets its own Server instance to avoid the SDK's
        // "Already connected to a transport" error on concurrent clients.
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
        });

        const sessionServer = createMcpServer();

        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid) sessions.delete(sid);
          sessionServer.close().catch(() => {});
        };

        await sessionServer.connect(transport);

        await clientIpStorage.run(clientIp, async () => {
          await transport.handleRequest(req, res);
        });

        if (transport.sessionId) {
          sessions.set(transport.sessionId, { server: sessionServer, transport });
        }
      } else {
        // GET/DELETE without a valid session.
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No valid session. Send initialize first.' }));
      }
    });

    httpServer.listen(transportConfig.port, transportConfig.host, () => {
      console.error(
        `Lox Brain MCP Server running on http://${transportConfig.host}:${transportConfig.port}`,
      );
    });
  }
}

main().catch((err: unknown) => {
  console.error('Fatal error starting MCP server:', err);
  process.exit(1);
});
