/**
 * Project Controller
 * Handles CRUD operations for projects
 */

import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma/client';
import { asyncHandler } from '../middleware/errorHandler';
import { NotFoundError, BadRequestError, ForbiddenError } from '../utils/errors';
import { analyzeProject } from '../services/analysisService';
import { projectAccessWhere, requireProjectAccess, requireWorkspaceRole } from '../services/projectAuthorization';

/**
 * GET /api/v1/projects
 * List all projects with optional filtering
 */
export const listProjects = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { workspaceId, status, page = '1', limit = '20' } = req.query;
  const userId = req.user!.id;

  const pageNum = Math.max(1, parseInt(page as string, 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10)));
  const skip = (pageNum - 1) * limitNum;

  const where: Prisma.ProjectWhereInput = {};

  if (workspaceId) {
    await requireWorkspaceRole(userId, workspaceId as string, ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER']);
    where.workspaceId = workspaceId as string;
    where.workspace = {
      is: {
        members: {
          some: {
            userId,
            role: { in: ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] },
          },
        },
      },
    };
  } else {
    where.OR = [
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
    ];
  }

  if (status) {
    where.status = status as string;
  }

  const [projects, total] = await Promise.all([
    prisma.project.findMany({
      where,
      skip,
      take: limitNum,
      orderBy: { createdAt: 'desc' },
      include: {
        owner: {
          select: { id: true, name: true, email: true, avatarUrl: true },
        },
        workspace: {
          select: { id: true, name: true },
        },
        _count: {
          select: { repositories: true, analyses: true, knowledgeGaps: true, risks: true },
        },
      },
    }),
    prisma.project.count({ where }),
  ]);

  res.json({
    success: true,
    data: projects,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum),
    },
  });
});

/**
 * POST /api/v1/projects
 * Create a new project
 */
export const createProject = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { name, description, repositoryUrl, workspaceId, ownerId } = req.body;
  const userId = req.user!.id;

  if (!name) {
    throw new BadRequestError('Project name is required');
  }

  if (ownerId && ownerId !== userId) {
    throw new ForbiddenError('A project owner must be the authenticated user');
  }

  const projectData = {
    name,
    description,
    repositoryUrl,
    workspaceId: workspaceId || null,
    ownerId: userId,
  };
  const projectInclude = {
    owner: {
      select: { id: true, name: true, email: true, avatarUrl: true },
    },
    workspace: {
      select: { id: true, name: true },
    },
  };
  const project = workspaceId
    ? await prisma.$transaction(async (tx) => {
      await requireWorkspaceRole(userId, workspaceId, ['OWNER', 'ADMIN', 'MEMBER'], tx);
      return tx.project.create({ data: projectData, include: projectInclude });
    })
    : await prisma.project.create({ data: projectData, include: projectInclude });

  res.status(201).json({
    success: true,
    data: project,
  });
});

/**
 * GET /api/v1/projects/:id
 * Get a single project by ID
 */
export const getProject = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const userId = req.user!.id;

  await requireProjectAccess(id, userId, ['OWNER', 'MEMBER', 'VIEWER']);

  const project = await prisma.project.findFirst({
    where: projectAccessWhere(userId, ['OWNER', 'MEMBER', 'VIEWER'], id),
    include: {
      owner: {
        select: { id: true, name: true, email: true, avatarUrl: true },
      },
      workspace: {
        select: { id: true, name: true },
      },
      repositories: {
        include: {
          ingestions: { orderBy: { createdAt: 'desc' }, take: 1 },
          _count: { select: { files: true } },
        },
      },
      analyses: {
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
      knowledgeGaps: {
        orderBy: { severity: 'desc' },
      },
      risks: {
        orderBy: { createdAt: 'desc' },
      },
      interviews: {
        orderBy: { createdAt: 'desc' },
        include: { questions: { orderBy: { order: 'asc' } } },
      },
      documents: {
        orderBy: { createdAt: 'desc' },
        include: { evidence: true },
      },
    },
  });

  if (!project) {
    throw new NotFoundError('Project', id);
  }

  res.json({
    success: true,
    data: project,
  });
});

/**
 * PATCH /api/v1/projects/:id
 * Update a project
 */
/**
 * POST /api/v1/projects/:id/analyze
 * Analyze only source files linked to the authenticated user's project.
 */
export const startProjectAnalysis = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const result = await analyzeProject(req.params.id, req.user!.id);
  res.status(201).json({ success: true, data: result });
});

export const updateProject = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { name, description, status, repositoryUrl, workspaceId } = req.body;
  const userId = req.user!.id;

  const updated = await prisma.$transaction(async (tx) => {
    const project = await requireProjectAccess(id, userId, ['OWNER', 'MEMBER'], tx);

    if (workspaceId !== undefined && workspaceId !== project.workspaceId) {
      if (project.workspaceId) {
        await requireWorkspaceRole(userId, project.workspaceId, ['OWNER', 'ADMIN'], tx);
      }
      if (workspaceId) {
        await requireWorkspaceRole(userId, workspaceId, ['OWNER', 'ADMIN'], tx);
      }
    }

    const updateResult = await tx.project.updateMany({
      where: projectAccessWhere(userId, ['OWNER', 'MEMBER'], id),
      data: {
        name,
        description,
        status,
        repositoryUrl,
        ...(workspaceId !== undefined ? { workspaceId } : {}),
      },
    });

    if (updateResult.count === 0) {
      throw new NotFoundError('Project', id);
    }

    const updatedProject = await tx.project.findFirst({
      where: projectAccessWhere(userId, ['OWNER', 'MEMBER'], id),
      include: {
        owner: {
          select: { id: true, name: true, email: true, avatarUrl: true },
        },
        workspace: {
          select: { id: true, name: true },
        },
      },
    });

    if (!updatedProject) {
      throw new NotFoundError('Project', id);
    }

    return updatedProject;
  });

  res.json({
    success: true,
    data: updated,
  });
});

/**
 * DELETE /api/v1/projects/:id
 * Delete a project
 */
export const deleteProject = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const userId = req.user!.id;

  await prisma.$transaction(async (tx) => {
    await requireProjectAccess(id, userId, ['OWNER'], tx);
    const result = await tx.project.deleteMany({
      where: projectAccessWhere(userId, ['OWNER'], id),
    });
    if (result.count === 0) {
      throw new NotFoundError('Project', id);
    }
  });

  res.status(204).send();
});