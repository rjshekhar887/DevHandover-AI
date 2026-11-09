/**
 * GitHub Controller
 * Handles GitHub OAuth authentication and repository operations
 */

import { Request, Response } from 'express';
import { config } from '../config';
import { prisma } from '../prisma/client';
import { logger } from '../utils/logger';
import { asyncHandler } from '../middleware/errorHandler';
import { UnauthorizedError, BadRequestError, InternalServerError, NotFoundError } from '../utils/errors';
import {
  generateOAuthState,
  buildOAuthUrl,
  exchangeCodeForToken,
  fetchGitHubUser,
  fetchGitHubEmails,
  upsertGitHubConnection,
  getGitHubConnection,
  deleteGitHubConnection,
  decryptToken,
  fetchUserRepositories,
  fetchRepository,
  fetchRepositoryTree,
  fetchFileContent,
} from '../services/githubService';
import { startRepositoryIngestion, getIngestionStatus as getIngestionStatusService, getIngestedFiles } from '../services/ingestionService';

// In-memory state store for OAuth (in production, use Redis with TTL)
const oauthStateStore = new Map<string, { userId: string; redirectUri?: string; expiresAt: number }>();

// Cleanup expired states every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [state, data] of oauthStateStore.entries()) {
    if (data.expiresAt < now) {
      oauthStateStore.delete(state);
    }
  }
}, 5 * 60 * 1000);

/**
 * GET /api/v1/github/auth
 * Initiate GitHub OAuth flow
 */
export const initiateOAuth = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  if (!config.GITHUB_CLIENT_ID || !config.GITHUB_CLIENT_SECRET) {
    throw new InternalServerError('GitHub OAuth is not configured. Please set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.');
  }

  const { redirectUri } = req.query as { redirectUri?: string };
  const state = generateOAuthState();

  // Store state with 10-minute expiry
  // In a real app, associate with user session. For now, use a placeholder userId.
  // TODO: Get actual userId from authenticated session
  const userId = 'temp-user'; // Placeholder - will be replaced with actual auth

  oauthStateStore.set(state, {
    userId,
    redirectUri,
    expiresAt: Date.now() + 10 * 60 * 1000,
  });

  const authUrl = buildOAuthUrl(state);

  res.json({
    success: true,
    data: {
      authUrl,
      state,
    },
  });
});

/**
 * GET /api/v1/github/callback
 * Handle GitHub OAuth callback
 */
export const handleOAuthCallback = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { code, state, error, error_description } = req.query as {
    code?: string;
    state?: string;
    error?: string;
    error_description?: string;
  };

  // Handle OAuth errors
  if (error) {
    logger.warn('GitHub OAuth error', { error, error_description });

    // Redirect to frontend with error
    const frontendUrl = config.CORS_ORIGIN || 'http://localhost:5173';
    const errorUrl = `${frontendUrl}/github/callback?error=${encodeURIComponent(error)}&error_description=${encodeURIComponent(error_description || '')}`;
    res.redirect(errorUrl);
    return;
  }

  if (!code || !state) {
    throw new BadRequestError('Missing authorization code or state parameter');
  }

  // Validate state
  const stateData = oauthStateStore.get(state);
  if (!stateData) {
    throw new BadRequestError('Invalid or expired OAuth state');
  }

  // Remove state after use
  oauthStateStore.delete(state);

  try {
    // Exchange code for access token
    const tokenResponse = await exchangeCodeForToken(code);

    // Fetch GitHub user profile
    const githubUser = await fetchGitHubUser(tokenResponse.access_token);

    // Fetch primary email
    const emails = await fetchGitHubEmails(tokenResponse.access_token);
    const primaryEmail = emails.find(e => e.primary && e.verified)?.email || githubUser.email;

    // Find or create user
    let user = await prisma.user.findUnique({
      where: { githubId: githubUser.id.toString() },
    });

    if (!user) {
      // Try to find by email
      if (primaryEmail) {
        user = await prisma.user.findUnique({
          where: { email: primaryEmail },
        });
      }
    }

    if (!user) {
      // Create new user
      user = await prisma.user.create({
        data: {
          email: primaryEmail || `${githubUser.login}@github.local`,
          name: githubUser.name || githubUser.login,
          avatarUrl: githubUser.avatar_url,
        },
      });
    }

    // Store GitHub connection
    await upsertGitHubConnection(user.id, githubUser, tokenResponse.access_token, tokenResponse.scope);

    // Redirect to frontend with success
    const frontendUrl = config.CORS_ORIGIN || 'http://localhost:5173';
    const redirectUri = stateData.redirectUri || `${frontendUrl}/github/callback?connected=true`;
    res.redirect(redirectUri);
  } catch (error) {
    logger.error('OAuth callback failed', error);

    const frontendUrl = config.CORS_ORIGIN || 'http://localhost:5173';
    const errorUrl = `${frontendUrl}/github/callback?error=callback_failed`;
    res.redirect(errorUrl);
  }
});

