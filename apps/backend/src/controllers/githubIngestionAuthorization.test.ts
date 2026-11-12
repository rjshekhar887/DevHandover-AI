import express from 'express';
import { createServer, Server } from 'node:http';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import githubRoutes from '../routes/githubRoutes.js';

const { prismaMock, githubServiceMock, ingestionServiceMock } = vi.hoisted(() => ({
  prismaMock: {
    project: {
      findFirst: vi.fn(),
    },
    workspaceMember: {
      findUnique: vi.fn(),
    },
    repository: {
      findFirst: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  githubServiceMock: {
    getGitHubConnection: vi.fn(),
    decryptToken: vi.fn(),
    fetchRepository: vi.fn(),
  },
  ingestionServiceMock: {
    startRepositoryIngestion: vi.fn(),
    getIngestionStatus: vi.fn(),
    getIngestedFiles: vi.fn(),
  },
}));

const SECRET = 'github-ingestion-route-test-secret';
const USER_A = `c${'a'.repeat(23)}1`;
const USER_B = `c${'b'.repeat(23)}2`;
const PROJECT_A = `c${'p'.repeat(23)}1`;
const PROJECT_B = `c${'q'.repeat(23)}2`;
const REPOSITORY_ID = `c${'r'.repeat(23)}3`;

vi.mock('../config', () => ({
  config: { JWT_SECRET: 'github-ingestion-route-test-secret' },
  isDevelopment: false,
  isProduction: false,
  isTest: true,
}));
vi.mock('../prisma/client', () => ({ prisma: prismaMock }));
vi.mock('../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock('../services/githubService', () => ({
  generateOAuthState: vi.fn(),
  buildOAuthUrl: vi.fn(),
  exchangeCodeForToken: vi.fn(),
  fetchGitHubUser: vi.fn(),
  fetchGitHubEmails: vi.fn(),
  upsertGitHubConnection: vi.fn(),
  getGitHubConnection: githubServiceMock.getGitHubConnection,
  deleteGitHubConnection: vi.fn(),
  decryptToken: githubServiceMock.decryptToken,
  fetchUserRepositories: vi.fn(),
  fetchRepository: githubServiceMock.fetchRepository,
  fetchRepositoryTree: vi.fn(),
  fetchFileContent: vi.fn(),
}));
vi.mock('../services/ingestionService', () => ({
  startRepositoryIngestion: ingestionServiceMock.startRepositoryIngestion,
  getIngestionStatus: ingestionServiceMock.getIngestionStatus,
  getIngestedFiles: ingestionServiceMock.getIngestedFiles,
}));

let server: Server;
let baseUrl: string;

const tokenFor = (userId: string): string =>
  jwt.sign({ email: `${userId}@example.test` }, SECRET, { subject: userId, expiresIn: '10m' });

const request = async (projectId?: string): Promise<Response> => {
  const headers = new Headers({ Authorization: `Bearer ${tokenFor(USER_A)}` });
  if (projectId) headers.set('Content-Type', 'application/json');
  return fetch(`${baseUrl}/github/repositories/acme/project/ingest`, {
    method: 'POST',
    headers,
    body: projectId ? JSON.stringify({ projectId }) : JSON.stringify({}),
  });
};

describe('GitHub ingestion project authorization', () => {
  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/github', githubRoutes);
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
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof prismaMock) => Promise<unknown>) =>
      callback(prismaMock)
    );
    prismaMock.project.findFirst.mockImplementation(({ where }: { where: { id?: string; OR?: Array<{ ownerId?: string }> } }) => {
      const ownerId = where.OR?.find((condition) => condition.ownerId)?.ownerId;
      if (where.id === PROJECT_A && ownerId === USER_A) {
        return { id: PROJECT_A, ownerId: USER_A, workspaceId: null };
      }
      if (where.id === PROJECT_B && ownerId === USER_B) {
        return { id: PROJECT_B, ownerId: USER_B, workspaceId: null };
      }
      return null;
    });
    prismaMock.workspaceMember.findUnique.mockResolvedValue(null);
    prismaMock.repository.findFirst
      .mockResolvedValueOnce({
        id: REPOSITORY_ID,
        fullName: 'acme/project',
        projectId: null,
        defaultBranch: 'main',
      })
      .mockResolvedValueOnce({ projectId: null });
    prismaMock.repository.updateMany.mockResolvedValue({ count: 1 });
    githubServiceMock.getGitHubConnection.mockResolvedValue({
      id: 'connection-a',
      accessToken: 'test-token',
    });
    githubServiceMock.decryptToken.mockReturnValue('test-token');
    ingestionServiceMock.startRepositoryIngestion.mockResolvedValue({
      id: 'ingestion-a',
      status: 'PROCESSING',
    });
  });

  it('rejects linking to a project the authenticated user cannot access', async () => {
    const response = await request(PROJECT_B);

    expect(response.status).toBe(404);
    expect(prismaMock.repository.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.repository.updateMany).not.toHaveBeenCalled();
    expect(ingestionServiceMock.startRepositoryIngestion).not.toHaveBeenCalled();
  });

  it('authorizes and links a repository to an accessible project before starting ingestion', async () => {
    const response = await request(PROJECT_A);
    const payload = await response.json() as { data: { repositoryId: string } };

    expect(response.status).toBe(202);
    expect(payload.data.repositoryId).toBe(REPOSITORY_ID);
    expect(JSON.stringify(payload)).not.toContain('test-token');
    expect(JSON.stringify(payload)).not.toContain('gh-token:v2:');
    expect(githubServiceMock.decryptToken).toHaveBeenCalledWith('test-token', USER_A);
    expect(prismaMock.repository.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: REPOSITORY_ID,
        githubConnectionId: 'connection-a',
        projectId: null,
        AND: expect.arrayContaining([
          expect.objectContaining({
            project: {
              is: expect.objectContaining({
                id: PROJECT_A,
                OR: expect.arrayContaining([{ ownerId: USER_A }]),
              }),
            },
          }),
        ]),
      }),
      data: { projectId: PROJECT_A },
    }));
    expect(ingestionServiceMock.startRepositoryIngestion).toHaveBeenCalledWith(
      REPOSITORY_ID,
      'test-token',
      'acme',
      'project',
      'main'
    );
  });

  it('requires owner-level source-project access before moving a linked repository', async () => {
    prismaMock.repository.findFirst.mockReset()
      .mockResolvedValueOnce({
        id: REPOSITORY_ID,
        fullName: 'acme/project',
        projectId: PROJECT_B,
        defaultBranch: 'main',
      })
      .mockResolvedValueOnce({ projectId: PROJECT_B });

    const response = await request(PROJECT_A);

    expect(response.status).toBe(404);
    expect(prismaMock.repository.updateMany).not.toHaveBeenCalled();
    expect(ingestionServiceMock.startRepositoryIngestion).not.toHaveBeenCalled();
  });

  it('does not call GitHub or ingestion services when token decryption fails', async () => {
    githubServiceMock.decryptToken.mockImplementation(() => {
      throw new Error('Unable to access GitHub connection securely');
    });

    const response = await request();
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(body).not.toContain('test-token');
    expect(githubServiceMock.fetchRepository).not.toHaveBeenCalled();
    expect(ingestionServiceMock.startRepositoryIngestion).not.toHaveBeenCalled();
  });
});
