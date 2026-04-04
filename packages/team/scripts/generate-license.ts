#!/usr/bin/env tsx
import jwt from 'jsonwebtoken';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);

function usage(): never {
  console.error('Usage: tsx generate-license.ts --org <org> --max-peers <n> --expires <YYYY-MM-DD> --key <path-to-private-key.pem>');
  process.exit(1);
}

function getArg(flag: string): string {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) usage();
  return args[idx + 1];
}

const org = getArg('--org');
const maxPeers = parseInt(getArg('--max-peers'), 10);
const expires = getArg('--expires');
const keyPath = getArg('--key');

if (!org || isNaN(maxPeers) || !expires || !keyPath) usage();

const privateKey = readFileSync(resolve(keyPath), 'utf-8');

const expiresDate = new Date(expires);
const diffMs = expiresDate.getTime() - Date.now();
if (diffMs <= 0) {
  console.error('Error: expires date must be in the future');
  process.exit(1);
}

const diffSeconds = Math.floor(diffMs / 1000);

const token = jwt.sign(
  { org, max_peers: maxPeers, expires, issued_by: 'isorensen' },
  privateKey,
  { algorithm: 'RS256', expiresIn: diffSeconds },
);

console.log(token);
