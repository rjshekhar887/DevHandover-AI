import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ENVELOPE_PREFIX = 'gh-token';
const ENVELOPE_VERSION = 'v2';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
const CONTEXT_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const BASE64URL_PATTERN = /^(?:[A-Za-z0-9_-]{4})*(?:[A-Za-z0-9_-]{2}|[A-Za-z0-9_-]{3})?$/;

export interface TokenEncryptionContext {
  entity: string;
  userId: string;
  field: string;
}

export interface TokenEncryptionConfig {
  activeKeyId: string;
  keys: ReadonlyMap<string, Buffer>;
}

export interface TokenEncryptionEnvironment {
  nodeEnv: string;
  activeKeyId?: string;
  keysJson?: string;
}

export class TokenEncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenEncryptionError';
  }
}

function decodeKey(encodedKey: unknown): Buffer {
  if (
    typeof encodedKey !== 'string' ||
    !BASE64_PATTERN.test(encodedKey)
  ) {
    throw new TokenEncryptionError('Encryption keys must use canonical Base64 encoding');
  }

  const key = Buffer.from(encodedKey, 'base64');
  if (key.length !== KEY_LENGTH || key.toString('base64') !== encodedKey) {
    throw new TokenEncryptionError('Encryption keys must decode to exactly 32 bytes');
  }
  return key;
}

function parseKeyMap(keysJson: string): Array<[string, string]> {
  let index = 0;
  const keys: Array<[string, string]> = [];
  const seen = new Set<string>();

  const skipWhitespace = (): void => {
    while (/\s/.test(keysJson[index] || '')) index += 1;
  };

  const readString = (): string => {
    if (keysJson[index] !== '"') {
      throw new TokenEncryptionError('GITHUB_TOKEN_ENCRYPTION_KEYS must be a JSON object of string values');
    }

    const start = index;
    index += 1;
    while (index < keysJson.length) {
      const character = keysJson[index];
      if (character === '\\') {
        index += 2;
        continue;
      }
      if (character === '"') {
        index += 1;
        try {
          return JSON.parse(keysJson.slice(start, index)) as string;
        } catch {
          throw new TokenEncryptionError('GITHUB_TOKEN_ENCRYPTION_KEYS contains invalid JSON strings');
        }
      }
      index += 1;
    }

    throw new TokenEncryptionError('GITHUB_TOKEN_ENCRYPTION_KEYS contains an unterminated JSON string');
  };

  skipWhitespace();
  if (keysJson[index] !== '{') {
    throw new TokenEncryptionError('GITHUB_TOKEN_ENCRYPTION_KEYS must be a JSON object');
  }
  index += 1;
  skipWhitespace();

  if (keysJson[index] === '}') {
    index += 1;
  } else {
    while (index < keysJson.length) {
      const keyId = readString();
      if (seen.has(keyId)) {
        throw new TokenEncryptionError('GITHUB_TOKEN_ENCRYPTION_KEYS contains duplicate key identifiers');
      }
      seen.add(keyId);
      if (!KEY_ID_PATTERN.test(keyId)) {
        throw new TokenEncryptionError('Encryption key identifiers must be 1-32 URL-safe characters');
      }

      skipWhitespace();
      if (keysJson[index] !== ':') {
        throw new TokenEncryptionError('GITHUB_TOKEN_ENCRYPTION_KEYS must be a JSON object of string values');
      }
      index += 1;
      skipWhitespace();
      const encodedKey = readString();
      keys.push([keyId, encodedKey]);

      skipWhitespace();
      if (keysJson[index] === '}') {
        index += 1;
        break;
      }
      if (keysJson[index] !== ',') {
        throw new TokenEncryptionError('GITHUB_TOKEN_ENCRYPTION_KEYS must be a JSON object of string values');
      }
      index += 1;
      skipWhitespace();
    }
  }

  skipWhitespace();
  if (index !== keysJson.length) {
    throw new TokenEncryptionError('GITHUB_TOKEN_ENCRYPTION_KEYS must be a JSON object');
  }
  return keys;
}

export function parseTokenEncryptionConfig(
  environment: TokenEncryptionEnvironment
): TokenEncryptionConfig | undefined {
  const { activeKeyId, keysJson, nodeEnv } = environment;
  if (!activeKeyId && !keysJson && nodeEnv !== 'production') return undefined;
  if (!activeKeyId || !keysJson) {
    throw new TokenEncryptionError(
      'GITHUB_TOKEN_ENCRYPTION_ACTIVE_KEY_ID and GITHUB_TOKEN_ENCRYPTION_KEYS must be configured together'
    );
  }

  let entries: Array<[string, string]>;
  try {
    entries = parseKeyMap(keysJson);
  } catch (error) {
    if (error instanceof TokenEncryptionError) throw error;
    throw new TokenEncryptionError('Invalid GITHUB_TOKEN_ENCRYPTION_KEYS configuration');
  }

  if (entries.length === 0) {
    throw new TokenEncryptionError('At least one GitHub token encryption key is required');
  }

  const keys = new Map<string, Buffer>();
  for (const [keyId, encodedKey] of entries) {
    keys.set(keyId, decodeKey(encodedKey));
  }

  if (!KEY_ID_PATTERN.test(activeKeyId) || !keys.has(activeKeyId)) {
    throw new TokenEncryptionError('Active GitHub token encryption key ID is not configured');
  }

  return { activeKeyId, keys };
}