/**
 * GET /api/v1/github/connection
 * Get current GitHub connection status
 */
export const getConnectionStatus = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  // TODO: Get actual userId from authenticated session
  const userId = 'temp-user'; // Placeholder

  const connection = await getGitHubConnection(userId);

  if (!connection) {
    res.json({
      success: true,
      data: {
        connected: false,
      },
    });
    return;
  }

  res.json({
    success: true,
    data: {
      connected: true,
      githubId: connection.githubId,
      login: connection.login,
      name: connection.name,
      email: connection.email,
      avatarUrl: connection.avatarUrl,
      scope: connection.scope,
      connectedAt: connection.connectedAt,
    },
  });
});

/**
 * DELETE /api/v1/github/connection
 * Disconnect GitHub account
 */
export const disconnectGitHub = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  // TODO: Get actual userId from authenticated session
  const userId = 'temp-user'; // Placeholder

  const connection = await getGitHubConnection(userId);
  if (!connection) {
    throw new NotFoundError('GitHub connection');
  }

  await deleteGitHubConnection(userId);

  res.json({
    success: true,
    message: 'GitHub account disconnected successfully',
  });
});

/**
 * GET /api/v1/github/repositories
 * List repositories accessible to the authenticated user
 */
export const listRepositories = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  // TODO: Get actual userId from authenticated session
  const userId = 'temp-user'; // Placeholder

  const connection = await getGitHubConnection(userId);
  if (!connection) {
    throw new UnauthorizedError('GitHub account not connected');
  }

  const accessToken = decryptToken(connection.accessToken);
  const { page, perPage, sort, direction, type } = req.query as {
    page?: string;
    perPage?: string;
    sort?: string;
    direction?: string;
    type?: string;
  };

  const result = await fetchUserRepositories(accessToken, {
    page: parseInt(page || '1', 10),
    perPage: parseInt(perPage || '30', 10),
    sort: (sort as any) || 'updated',
    direction: (direction as any) || 'desc',
    type: (type as any) || 'owner',
  });

  // Store/update repositories in database
  for (const repo of result.repositories) {
    await prisma.repository.upsert({
      where: { githubId: repo.id.toString() },
      update: {
        name: repo.name,
        fullName: repo.full_name,
        url: repo.html_url,
        cloneUrl: repo.clone_url,
        defaultBranch: repo.default_branch,
        language: repo.language,
        description: repo.description,
        isPrivate: repo.private,
        isFork: repo.fork,
        size: repo.size,
        stargazersCount: repo.stargazers_count,
        forksCount: repo.forks_count,
        openIssuesCount: repo.open_issues_count,
        pushedAt: repo.pushed_at ? new Date(repo.pushed_at) : null,
        githubCreatedAt: new Date(repo.created_at),
        githubUpdatedAt: new Date(repo.updated_at),
        githubConnectionId: connection.id,
      },
      create: {
        githubId: repo.id.toString(),
        name: repo.name,
        fullName: repo.full_name,
        url: repo.html_url,
        cloneUrl: repo.clone_url,
        defaultBranch: repo.default_branch,
        language: repo.language,
        description: repo.description,
        isPrivate: repo.private,
        isFork: repo.fork,
        size: repo.size,
        stargazersCount: repo.stargazers_count,
        forksCount: repo.forks_count,
        openIssuesCount: repo.open_issues_count,
        pushedAt: repo.pushed_at ? new Date(repo.pushed_at) : null,
        githubCreatedAt: new Date(repo.created_at),
        githubUpdatedAt: new Date(repo.updated_at),
        githubConnectionId: connection.id,
      },
    });
  }

  res.json({
    success: true,
    data: result.repositories.map(repo => ({
      id: repo.id.toString(),
      name: repo.name,
      fullName: repo.full_name,
      url: repo.html_url,
      cloneUrl: repo.clone_url,
      defaultBranch: repo.default_branch,
      language: repo.language,
      description: repo.description,
      isPrivate: repo.private,
      isFork: repo.fork,
      size: repo.size,
      stargazersCount: repo.stargazers_count,
      forksCount: repo.forks_count,
      openIssuesCount: repo.open_issues_count,
      pushedAt: repo.pushed_at,
      createdAt: repo.created_at,
      updatedAt: repo.updated_at,
    })),
    pagination: {
      page: parseInt(page || '1', 10),
      perPage: parseInt(perPage || '30', 10),
      hasNextPage: result.hasNextPage,
    },
  });
});

