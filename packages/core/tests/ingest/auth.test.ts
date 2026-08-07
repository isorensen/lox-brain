import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { requestMock, getClientMock, googleAuthMock } = vi.hoisted(() => {
  const requestMock = vi.fn();
  const getClientMock = vi.fn();
  const googleAuthMock = vi.fn();
  return { requestMock, getClientMock, googleAuthMock };
});

vi.mock('google-auth-library', () => ({
  GoogleAuth: googleAuthMock,
}));

import { getAccessToken, SCOPES } from '../../src/ingest/auth.js';

function deps(overrides = {}) {
  return {
    signJwt: vi.fn().mockResolvedValue('signed.jwt.value'),
    exchange: vi.fn().mockResolvedValue('ya29.token'),
    now: () => 1_000_000,
    ...overrides,
  };
}

describe('getAccessToken', () => {
  it('requests exactly the two readonly scopes', async () => {
    const d = deps();
    await getAccessToken('sa@proj.iam.gserviceaccount.com', 'capture@example.com', d);
    const payload = JSON.parse(d.signJwt.mock.calls[0][1]);
    expect(payload.scope.split(' ').sort()).toEqual([...SCOPES].sort());
  });

  it('never requests any gmail scope', async () => {
    const d = deps();
    await getAccessToken('sa@proj.iam.gserviceaccount.com', 'capture@example.com', d);
    const payload = JSON.parse(d.signJwt.mock.calls[0][1]);
    expect(payload.scope).not.toContain('gmail');
  });

  it('sets sub to the impersonated subject and iss to the service account', async () => {
    const d = deps();
    await getAccessToken('sa@proj.iam.gserviceaccount.com', 'capture@example.com', d);
    const payload = JSON.parse(d.signJwt.mock.calls[0][1]);
    expect(payload.sub).toBe('capture@example.com');
    expect(payload.iss).toBe('sa@proj.iam.gserviceaccount.com');
    expect(payload.exp).toBe(1_000_000 + 3600);
  });

  it('exchanges the signed jwt for an access token', async () => {
    const d = deps();
    const token = await getAccessToken('sa@proj.iam.gserviceaccount.com', 'capture@example.com', d);
    expect(d.exchange).toHaveBeenCalledWith('signed.jwt.value');
    expect(token).toBe('ya29.token');
  });

  it('propagates a signing failure', async () => {
    const d = deps({ signJwt: vi.fn().mockRejectedValue(new Error('permission denied')) });
    await expect(
      getAccessToken('sa@proj.iam.gserviceaccount.com', 'capture@example.com', d),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('getAccessToken with default deps (network boundary mocked)', () => {
  beforeEach(() => {
    requestMock.mockReset();
    getClientMock.mockReset();
    googleAuthMock.mockReset();
    getClientMock.mockResolvedValue({ request: requestMock });
    googleAuthMock.mockImplementation(function GoogleAuthStub() {
      return { getClient: getClientMock };
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('signs the JWT via IAM credentials and exchanges it for a token', async () => {
    requestMock.mockResolvedValue({ data: { signedJwt: 'iam.signed.jwt' } });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => ({ access_token: 'ya29.real-token' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const token = await getAccessToken('sa@proj.iam.gserviceaccount.com', 'capture@example.com');

    expect(googleAuthMock).toHaveBeenCalledWith({
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/sa@proj.iam.gserviceaccount.com:signJwt',
        method: 'POST',
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://oauth2.googleapis.com/token',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(token).toBe('ya29.real-token');
  });

  it('throws when the token exchange responds with a non-2xx status', async () => {
    requestMock.mockResolvedValue({ data: { signedJwt: 'iam.signed.jwt' } });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => 'forbidden',
        json: async () => ({}),
      }),
    );

    await expect(
      getAccessToken('sa@proj.iam.gserviceaccount.com', 'capture@example.com'),
    ).rejects.toThrow(/403/);
  });

  it('throws when the token exchange response has no access_token', async () => {
    requestMock.mockResolvedValue({ data: { signedJwt: 'iam.signed.jwt' } });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({}),
      }),
    );

    await expect(
      getAccessToken('sa@proj.iam.gserviceaccount.com', 'capture@example.com'),
    ).rejects.toThrow(/no access_token/);
  });
});
