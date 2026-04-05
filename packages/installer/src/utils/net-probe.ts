import { createConnection, type Socket } from 'node:net';

/**
 * Probe whether a TCP port is reachable on `host`. Returns true if the
 * connection handshake completes within `timeoutMs`, false otherwise.
 *
 * Used by step 12 to detect whether the WireGuard VPN tunnel is actually
 * up before attempting `scp lox-vm:...` — a raw scp against an inactive
 * tunnel hangs until its own timeout (60s) and then surfaces as an
 * unhandled exception (#93). A fast TCP probe converts that into a
 * clean, recoverable "VPN unreachable" signal before we start the scp.
 *
 * Never throws — any socket error is normalized to `false`. Callers
 * receive a boolean and decide how to present the failure.
 */
export function probeTcp(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: boolean, socket: Socket): void => {
      if (settled) return;
      settled = true;
      // destroy() is a no-op if the socket is already closed; safe to call
      // from any of the three terminal branches (connect / error / timeout).
      socket.destroy();
      resolve(result);
    };

    // `timeout` in the options object arms the timer BEFORE the connect
    // attempt starts, avoiding a theoretical race between createConnection
    // and a separate setTimeout() call.
    const socket = createConnection({ host, port, timeout: timeoutMs });
    socket.once('connect', () => finish(true, socket));
    socket.once('timeout', () => finish(false, socket));
    // The 'error' listener is mandatory even though `settled` would ignore
    // late errors: socket.destroy() can itself emit a follow-up 'error'
    // event (ECONNRESET, etc.) on some Node versions, and an uncaught
    // 'error' on a Socket crashes the process. Do NOT remove this line.
    socket.once('error', () => finish(false, socket));
  });
}