/**
 * GET /api/v1/github/repositories/:owner/:repo
 * Get repository details
 */
export const getRepository = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  // TODO: Get actual userId from authenticated session
  const userId = 'temp-user'; // Placeholder

  const connection = await getGitHubConnection(userId);
  if (!connection) {
    throw new UnauthorizedError('GitHub account not connected');
  }

  const { owner, repo } = req.params;
  const accessToken = decryptToken(connection.accessToken);

  const githubRepo = await fetchRepository(accessToken, owner, repo);

  // Store/update in database
  const repository = await prisma.repository.upsert({
    where: { githubId: githubRepo.id.toString() },
    update: {
      name: githubRepo.name,
      fullName: githubRepo.full_name,
      url: githubRepo.html_url,
      cloneUrl: githubRepo.clone_url,
      defaultBranch: githubRepo.default_branch,
      language: githubRepo.language,
      description: githubRepo.description,
      isPrivate: githubRepo.private,
      isFork: githubRepo.fork,
      size: githubRepo.size,
      stargazersCount: githubRepo.stargazers_count,
      forksCount: githubRepo.forks_count,
      openIssuesCount: githubRepo.open_issues_count,
      pushedAt: githubRepo.pushed_at ? new Date(githubRepo.pushed_at) : null,
      githubCreatedAt: new Date(githubRepo.created_at),
      githubUpdatedAt: new Date(githubRepo.updated_at),
      githubConnectionId: connection.id,
    },
    create: {
      githubId: githubRepo.id.toString(),
      name: githubRepo.name,
      fullName: githubRepo.full_name,
      url: githubRepo.html_url,
      cloneUrl: githubRepo.clone_url,
      defaultBranch: githubRepo.default_branch,
      language: githubRepo.language,
      description: githubRepo.description,
      isPrivate: githubRepo.private,
      isFork: githubRepo.fork,
      size: githubRepo.size,
      stargazersCount: githubRepo.stargazers_count,
      forksCount: githubRepo.forks_count,
      openIssuesCount: githubRepo.open_issues_count,
      pushedAt: githubRepo.pushed_at ? new Date(githubRepo.pushed_at) : null,
      githubCreatedAt: new Date(githubRepo.created_at),
      githubUpdatedAt: new Date(githubRepo.updated_at),
      githubConnectionId: connection.id,
    },
  });

  res.json({
    success: true,
    data: {
      id: repository.id,
      githubId: repository.githubId,
      name: repository.name,
      fullName: repository.fullName,
      url: repository.url,
      cloneUrl: repository.cloneUrl,
      defaultBranch: repository.defaultBranch,
      language: repository.language,
      description: repository.description,
      isPrivate: repository.isPrivate,
      isFork: repository.isFork,
      size: repository.size,
      stargazersCount: repository.stargazersCount,
      forksCount: repository.forksCount,
      openIssuesCount: repository.openIssuesCount,
      pushedAt: repository.pushedAt,
      githubCreatedAt: repository.githubCreatedAt,
      githubUpdatedAt: repository.githubUpdatedAt,
      createdAt: repository.createdAt,
      updatedAt: repository.updatedAt,
    },
  });
});

/**
 * GET /api/v1/github/repositories/:owner/:repo/contents/*
 * Get file content from repository
 */
export const getFileContent = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  // TODO: Get actual userId from authenticated session
  const userId = 'temp-user'; // Placeholder

  const connection = await getGitHubConnection(userId);
  if (!connection) {
    throw new UnauthorizedError('GitHub account not connected');
  }

  const { owner, repo, path } = req.params;
  const { branch = 'main' } = req.query as { branch?: string };
  const accessToken = decryptToken(connection.accessToken);

  const fileContent = await fetchFileContent(accessToken, owner, repo, path, branch);

  // Decode base64 content
  let content: string;
  if (fileContent.encoding === 'base64') {
    content = Buffer.from(fileContent.content, 'base64').toString('utf-8');
  } else {
    content = fileContent.content;
  }

  res.json({
    success: true,
    data: {
      path,
      name: path.split('/').pop() || path,
      size: fileContent.size,
      sha: fileContent.sha,
      content,
      encoding: fileContent.encoding,
    },
  });
});

