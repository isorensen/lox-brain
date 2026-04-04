import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { TransportConfig } from '../../src/mcp/transports.js';

describe('selectTransport', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should default to stdio when MCP_TRANSPORT is not set', async () => {
    delete process.env.MCP_TRANSPORT;
    const { getTransportConfig } = await import('../../src/mcp/transports.js');
    const config = getTransportConfig();
    expect(config.type).toBe('stdio');
  });

  it('should select stdio when MCP_TRANSPORT=stdio', async () => {
    process.env.MCP_TRANSPORT = 'stdio';
    const { getTransportConfig } = await import('../../src/mcp/transports.js');
    const config = getTransportConfig();
    expect(config.type).toBe('stdio');
  });

  it('should select http when MCP_TRANSPORT=http', async () => {
    process.env.MCP_TRANSPORT = 'http';
    const { getTransportConfig } = await import('../../src/mcp/transports.js');
    const config: TransportConfig = getTransportConfig();
    expect(config.type).toBe('http');

    if (config.type !== 'http') throw new Error('Expected http config');
    expect(config.port).toBe(3100);
    expect(config.host).toBe('127.0.0.1');
  });

  it('should respect MCP_PORT override', async () => {
    process.env.MCP_TRANSPORT = 'http';
    process.env.MCP_PORT = '4200';
    const { getTransportConfig } = await import('../../src/mcp/transports.js');
    const config: TransportConfig = getTransportConfig();

    if (config.type !== 'http') throw new Error('Expected http config');
    expect(config.port).toBe(4200);
  });

  it('should throw on invalid transport value', async () => {
    process.env.MCP_TRANSPORT = 'websocket';
    const { getTransportConfig } = await import('../../src/mcp/transports.js');
    expect(() => getTransportConfig()).toThrow('Invalid MCP_TRANSPORT');
  });

  it('should throw on non-numeric MCP_PORT', async () => {
    process.env.MCP_TRANSPORT = 'http';
    process.env.MCP_PORT = 'abc';
    const { getTransportConfig } = await import('../../src/mcp/transports.js');
    expect(() => getTransportConfig()).toThrow('Invalid MCP_PORT');
  });

  it('should throw on MCP_PORT out of range (0)', async () => {
    process.env.MCP_TRANSPORT = 'http';
    process.env.MCP_PORT = '0';
    const { getTransportConfig } = await import('../../src/mcp/transports.js');
    expect(() => getTransportConfig()).toThrow('Invalid MCP_PORT');
  });

  it('should throw on MCP_PORT out of range (65536)', async () => {
    process.env.MCP_TRANSPORT = 'http';
    process.env.MCP_PORT = '65536';
    const { getTransportConfig } = await import('../../src/mcp/transports.js');
    expect(() => getTransportConfig()).toThrow('Invalid MCP_PORT');
  });
});
