export interface StdioTransportConfig {
  type: 'stdio';
}

export interface HttpTransportConfig {
  type: 'http';
  host: string;
  port: number;
}

export type TransportConfig = StdioTransportConfig | HttpTransportConfig;

export function getTransportConfig(): TransportConfig {
  const transport = process.env.MCP_TRANSPORT ?? 'stdio';

  if (transport === 'stdio') {
    return { type: 'stdio' };
  }

  if (transport === 'http') {
    const port = process.env.MCP_PORT ? parseInt(process.env.MCP_PORT, 10) : 3100;
    return {
      type: 'http',
      host: '127.0.0.1',
      port,
    };
  }

  throw new Error(`Invalid MCP_TRANSPORT value: "${transport}". Must be "stdio" or "http".`);
}
