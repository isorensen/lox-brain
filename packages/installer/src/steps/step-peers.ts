import { input, number as numberPrompt } from '@inquirer/prompts';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { t } from '../i18n/index.js';
import type { InstallerContext, StepResult } from './types.js';

interface PeerData {
  name: string;
  email: string;
  ip: string;
  public_key: string;
  privateKey: string;
  added_at: string;
}

function generateKeypair(): { privateKey: string; publicKey: string } {
  const privateKey = execFileSync('wg', ['genkey']).toString().trim();
  const publicKey = execFileSync('wg', ['pubkey'], { input: privateKey }).toString().trim();
  return { privateKey, publicKey };
}

function assignIp(baseSubnet: string, index: number): string {
  const parts = baseSubnet.split('/')[0].split('.');
  parts[3] = String(index + 2); // .1 is server, peers start at .2
  return parts.join('.');
}

function generateConfFile(
  peerPrivateKey: string,
  peerIp: string,
  serverPublicKey: string,
  serverEndpoint: string,
  serverPort: number,
): string {
  return `[Interface]
PrivateKey = ${peerPrivateKey}
Address = ${peerIp}/24
DNS = 1.1.1.1

[Peer]
PublicKey = ${serverPublicKey}
Endpoint = ${serverEndpoint}:${serverPort}
AllowedIPs = 10.10.0.0/24
PersistentKeepalive = 25
`;
}

export async function stepPeers(ctx: InstallerContext): Promise<StepResult> {
  if (ctx.config.mode !== 'team') {
    return { success: true, message: 'skip: personal mode' };
  }

  const strings = t();

  const count = await numberPrompt({ message: strings.peers_count_prompt, min: 1, max: 254 });
  if (!count || count < 1) {
    return { success: false, message: 'At least 1 peer is required' };
  }

  const subnet = ctx.config.vpn?.subnet ?? '10.10.0.0/24';
  const serverPort = ctx.config.vpn?.listen_port ?? 51820;

  const peers: PeerData[] = [];

  console.log(strings.peers_generating);

  for (let i = 0; i < count; i++) {
    const name = await input({ message: `${strings.peers_name_prompt} ${i + 1}:` });
    const email = await input({ message: `${strings.peers_email_prompt} ${i + 1}:` });
    const ip = assignIp(subnet, i);
    const keypair = generateKeypair();
    peers.push({
      name,
      email,
      ip,
      public_key: keypair.publicKey,
      privateKey: keypair.privateKey,
      added_at: new Date().toISOString().split('T')[0],
    });
  }

  // Store peers in config (without private keys)
  ctx.config.vpn = ctx.config.vpn ?? { server_ip: '10.10.0.1', subnet, listen_port: serverPort, peers: [] };
  ctx.config.vpn.peers = peers.map(({ name, email, ip, public_key, added_at }) => ({
    name,
    email,
    ip,
    public_key,
    added_at,
  }));

  // Write .conf files for distribution
  const outputDir = path.join(homedir(), '.lox', 'peers');
  mkdirSync(outputDir, { recursive: true });

  const serverPublicKey = 'SERVER_PUBLIC_KEY_PLACEHOLDER';
  const serverEndpoint = 'SERVER_ENDPOINT_PLACEHOLDER';

  for (const peer of peers) {
    const conf = generateConfFile(peer.privateKey, peer.ip, serverPublicKey, serverEndpoint, serverPort);
    const confPath = path.join(outputDir, `${peer.name}.conf`);
    writeFileSync(confPath, conf);
    chmodSync(confPath, 0o600);
  }

  console.log(strings.peers_generated);
  console.log(strings.peers_conf_written);

  console.log('\n  ⚠ Server endpoint and public key are placeholders.');
  console.log('  Edit each .conf file with actual values before distributing to peers.');

  return { success: true };
}
