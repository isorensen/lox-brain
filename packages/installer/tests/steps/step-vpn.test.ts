import { describe, it, expect } from 'vitest';
import { buildServerDeployScript } from '../../src/steps/step-vpn.js';

const SAMPLE_SERVER_CONF = [
  '[Interface]',
  'PrivateKey = abc123==',
  'Address = 10.10.0.1/24',
  'ListenPort = 51820',
  '',
  '[Peer]',
  'PublicKey = xyz789==',
  'AllowedIPs = 10.10.0.3/32',
].join('\n');

describe('buildServerDeployScript (#99)', () => {
  it('uses systemctl RESTART, not start — critical for re-runs', () => {
    // The bug: `systemctl start` is a no-op when the service is already
    // active, so the kernel keeps the old peer keys loaded even after
    // /etc/wireguard/wg0.conf is overwritten with new keys on re-run.
    // Handshakes then fail silently because server (in kernel) doesn't
    // recognize the new client public key. `restart` is the only correct
    // verb here. DO NOT change this test to accept `start`.
    const script = buildServerDeployScript(SAMPLE_SERVER_CONF);
    expect(script).toContain('sudo systemctl restart wg-quick@wg0');
    // Guard against a silent regression where someone replaces restart
    // with start; the only 'systemctl start' allowed would be a regex
    // false-positive, so we assert on the exact phrase.
    expect(script).not.toMatch(/sudo systemctl start wg-quick@wg0(?!\S)/);
  });

  it('writes the server config to /etc/wireguard/wg0.conf and chmods 600', () => {
    const script = buildServerDeployScript(SAMPLE_SERVER_CONF);
    expect(script).toContain('/etc/wireguard/wg0.conf');
    expect(script).toContain('sudo chmod 600 /etc/wireguard/wg0.conf');
  });

  it('enables IP forwarding both at runtime and persistently via /etc/sysctl.conf', () => {
    const script = buildServerDeployScript(SAMPLE_SERVER_CONF);
    expect(script).toContain('sysctl -w net.ipv4.ip_forward=1');
    expect(script).toContain('/etc/sysctl.conf');
  });

  it('enables the wg-quick@wg0 service so it survives VM reboots', () => {
    const script = buildServerDeployScript(SAMPLE_SERVER_CONF);
    expect(script).toContain('sudo systemctl enable wg-quick@wg0');
  });

  it('embeds the exact server conf into the tee heredoc', () => {
    const script = buildServerDeployScript(SAMPLE_SERVER_CONF);
    expect(script).toContain('[Interface]');
    expect(script).toContain('PrivateKey = abc123==');
    expect(script).toContain('AllowedIPs = 10.10.0.3/32');
  });

  it('uses newlines, not && chains, so cmd.exe on Windows does not mangle it', () => {
    // The vpnSshExecScript helper pipes the script via scp+bash, but if
    // anyone refactors to a single-line && chain, Windows cmd.exe breaks.
    const script = buildServerDeployScript(SAMPLE_SERVER_CONF);
    expect(script).not.toContain(' && ');
    expect(script.split('\n').length).toBeGreaterThan(4);
  });
});
