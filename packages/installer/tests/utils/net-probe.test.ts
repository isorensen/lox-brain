import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'node:net';
import { probeTcp } from '../../src/utils/net-probe.js';

describe('probeTcp', () => {
  let server: Server | null = null;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = null;
    }
  });

  it('returns true when a local server accepts the connection', async () => {
    server = createServer((socket) => socket.end());
    const port = await new Promise<number>((resolve) => {
      server!.listen(0, '127.0.0.1', () => {
        const addr = server!.address();
        if (typeof addr === 'object' && addr !== null) resolve(addr.port);
        else throw new Error('unexpected address');
      });
    });
    expect(await probeTcp('127.0.0.1', port, 2000)).toBe(true);
  });

  it('returns false when the target port is closed (connection refused)', async () => {
    // Port 1 is not a listening service on any sane machine. ECONNREFUSED
    // is emitted almost instantly on localhost — no need for a long timeout.
    expect(await probeTcp('127.0.0.1', 1, 2000)).toBe(false);
  });

  it('returns false within the timeout when the host silently drops packets', async () => {
    // TEST-NET-1 (RFC 5737): documentation-only range, guaranteed not to
    // route anywhere. Connect attempts hang until timeout — mimics the
    // exact failure mode of a down WireGuard tunnel (#93).
    const started = Date.now();
    const result = await probeTcp('192.0.2.1', 22, 300);
    const elapsed = Date.now() - started;
    expect(result).toBe(false);
    // Allow generous slack for slow CI; the key property is that we time
    // out rather than hanging for the default socket timeout (minutes).
    expect(elapsed).toBeLessThan(2000);
  });

  it('returns false for an unresolvable hostname', async () => {
    expect(await probeTcp('nonexistent.invalid.', 22, 2000)).toBe(false);
  });
});
