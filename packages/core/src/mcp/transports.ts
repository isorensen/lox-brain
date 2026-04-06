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

    const host = process.env.MCP_HOST ?? '127.0.0.1';
    if (host === '0.0.0.0') {
      console.error('[lox] WARNING: MCP_HOST=0.0.0.0 exposes the MCP server on ALL interfaces. Use a VPN IP (e.g. 10.x.x.x) for Zero Trust compliance.');
    }

    return {
      type: 'http',
      host,
      port,
    };
  }

  throw new Error(`Invalid MCP_TRANSPORT value: "${transport}". Must be "stdio" or "http".`);
}
