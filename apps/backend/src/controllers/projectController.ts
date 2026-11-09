/**
 * Project Controller
 * Handles CRUD operations for projects
 */

import { Request, Response } from 'express';
import { prisma } from '../prisma/client';
import { asyncHandler } from '../middleware/errorHandler';
import { NotFoundError, BadRequestError } from '../utils/errors';

/**
 * GET /api/v1/projects
 * List all projects with optional filtering
 */
export const listProjects = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { workspaceId, status, page = '1', limit = '20' } = req.query;

  const pageNum = Math.max(1, parseInt(page as string, 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10)));
  const skip = (pageNum - 1) * limitNum;

  const where: Record<string, unknown> = {};

  if (workspaceId) {
    where.workspaceId = workspaceId;
  }

  if (status) {
    where.status = status;
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

  if (!name) {
    throw new BadRequestError('Project name is required');
  }

  // If workspaceId provided, verify it exists
  if (workspaceId) {
    const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace) {
      throw new NotFoundError('Workspace', workspaceId);
    }
  }

  // If ownerId provided, verify it exists
  let finalOwnerId = ownerId;
  if (!finalOwnerId) {
    // TODO: Get from authenticated user
    // For now, find or create a default user
    let defaultUser = await prisma.user.findFirst();
    if (!defaultUser) {
      defaultUser = await prisma.user.create({
        data: {
          email: 'demo@devhandover.ai',
          name: 'Demo User',
        },
      });
    }
    finalOwnerId = defaultUser.id;
  } else {
    const owner = await prisma.user.findUnique({ where: { id: finalOwnerId } });
    if (!owner) {
      throw new NotFoundError('User', finalOwnerId);
    }
  }

  const project = await prisma.project.create({
    data: {
      name,
      description,
      repositoryUrl,
      workspaceId,
      ownerId: finalOwnerId,
    },
    include: {
      owner: {
        select: { id: true, name: true, email: true, avatarUrl: true },
      },
      workspace: {
        select: { id: true, name: true },
      },
    },
  });

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

  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      owner: {
        select: { id: true, name: true, email: true, avatarUrl: true },
      },
      workspace: {
        select: { id: true, name: true },
      },
      repositories: true,
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
      },
      documents: {
        orderBy: { createdAt: 'desc' },
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
export const updateProject = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { name, description, status, repositoryUrl, workspaceId } = req.body;

  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) {
    throw new NotFoundError('Project', id);
  }

  // If workspaceId provided, verify it exists
  if (workspaceId) {
    const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace) {
      throw new NotFoundError('Workspace', workspaceId);
    }
  }

  const updated = await prisma.project.update({
    where: { id },
    data: {
      name,
      description,
      status,
      repositoryUrl,
      workspaceId,
    },
    include: {
      owner: {
        select: { id: true, name: true, email: true, avatarUrl: true },
      },
      workspace: {
        select: { id: true, name: true },
      },
    },
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

  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) {
    throw new NotFoundError('Project', id);
  }

  await prisma.project.delete({ where: { id } });

  res.status(204).send();
});