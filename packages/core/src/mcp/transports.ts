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
    const rawPort = process.env.MCP_PORT;
    const port = rawPort !== undefined ? parseInt(rawPort, 10) : 3100;

    if (rawPort !== undefined && (isNaN(port) || port < 1 || port > 65535)) {
      throw new Error(`Invalid MCP_PORT value: "${rawPort}". Must be a number between 1 and 65535.`);
    }

    return {
      type: 'http',
      host: '127.0.0.1',
      port,
    };
  }

  throw new Error(`Invalid MCP_TRANSPORT value: "${transport}". Must be "stdio" or "http".`);
}
