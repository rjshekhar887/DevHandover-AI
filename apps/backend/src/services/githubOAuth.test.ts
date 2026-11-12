/**
 * GitHub OAuth Tests
 * Tests for OAuth state generation and URL building
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateOAuthState, buildOAuthUrl } from './githubService';

// Mock config before importing
vi.mock('../config', () => ({
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
}));

describe('GitHub OAuth Service', () => {
  describe('generateOAuthState', () => {
    it('should generate a secure random state', () => {
      const state1 = generateOAuthState();
      const state2 = generateOAuthState();

      expect(state1).toBeDefined();
      expect(state1).not.toBe(state2);
      expect(state1.length).toBeGreaterThan(20);
    });

    it('should generate URL-safe base64 strings', () => {
      const state = generateOAuthState();
      // base64url should not contain +, /, or =
      expect(state).not.toContain('+');
      expect(state).not.toContain('/');
      expect(state).not.toContain('=');
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

    it('should include all required OAuth parameters', () => {
      const state = 'random-state';
      const url = buildOAuthUrl(state);

      const urlObj = new URL(url);
      expect(urlObj.searchParams.get('client_id')).toBe('test-client-id');
      expect(urlObj.searchParams.get('redirect_uri')).toBe('http://localhost:3000/api/v1/github/callback');
      expect(urlObj.searchParams.get('scope')).toBe('repo read:user user:email');
      expect(urlObj.searchParams.get('state')).toBe(state);
      expect(urlObj.searchParams.get('allow_signup')).toBe('true');
    });
  });
});