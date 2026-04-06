import { AsyncLocalStorage } from 'node:async_hooks';
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
    // Single stateless transport -- server.connect() once to avoid
    // handler conflicts and listener leaks from multiple connect() calls.
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await server.connect(transport);

    const httpServer = createServer(async (req, res) => {
      // Inject the caller's IP as a request header so that MCP tool
      // handlers can read it via extra.requestInfo.headers['x-real-ip'].
      const clientIp = req.socket.remoteAddress ?? '';
      req.headers['x-real-ip'] = clientIp;

      await clientIpStorage.run(clientIp, async () => {
        await transport.handleRequest(req, res);
      });
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
