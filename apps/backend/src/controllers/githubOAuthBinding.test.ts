import express from 'express';
import { createServer, Server } from 'node:http';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { githubServiceMock } = vi.hoisted(() => ({
  githubServiceMock: {
    generateOAuthState: vi.fn(),
    buildOAuthUrl: vi.fn(),
    exchangeCodeForToken: vi.fn(),
    fetchGitHubUser: vi.fn(),
    fetchGitHubEmails: vi.fn(),
    upsertGitHubConnection: vi.fn(),
    getGitHubConnection: vi.fn(),
    deleteGitHubConnection: vi.fn(),
    decryptToken: vi.fn(),
    fetchUserRepositories: vi.fn(),
    fetchRepository: vi.fn(),
    fetchRepositoryTree: vi.fn(),
    fetchFileContent: vi.fn(),
  },
}));

const JWT_SECRET = 'github-oauth-binding-test-secret';
const USER_ID = `c${'u'.repeat(23)}1`;
const COOKIE_NAME = 'github_oauth_binding';

vi.mock('../config', () => ({
  config: {
    JWT_SECRET: 'github-oauth-binding-test-secret',
    GITHUB_CLIENT_ID: 'test-client-id',
    GITHUB_CLIENT_SECRET: 'test-client-secret',
    CORS_ORIGIN: 'http://localhost:5173',
    API_PREFIX: '/api/v1',
  },
  isProduction: false,
  isDevelopment: false,
  isTest: true,
}));
vi.mock('../prisma/client', () => ({ prisma: {} }));
vi.mock('../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock('../services/projectAuthorization', () => ({
  projectAccessWhere: vi.fn(),
  requireProjectAccess: vi.fn(),
}));
vi.mock('../services/githubService', () => githubServiceMock);
vi.mock('../services/ingestionService', () => ({
  startRepositoryIngestion: vi.fn(),
  getIngestionStatus: vi.fn(),
  getIngestedFiles: vi.fn(),
}));

import githubRoutes from '../routes/githubRoutes.js';

let server: Server;
let baseUrl: string;

const tokenFor = (userId: string): string =>
  jwt.sign({ email: `${userId}@example.test` }, JWT_SECRET, { subject: userId, expiresIn: '1h' });

const initiate = async (authorization = `Bearer ${tokenFor(USER_ID)}`): Promise<Response> =>
  fetch(`${baseUrl}/api/v1/github/auth?redirectUri=${encodeURIComponent('http://localhost:5173/github/callback')}`, {
    headers: authorization ? new Headers({ Authorization: authorization }) : new Headers(),
    redirect: 'manual',
  });

const bindingCookieFrom = (response: Response): string => {
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) throw new Error('OAuth initiation did not set a browser-binding cookie');
  return setCookie.split(';', 1)[0];
};

const callback = (
  query: string,
  cookie?: string
): Promise<Response> => {
  const headers = new Headers();
  if (cookie) headers.set('Cookie', cookie);
  return fetch(`${baseUrl}/api/v1/github/callback?${query}`, {
    headers,
    redirect: 'manual',
  });
};