function getKey(config: TokenEncryptionConfig, keyId: string): Buffer {
  const key = config.keys.get(keyId);
  if (!key) throw new TokenEncryptionError('Unknown GitHub token encryption key ID');
  if (!Buffer.isBuffer(key) || key.length !== KEY_LENGTH) {
    throw new TokenEncryptionError('GitHub token encryption key must be 32 bytes');
  }
  return key;
}

function encodeContext(context: TokenEncryptionContext): Buffer {
  if (
    typeof context !== 'object' ||
    context === null ||
    typeof context.entity !== 'string' ||
    typeof context.field !== 'string' ||
    !CONTEXT_ID_PATTERN.test(context.entity) ||
    !CONTEXT_ID_PATTERN.test(context.field) ||
    typeof context.userId !== 'string' ||
    context.userId.length < 1 ||
    Buffer.byteLength(context.userId, 'utf8') > 256 ||
    context.userId.trim() !== context.userId ||
    /[\u0000-\u001f\u007f]/.test(context.userId) ||
    Object.keys(context).length !== 3 ||
    !Object.prototype.hasOwnProperty.call(context, 'entity') ||
    !Object.prototype.hasOwnProperty.call(context, 'userId') ||
    !Object.prototype.hasOwnProperty.call(context, 'field')
  ) {
    throw new TokenEncryptionError('Invalid GitHub token encryption context');
  }

  return Buffer.from(JSON.stringify([context.entity, context.userId, context.field]), 'utf8');
}

function decodeBase64Url(value: string): Buffer {
  if (!BASE64URL_PATTERN.test(value)) {
    throw new TokenEncryptionError('Malformed GitHub token encryption envelope');
  }
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.toString('base64url') !== value) {
    throw new TokenEncryptionError('Malformed GitHub token encryption envelope');
  }
  return decoded;
}

export function encryptToken(
  plaintext: string,
  config: TokenEncryptionConfig,
  context: TokenEncryptionContext
): string {
  if (typeof plaintext !== 'string') {
    throw new TokenEncryptionError('Token plaintext must be a string');
  }
  const encodedContext = encodeContext(context);

  const keyId = config.activeKeyId;
  if (!KEY_ID_PATTERN.test(keyId)) {
    throw new TokenEncryptionError('Invalid active GitHub token encryption key ID');
  }
  const key = getKey(config, keyId);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: AUTH_TAG_LENGTH });
  cipher.setAAD(Buffer.concat([
    Buffer.from(`${ENVELOPE_PREFIX}:${ENVELOPE_VERSION}:${keyId}:`, 'utf8'),
    encodedContext,
  ]));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    ENVELOPE_PREFIX,
    ENVELOPE_VERSION,
    keyId,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join(':');
}

export function decryptToken(
  envelope: string,
  config: TokenEncryptionConfig,
  context: TokenEncryptionContext
): string {
  if (typeof envelope !== 'string') {
    throw new TokenEncryptionError('Malformed GitHub token encryption envelope');
  }

  const parts = envelope.split(':');
  if (parts.length !== 6 || parts[0] !== ENVELOPE_PREFIX) {
    throw new TokenEncryptionError('Malformed GitHub token encryption envelope');
  }
  if (parts[1] !== ENVELOPE_VERSION) {
    throw new TokenEncryptionError('Unsupported GitHub token encryption version');
  }

  const encodedContext = encodeContext(context);
  const [, , keyId, encodedIv, encodedTag, encodedCiphertext] = parts;
  if (!KEY_ID_PATTERN.test(keyId)) {
    throw new TokenEncryptionError('Malformed GitHub token encryption envelope');
  }

  const iv = decodeBase64Url(encodedIv);
  const tag = decodeBase64Url(encodedTag);
  const ciphertext = decodeBase64Url(encodedCiphertext);
  if (iv.length !== IV_LENGTH || tag.length !== AUTH_TAG_LENGTH) {
    throw new TokenEncryptionError('Malformed GitHub token encryption envelope');
  }

  const key = getKey(config, keyId);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: AUTH_TAG_LENGTH });
    decipher.setAAD(Buffer.concat([
      Buffer.from(`${ENVELOPE_PREFIX}:${ENVELOPE_VERSION}:${keyId}:`, 'utf8'),
      encodedContext,
    ]));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new TokenEncryptionError('GitHub token decryption failed');
  }
}
