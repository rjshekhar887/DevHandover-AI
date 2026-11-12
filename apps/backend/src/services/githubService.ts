/**
 * GitHub Service
 * Handles GitHub OAuth authentication and API interactions
 */

import { config } from '../config';
import { prisma } from '../prisma/client';
import { logger } from '../utils/logger';
import { UnauthorizedError, BadRequestError, ServiceUnavailableError, InternalServerError } from '../utils/errors';
import {
  decryptToken as decryptEncryptedToken,
  encryptToken as encryptTokenWithAad,
  type TokenEncryptionContext,
} from './tokenEncryption';

// Types
export interface GitHubTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
  error?: string;
  error_description?: string;
  error_uri?: string;
}

export interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string;
  html_url: string;
}

export interface GitHubRepository {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  clone_url: string;
  default_branch: string;
  language: string | null;
  description: string | null;
  private: boolean;
  fork: boolean;
  size: number;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  pushed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface GitHubTreeItem {
  path: string;
  mode: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
  url: string;
}

export interface GitHubTreeResponse {
  sha: string;
  tree: GitHubTreeItem[];
  truncated: boolean;
}

export interface GitHubFileContent {
  content: string;
  encoding: 'base64';
  size: number;
  sha: string;
}

/**
 * Generate a cryptographically secure OAuth state parameter
 */
export function generateOAuthState(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Buffer.from(array).toString('base64url');
}

/**
 * Build GitHub OAuth authorization URL
 */
export function buildOAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: config.GITHUB_CLIENT_ID || '',
    redirect_uri: config.GITHUB_CALLBACK_URL || '',
    scope: 'repo read:user user:email',
    state,
    allow_signup: 'true',
  });
  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

/**
 * Exchange authorization code for access token
 */
export async function exchangeCodeForToken(code: string): Promise<GitHubTokenResponse> {
  if (!config.GITHUB_CLIENT_ID || !config.GITHUB_CLIENT_SECRET) {
    throw new InternalServerError('GitHub OAuth not configured');
  }

  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: config.GITHUB_CLIENT_ID,
      client_secret: config.GITHUB_CLIENT_SECRET,
      code,
    }),
  });

  if (!response.ok) {
    logger.error('GitHub token exchange failed', { status: response.status });
    throw new UnauthorizedError('Failed to exchange authorization code for token');
  }

  const data = await response.json() as GitHubTokenResponse;

  if (data.error) {
    logger.error('GitHub OAuth error');
    throw new UnauthorizedError(data.error_description || 'GitHub OAuth failed');
  }

  return data;
}

/**
 * Fetch authenticated GitHub user profile
 */
export async function fetchGitHubUser(accessToken: string): Promise<GitHubUser> {
  const response = await fetch('https://api.github.com/user', {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new UnauthorizedError('Invalid or expired GitHub access token');
    }
    throw new ServiceUnavailableError('Failed to fetch GitHub user');
  }

  return response.json() as Promise<GitHubUser>;
}

/**
 * Fetch user's email addresses from GitHub
 */
export async function fetchGitHubEmails(accessToken: string): Promise<Array<{ email: string; primary: boolean; verified: boolean }>> {
  const response = await fetch('https://api.github.com/user/emails', {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!response.ok) {
    logger.warn('Failed to fetch GitHub emails', { status: response.status });
    return [];
  }

  return response.json() as Promise<Array<{ email: string; primary: boolean; verified: boolean }>>;
}

/**
 * Store or update GitHub connection for a user
 */
export async function upsertGitHubConnection(
  userId: string,
  githubUser: GitHubUser,
  accessToken: string,
  scope: string
): Promise<void> {
  const encryptionConfig = config.TOKEN_ENCRYPTION;
  if (!encryptionConfig) {
    throw new InternalServerError('GitHub token encryption is not configured');
  }

  const connectionContext: TokenEncryptionContext = {
    entity: 'GitHubConnection',
    userId,
    field: 'accessToken',
  };
  const userContext: TokenEncryptionContext = {
    entity: 'User',
    userId,
    field: 'accessToken',
  };
  let connectionToken: string;
  let userToken: string;
  try {
    connectionToken = encryptTokenWithAad(accessToken, encryptionConfig, connectionContext);
    userToken = encryptTokenWithAad(accessToken, encryptionConfig, userContext);
  } catch {
    throw new InternalServerError('Unable to secure GitHub connection');
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.gitHubConnection.upsert({
        where: { userId },
        update: {
          githubId: githubUser.id.toString(),
          login: githubUser.login,
          name: githubUser.name,
          email: githubUser.email,
          avatarUrl: githubUser.avatar_url,
          accessToken: connectionToken,
          scope,
          tokenType: 'bearer',
          connectedAt: new Date(),
          disconnectedAt: null,
        },
        create: {
          userId,
          githubId: githubUser.id.toString(),
          login: githubUser.login,
          name: githubUser.name,
          email: githubUser.email,
          avatarUrl: githubUser.avatar_url,
          accessToken: connectionToken,
          scope,
          tokenType: 'bearer',
        },
      });

      await tx.user.update({
        where: { id: userId },
        data: {
          githubId: githubUser.id.toString(),
          githubLogin: githubUser.login,
          avatarUrl: githubUser.avatar_url,
          accessToken: userToken,
        },
      });
    });
  } catch (error) {
    logger.error('GitHub connection persistence failed', {
      errorType: error instanceof Error ? error.name : 'UnknownError',
    });
    throw new InternalServerError('Unable to persist GitHub connection securely');
  }
}

