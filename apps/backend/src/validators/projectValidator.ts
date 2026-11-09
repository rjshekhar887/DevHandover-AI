/**
 * Project validation schemas using Zod
 */

import { z } from 'zod';

/**
 * Project creation schema
 */
export const createProjectSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Name is required').max(255),
    description: z.string().optional(),
    repositoryUrl: z.string().url('Invalid repository URL').optional().or(z.literal('')),
    workspaceId: z.string().cuid('Invalid workspace ID').optional(),
    ownerId: z.string().cuid('Invalid owner ID').optional(),
  }),
});

/**
 * Project update schema
 */
export const updateProjectSchema = z.object({
  body: z.object({
    name: z.string().min(1).max(255).optional(),
    description: z.string().optional(),
    status: z.enum(['ACTIVE', 'ARCHIVED', 'ON_HOLD', 'COMPLETED']).optional(),
    repositoryUrl: z.string().url().optional().or(z.literal('')),
    workspaceId: z.string().cuid().optional().nullable(),
  }),
  params: z.object({
    id: z.string().cuid('Invalid project ID'),
  }),
});

/**
 * Project ID param schema
 */
export const projectIdParamSchema = z.object({
  params: z.object({
    id: z.string().cuid('Invalid project ID'),
  }),
});

/**
 * Project list query schema
 */
export const listProjectsQuerySchema = z.object({
  query: z.object({
    workspaceId: z.string().cuid().optional(),
    status: z.enum(['ACTIVE', 'ARCHIVED', 'ON_HOLD', 'COMPLETED']).optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
  }),
});

// Type inference helpers
export type CreateProjectInput = z.infer<typeof createProjectSchema>['body'];
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>['body'];
export type ProjectIdParam = z.infer<typeof projectIdParamSchema>['params'];
export type ListProjectsQuery = z.infer<typeof listProjectsQuerySchema>['query'];