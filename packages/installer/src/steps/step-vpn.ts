import crypto from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import chalk from 'chalk';
import { shell } from '../utils/shell.js';
import { t } from '../i18n/index.js';
import { renderStepHeader } from '../ui/box.js';
import { withSpinner } from '../ui/spinner.js';
import type { InstallerContext, StepResult } from './types.js';

const TOTAL_STEPS = 12;
const VM_NAME = 'lox-vm';
const VPN_LISTEN_PORT = 51820;
const VPN_SERVER_IP = '10.10.0.1';
const VPN_CLIENT_IP = '10.10.0.3'; // Mac client (0.2 reserved for Arch)
const VPN_SUBNET = '10.10.0.0/24';
const HOST_INTERFACE = 'ens4'; // GCP default NIC

/**
 * Execute a command on the VM via IAP tunnel SSH.
 */
async function sshExec(
  project: string,
  zone: string,
  command: string,
): Promise<string> {
  const { stdout } = await shell('gcloud', [
    'compute', 'ssh', VM_NAME,
    '--zone', zone,
    '--project', project,
    '--tunnel-through-iap',
    '--command', command,
  ]);
  return stdout;
}

/**
 * Step 8: Allocate static IP, configure WireGuard server on VM,
 * generate client config locally, and activate the tunnel.
 */
