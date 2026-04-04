import { describe, it, expect } from 'vitest';
import { PeerResolver } from '../../src/multi-user/peer-resolver.js';
import type { VpnPeer } from '@lox-brain/shared';

describe('PeerResolver', () => {
  const peers: VpnPeer[] = [
    { name: 'eduardo', ip: '10.10.0.2', public_key: 'key1', added_at: '2026-04-03' },
    { name: 'matheus', ip: '10.10.0.3', public_key: 'key2', added_at: '2026-04-03' },
    { name: 'igor', ip: '10.10.0.4', public_key: 'key3', added_at: '2026-04-03' },
  ];

  it('should resolve a known IP to its peer identity', () => {
    const resolver = new PeerResolver(peers);
    const result = resolver.resolve('10.10.0.2');
    expect(result).not.toBeNull();
    expect(result!.name).toBe('eduardo');
  });

  it('should return null for an unknown IP', () => {
    const resolver = new PeerResolver(peers);
    expect(resolver.resolve('10.10.0.99')).toBeNull();
  });

  it('should return null for the server IP', () => {
    const resolver = new PeerResolver(peers);
    expect(resolver.resolve('10.10.0.1')).toBeNull();
  });

  it('should return null for empty string', () => {
    const resolver = new PeerResolver(peers);
    expect(resolver.resolve('')).toBeNull();
  });

  it('should handle IPv6-mapped IPv4 addresses', () => {
    const resolver = new PeerResolver(peers);
    const result = resolver.resolve('::ffff:10.10.0.3');
    expect(result).not.toBeNull();
    expect(result!.name).toBe('matheus');
  });

  it('should handle empty peer list', () => {
    const resolver = new PeerResolver([]);
    expect(resolver.resolve('10.10.0.2')).toBeNull();
  });

  it('should return all registered peers count', () => {
    const resolver = new PeerResolver(peers);
    expect(resolver.peerCount).toBe(3);
  });
});
