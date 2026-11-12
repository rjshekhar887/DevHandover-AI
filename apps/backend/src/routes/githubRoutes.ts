/**
 * GitHub Routes
 * Defines all GitHub-related API endpoints
 */

import { Router } from 'express';
import {
  initiateOAuth,
  handleOAuthCallback,
  getConnectionStatus,
  disconnectGitHub,
  listRepositories,
  getRepository,
  getFileContent,
  startIngestion,
  getIngestionStatus,
  getIngestionFiles,
} from '../controllers/githubController';
import { validate } from '../middleware/validation';
import { requireAuth } from '../middleware/auth';
import {
  initiateOAuthSchema,
  listRepositoriesSchema,
  repositoryParamsSchema,
  startIngestionSchema,
  ingestionStatusSchema,
  fileContentParamsSchema,
} from '../validators/githubValidator';

const router = Router();

/**
 * @route GET /api/v1/github/auth
 * @description Initiate GitHub OAuth flow
 * @access Private (authenticated application user)
 */
router.get(
  '/auth',
  requireAuth,
  validate(initiateOAuthSchema),
  initiateOAuth
);

/**
 * @route GET /api/v1/github/callback
 * @description Handle GitHub OAuth callback
 * @access Public (OAuth state and browser binding required)
 */
router.get(
  '/callback',
  handleOAuthCallback
);

// All GitHub account and repository operations require an application session.
router.use(requireAuth);

/**
 * @route GET /api/v1/github/connection
 * @description Get current GitHub connection status
 * @access Private
 */
router.get(
  '/connection',
  getConnectionStatus
);

/**
 * @route DELETE /api/v1/github/connection
 * @description Disconnect GitHub account
 * @access Private
 */
router.delete(
  '/connection',
  disconnectGitHub
);

/**
 * @route GET /api/v1/github/repositories
 * @description List repositories accessible to the authenticated user
 * @access Private
 */
router.get(
  '/repositories',
  validate(listRepositoriesSchema),
  listRepositories
);

/**
 * @route GET /api/v1/github/repositories/:owner/:repo
 * @description Get repository details
 * @access Private
 */
router.get(
  '/repositories/:owner/:repo',
  validate(repositoryParamsSchema),
  getRepository
);

/**
 * @route GET /api/v1/github/repositories/:owner/:repo/contents/*path
 * @description Get file content from repository
 * @access Private
 */
router.get(
  '/repositories/:owner/:repo/contents/*path',
  validate(fileContentParamsSchema),
  getFileContent
);

/**
 * @route POST /api/v1/github/repositories/:owner/:repo/ingest
 * @description Start repository ingestion
 * @access Private
 */
router.post(
  '/repositories/:owner/:repo/ingest',
  validate(repositoryParamsSchema),
  validate(startIngestionSchema),
  startIngestion
);

/**
 * @route GET /api/v1/github/ingestions/:ingestionId
 * @description Get ingestion status
 * @access Private
 */
router.get(
  '/ingestions/:ingestionId',
  validate(ingestionStatusSchema),
  getIngestionStatus
);

/**
 * @route GET /api/v1/github/ingestions/:ingestionId/files
 * @description Get ingested files
 * @access Private
 */
router.get(
  '/ingestions/:ingestionId/files',
  validate(ingestionStatusSchema),
  getIngestionFiles
);

export default router;