export async function stepVpn(ctx: InstallerContext): Promise<StepResult> {
  const strings = t();
  const project = ctx.gcpProjectId;
  const zone = ctx.config.gcp?.zone;
  const region = ctx.config.gcp?.region;

  if (!project || !zone || !region) {
    return { success: false, message: 'GCP project, zone, or region not set. Run step 3 first.' };
  }

  console.log(renderStepHeader(8, TOTAL_STEPS, strings.step_wireguard));

  // Allocate static IP for VPN endpoint
  let staticIp: string;

  await withSpinner(
    `${strings.creating} static IP for VPN...`,
    async () => {
      try {
        await shell('gcloud', [
          'compute', 'addresses', 'create', 'lox-vpn-ip',
          '--region', region,
          '--project', project,
        ]);
      } catch {
        // Address may already exist
      }
    },
  );

  // Get the allocated IP
  const { stdout: ipOutput } = await shell('gcloud', [
    'compute', 'addresses', 'describe', 'lox-vpn-ip',
    '--region', region,
    '--format=value(address)',
    '--project', project,
  ]);
  staticIp = ipOutput.trim();

  if (!staticIp) {
    return { success: false, message: 'Failed to allocate static IP for VPN.' };
  }

  // Attach static IP to VM
  await withSpinner(
    `Attaching static IP ${staticIp} to VM...`,
    async () => {
      try {
        await shell('gcloud', [
          'compute', 'instances', 'add-access-config', VM_NAME,
          '--zone', zone,
          '--access-config-name=vpn-only',
          `--address=${staticIp}`,
          '--project', project,
        ]);
      } catch {
        // Access config may already exist; delete and re-add
        try {
          await shell('gcloud', [
            'compute', 'instances', 'delete-access-config', VM_NAME,
            '--zone', zone,
            '--access-config-name=vpn-only',
            '--project', project,
          ]);
          await shell('gcloud', [
            'compute', 'instances', 'add-access-config', VM_NAME,
            '--zone', zone,
            '--access-config-name=vpn-only',
            `--address=${staticIp}`,
            '--project', project,
          ]);
        } catch {
          // If it still fails, the IP may already be attached — continue
        }
      }
    },
  );

  // Generate WireGuard keys on the VM
  let serverPublicKey: string;
  await withSpinner(
    'Generating WireGuard server keys on VM...',
    async () => {
      await sshExec(project, zone, [
        'umask 077',
        'wg genkey | sudo tee /etc/wireguard/server_private.key | wg pubkey | sudo tee /etc/wireguard/server_public.key',
      ].join(' && '));
    },
  );

  serverPublicKey = (await sshExec(project, zone, 'sudo cat /etc/wireguard/server_public.key')).trim();

  // Generate client keys locally
  let clientPrivateKey: string;
  let clientPublicKey: string;

  await withSpinner(
    'Generating WireGuard client keys locally...',
    async () => {
      const { stdout: privKey } = await shell('wg', ['genkey']);
      clientPrivateKey = privKey.trim();
      // Pipe private key to wg pubkey via bash
      const { stdout: pubKey } = await shell('bash', [
        '-c', `echo "${clientPrivateKey}" | wg pubkey`,
      ]);
      clientPublicKey = pubKey.trim();
    },
  );

  // Configure WireGuard server on VM
  await withSpinner(
    `${strings.configuring} WireGuard server on VM...`,
    async () => {
      const serverPrivateKey = (await sshExec(project, zone, 'sudo cat /etc/wireguard/server_private.key')).trim();

      const serverConf = [
        '[Interface]',
        `PrivateKey = ${serverPrivateKey}`,
        `Address = ${VPN_SERVER_IP}/24`,
        `ListenPort = ${VPN_LISTEN_PORT}`,
        `PostUp = iptables -A FORWARD -i wg0 -j ACCEPT; iptables -t nat -A POSTROUTING -o ${HOST_INTERFACE} -j MASQUERADE`,
        `PostDown = iptables -D FORWARD -i wg0 -j ACCEPT; iptables -t nat -D POSTROUTING -o ${HOST_INTERFACE} -j MASQUERADE`,
        '',
        '[Peer]',
        `PublicKey = ${clientPublicKey!}`,
        `AllowedIPs = ${VPN_CLIENT_IP}/32`,
      ].join('\n');

      // Write config and enable the service
      await sshExec(project, zone, [
        `echo '${serverConf}' | sudo tee /etc/wireguard/wg0.conf > /dev/null`,
        'sudo chmod 600 /etc/wireguard/wg0.conf',
        'sudo sysctl -w net.ipv4.ip_forward=1',
        'echo "net.ipv4.ip_forward=1" | sudo tee -a /etc/sysctl.conf > /dev/null',
        'sudo systemctl enable wg-quick@wg0',
        'sudo systemctl start wg-quick@wg0',
      ].join(' && '));
    },
  );

  // Write client config locally
  const clientConfDir = path.join(process.env.HOME ?? '/tmp', '.config', 'lox', 'wireguard');
  const clientConfPath = path.join(clientConfDir, 'wg0.conf');

  await withSpinner(
    `${strings.configuring} WireGuard client config...`,
    async () => {
      const clientConf = [
        '[Interface]',
        `PrivateKey = ${clientPrivateKey!}`,
        `Address = ${VPN_CLIENT_IP}/24`,
        '',
        '[Peer]',
        `PublicKey = ${serverPublicKey}`,
        `Endpoint = ${staticIp}:${VPN_LISTEN_PORT}`,
        `AllowedIPs = ${VPN_SUBNET}`,
        'PersistentKeepalive = 25',
      ].join('\n');

      await mkdir(clientConfDir, { recursive: true });
      await writeFile(clientConfPath, clientConf, { mode: 0o600 });
    },
  );

  // Store VPN config in context
  ctx.config.vpn = {
    server_ip: VPN_SERVER_IP,
    subnet: VPN_SUBNET,
    listen_port: VPN_LISTEN_PORT,
    peers: [
      {
        name: 'mac-client',
        ip: VPN_CLIENT_IP,
        public_key: clientPublicKey!,
        added_at: new Date().toISOString(),
      },
    ],
  };

  console.log(chalk.green(`  ✓ WireGuard VPN configured (${staticIp}:${VPN_LISTEN_PORT})`));
  console.log(chalk.dim(`    Client config: ${clientConfPath}`));
  console.log(chalk.dim(`    Activate: sudo wg-quick up ${clientConfPath}`));
  return { success: true };
}
