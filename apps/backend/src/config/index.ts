/**
 * Centralized configuration for the backend
 * All environment variables are validated and typed here
 */

import { z } from 'zod';
import { parseTokenEncryptionConfig } from '../services/tokenEncryption';
import type { TokenEncryptionConfig } from '../services/tokenEncryption';

// Environment schema with validation
const envSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  API_PREFIX: z.string().default('/api/v1'),

  // Database
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // CORS
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  CORS_CREDENTIALS: z.coerce.boolean().default(true),

  // Demo Mode - allows app to work without GitHub OAuth or LLM
  DEMO_MODE: z.coerce.boolean().default(false),
  DEMO_USER_EMAIL: z.string().email().default('demo@devhandover.ai'),

  // GitHub
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  GITHUB_CALLBACK_URL: z.string().url().optional(),
  GITHUB_TOKEN_ENCRYPTION_ACTIVE_KEY_ID: z.string().optional(),
  GITHUB_TOKEN_ENCRYPTION_KEYS: z.string().optional(),

  // LLM Provider
  LLM_PROVIDER: z.enum(['openai', 'nim', 'custom']).default('openai'),
  LLM_API_KEY: z.string().optional(),
  LLM_BASE_URL: z.string().url().optional(),
  LLM_MODEL: z.string().default('gpt-4o'),

  // JWT (for future auth)
  JWT_SECRET: z.string().optional(),
  JWT_EXPIRES_IN: z.string().default('7d'),

  // Logging
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly']).default('info'),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('❌ Invalid environment variables:');
  console.error(parsedEnv.error.flatten().fieldErrors);
  process.exit(1);
}

const {
  GITHUB_TOKEN_ENCRYPTION_ACTIVE_KEY_ID,
  GITHUB_TOKEN_ENCRYPTION_KEYS,
  ...parsedConfig
} = parsedEnv.data;

let tokenEncryptionConfig: TokenEncryptionConfig | undefined;
try {
  tokenEncryptionConfig = parseTokenEncryptionConfig({
    nodeEnv: parsedConfig.NODE_ENV,
    activeKeyId: GITHUB_TOKEN_ENCRYPTION_ACTIVE_KEY_ID,
    keysJson: GITHUB_TOKEN_ENCRYPTION_KEYS,
  });
} catch {
  console.error('Invalid GitHub token encryption configuration. Check the key IDs and 32-byte Base64 key values.');
  process.exit(1);
}

export const config = {
  ...parsedConfig,
  TOKEN_ENCRYPTION: tokenEncryptionConfig,
};

export type Config = typeof config;

// Helper to check if we're in production
export const isProduction = config.NODE_ENV === 'production';
export const isDevelopment = config.NODE_ENV === 'development';
export const isTest = config.NODE_ENV === 'test';
export const isDemoMode = config.DEMO_MODE;