/**
 * POST /api/v1/github/repositories/:owner/:repo/ingest
 * Start repository ingestion
 */
export const startIngestion = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  // TODO: Get actual userId from authenticated session
  const userId = 'temp-user'; // Placeholder

  const connection = await getGitHubConnection(userId);
  if (!connection) {
    throw new UnauthorizedError('GitHub account not connected');
  }

  const { owner, repo } = req.params;
  const { branch, projectId } = req.body;
  const accessToken = decryptToken(connection.accessToken);

  // Find or create repository record
  let repository = await prisma.repository.findFirst({
    where: { fullName: `${owner}/${repo}`, githubConnectionId: connection.id },
  });

  if (!repository) {
    // Fetch from GitHub and create
    const githubRepo = await fetchRepository(accessToken, owner, repo);
    repository = await prisma.repository.create({
      data: {
        githubId: githubRepo.id.toString(),
        name: githubRepo.name,
        fullName: githubRepo.full_name,
        url: githubRepo.html_url,
        cloneUrl: githubRepo.clone_url,
        defaultBranch: githubRepo.default_branch,
        language: githubRepo.language,
        description: githubRepo.description,
        isPrivate: githubRepo.private,
        isFork: githubRepo.fork,
        size: githubRepo.size,
        stargazersCount: githubRepo.stargazers_count,
        forksCount: githubRepo.forks_count,
        openIssuesCount: githubRepo.open_issues_count,
        pushedAt: githubRepo.pushed_at ? new Date(githubRepo.pushed_at) : null,
        githubCreatedAt: new Date(githubRepo.created_at),
        githubUpdatedAt: new Date(githubRepo.updated_at),
        githubConnectionId: connection.id,
      },
    });
  }

  // Link to project if provided
  if (projectId && repository.projectId !== projectId) {
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      throw new NotFoundError('Project', projectId);
    }
    await prisma.repository.update({
      where: { id: repository.id },
      data: { projectId },
    });
    repository = { ...repository, projectId };
  }

  // Start ingestion
  const ingestion = await startRepositoryIngestion(
    repository.id,
    accessToken,
    owner,
    repo,
    branch || repository.defaultBranch
  );

  res.status(202).json({
    success: true,
    data: {
      ingestionId: ingestion.id,
      repositoryId: repository.id,
      status: ingestion.status,
      message: 'Repository ingestion started',
    },
  });
});

/**
 * GET /api/v1/github/ingestions/:ingestionId
 * Get ingestion status
 */
export const getIngestionStatus = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { ingestionId } = req.params;

  const ingestion = await getIngestionStatusService(ingestionId);
  if (!ingestion) {
    throw new NotFoundError('Ingestion', ingestionId);
  }

  res.json({
    success: true,
    data: {
      id: ingestion.id,
      repositoryId: ingestion.repositoryId,
      status: ingestion.status,
      totalFiles: ingestion.totalFiles,
      processedFiles: ingestion.processedFiles,
      totalSize: ingestion.totalSize,
      processedSize: ingestion.processedSize,
      error: ingestion.error,
      errorDetails: ingestion.errorDetails,
      startedAt: ingestion.startedAt,
      completedAt: ingestion.completedAt,
      createdAt: ingestion.createdAt,
      updatedAt: ingestion.updatedAt,
    },
  });
});

/**
 * GET /api/v1/github/ingestions/:ingestionId/files
 * Get ingested files
 */
export const getIngestionFiles = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { ingestionId } = req.params;
  const { page = '1', limit = '50', language, isTest, isConfig, isDocumentation } = req.query as {
    page?: string;
    limit?: string;
    language?: string;
    isTest?: string;
    isConfig?: string;
    isDocumentation?: string;
  };

  const ingestion = await getIngestionStatusService(ingestionId);
  if (!ingestion) {
    throw new NotFoundError('Ingestion', ingestionId);
  }

  const files = await getIngestedFiles(ingestion.repositoryId, {
    page: parseInt(page, 10),
    limit: parseInt(limit, 10),
    language,
    isTest: isTest === 'true',
    isConfig: isConfig === 'true',
    isDocumentation: isDocumentation === 'true',
  });

  res.json({
    success: true,
    data: files.data,
    pagination: files.pagination,
  });
});