/**
 * Get GitHub connection for a user
 */
export async function getGitHubConnection(userId: string) {
  return prisma.gitHubConnection.findUnique({
    where: { userId },
  });
}

/**
 * Delete GitHub connection for a user
 */
export async function deleteGitHubConnection(userId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.gitHubConnection.delete({
      where: { userId },
    });

    await tx.user.update({
      where: { id: userId },
      data: {
        githubId: null,
        githubLogin: null,
        accessToken: null,
      },
    });
  });
}

/**
 * Decrypt a stored GitHub connection token using its owning platform user ID.
 */
export function decryptToken(encryptedToken: string, userId: string): string {
  const encryptionConfig = config.TOKEN_ENCRYPTION;
  if (!encryptionConfig) {
    throw new InternalServerError('GitHub token encryption is not configured');
  }

  try {
    return decryptEncryptedToken(encryptedToken, encryptionConfig, {
      entity: 'GitHubConnection',
      userId,
      field: 'accessToken',
    });
  } catch {
    throw new InternalServerError('Unable to access GitHub connection securely');
  }
}

/**
 * Fetch repositories accessible to the authenticated user
 */
export async function fetchUserRepositories(
  accessToken: string,
  options: {
    page?: number;
    perPage?: number;
    sort?: 'created' | 'updated' | 'pushed' | 'full_name';
    direction?: 'asc' | 'desc';
    type?: 'all' | 'owner' | 'public' | 'private' | 'member';
  } = {}
): Promise<{ repositories: GitHubRepository[]; hasNextPage: boolean }> {
  const {
    page = 1,
    perPage = 30,
    sort = 'updated',
    direction = 'desc',
    type = 'owner',
  } = options;

  const params = new URLSearchParams({
    page: page.toString(),
    per_page: Math.min(perPage, 100).toString(),
    sort,
    direction,
    type,
  });

  const response = await fetch(`https://api.github.com/user/repos?${params}`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new UnauthorizedError('Invalid or expired GitHub access token');
    }
    if (response.status === 403) {
      // Check rate limit
      const resetTime = response.headers.get('X-RateLimit-Reset');
      throw new ServiceUnavailableError('GitHub API rate limit exceeded', {
        resetTime: resetTime ? parseInt(resetTime, 10) * 1000 : undefined,
      });
    }
    throw new ServiceUnavailableError('Failed to fetch repositories');
  }

  const repositories = await response.json() as GitHubRepository[];
  const linkHeader = response.headers.get('Link');
  const hasNextPage = linkHeader?.includes('rel="next"') || false;

  return { repositories, hasNextPage };
}

/**
 * Fetch a single repository by owner and name
 */
export async function fetchRepository(
  accessToken: string,
  owner: string,
  repo: string
): Promise<GitHubRepository> {
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new BadRequestError('Repository not found');
    }
    if (response.status === 401) {
      throw new UnauthorizedError('Invalid or expired GitHub access token');
    }
    throw new ServiceUnavailableError('Failed to fetch repository');
  }

  return response.json() as Promise<GitHubRepository>;
}

/**
 * Fetch repository tree (file structure)
 */
export async function fetchRepositoryTree(
  accessToken: string,
  owner: string,
  repo: string,
  branch: string = 'main',
  recursive: boolean = true
): Promise<GitHubTreeResponse> {
  const params = new URLSearchParams();
  if (recursive) params.append('recursive', '1');

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?${params}`,
    {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    }
  );

  if (!response.ok) {
    if (response.status === 404) {
      throw new BadRequestError('Repository or branch not found');
    }
    if (response.status === 401) {
      throw new UnauthorizedError('Invalid or expired GitHub access token');
    }
    throw new ServiceUnavailableError('Failed to fetch repository tree');
  }

  return response.json() as Promise<GitHubTreeResponse>;
}

/**
 * Fetch file content from repository
 */
export async function fetchFileContent(
  accessToken: string,
  owner: string,
  repo: string,
  path: string,
  branch: string = 'main'
): Promise<GitHubFileContent> {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${branch}`,
    {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    }
  );

  if (!response.ok) {
    if (response.status === 404) {
      throw new BadRequestError('File not found');
    }
    if (response.status === 401) {
      throw new UnauthorizedError('Invalid or expired GitHub access token');
    }
    throw new ServiceUnavailableError('Failed to fetch file content');
  }

  return response.json() as Promise<GitHubFileContent>;
}