describe('GitHub OAuth browser binding', () => {
  beforeAll(async () => {
    const app = express();
    app.use('/api/v1/github', githubRoutes);
    app.use((error: { statusCode?: number; message?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(error.statusCode || 500).json({ error: error.message });
    });

    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not start');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    let generated = 0;
    githubServiceMock.generateOAuthState.mockImplementation(() =>
      `${'a'.repeat(42)}${++generated}`
    );
    githubServiceMock.buildOAuthUrl.mockImplementation((state: string) =>
      `https://github.com/login/oauth/authorize?state=${state}`
    );
    githubServiceMock.exchangeCodeForToken.mockResolvedValue({
      access_token: 'oauth-test-token',
      scope: 'repo',
      token_type: 'bearer',
    });
    githubServiceMock.fetchGitHubUser.mockResolvedValue({
      id: 123,
      login: 'test-user',
      name: 'Test User',
      email: 'test@example.test',
      avatar_url: 'https://example.test/avatar.png',
    });
    githubServiceMock.fetchGitHubEmails.mockResolvedValue([]);
    githubServiceMock.upsertGitHubConnection.mockResolvedValue({});
  });

  it('requires an authenticated initiator and sets a short-lived HttpOnly browser-binding cookie', async () => {
    const unauthenticated = await initiate('');
    expect(unauthenticated.status).toBe(401);
    expect(githubServiceMock.generateOAuthState).not.toHaveBeenCalled();

    const response = await initiate();
    const payload = await response.json() as { data: { state: string; authUrl: string } };
    const setCookie = response.headers.get('set-cookie') || '';

    expect(response.status).toBe(200);
    expect(payload.data.state).toBe(`${'a'.repeat(42)}1`);
    expect(payload.data.authUrl).toContain(payload.data.state);
    expect(githubServiceMock.generateOAuthState).toHaveBeenCalledTimes(2);
    expect(setCookie).toContain(`${COOKIE_NAME}=`);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Path=/api/v1/github/callback');
    expect(setCookie).toMatch(/Max-Age=600/i);
  });

  it('links the GitHub account to the initiating user only when state and browser binding match', async () => {
    const initiation = await initiate();
    const cookie = bindingCookieFrom(initiation);
    const { data } = await initiation.json() as { data: { state: string } };

    const response = await callback(`code=github-code&state=${data.state}`, cookie);

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('http://localhost:5173/github/callback');
    expect(response.headers.get('set-cookie')).toContain('Expires=Thu, 01 Jan 1970');
    expect(githubServiceMock.exchangeCodeForToken).toHaveBeenCalledWith('github-code');
    expect(githubServiceMock.upsertGitHubConnection).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ login: 'test-user' }),
      'oauth-test-token',
      'repo'
    );
  });

  it('rejects a missing or mismatched browser binding and consumes the state without linking', async () => {
    const initiation = await initiate();
    const cookie = bindingCookieFrom(initiation);
    const { data } = await initiation.json() as { data: { state: string } };
    const query = `code=github-code&state=${data.state}`;

    const missingCookie = await callback(query);
    expect(missingCookie.status).toBe(400);
    expect(missingCookie.headers.get('set-cookie')).toContain('Expires=Thu, 01 Jan 1970');

    const secondInitiation = await initiate();
    const secondCookie = bindingCookieFrom(secondInitiation);
    const second = await secondInitiation.json() as { data: { state: string } };
    const mismatch = await callback(`code=github-code&state=${second.data.state}`, `${COOKIE_NAME}=${'z'.repeat(43)}`);
    expect(mismatch.status).toBe(400);
    expect(mismatch.headers.get('set-cookie')).toContain('Expires=Thu, 01 Jan 1970');

    const replay = await callback(`code=github-code&state=${second.data.state}`, secondCookie);
    expect(replay.status).toBe(400);
    expect(githubServiceMock.exchangeCodeForToken).not.toHaveBeenCalled();
    expect(githubServiceMock.upsertGitHubConnection).not.toHaveBeenCalled();
    expect(cookie).toContain(`${COOKIE_NAME}=`);
  });

  it('rejects expired state and does not exchange the authorization code', async () => {
    const initiation = await initiate();
    const cookie = bindingCookieFrom(initiation);
    const { data } = await initiation.json() as { data: { state: string } };
    const initiatedAt = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(initiatedAt + 11 * 60 * 1000);

    const response = await callback(`code=github-code&state=${data.state}`, cookie);

    expect(response.status).toBe(400);
    expect(response.headers.get('set-cookie')).toContain('Expires=Thu, 01 Jan 1970');
    expect(githubServiceMock.exchangeCodeForToken).not.toHaveBeenCalled();
    expect(githubServiceMock.upsertGitHubConnection).not.toHaveBeenCalled();
  });

  it('validates state and browser binding for GitHub-declined authorization', async () => {
    const initiation = await initiate();
    const cookie = bindingCookieFrom(initiation);
    const { data } = await initiation.json() as { data: { state: string } };

    const response = await callback(
      `error=access_denied&error_description=${encodeURIComponent('User denied access')}&state=${data.state}`,
      cookie
    );

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toContain('error=access_denied');
    expect(response.headers.get('set-cookie')).toContain('Expires=Thu, 01 Jan 1970');
    expect(githubServiceMock.exchangeCodeForToken).not.toHaveBeenCalled();
    expect(githubServiceMock.upsertGitHubConnection).not.toHaveBeenCalled();
  });

  it('clears the binding cookie and rejects malformed callbacks', async () => {
    const response = await callback('code=github-code');

    expect(response.status).toBe(400);
    expect(response.headers.get('set-cookie')).toContain('Expires=Thu, 01 Jan 1970');
    expect(githubServiceMock.exchangeCodeForToken).not.toHaveBeenCalled();
    expect(githubServiceMock.upsertGitHubConnection).not.toHaveBeenCalled();
  });
});
