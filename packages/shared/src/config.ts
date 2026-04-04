export interface VpnPeer {
  name: string;
  ip: string;
  public_key: string;
  email?: string;
  added_at: string;
}

export interface LoxConfig {
  version: string;
  mode: 'personal' | 'team';
  gcp: {
    project: string;
    region: string;
    zone: string;
    vm_name: string;
    service_account: string;
  };
  database: {
    host: string;
    port: number;
    name: string;
    user: string;
  };
  vpn: {
    server_ip: string;
    subnet: string;
    listen_port: number;
    peers: VpnPeer[];
  };
  vault: {
    repo: string;
    local_path: string;
    preset: 'zettelkasten' | 'para';
  };
  install_dir: string;
  installed_at: string;
  license_key?: string;
}

export const DEFAULT_CONFIG: Partial<LoxConfig> = {
  version: '0.1.0',
  mode: 'personal',
  database: {
    host: '127.0.0.1',
    port: 5432,
    name: 'lox_brain',
    user: 'lox',
  },
  vpn: {
    server_ip: '10.10.0.1',
    subnet: '10.10.0.0/24',
    listen_port: 51820,
    peers: [],
  },
};

/**
 * Safe defaults applied before the installer collects user-specific values.
 * Fields not present here (gcp, vault, install_dir, installed_at) MUST be provided by the installer.
 */

export function getConfigPath(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE;
  if (!home) {
    throw new Error('Cannot determine home directory: HOME and USERPROFILE are both unset');
  }
  return `${home}/.lox/config.json`;
}
