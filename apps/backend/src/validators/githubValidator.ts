/**
 * GitHub validation schemas using Zod
 */

import { z } from 'zod';

/**
 * OAuth initiation schema
 */
export const initiateOAuthSchema = z.object({
  query: z.object({
    // Optional: redirect URL after OAuth completion (for frontend integration)
    redirectUri: z.string().url().optional(),
  }),
});

/**
 * OAuth callback schema
 */
export const oauthCallbackSchema = z.object({
  query: z.object({
    code: z.string().min(1, 'Authorization code is required').optional(),
    state: z.string().min(1, 'State parameter is required'),
    error: z.string().min(1).optional(),
    error_description: z.string().optional(),
    error_uri: z.string().optional(),
  }),
}).refine(
  ({ query }) => Boolean(query.error) || Boolean(query.code),
  { path: ['query', 'code'], message: 'Authorization code is required unless GitHub returns an OAuth error' }
);

/**
 * Repository list query schema
 */
export const listRepositoriesSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    perPage: z.coerce.number().int().positive().max(100).default(30),
    sort: z.enum(['created', 'updated', 'pushed', 'full_name']).default('updated'),
    direction: z.enum(['asc', 'desc']).default('desc'),
    type: z.enum(['all', 'owner', 'public', 'private', 'member']).default('owner'),
  }),
});

/**
 * Repository detail params schema
 */
export const repositoryParamsSchema = z.object({
  params: z.object({
    owner: z.string().min(1, 'Owner is required'),
    repo: z.string().min(1, 'Repository name is required'),
  }),
});

/**
 * Repository ingestion start schema
 */
export const startIngestionSchema = z.object({
  body: z.object({
    branch: z.string().optional(),
    projectId: z.string().cuid('Invalid project ID').optional(),
  }),
});

/**
 * Ingestion status params schema
 */
export const ingestionStatusSchema = z.object({
  params: z.object({
    ingestionId: z.string().cuid('Invalid ingestion ID'),
  }),
});

/**
 * Repository file content params schema
 */
export const fileContentParamsSchema = z.object({
  params: z.object({
    owner: z.string().min(1, 'Owner is required'),
    repo: z.string().min(1, 'Repository name is required'),
    path: z.string().min(1, 'File path is required'),
    branch: z.string().optional(),
  }),
});

// Type inference helpers
export type InitiateOAuthQuery = z.infer<typeof initiateOAuthSchema>['query'];
export type OAuthCallbackQuery = z.infer<typeof oauthCallbackSchema>['query'];
export type ListRepositoriesQuery = z.infer<typeof listRepositoriesSchema>['query'];
export type RepositoryParams = z.infer<typeof repositoryParamsSchema>['params'];
export type StartIngestionInput = z.infer<typeof startIngestionSchema>['body'];
export type IngestionStatusParams = z.infer<typeof ingestionStatusSchema>['params'];
export type FileContentParams = z.infer<typeof fileContentParamsSchema>['params'];