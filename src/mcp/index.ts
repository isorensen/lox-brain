import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { Pool } from 'pg';
import OpenAI from 'openai';
import { EmbeddingService } from '../lib/embedding-service.js';
import { DbClient } from '../lib/db-client.js';
import { createTools } from './tools.js';

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

const pool = new Pool({
  host: '127.0.0.1',
  port: 5432,
  database: 'open_brain',
  user: 'obsidian_brain',
  password: process.env.PG_PASSWORD,
  // SSL omitted: PostgreSQL listens on localhost only (Zero Trust — no public IP).
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const embeddingService = new EmbeddingService(openai);
const dbClient = new DbClient(pool);
const tools = createTools(dbClient, embeddingService, VAULT_PATH);

const server = new Server(
  { name: 'obsidian-open-brain', version: '1.0.0' },
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
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Obsidian Open Brain MCP Server running on stdio');
}

main().catch((err: unknown) => {
  console.error('Fatal error starting MCP server:', err);
  process.exit(1);
});
