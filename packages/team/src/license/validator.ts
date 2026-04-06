import jwt from 'jsonwebtoken';
import type { LicensePayload } from './types.js';

function isValidPayload(decoded: unknown): decoded is LicensePayload & Record<string, unknown> {
  if (typeof decoded !== 'object' || decoded === null) return false;
  const obj = decoded as Record<string, unknown>;
  return (
    typeof obj.org === 'string' &&
    typeof obj.max_peers === 'number' &&
    typeof obj.expires === 'string' &&
    typeof obj.issued_by === 'string'
  );
}

export function validateLicense(token: string, publicKey: string): LicensePayload | null {
  if (!token || !publicKey) return null;
  try {
    const decoded = jwt.verify(token, publicKey, { algorithms: ['RS256'] });
    if (!isValidPayload(decoded)) return null;
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
