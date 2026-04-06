import type { LoxConfig } from '@lox-brain/shared';
import { validateLicense } from './license/validator.js';
import type { LicensePayload } from './license/types.js';
import { PeerResolver } from './multi-user/peer-resolver.js';
import { wrapToolWithCreatedBy } from './multi-user/created-by-middleware.js';
import type { Tool } from './multi-user/created-by-middleware.js';
import { createTeamTools } from './mcp-extensions/team-tools.js';

export type { LicensePayload } from './license/types.js';
export { validateLicense } from './license/validator.js';
export { PeerResolver } from './multi-user/peer-resolver.js';
export { wrapToolWithCreatedBy } from './multi-user/created-by-middleware.js';
export { createTeamTools } from './mcp-extensions/team-tools.js';

export interface TeamRegistrationResult {
  success: boolean;
  org?: string;
  peersRegistered?: number;
  tools?: Tool[];
  error?: string;
}

interface DbClientLike {
  listRecent(options?: unknown): Promise<unknown>;
  searchByAuthor(author: string, query?: string, options?: unknown): Promise<unknown>;
}

export async function registerTeamFeatures(
  _server: unknown,
  config: LoxConfig,
  tools: Tool[],
  publicKey: string,
  options?: {
    getClientIp?: () => string | null;
    dbClient?: DbClientLike;
  },
): Promise<TeamRegistrationResult> {
  if (config.mode !== 'team') {
    return { success: false, error: 'Cannot register team features in personal mode' };
  }

  const licenseKey = config.license_key;
  if (!licenseKey) {
    return { success: false, error: 'No license key found in config' };
  }

  const license = validateLicense(licenseKey, publicKey);
  if (!license) {
    return { success: false, error: 'Invalid or expired license key' };
  }

  const peers = config.vpn?.peers ?? [];
  const resolver = new PeerResolver(peers);
  const getClientIp = options?.getClientIp ?? (() => null);

  const wrappedTools = tools.map(tool => wrapToolWithCreatedBy(tool, resolver, getClientIp));

  const teamTools: Tool[] = options?.dbClient
    ? createTeamTools(options.dbClient)
    : [];

  const allTools = [...wrappedTools, ...teamTools];

  return {
    success: true,
    org: license.org,
    peersRegistered: resolver.peerCount,
    tools: allTools,
  };
}
