import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    repositoryIngestion: {
      findFirst: vi.fn(),
    },
    repositoryFile: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock('../prisma/client', () => ({ prisma: prismaMock }));
vi.mock('../config', () => ({
  config: { LOG_LEVEL: 'error' },
  isDevelopment: false,
  isProduction: false,
  isTest: true,
}));
vi.mock('./githubService', () => ({
  fetchRepositoryTree: vi.fn(),
  fetchFileContent: vi.fn(),
}));

import { getIngestedFiles, getIngestionStatus } from './ingestionService';

const USER_A = 'user-a';
const INGESTION_ID = 'ingestion-1';
const REPOSITORY_ID = 'repository-1';

const expectAuthorizedIngestionFilter = (where: Record<string, any>, userId: string): void => {
  expect(where.id).toBe(INGESTION_ID);
  const repositoryAccess = where.repository.is.OR as Array<Record<string, any>>;
  const linkedProject = repositoryAccess.find((condition) => condition.project);
  const unlinkedRepository = repositoryAccess.find((condition) => condition.projectId === null);

  expect(linkedProject?.project.is.OR).toEqual(expect.arrayContaining([
    { ownerId: userId },
    {
      workspace: {
        is: {
          members: {
            some: {
              userId,
              role: { in: ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] },
            },
          },
        },
      },
    },
  ]));
  expect(unlinkedRepository).toEqual({
    projectId: null,
    githubConnection: { is: { userId } },
  });
};

describe('Ingestion resource authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof prismaMock) => Promise<unknown>) =>
      callback(prismaMock)
    );
  });

  it('scopes status lookup to workspace/project access or ownership of the unlinked repository connection', async () => {
    prismaMock.repositoryIngestion.findFirst.mockResolvedValue({
      id: INGESTION_ID,
      repositoryId: REPOSITORY_ID,
      status: 'COMPLETED',
    });

    const ingestion = await getIngestionStatus(INGESTION_ID, USER_A);

    expect(ingestion).toMatchObject({ id: INGESTION_ID, status: 'COMPLETED' });
    expectAuthorizedIngestionFilter(
      prismaMock.repositoryIngestion.findFirst.mock.calls[0][0].where,
      USER_A
    );
  });

  it('returns no status record when the authorization-scoped query finds none', async () => {
    prismaMock.repositoryIngestion.findFirst.mockResolvedValue(null);

    const ingestion = await getIngestionStatus(INGESTION_ID, USER_A);

    expect(ingestion).toBeNull();
    expectAuthorizedIngestionFilter(
      prismaMock.repositoryIngestion.findFirst.mock.calls[0][0].where,
      USER_A
    );
  });

  it('scopes source-file queries to the authorized ingestion repository and selected project roles', async () => {
    prismaMock.repositoryIngestion.findFirst.mockResolvedValue({
      id: INGESTION_ID,
      repositoryId: REPOSITORY_ID,
    });
    prismaMock.repositoryFile.findMany.mockResolvedValue([{ path: 'src/index.ts', content: 'source' }]);
    prismaMock.repositoryFile.count.mockResolvedValue(1);

    const result = await getIngestedFiles(INGESTION_ID, USER_A, {
      page: 1,
      limit: 50,
    });

    expect(result.data).toEqual([{ path: 'src/index.ts', content: 'source' }]);
    const ingestionWhere = prismaMock.repositoryIngestion.findFirst.mock.calls[0][0].where;
    expectAuthorizedIngestionFilter(ingestionWhere, USER_A);

    const fileWhere = prismaMock.repositoryFile.findMany.mock.calls[0][0].where;
    expect(fileWhere.repositoryId).toBe(REPOSITORY_ID);
    expectAuthorizedIngestionFilter(
      {
        id: INGESTION_ID,
        repository: fileWhere.repository,
      },
      USER_A
    );
    expect(prismaMock.repositoryFile.findMany.mock.calls[0][0].select.content).toBe(true);
  });

  it('does not read source files if the ingestion is outside the caller’s authorized scope', async () => {
    prismaMock.repositoryIngestion.findFirst.mockResolvedValue(null);

    await expect(getIngestedFiles(INGESTION_ID, USER_A, {
      page: 1,
      limit: 50,
    })).rejects.toThrow('Ingestion with id ingestion-1 not found');

    expect(prismaMock.repositoryFile.findMany).not.toHaveBeenCalled();
    expect(prismaMock.repositoryFile.count).not.toHaveBeenCalled();
  });
});
