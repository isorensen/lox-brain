import { input, number as numberPrompt } from '@inquirer/prompts';
import { execFileSync } from 'node:child_process';
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
  const serverIp = ctx.config.vpn?.server_ip ?? (ctx.config.mode === 'team' ? '10.20.0.1' : '10.10.0.1');
  ctx.config.vpn = ctx.config.vpn ?? { server_ip: serverIp, subnet, listen_port: serverPort, peers: [] };
  ctx.config.vpn.peers = peers.map(({ name, email, ip, public_key, added_at }) => ({
    name,
    email,
    ip,
    public_key,
    added_at,
  }));

  // Store private keys temporarily in context for .conf generation in step 8
  // (step-vpn.ts), which has access to the server public key and static IP.
  // Private keys are NOT persisted to config.json — only used for .conf files.
  (ctx as unknown as Record<string, unknown>)._peerPrivateKeys = Object.fromEntries(
    peers.map(p => [p.ip, p.privateKey]),
  );

  console.log(strings.peers_generated);

  return { success: true };
}
