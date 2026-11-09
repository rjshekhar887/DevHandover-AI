/**
 * GitHub Service Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  generateOAuthState,
  buildOAuthUrl,
  encryptToken,
  decryptToken,
} from './githubService';
import {
  shouldExcludeFile,
  isTextFile,
  isBinaryContent,
  categorizeFile,
  getLanguageFromPath,
} from './ingestionService';

// Mock config
vi.mock('../config', async () => {
  const actual = await vi.importActual('../config');
  return {
    ...actual,
    config: {
      GITHUB_CLIENT_ID: 'test-client-id',
      GITHUB_CLIENT_SECRET: 'test-client-secret',
      GITHUB_CALLBACK_URL: 'http://localhost:3000/api/v1/github/callback',
      NODE_ENV: 'test',
      PORT: 3000,
      API_PREFIX: '/api/v1',
      DATABASE_URL: 'file:./test.db',
      CORS_ORIGIN: 'http://localhost:5173',
      CORS_CREDENTIALS: true,
      LLM_PROVIDER: 'openai',
      LLM_MODEL: 'gpt-4o',
      JWT_SECRET: 'test-secret',
      JWT_EXPIRES_IN: '7d',
      LOG_LEVEL: 'info',
    },
    isDevelopment: false,
    isProduction: false,
    isTest: true,
  };
});

describe('GitHub Service', () => {
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

  describe('encryptToken/decryptToken', () => {
    it('should encrypt and decrypt tokens correctly', () => {
      const token = 'gho_test_token_1234567890abcdef';
      const encrypted = encryptToken(token);
      const decrypted = decryptToken(encrypted);

      expect(encrypted).not.toBe(token);
      expect(decrypted).toBe(token);
    });

    it('should handle legacy tokens', () => {
      const legacyToken = 'not-base64-encoded';
      const decrypted = decryptToken(legacyToken);
      expect(decrypted).toBe(legacyToken);
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