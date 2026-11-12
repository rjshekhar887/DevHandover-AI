import express from 'express';
import { createServer, Server } from 'node:http';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    project: {
      findMany: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    workspaceMember: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock('../config', () => ({
  config: { JWT_SECRET: 'project-route-test-secret' },
  isDevelopment: false,
  isProduction: false,
  isTest: true,
}));

vi.mock('../prisma/client', () => ({ prisma: prismaMock }));

import projectRoutes from '../routes/projectRoutes';
import { errorHandler } from '../middleware/errorHandler';

type TestProject = {
  id: string;
  name: string;
  status: string;
  ownerId: string;
  workspaceId: string | null;
  repositories: unknown[];
};

type TestMembership = {
  userId: string;
  workspaceId: string;
  role: string;
};

type TestWhere = {
  id?: string;
  ownerId?: string;
  workspaceId?: string | { in?: Array<string | null> };
  status?: string;
  OR?: TestWhere[];
  AND?: TestWhere[];
  workspace?: {
    is?: {
      members?: {
        some?: {
          userId: string;
          role?: { in: string[] };
        };
      };
    };
  };
};

type TestProjectCreateData = {
  name: string;
  ownerId: string;
  workspaceId: string | null;
};

const USER_A = `c${'a'.repeat(23)}1`;
const USER_B = `c${'b'.repeat(23)}2`;
const PROJECT_A = `c${'p'.repeat(23)}1`;
const PROJECT_B = `c${'q'.repeat(23)}2`;
const PROJECT_WORKSPACE = `c${'r'.repeat(23)}3`;
const WORKSPACE_A = `c${'w'.repeat(23)}1`;
const WORKSPACE_B = `c${'x'.repeat(23)}2`;
const SECRET = 'project-route-test-secret';

let projects: TestProject[] = [];
let memberships: TestMembership[] = [];
let createdProjectNumber = 0;
let server: Server;
let baseUrl: string;

const matchesWhere = (project: TestProject, where: TestWhere): boolean => {
  if (where.id && project.id !== where.id) return false;
  if (where.ownerId && project.ownerId !== where.ownerId) return false;
  if (typeof where.workspaceId === 'string' && project.workspaceId !== where.workspaceId) return false;
  if (typeof where.workspaceId === 'object' && where.workspaceId.in && !where.workspaceId.in.includes(project.workspaceId)) return false;
  if (where.status && project.status !== where.status) return false;
  if (where.OR && !where.OR.some((condition) => matchesWhere(project, condition))) return false;
  if (where.AND && !where.AND.every((condition) => matchesWhere(project, condition))) return false;

  const memberFilter = where.workspace?.is?.members?.some;
  if (memberFilter) {
    const hasMembership = memberships.some((membership) =>
      membership.userId === memberFilter.userId
      && membership.workspaceId === project.workspaceId
      && (!memberFilter.role?.in || memberFilter.role.in.includes(membership.role))
    );
    if (!hasMembership) return false;
  }

  return true;
};

const tokenFor = (userId: string): string =>
  jwt.sign({ email: `${userId}@example.test` }, SECRET, { subject: userId, expiresIn: '10m' });

const request = async (
  method: string,
  path: string,
  userId?: string,
  body?: Record<string, unknown>
): Promise<Response> => {
  const headers = new Headers();
  if (userId) headers.set('Authorization', `Bearer ${tokenFor(userId)}`);
  if (body) headers.set('Content-Type', 'application/json');
  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
};

const responsePayload = async <T>(response: Response): Promise<{ data: T; error: { message: string } }> =>
  response.json() as Promise<{ data: T; error: { message: string } }>;

describe('Project route authorization', () => {
  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/projects', projectRoutes);
    app.use(errorHandler);
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
    projects = [
      { id: PROJECT_A, name: 'Personal A', status: 'ACTIVE', ownerId: USER_A, workspaceId: null, repositories: [] },
      { id: PROJECT_B, name: 'Personal B', status: 'ACTIVE', ownerId: USER_B, workspaceId: null, repositories: [] },
      { id: PROJECT_WORKSPACE, name: 'Workspace project', status: 'ACTIVE', ownerId: USER_B, workspaceId: WORKSPACE_A, repositories: [] },
    ];
    memberships = [];
    createdProjectNumber = 0;
    vi.clearAllMocks();

    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof prismaMock) => Promise<unknown>) =>
      callback(prismaMock)
    );
    prismaMock.project.findMany.mockImplementation(({ where, skip, take }: { where: TestWhere; skip: number; take: number }) =>
      projects.filter((project) => matchesWhere(project, where)).slice(skip, skip + take)
    );
    prismaMock.project.count.mockImplementation(({ where }: { where: TestWhere }) =>
      projects.filter((project) => matchesWhere(project, where)).length
    );
    prismaMock.project.findFirst.mockImplementation(({ where }: { where: TestWhere }) => {
      const project = projects.find((candidate) => matchesWhere(candidate, where));
      return project ? { ...project, repositories: project.repositories } : null;
    });
    prismaMock.project.create.mockImplementation(({ data }: { data: TestProjectCreateData }) => {
      createdProjectNumber += 1;
      const project = {
        id: `c${'n'.repeat(23)}${createdProjectNumber}`,
        name: data.name,
        status: 'ACTIVE',
        ownerId: data.ownerId,
        workspaceId: data.workspaceId,
        repositories: [],
      };
      projects.push(project);
      return project;
    });
    prismaMock.project.updateMany.mockImplementation(({ where, data }: { where: TestWhere; data: Record<string, unknown> }) => {
      const project = projects.find((candidate) => matchesWhere(candidate, where));
      if (!project) return { count: 0 };
      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined) Object.assign(project, { [key]: value });
      }
      return { count: 1 };
    });
    prismaMock.project.deleteMany.mockImplementation(({ where }: { where: TestWhere }) => {
      const originalLength = projects.length;
      projects = projects.filter((project) => !matchesWhere(project, where));
      return { count: originalLength - projects.length };
    });
    prismaMock.workspaceMember.findUnique.mockImplementation(({ where }: { where: { userId_workspaceId: TestMembership } }) => {
      const key = where.userId_workspaceId;
      const membership = memberships.find((item) =>
        item.userId === key.userId && item.workspaceId === key.workspaceId
      );
      return membership ? { role: membership.role } : null;
    });
    prismaMock.workspaceMember.findMany.mockImplementation(({ where }: { where: { userId: string } }) =>
      memberships
        .filter((membership) => membership.userId === where.userId)
        .map((membership) => ({ workspaceId: membership.workspaceId }))
    );
  });

  it('rejects unauthenticated requests to every project endpoint, including analysis', async () => {
    const responses = await Promise.all([
      request('GET', '/projects'),
      request('POST', '/projects', undefined, { name: 'Unauthenticated' }),
      request('GET', `/projects/${PROJECT_A}`),
      request('PATCH', `/projects/${PROJECT_A}`, undefined, { name: 'Changed' }),
      request('DELETE', `/projects/${PROJECT_A}`),
      request('POST', `/projects/${PROJECT_A}/analyze`, undefined, {}),
    ]);

    expect(responses.map((response) => response.status)).toEqual([401, 401, 401, 401, 401, 401]);
    expect(prismaMock.project.findMany).not.toHaveBeenCalled();
    expect(prismaMock.project.create).not.toHaveBeenCalled();
  });

  it("lists only owned projects and projects in the user's workspaces", async () => {
    memberships.push({ userId: USER_A, workspaceId: WORKSPACE_A, role: 'MEMBER' });

    const response = await request('GET', '/projects', USER_A);
    const payload = await responsePayload<TestProject[]>(response);

    expect(response.status).toBe(200);
    expect(payload.data.map((project: TestProject) => project.id)).toEqual([PROJECT_A, PROJECT_WORKSPACE]);
    expect(prismaMock.project.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ OR: expect.any(Array) }),
    }));
  });

  it('allows workspace members to list that workspace but denies non-members', async () => {
    const denied = await request('GET', `/projects?workspaceId=${WORKSPACE_A}`, USER_A);
    expect(denied.status).toBe(403);

    memberships.push({ userId: USER_A, workspaceId: WORKSPACE_A, role: 'VIEWER' });
    const allowed = await request('GET', `/projects?workspaceId=${WORKSPACE_A}`, USER_A);
    const payload = await responsePayload<TestProject[]>(allowed);

    expect(allowed.status).toBe(200);
    expect(payload.data.map((project: TestProject) => project.id)).toEqual([PROJECT_WORKSPACE]);
  });

  it('allows project owners and workspace members to read, but not outsiders', async () => {
    expect((await request('GET', `/projects/${PROJECT_A}`, USER_A)).status).toBe(200);
    expect((await request('GET', `/projects/${PROJECT_B}`, USER_A)).status).toBe(404);

    memberships.push({ userId: USER_A, workspaceId: WORKSPACE_A, role: 'VIEWER' });
    expect((await request('GET', `/projects/${PROJECT_WORKSPACE}`, USER_A)).status).toBe(200);
  });

  it('allows owners and workspace members to update, but enforces viewer read-only access', async () => {
    const owner = await request('PATCH', `/projects/${PROJECT_A}`, USER_A, { name: 'Owner edit' });
    expect(owner.status).toBe(200);
    expect(projects.find((project) => project.id === PROJECT_A)?.name).toBe('Owner edit');

    const outsider = await request('PATCH', `/projects/${PROJECT_B}`, USER_A, { name: 'Unauthorized' });
    expect(outsider.status).toBe(404);
    expect(projects.find((project) => project.id === PROJECT_B)?.name).toBe('Personal B');

    memberships.push({ userId: USER_A, workspaceId: WORKSPACE_A, role: 'VIEWER' });
    const viewer = await request('PATCH', `/projects/${PROJECT_WORKSPACE}`, USER_A, { name: 'Viewer edit' });
    expect(viewer.status).toBe(403);

    memberships[0].role = 'MEMBER';
    const member = await request('PATCH', `/projects/${PROJECT_WORKSPACE}`, USER_A, { name: 'Member edit' });
    expect(member.status).toBe(200);
    expect(projects.find((project) => project.id === PROJECT_WORKSPACE)?.name).toBe('Member edit');
  });

  it('allows project owners and workspace admins to delete, but not members or viewers', async () => {
    const outsider = await request('DELETE', `/projects/${PROJECT_B}`, USER_A);
    expect(outsider.status).toBe(404);
    expect(projects.some((project) => project.id === PROJECT_B)).toBe(true);

    memberships.push({ userId: USER_A, workspaceId: WORKSPACE_A, role: 'MEMBER' });
    expect((await request('DELETE', `/projects/${PROJECT_WORKSPACE}`, USER_A)).status).toBe(403);
    expect(projects.some((project) => project.id === PROJECT_WORKSPACE)).toBe(true);

    memberships[0].role = 'ADMIN';
    expect((await request('DELETE', `/projects/${PROJECT_WORKSPACE}`, USER_A)).status).toBe(204);
    expect(projects.some((project) => project.id === PROJECT_WORKSPACE)).toBe(false);

    expect((await request('DELETE', `/projects/${PROJECT_A}`, USER_A)).status).toBe(204);
    expect(projects.some((project) => project.id === PROJECT_A)).toBe(false);
  });

  it('derives ownership from the authenticated user and rejects owner overrides', async () => {
    const denied = await request('POST', '/projects', USER_A, {
      name: 'Impersonated owner',
      ownerId: USER_B,
    });
    expect(denied.status).toBe(403);
    expect(prismaMock.project.create).not.toHaveBeenCalled();

    const created = await request('POST', '/projects', USER_A, { name: 'Personal project' });
    const payload = await responsePayload<TestProject>(created);
    expect(created.status).toBe(201);
    expect(payload.data.ownerId).toBe(USER_A);
    expect(projects.at(-1)?.ownerId).toBe(USER_A);
  });

  it('allows project creation only for members with write-capable workspace roles', async () => {
    const outsider = await request('POST', '/projects', USER_A, {
      name: 'Unauthorized workspace project',
      workspaceId: WORKSPACE_A,
    });
    expect(outsider.status).toBe(403);

    memberships.push({ userId: USER_A, workspaceId: WORKSPACE_A, role: 'VIEWER' });
    const viewer = await request('POST', '/projects', USER_A, {
      name: 'Viewer workspace project',
      workspaceId: WORKSPACE_A,
    });
    expect(viewer.status).toBe(403);

    memberships[0].role = 'MEMBER';
    const member = await request('POST', '/projects', USER_A, {
      name: 'Member workspace project',
      workspaceId: WORKSPACE_A,
    });
    const payload = await responsePayload<TestProject>(member);
    expect(member.status).toBe(201);
    expect(payload.data.ownerId).toBe(USER_A);
    expect(payload.data.workspaceId).toBe(WORKSPACE_A);
  });

  it('grants workspace owners owner-level project permissions', async () => {
    memberships.push({ userId: USER_A, workspaceId: WORKSPACE_A, role: 'OWNER' });
    const created = await request('POST', '/projects', USER_A, {
      name: 'Workspace owner project',
      workspaceId: WORKSPACE_A,
    });
    const payload = await responsePayload<TestProject>(created);

    expect(created.status).toBe(201);
    expect((await request('PATCH', `/projects/${payload.data.id}`, USER_A, { name: 'Owner updated' })).status).toBe(200);
    expect((await request('DELETE', `/projects/${payload.data.id}`, USER_A)).status).toBe(204);
  });

  it('requires workspace admins to transfer projects between workspaces', async () => {
    memberships.push({ userId: USER_A, workspaceId: WORKSPACE_A, role: 'MEMBER' });
    memberships.push({ userId: USER_A, workspaceId: WORKSPACE_B, role: 'ADMIN' });

    const denied = await request('PATCH', `/projects/${PROJECT_WORKSPACE}`, USER_A, {
      workspaceId: WORKSPACE_B,
    });
    expect(denied.status).toBe(403);
    expect(projects.find((project) => project.id === PROJECT_WORKSPACE)?.workspaceId).toBe(WORKSPACE_A);

    memberships[0].role = 'ADMIN';
    const allowed = await request('PATCH', `/projects/${PROJECT_WORKSPACE}`, USER_A, {
      workspaceId: WORKSPACE_B,
    });
    expect(allowed.status).toBe(200);
    expect(projects.find((project) => project.id === PROJECT_WORKSPACE)?.workspaceId).toBe(WORKSPACE_B);
  });

  it('keeps project analysis authenticated and owner-scoped', async () => {
    const unauthenticated = await request('POST', `/projects/${PROJECT_A}/analyze`, undefined, {});
    expect(unauthenticated.status).toBe(401);

    const otherUser = await request('POST', `/projects/${PROJECT_B}/analyze`, USER_A, {});
    expect(otherUser.status).toBe(400);

    const owner = await request('POST', `/projects/${PROJECT_A}/analyze`, USER_A, {});
    const payload = await responsePayload<{ message: string }>(owner);
    expect(owner.status).toBe(400);
    expect(payload.error.message).toContain('completed repository ingestion');
  });
});
