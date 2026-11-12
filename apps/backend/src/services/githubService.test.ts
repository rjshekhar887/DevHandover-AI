/**
 * GitHub Service Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock config BEFORE importing services - use vi.hoisted to avoid hoisting issues
const { configMock, prismaMock } = vi.hoisted(() => ({
  configMock: {
    GITHUB_CLIENT_ID: 'test-client-id',
    GITHUB_CLIENT_SECRET: 'test-client-secret',
    GITHUB_CALLBACK_URL: 'http://localhost:3000/api/v1/github/callback',
    NODE_ENV: 'test',
    PORT: 3000,
    API_PREFIX: '/api/v1',
    DATABASE_URL: 'file:./test.db',
    CORS_ORIGIN: 'http://localhost:5173',
    CORS_CREDENTIALS: true,
    LLM_PROVIDER: 'openai' as const,
    LLM_MODEL: 'gpt-4o',
    JWT_SECRET: 'test-secret',
    JWT_EXPIRES_IN: '7d',
    LOG_LEVEL: 'info' as const,
    TOKEN_ENCRYPTION: {
      activeKeyId: 'test-key',
      keys: new Map([['test-key', Buffer.alloc(32, 7)]]),
    },
  },
  prismaMock: {
    gitHubConnection: {
      upsert: vi.fn(),
      delete: vi.fn(),
    },
    user: {
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock('../config', () => ({
  config: configMock,
  isDevelopment: false,
  isProduction: false,
  isTest: true,
}));
vi.mock('../prisma/client', () => ({ prisma: prismaMock }));
vi.mock('../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// Now import services after mock is set up
import {
  generateOAuthState,
  buildOAuthUrl,
  decryptToken,
  upsertGitHubConnection,
  deleteGitHubConnection,
} from './githubService';
import { decryptToken as decryptEncryptedToken } from './tokenEncryption';
import { logger } from '../utils/logger';
import {
  shouldExcludeFile,
  isTextFile,
  isBinaryContent,
  categorizeFile,
  getLanguageFromPath,
} from './ingestionService';

describe('GitHub Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(
      async (callback: (tx: typeof prismaMock) => Promise<unknown>) => callback(prismaMock)
    );
  });

  describe('generateOAuthState', () => {
    it('should generate a secure random state', () => {
      const state1 = generateOAuthState();
      const state2 = generateOAuthState();

      expect(state1).toBeDefined();
      expect(state1).not.toBe(state2);
      expect(state1.length).toBeGreaterThan(20);
    });
  });

  describe('buildOAuthUrl', () => {
    it('should build a valid GitHub OAuth URL', () => {
      const state = 'test-state-123';
      const url = buildOAuthUrl(state);

      expect(url).toContain('https://github.com/login/oauth/authorize');
      expect(url).toContain('client_id=test-client-id');
      expect(url).toContain('redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fapi%2Fv1%2Fgithub%2Fcallback');
      expect(url).toContain('scope=repo+read%3Auser+user%3Aemail');
      expect(url).toContain(`state=${state}`);
      expect(url).toContain('allow_signup=true');
    });
  });

  describe('encrypted token persistence', () => {
    const userId = 'platform-user-42';
    const token = 'synthetic-unit-test-token';
    const githubUser = {
      id: 123,
      login: 'test-user',
      name: 'Test User',
      email: 'test@example.test',
      avatar_url: 'https://example.test/avatar.png',
      html_url: 'https://github.com/test-user',
    };

    it('persists separately encrypted values with the correct AAD in one transaction', async () => {
      await upsertGitHubConnection(userId, githubUser, token, 'repo');

      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
      const connectionData = prismaMock.gitHubConnection.upsert.mock.calls[0][0];
      const userData = prismaMock.user.update.mock.calls[0][0];
      const connectionEnvelope = connectionData.create.accessToken;
      const userEnvelope = userData.data.accessToken;

      expect(connectionEnvelope).toMatch(/^gh-token:v2:/);
      expect(userEnvelope).toMatch(/^gh-token:v2:/);
      expect(connectionEnvelope).not.toBe(userEnvelope);
      expect(connectionEnvelope).not.toContain(token);
      expect(userEnvelope).not.toContain(token);
      expect(decryptEncryptedToken(connectionEnvelope, configMock.TOKEN_ENCRYPTION, {
        entity: 'GitHubConnection',
        userId,
        field: 'accessToken',
      })).toBe(token);
      expect(decryptEncryptedToken(userEnvelope, configMock.TOKEN_ENCRYPTION, {
        entity: 'User',
        userId,
        field: 'accessToken',
      })).toBe(token);
      const loggedValues = JSON.stringify([
        vi.mocked(logger.error).mock.calls,
        vi.mocked(logger.warn).mock.calls,
        vi.mocked(logger.info).mock.calls,
        vi.mocked(logger.debug).mock.calls,
      ]);
      expect(loggedValues).not.toContain(token);
      expect(loggedValues).not.toContain(connectionEnvelope);
      expect(loggedValues).not.toContain(userEnvelope);
      expect(loggedValues).not.toContain(configMock.TOKEN_ENCRYPTION.keys.get('test-key')?.toString('base64'));
    });

    it('replaces both encrypted values on reconnection', async () => {
      await upsertGitHubConnection(userId, githubUser, token, 'repo');
      await upsertGitHubConnection(userId, githubUser, 'replacement-unit-token', 'repo');

      expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
      expect(prismaMock.gitHubConnection.upsert.mock.calls[1][0].update.accessToken)
        .not.toBe(prismaMock.gitHubConnection.upsert.mock.calls[0][0].update.accessToken);
      expect(prismaMock.user.update.mock.calls[1][0].data.accessToken)
        .not.toBe(prismaMock.user.update.mock.calls[0][0].data.accessToken);
    });

    it('propagates either write failure from the encompassing transaction', async () => {
      prismaMock.user.update.mockRejectedValueOnce(new Error('synthetic write failure'));

      await expect(upsertGitHubConnection(userId, githubUser, token, 'repo'))
        .rejects.toThrow('Unable to persist GitHub connection securely');
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain(token);
    });

    it('does not attempt the legacy user write when the connection write fails', async () => {
      prismaMock.gitHubConnection.upsert.mockRejectedValueOnce(new Error('synthetic connection failure'));

      await expect(upsertGitHubConnection(userId, githubUser, token, 'repo'))
        .rejects.toThrow('Unable to persist GitHub connection securely');
      expect(prismaMock.user.update).not.toHaveBeenCalled();
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    });

    it('fails closed for missing keys, wrong owners, and malformed envelopes', async () => {
      await upsertGitHubConnection(userId, githubUser, token, 'repo');
      const stored = prismaMock.gitHubConnection.upsert.mock.calls.at(-1)![0].create.accessToken;

      expect(() => decryptToken(stored, `${userId}-different`))
        .toThrow('Unable to access GitHub connection securely');
      expect(() => decryptToken('not-a-v2-envelope', userId))
        .toThrow('Unable to access GitHub connection securely');
      const userEnvelope = prismaMock.user.update.mock.calls.at(-1)![0].data.accessToken;
      expect(() => decryptToken(userEnvelope, userId))
        .toThrow('Unable to access GitHub connection securely');

      const encryptionConfig = configMock.TOKEN_ENCRYPTION;
      try {
        configMock.TOKEN_ENCRYPTION = undefined as unknown as typeof encryptionConfig;
        expect(() => decryptToken(stored, userId))
          .toThrow('GitHub token encryption is not configured');
      } finally {
        configMock.TOKEN_ENCRYPTION = encryptionConfig;
      }
    });

    it('clears the connection and legacy fields in one transaction', async () => {
      await deleteGitHubConnection(userId);

      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
      expect(prismaMock.gitHubConnection.delete).toHaveBeenCalledWith({ where: { userId } });
      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: userId },
        data: { githubId: null, githubLogin: null, accessToken: null },
      });
    });

    it('propagates legacy clearing failure so the disconnect transaction rolls back', async () => {
      prismaMock.user.update.mockRejectedValueOnce(new Error('synthetic clear failure'));

      await expect(deleteGitHubConnection(userId)).rejects.toThrow('synthetic clear failure');
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    });
  });
});

describe('File Filtering', () => {
  describe('shouldExcludeFile', () => {
    it('should exclude .git directory', () => {
      expect(shouldExcludeFile('.git/config')).toBe(true);
      expect(shouldExcludeFile('src/.git/HEAD')).toBe(true);
    });

    it('should exclude node_modules', () => {
      expect(shouldExcludeFile('node_modules/lodash/index.js')).toBe(true);
      expect(shouldExcludeFile('src/node_modules/test.js')).toBe(true);
    });

    it('should exclude dist/build directories', () => {
      expect(shouldExcludeFile('dist/index.js')).toBe(true);
      expect(shouldExcludeFile('build/main.js')).toBe(true);
    });

    it('should exclude hidden directories (except .github, .vscode, .idea)', () => {
      expect(shouldExcludeFile('.hidden/file.js')).toBe(true);
      expect(shouldExcludeFile('.github/workflows/ci.yml')).toBe(false);
      expect(shouldExcludeFile('.vscode/settings.json')).toBe(false);
      expect(shouldExcludeFile('.idea/workspace.xml')).toBe(false);
    });

    it('should exclude lock files', () => {
      expect(shouldExcludeFile('package-lock.json')).toBe(true);
      expect(shouldExcludeFile('yarn.lock')).toBe(true);
      expect(shouldExcludeFile('pnpm-lock.yaml')).toBe(true);
    });

    it('should exclude .min.js and .map files', () => {
      expect(shouldExcludeFile('dist/app.min.js')).toBe(true);
      expect(shouldExcludeFile('dist/app.js.map')).toBe(true);
    });

    it('should not exclude source files', () => {
      expect(shouldExcludeFile('src/index.ts')).toBe(false);
      expect(shouldExcludeFile('src/components/Button.tsx')).toBe(false);
      expect(shouldExcludeFile('README.md')).toBe(false);
      expect(shouldExcludeFile('package.json')).toBe(false);
    });
  });

  describe('isTextFile', () => {
    it('should identify common source files as text', () => {
      expect(isTextFile('src/index.ts')).toBe(true);
      expect(isTextFile('src/App.tsx')).toBe(true);
      expect(isTextFile('src/main.js')).toBe(true);
      expect(isTextFile('src/component.jsx')).toBe(true);
    });

    it('should identify config files as text', () => {
      expect(isTextFile('package.json')).toBe(true);
      expect(isTextFile('tsconfig.json')).toBe(true);
      expect(isTextFile('.eslintrc')).toBe(true);
      expect(isTextFile('Dockerfile')).toBe(true);
      expect(isTextFile('Makefile')).toBe(true);
    });

    it('should identify documentation as text', () => {
      expect(isTextFile('README.md')).toBe(true);
      expect(isTextFile('CHANGELOG.md')).toBe(true);
      expect(isTextFile('LICENSE')).toBe(true);
    });

    it('should identify other text formats', () => {
      expect(isTextFile('config.yaml')).toBe(true);
      expect(isTextFile('settings.toml')).toBe(true);
      expect(isTextFile('.env.example')).toBe(true);
    });

    it('should not identify binary files as text', () => {
      expect(isTextFile('image.png')).toBe(false);
      expect(isTextFile('binary.exe')).toBe(false);
      expect(isTextFile('data.bin')).toBe(false);
    });
  });

  describe('isBinaryContent', () => {
    it('should detect null bytes', () => {
      expect(isBinaryContent('hello\0world')).toBe(true);
    });

    it('should detect high ratio of non-printable chars', () => {
      const binaryLike = String.fromCharCode(1, 2, 3, 4, 5, 6, 7, 8, 9, 10);
      expect(isBinaryContent(binaryLike)).toBe(true);
    });

    it('should not flag normal text as binary', () => {
      expect(isBinaryContent('Hello world\nThis is a test')).toBe(false);
      expect(isBinaryContent('const x = 1;\nconsole.log(x);')).toBe(false);
    });
  });

  describe('categorizeFile', () => {
    it('should identify test files', () => {
      const result = categorizeFile('src/__tests__/component.test.ts');
      expect(result.isTest).toBe(true);
    });

    it('should identify config files', () => {
      expect(categorizeFile('package.json').isConfig).toBe(true);
      expect(categorizeFile('tsconfig.json').isConfig).toBe(true);
      expect(categorizeFile('.eslintrc.json').isConfig).toBe(true);
      expect(categorizeFile('Dockerfile').isConfig).toBe(true);
    });

    it('should identify documentation files', () => {
      expect(categorizeFile('README.md').isDocumentation).toBe(true);
      expect(categorizeFile('docs/guide.md').isDocumentation).toBe(true);
      expect(categorizeFile('LICENSE').isDocumentation).toBe(true);
    });

    it('should identify generated files', () => {
      expect(categorizeFile('dist/main.js').isGenerated).toBe(true);
      expect(categorizeFile('build/bundle.min.js').isGenerated).toBe(true);
    });
  });

  describe('getLanguageFromPath', () => {
    it('should return correct language for common extensions', () => {
      expect(getLanguageFromPath('src/index.ts')).toBe('TypeScript');
      expect(getLanguageFromPath('src/App.tsx')).toBe('TypeScript');
      expect(getLanguageFromPath('src/main.js')).toBe('JavaScript');
      expect(getLanguageFromPath('src/component.jsx')).toBe('JavaScript');
      expect(getLanguageFromPath('config.json')).toBe('JSON');
      expect(getLanguageFromPath('README.md')).toBe('Markdown');
      expect(getLanguageFromPath('script.py')).toBe('Python');
      expect(getLanguageFromPath('main.go')).toBe('Go');
      expect(getLanguageFromPath('lib.rs')).toBe('Rust');
    });

    it('should return null for unknown extensions', () => {
      expect(getLanguageFromPath('data.xyz')).toBeNull();
      expect(getLanguageFromPath('README')).toBeNull();
    });
  });
});