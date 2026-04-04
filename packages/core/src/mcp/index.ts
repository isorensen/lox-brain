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

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = tools.find((t) => t.name === request.params.name);
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

async function main(): Promise<void> {
  const transportConfig = getTransportConfig();

  if (transportConfig.type === 'stdio') {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('Lox Brain MCP Server running on stdio');
  } else {
    const httpServer = createServer(async (req, res) => {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      (transport as any).clientIp = req.socket.remoteAddress ?? null;
      await server.connect(transport);
      await transport.handleRequest(req, res);
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
