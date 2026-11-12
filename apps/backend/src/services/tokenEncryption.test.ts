import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  decryptToken,
  encryptToken,
  parseTokenEncryptionConfig,
  TokenEncryptionConfig,
  TokenEncryptionContext,
  TokenEncryptionError,
} from './tokenEncryption';

const keyConfig = (
  keyId = 'test-key',
  key = randomBytes(32)
): TokenEncryptionConfig => ({
  activeKeyId: keyId,
  keys: new Map([[keyId, key]]),
});

const connectionContext = (overrides: Partial<TokenEncryptionContext> = {}): TokenEncryptionContext => ({
  entity: 'GitHubConnection',
  userId: 'test-user-1',
  field: 'accessToken',
  ...overrides,
});

const configuredKeys = (keys: string): {
  nodeEnv: string;
  activeKeyId: string;
  keysJson: string;
} => ({
  nodeEnv: 'production',
  activeKeyId: 'active',
  keysJson: keys,
});

describe('GitHub token encryption utility', () => {
  it('encrypts and decrypts with a versioned authenticated envelope and matching context', () => {
    const config = keyConfig();
    const plaintext = 'unit-test-token-value';
    const context = connectionContext();

    const envelope = encryptToken(plaintext, config, context);

    expect(envelope).toMatch(/^gh-token:v2:test-key:/);
    expect(decryptToken(envelope, config, context)).toBe(plaintext);
    expect(envelope).not.toContain(plaintext);
  });

  it('uses a fresh IV so encrypting the same plaintext twice produces different envelopes', () => {
    const config = keyConfig();
    const context = connectionContext();

    expect(encryptToken('same-unit-test-value', config, context))
      .not.toBe(encryptToken('same-unit-test-value', config, context));
  });

  it.each([
    ['user ID', { userId: 'another-user' }],
    ['entity type', { entity: 'User' }],
    ['field identity', { field: 'refreshToken' }],
  ])('rejects decryption with a different %s context', (_label, override) => {
    const config = keyConfig();
    const envelope = encryptToken('unit-test-value', config, connectionContext());

    expect(() => decryptToken(envelope, config, connectionContext(override)))
      .toThrow('decryption failed');
  });

  it('rejects missing context at runtime for encryption and decryption', () => {
    const config = keyConfig();

    expect(() => encryptToken('unit-test-value', config, undefined as unknown as TokenEncryptionContext))
      .toThrow('Invalid GitHub token encryption context');
    const envelope = encryptToken('unit-test-value', config, connectionContext());
    expect(() => decryptToken(envelope, config, undefined as unknown as TokenEncryptionContext))
      .toThrow('Invalid GitHub token encryption context');
  });

  it('rejects invalid entity, user, and field context values', () => {
    const config = keyConfig();

    expect(() => encryptToken('unit-test-value', config, connectionContext({ entity: 'Bad:Entity' })))
      .toThrow('Invalid GitHub token encryption context');
    expect(() => encryptToken('unit-test-value', config, connectionContext({ field: '' })))
      .toThrow('Invalid GitHub token encryption context');
    expect(() => encryptToken('unit-test-value', config, connectionContext({ userId: ' user ' })))
      .toThrow('Invalid GitHub token encryption context');
  });

  it('rejects decryption with an incorrect key', () => {
    const context = connectionContext();
    const envelope = encryptToken('unit-test-value', keyConfig('test-key'), context);

    expect(() => decryptToken(envelope, keyConfig('test-key'), context))
      .toThrow(TokenEncryptionError);
  });

  it('rejects modified ciphertext and authentication tags', () => {
    const config = keyConfig();
    const context = connectionContext();
    const envelope = encryptToken('unit-test-value', config, context);
    const parts = envelope.split(':');
    const ciphertext = Buffer.from(parts[5], 'base64url');
    ciphertext[0] ^= 1;
    parts[5] = ciphertext.toString('base64url');
    expect(() => decryptToken(parts.join(':'), config, context)).toThrow('decryption failed');

    const modifiedTag = envelope.split(':');
    const tag = Buffer.from(modifiedTag[4], 'base64url');
    tag[0] ^= 1;
    modifiedTag[4] = tag.toString('base64url');
    expect(() => decryptToken(modifiedTag.join(':'), config, context)).toThrow('decryption failed');
  });

  it('rejects malformed envelopes and invalid Base64URL components', () => {
    const config = keyConfig();
    const context = connectionContext();
    const validParts = encryptToken('unit-test-value', config, context).split(':');

    expect(() => decryptToken('not-an-envelope', config, context)).toThrow('Malformed');
    const malformedComponent = [...validParts];
    malformedComponent[3] = 'bad!';
    expect(() => decryptToken(malformedComponent.join(':'), config, context)).toThrow('Malformed');
  });

  it('rejects an incorrect IV length', () => {
    const config = keyConfig();
    const context = connectionContext();
    const parts = encryptToken('unit-test-value', config, context).split(':');
    parts[3] = randomBytes(11).toString('base64url');

    expect(() => decryptToken(parts.join(':'), config, context)).toThrow('Malformed');
  });

  it('rejects an incorrect authentication tag length', () => {
    const config = keyConfig();
    const context = connectionContext();
    const parts = encryptToken('unit-test-value', config, context).split(':');
    parts[4] = randomBytes(15).toString('base64url');

    expect(() => decryptToken(parts.join(':'), config, context)).toThrow('Malformed');
  });

  it('accepts empty ciphertext for empty plaintext', () => {
    const config = keyConfig();
    const context = connectionContext();
    const envelope = encryptToken('', config, context);

    expect(envelope.split(':')[5]).toBe('');
    expect(decryptToken(envelope, config, context)).toBe('');
  });

  it('rejects unsupported envelope versions and unknown key identifiers', () => {
    const config = keyConfig();
    const context = connectionContext();
    const envelope = encryptToken('unit-test-value', config, context);

    expect(() => decryptToken(envelope.replace('gh-token:v2:', 'gh-token:v3:'), config, context))
      .toThrow('Unsupported');
    expect(() => decryptToken(envelope.replace(':test-key:', ':unknown-key:'), config, context))
      .toThrow('Unknown');
  });

  it('rejects duplicate JSON key IDs, including escaped duplicates', () => {
    const key = randomBytes(32).toString('base64');

    expect(() => parseTokenEncryptionConfig(configuredKeys(
      `{"active":"${key}","active":"${key}"}`
    ))).toThrow('duplicate');
    expect(() => parseTokenEncryptionConfig(configuredKeys(
      `{"active":"${key}","\\u0061ctive":"${key}"}`
    ))).toThrow('duplicate');
  });

  it('rejects invalid key IDs and malformed or noncanonical Base64', () => {
    const validKey = randomBytes(32).toString('base64');

    expect(() => parseTokenEncryptionConfig({
      ...configuredKeys(`{"invalid key":"${validKey}"}`),
      activeKeyId: 'invalid key',
    })).toThrow('URL-safe');
    expect(() => parseTokenEncryptionConfig(configuredKeys('{"active":"not*base64"}')))
      .toThrow('canonical Base64');
    expect(() => parseTokenEncryptionConfig(configuredKeys('{"active":"YQ==="}')))
      .toThrow('canonical Base64');
    expect(() => parseTokenEncryptionConfig(configuredKeys('{"active":"YQ"}')))
      .toThrow('canonical Base64');
  });

  it('rejects keys that do not decode to exactly 32 bytes', () => {
    const shortKey = randomBytes(16).toString('base64');

    expect(() => parseTokenEncryptionConfig(configuredKeys(
      JSON.stringify({ active: shortKey })
    ))).toThrow('exactly 32 bytes');
  });

  it('requires production key configuration and rejects malformed production keys', () => {
    expect(() => parseTokenEncryptionConfig({ nodeEnv: 'production' }))
      .toThrow('must be configured together');
    expect(() => parseTokenEncryptionConfig(configuredKeys('{"active":"malformed"}')))
      .toThrow('canonical Base64');
  });

  it('rejects an unknown active key ID', () => {
    const validKey = randomBytes(32).toString('base64');

    expect(() => parseTokenEncryptionConfig({
      nodeEnv: 'production',
      activeKeyId: 'missing',
      keysJson: JSON.stringify({ configured: validKey }),
    })).toThrow('not configured');
  });

  it('decrypts with a retained key and encrypts with the active key', () => {
    const oldKey = randomBytes(32);
    const activeKey = randomBytes(32);
    const context = connectionContext();
    const oldEnvelope = encryptToken('unit-test-value', keyConfig('old-key', oldKey), context);
    const rotatedConfig: TokenEncryptionConfig = {
      activeKeyId: 'active-key',
      keys: new Map([
        ['old-key', oldKey],
        ['active-key', activeKey],
      ]),
    };

    const newEnvelope = encryptToken('unit-test-value', rotatedConfig, context);

    expect(decryptToken(oldEnvelope, rotatedConfig, context)).toBe('unit-test-value');
    expect(newEnvelope).toMatch(/^gh-token:v2:active-key:/);
  });

  it('does not expose key material or plaintext in encryption errors', () => {
    const key = randomBytes(32);
    const plaintext = 'sensitive-unit-test-plaintext';
    const context = connectionContext();
    const envelope = encryptToken(plaintext, keyConfig('test-key', key), context);
    const parts = envelope.split(':');
    parts[4] = randomBytes(16).toString('base64url');

    let errorMessage = '';
    try {
      decryptToken(parts.join(':'), keyConfig('test-key', key), context);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }

    expect(errorMessage).toBe('GitHub token decryption failed');
    expect(errorMessage).not.toContain(key.toString('base64'));
    expect(errorMessage).not.toContain(plaintext);
  });
});
