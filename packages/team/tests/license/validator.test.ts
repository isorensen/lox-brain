import { describe, it, expect, beforeAll } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { validateLicense } from '../../src/license/validator.js';
import type { LicensePayload } from '../../src/license/types.js';

describe('validateLicense', () => {
  let privateKey: string;
  let publicKey: string;

  beforeAll(() => {
    const pair = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    privateKey = pair.privateKey;
    publicKey = pair.publicKey;
  });

  function createToken(payload: LicensePayload, key: string, expiresIn?: string): string {
    return jwt.sign(payload, key, { algorithm: 'RS256', expiresIn: expiresIn ?? '365d' });
  }

  it('should return payload for a valid license', () => {
    const token = createToken(
      { org: 'credifit', max_peers: 10, expires: '2027-04-03', issued_by: 'isorensen' },
      privateKey,
    );
    const result = validateLicense(token, publicKey);
    expect(result).not.toBeNull();
    expect(result!.org).toBe('credifit');
    expect(result!.max_peers).toBe(10);
    expect(result!.expires).toBe('2027-04-03');
    expect(result!.issued_by).toBe('isorensen');
  });

  it('should return null for an expired token', () => {
    const token = jwt.sign(
      { org: 'credifit', max_peers: 10, expires: '2025-01-01', issued_by: 'isorensen' },
      privateKey,
      { algorithm: 'RS256', expiresIn: '-1s' },
    );
    const result = validateLicense(token, publicKey);
    expect(result).toBeNull();
  });

  it('should return null for a token signed with wrong key', () => {
    const wrongPair = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const token = createToken(
      { org: 'credifit', max_peers: 10, expires: '2027-04-03', issued_by: 'isorensen' },
      wrongPair.privateKey,
    );
    const result = validateLicense(token, publicKey);
    expect(result).toBeNull();
  });

  it('should return null for a malformed token', () => {
    expect(validateLicense('not-a-jwt', publicKey)).toBeNull();
  });

  it('should return null for an empty string', () => {
    expect(validateLicense('', publicKey)).toBeNull();
  });

  it('should return null when required fields are missing', () => {
    const token = jwt.sign({ org: 'credifit' }, privateKey, { algorithm: 'RS256', expiresIn: '365d' });
    expect(validateLicense(token, publicKey)).toBeNull();
  });

  it('should return null for empty public key', () => {
    expect(validateLicense('sometoken', '')).toBeNull();
  });
});
