import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../prisma/client';
import { ForbiddenError, NotFoundError } from '../utils/errors';

type AuthorizationClient = PrismaClient | Prisma.TransactionClient;

export type ProjectRole = 'OWNER' | 'MEMBER' | 'VIEWER';
export type WorkspaceRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';

const roleToWorkspaceRoles: Record<ProjectRole, WorkspaceRole[]> = {
  OWNER: ['OWNER', 'ADMIN'],
  MEMBER: ['MEMBER'],
  VIEWER: ['VIEWER'],
};

const allProjectRoles: ProjectRole[] = ['OWNER', 'MEMBER', 'VIEWER'];

export const projectAccessWhere = (
  userId: string,
  projectRoles: ProjectRole[],
  projectId?: string
): Prisma.ProjectWhereInput => {
  const workspaceRoles = [...new Set(projectRoles.flatMap((role) => roleToWorkspaceRoles[role]))];
  const accessConditions: Prisma.ProjectWhereInput[] = [];

  if (projectRoles.includes('OWNER')) {
    accessConditions.push({ ownerId: userId });
  }

  if (workspaceRoles.length > 0) {
    accessConditions.push({
      workspace: {
        is: {
          members: {
            some: {
              userId,
              role: { in: workspaceRoles },
            },
          },
        },
      },
    });
  }

  return {
    ...(projectId ? { id: projectId } : {}),
    OR: accessConditions,
  };
};

export const requireProjectAccess = async (
  projectId: string,
  userId: string,
  allowedRoles: ProjectRole[],
  db: AuthorizationClient = prisma
): Promise<{ id: string; ownerId: string; workspaceId: string | null; role: ProjectRole }> => {
  const project = await db.project.findFirst({
    where: projectAccessWhere(userId, allProjectRoles, projectId),
    select: { id: true, ownerId: true, workspaceId: true },
  });

  if (!project) {
    throw new NotFoundError('Project', projectId);
  }

  let role: ProjectRole | undefined;
  if (project.ownerId === userId) {
    role = 'OWNER';
  } else if (project.workspaceId) {
    const membership = await db.workspaceMember.findUnique({
      where: {
        userId_workspaceId: {
          userId,
          workspaceId: project.workspaceId,
        },
      },
      select: { role: true },
    });

    if (membership?.role === 'OWNER' || membership?.role === 'ADMIN') {
      role = 'OWNER';
    } else if (membership?.role === 'MEMBER' || membership?.role === 'VIEWER') {
      role = membership.role;
    }
  }

  if (!role || !allowedRoles.includes(role)) {
    throw new ForbiddenError('You do not have permission to access this project');
  }

  return { ...project, role };
};

export const requireWorkspaceRole = async (
  userId: string,
  workspaceId: string,
  allowedRoles: WorkspaceRole[],
  db: AuthorizationClient = prisma
): Promise<void> => {
  const membership = await db.workspaceMember.findUnique({
    where: {
      userId_workspaceId: {
        userId,
        workspaceId,
      },
    },
    select: { role: true },
  });

  if (!membership || !allowedRoles.some((role) => role === membership.role)) {
    throw new ForbiddenError('You do not have the required workspace role');
  }
};
