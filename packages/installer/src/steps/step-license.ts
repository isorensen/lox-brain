import { password } from '@inquirer/prompts';
import jwt from 'jsonwebtoken';
import { t } from '../i18n/index.js';
import type { InstallerContext, StepResult } from './types.js';

interface LicensePayload {
  org: string;
  max_peers: number;
  expires: string;
  issued_by: string;
}

function validateLicenseKey(token: string, publicKey: string): LicensePayload | null {
  if (!token || !publicKey) return null;
  try {
    const decoded = jwt.verify(token, publicKey, { algorithms: ['RS256'] }) as Record<string, unknown>;
    if (
      typeof decoded.org !== 'string' ||
      typeof decoded.max_peers !== 'number' ||
      typeof decoded.expires !== 'string' ||
      typeof decoded.issued_by !== 'string'
    ) {
      return null;
    }
    return {
      org: decoded.org,
      max_peers: decoded.max_peers,
      expires: decoded.expires,
      issued_by: decoded.issued_by,
    };
  } catch {
    return null;
  }
}

export async function stepLicense(ctx: InstallerContext, publicKey: string): Promise<StepResult> {
  if (ctx.config.mode !== 'team') {
    return { success: true, message: 'skip: personal mode' };
  }

  const strings = t();
  const key = await password({ message: strings.license_prompt, mask: '*' });
  const payload = validateLicenseKey(key, publicKey);

  if (!payload) {
    return { success: false, message: strings.license_invalid };
  }

  ctx.config.license_key = key;

  console.log(`  ${strings.license_org}: ${payload.org}`);
  console.log(`  ${strings.license_max_peers}: ${payload.max_peers}`);
  console.log(`  ${strings.license_expires}: ${payload.expires}`);

  return { success: true, message: strings.license_valid };
}
