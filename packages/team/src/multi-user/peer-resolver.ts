import type { VpnPeer } from '@lox-brain/shared';

export interface ResolvedPeer {
  name: string;
  ip: string;
}

export class PeerResolver {
  private readonly peerMap: Map<string, ResolvedPeer>;

  constructor(peers: VpnPeer[]) {
    this.peerMap = new Map();
    for (const peer of peers) {
      this.peerMap.set(peer.ip, { name: peer.name, ip: peer.ip });
    }
  }

  resolve(ip: string): ResolvedPeer | null {
    if (!ip) return null;
    const normalizedIp = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
    return this.peerMap.get(normalizedIp) ?? null;
  }

  get peerCount(): number {
    return this.peerMap.size;
  }
}
