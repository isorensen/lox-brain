import { GoogleAuth } from 'google-auth-library';

export const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
] as const;

const IAM_HOST = 'https://iamcredentials.googleapis.com';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export interface AuthDeps {
  signJwt: (serviceAccount: string, payload: string) => Promise<string>;
  exchange: (signedJwt: string) => Promise<string>;
  now: () => number;
}

async function defaultSignJwt(serviceAccount: string, payload: string): Promise<string> {
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const client = await auth.getClient();
  const res = await client.request<{ signedJwt: string }>({
    url: `${IAM_HOST}/v1/projects/-/serviceAccounts/${serviceAccount}:signJwt`,
    method: 'POST',
    data: { payload },
  });
  return res.data.signedJwt;
}

async function defaultExchange(signedJwt: string): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: signedJwt,
    }),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) throw new Error('token exchange returned no access_token');
  return body.access_token;
}

const DEFAULTS: AuthDeps = {
  signJwt: defaultSignJwt,
  exchange: defaultExchange,
  now: () => Math.floor(Date.now() / 1000),
};

export async function getAccessToken(
  serviceAccount: string,
  subject: string,
  deps: AuthDeps = DEFAULTS,
): Promise<string> {
  const iat = deps.now();
  const payload = JSON.stringify({
    iss: serviceAccount,
    sub: subject,
    scope: SCOPES.join(' '),
    aud: TOKEN_URL,
    iat,
    exp: iat + 3600,
  });
  const signed = await deps.signJwt(serviceAccount, payload);
  return deps.exchange(signed);
}
