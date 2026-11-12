import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { githubServiceMock, prismaMock } = vi.hoisted(() => ({
  githubServiceMock: {
    getGitHubConnection: vi.fn(),
    decryptToken: vi.fn(),
    fetchUserRepositories: vi.fn(),
    fetchRepository: vi.fn(),
    fetchFileContent: vi.fn(),
  },
  prismaMock: {
    repository: {
      upsert: vi.fn(),
    },
  },
}));

vi.mock('../config', () => ({
  config: { API_PREFIX: '/api/v1', CORS_ORIGIN: 'http://localhost:5173' },
  isProduction: false,
}));
vi.mock('../prisma/client', () => ({ prisma: prismaMock }));
vi.mock('../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock('../services/projectAuthorization', () => ({
  projectAccessWhere: vi.fn(),
  requireProjectAccess: vi.fn(),
}));
vi.mock('../services/githubService', () => ({
  ...githubServiceMock,
  generateOAuthState: vi.fn(),
  buildOAuthUrl: vi.fn(),
  exchangeCodeForToken: vi.fn(),
  fetchGitHubUser: vi.fn(),
  fetchGitHubEmails: vi.fn(),
  upsertGitHubConnection: vi.fn(),
  deleteGitHubConnection: vi.fn(),
  fetchRepositoryTree: vi.fn(),
}));
vi.mock('../services/ingestionService', () => ({
  startRepositoryIngestion: vi.fn(),
  getIngestionStatus: vi.fn(),
  getIngestedFiles: vi.fn(),
}));

import {
  getFileContent,
  getRepository,
  listRepositories,
} from './githubController';

const USER_ID = 'platform-user-42';
const CIPHERTEXT = 'gh-token:v2:test-key:synthetic-envelope';
const DECRYPTED_TOKEN = 'synthetic-controller-test-token';

type ControllerHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => void;

function invoke(
  handler: ControllerHandler,
  params: Record<string, string> = {}
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const response = {
      json: (body: unknown) => {
        resolve(body);
        return response;
      },
      status: () => response,
    } as unknown as Response;
    const request = {
      user: { id: USER_ID },
      params,
      query: {},
      body: {},
      header: () => undefined,
    } as unknown as Request;

    handler(request, response, (error?: unknown) => {
      if (error) reject(error);
    });
  });
}

describe('GitHub token read controllers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    githubServiceMock.getGitHubConnection.mockResolvedValue({
      id: 'connection-1',
      accessToken: CIPHERTEXT,
    });
    githubServiceMock.decryptToken.mockReturnValue(DECRYPTED_TOKEN);
    githubServiceMock.fetchUserRepositories.mockResolvedValue({
      repositories: [],
      hasNextPage: false,
    });
    githubServiceMock.fetchRepository.mockResolvedValue({
      id: 123,
      name: 'repo',
      full_name: 'owner/repo',
      html_url: 'https://github.com/owner/repo',
      clone_url: 'https://github.com/owner/repo.git',
      default_branch: 'main',
      language: 'TypeScript',
      description: null,
      private: true,
      fork: false,
      size: 10,
      stargazers_count: 0,
      forks_count: 0,
      open_issues_count: 0,
      pushed_at: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    });
    githubServiceMock.fetchFileContent.mockResolvedValue({
      content: Buffer.from('safe file contents').toString('base64'),
      encoding: 'base64',
      size: 18,
      sha: 'file-sha',
    });
    prismaMock.repository.upsert.mockResolvedValue({
      id: 'repository-1',
      githubId: '123',
      name: 'repo',
      fullName: 'owner/repo',
      url: 'https://github.com/owner/repo',
      cloneUrl: 'https://github.com/owner/repo.git',
      defaultBranch: 'main',
      language: 'TypeScript',
      description: null,
      isPrivate: true,
      isFork: false,
      size: 10,
      stargazersCount: 0,
      forksCount: 0,
      openIssuesCount: 0,
      pushedAt: null,
      githubCreatedAt: new Date('2026-01-01T00:00:00Z'),
      githubUpdatedAt: new Date('2026-01-01T00:00:00Z'),
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });
  });

  it('decrypts repository-listing tokens for the authenticated user without returning them', async () => {
    const response = await invoke(listRepositories);

    expect(githubServiceMock.decryptToken).toHaveBeenCalledWith(CIPHERTEXT, USER_ID);
    expect(githubServiceMock.fetchUserRepositories).toHaveBeenCalledWith(
      DECRYPTED_TOKEN,
      expect.any(Object)
    );
    expect(JSON.stringify(response)).not.toContain(DECRYPTED_TOKEN);
    expect(JSON.stringify(response)).not.toContain(CIPHERTEXT);
  });

  it('decrypts repository-detail tokens for the authenticated user without returning them', async () => {
    const response = await invoke(getRepository, { owner: 'owner', repo: 'repo' });

    expect(githubServiceMock.decryptToken).toHaveBeenCalledWith(CIPHERTEXT, USER_ID);
    expect(githubServiceMock.fetchRepository).toHaveBeenCalledWith(
      DECRYPTED_TOKEN,
      'owner',
      'repo'
    );
    expect(JSON.stringify(response)).not.toContain(DECRYPTED_TOKEN);
    expect(JSON.stringify(response)).not.toContain(CIPHERTEXT);
  });

  it('decrypts file-access tokens for the authenticated user without returning them', async () => {
    const response = await invoke(getFileContent, {
      owner: 'owner',
      repo: 'repo',
      path: 'src/index.ts',
    });

    expect(githubServiceMock.decryptToken).toHaveBeenCalledWith(CIPHERTEXT, USER_ID);
    expect(githubServiceMock.fetchFileContent).toHaveBeenCalledWith(
      DECRYPTED_TOKEN,
      'owner',
      'repo',
      'src/index.ts',
      'main'
    );
    expect(JSON.stringify(response)).not.toContain(DECRYPTED_TOKEN);
    expect(JSON.stringify(response)).not.toContain(CIPHERTEXT);
  });

  it('does not make GitHub requests when strict decryption fails', async () => {
    githubServiceMock.decryptToken.mockImplementation(() => {
      throw new Error('Unable to access GitHub connection securely');
    });

    await expect(invoke(getRepository, { owner: 'owner', repo: 'repo' }))
      .rejects.toThrow('Unable to access GitHub connection securely');

    expect(githubServiceMock.fetchRepository).not.toHaveBeenCalled();
  });
});
