import { describe, expect, it, vi } from 'vitest';
import {
  createSafeTokenMigrationSummary,
  createTokenMigrationPlan,
  executeTokenMigrationPlan,
  type TokenMigrationSnapshot,
  type TokenMigrationStore,
  type TokenMigrationUpdate,
} from './githubTokenMigration';
import {
  encryptToken,
  type TokenEncryptionConfig,
} from './tokenEncryption';

const encryptionConfig: TokenEncryptionConfig = {
  activeKeyId: 'migration-test',
  keys: new Map([['migration-test', Buffer.alloc(32, 19)]]),
};
const migrationRunId = 'migration-run-test';
const PROVENANCE = { format: 'plaintext' as const, reference: 'change-record-test' };

function snapshot(
  userToken: string | null,
  connectionToken: string | null,
  userId = 'platform-user-test'
): TokenMigrationSnapshot {
  return {
    users: [{ id: userId, userId, accessToken: userToken }],
    connections: [{ id: 'connection-test', userId, accessToken: connectionToken }],
  };
}

function plan(
  input: TokenMigrationSnapshot,
  provenance = PROVENANCE
) {
  return createTokenMigrationPlan(
    input,
    { encryptionConfig, provenance },
    migrationRunId
  );
}

function makeStore(
  initialValues: Map<string, string | null>,
  failForRecord?: string
): TokenMigrationStore & { values: Map<string, string | null> } {
  const values = new Map(initialValues);
  return {
    values,
    async updateTokensAtomically(_userId: string, updates: TokenMigrationUpdate[]) {
      const pending = new Map(values);
      for (const update of updates) {
        const key = `${update.entity}:${update.recordId}`;
        if (key === failForRecord || pending.get(key) !== update.originalValue) {
          throw new Error('transaction update failed');
        }
        pending.set(key, update.encryptedValue);
      }
      values.clear();
      for (const [key, value] of pending) values.set(key, value);
    },
  };
}

describe('GitHub token migration planning', () => {
  it('defaults legacy values without provenance to ambiguous and does not write', async () => {
    const migrationPlan = createTokenMigrationPlan(
      snapshot('raw-shaped-value', 'raw-shaped-value'),
      { encryptionConfig, provenance: {} },
      migrationRunId
    );
    const store = makeStore(new Map([
      ['User:platform-user-test', 'raw-shaped-value'],
      ['GitHubConnection:connection-test', 'raw-shaped-value'],
    ]));

    expect(migrationPlan.report.counts).toEqual(expect.arrayContaining([
      expect.objectContaining({ entity: 'User', classification: 'AMBIGUOUS', count: 1 }),
      expect.objectContaining({ entity: 'GitHubConnection', classification: 'AMBIGUOUS', count: 1 }),
    ]));
    expect(migrationPlan.report.eligibleCount).toBe(0);
    expect(migrationPlan.report.quarantinedCount).toBe(2);
    expect(migrationPlan.updatesByUser.size).toBe(0);
    expect(store.values.get('User:platform-user-test')).toBe('raw-shaped-value');
  });

  it('classifies null and empty values separately without quarantine', () => {
    const migrationPlan = plan(snapshot('', null));

    expect(migrationPlan.report.counts).toEqual(expect.arrayContaining([
      expect.objectContaining({ entity: 'User', classification: 'NULL_OR_EMPTY', count: 1 }),
      expect.objectContaining({ entity: 'GitHubConnection', classification: 'NULL_OR_EMPTY', count: 1 }),
    ]));
    expect(migrationPlan.report.quarantinedCount).toBe(0);
    expect(migrationPlan.report.eligibleCount).toBe(0);
  });

  it('recognizes and validates a correctly bound encrypted envelope', () => {
    const value = encryptToken('synthetic-encrypted-test-value', encryptionConfig, {
      entity: 'GitHubConnection',
      userId: 'platform-user-test',
      field: 'accessToken',
    });
    const migrationPlan = plan(snapshot(null, value));

    expect(migrationPlan.report.counts).toContainEqual(expect.objectContaining({
      entity: 'GitHubConnection',
      field: 'accessToken',
      classification: 'ALREADY_ENCRYPTED_VALID',
      count: 1,
      eligibleCount: 0,
      quarantinedCount: 0,
    }));
    expect(migrationPlan.updatesByUser.size).toBe(0);
  });

  it('recognizes matching encrypted duplicates using their distinct field contexts', () => {
    const userEnvelope = encryptToken('matching-encrypted-test-value', encryptionConfig, {
      entity: 'User',
      userId: 'platform-user-test',
      field: 'accessToken',
    });
    const connectionEnvelope = encryptToken('matching-encrypted-test-value', encryptionConfig, {
      entity: 'GitHubConnection',
      userId: 'platform-user-test',
      field: 'accessToken',
    });
    const migrationPlan = plan(snapshot(userEnvelope, connectionEnvelope));

    expect(migrationPlan.report.quarantinedCount).toBe(0);
    expect(migrationPlan.report.counts).toEqual(expect.arrayContaining([
      expect.objectContaining({ entity: 'User', classification: 'ALREADY_ENCRYPTED_VALID' }),
      expect.objectContaining({
        entity: 'GitHubConnection',
        classification: 'ALREADY_ENCRYPTED_VALID',
      }),
    ]));
  });

  it('classifies malformed envelopes and unknown key IDs without decoding them', () => {
    const malformed = 'gh-token:v2:migration-test:invalid:invalid:invalid';
    const unknownKey = 'gh-token:v2:other-key:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAA:AA';
    const malformedPlan = plan(snapshot(null, malformed));
    const unknownPlan = plan(snapshot(null, unknownKey));

    expect(malformedPlan.report.counts).toContainEqual(expect.objectContaining({
      classification: 'ALREADY_ENCRYPTED_INVALID',
    }));
    expect(unknownPlan.report.counts).toContainEqual(expect.objectContaining({
      classification: 'UNKNOWN_KEY_OR_CONTEXT',
    }));
  });

  it('quarantines authentication failures caused by a wrong AAD context', () => {
    const value = encryptToken('synthetic-context-test-value', encryptionConfig, {
      entity: 'User',
      userId: 'different-platform-user',
      field: 'accessToken',
    });
    const migrationPlan = plan(snapshot(null, value));

    expect(migrationPlan.report.counts).toContainEqual(expect.objectContaining({
      entity: 'GitHubConnection',
      classification: 'UNKNOWN_KEY_OR_CONTEXT',
    }));
    expect(migrationPlan.report.quarantinedCount).toBe(1);
  });

  it('classifies legacy values only according to explicit operator provenance', () => {
    const base64Plan = createTokenMigrationPlan(
      snapshot(null, Buffer.from('synthetic-base64-test-value').toString('base64')),
      { encryptionConfig, provenance: { format: 'base64', reference: 'verified-release-record' } },
      migrationRunId
    );
    const plaintextPlan = plan(snapshot(null, 'synthetic-plaintext-test-value'));
    const invalidBase64Plan = createTokenMigrationPlan(
      snapshot(null, 'not-canonical-base64!'),
      { encryptionConfig, provenance: { format: 'base64', reference: 'verified-release-record' } },
      migrationRunId
    );

    expect(base64Plan.report.counts).toContainEqual(expect.objectContaining({
      classification: 'LEGACY_BASE64_CANDIDATE',
    }));
    expect(plaintextPlan.report.counts).toContainEqual(expect.objectContaining({
      classification: 'LEGACY_PLAINTEXT_CANDIDATE',
    }));
    expect(invalidBase64Plan.report.counts).toContainEqual(expect.objectContaining({
      classification: 'UNKNOWN_FORMAT',
    }));
  });

  it('does not make legacy candidates eligible for migration without encryption keys', () => {
    const migrationPlan = createTokenMigrationPlan(
      snapshot(null, 'synthetic-plaintext-value'),
      { provenance: PROVENANCE },
      migrationRunId
    );

    expect(migrationPlan.report.eligibleCount).toBe(0);
    expect(migrationPlan.report.quarantinedCount).toBe(1);
    expect(migrationPlan.report.quarantineRecords[0].reasonCode)
      .toBe('ENCRYPTION_KEYS_REQUIRED');
  });

  it('allows matching duplicate plaintext values and quarantines conflicting values', () => {
    const matching = plan(snapshot('same-synthetic-value', 'same-synthetic-value'));
    const conflicting = plan(snapshot('synthetic-user-value', 'synthetic-connection-value'));

    expect(matching.report.eligibleCount).toBe(2);
    expect(matching.report.quarantinedCount).toBe(0);
    expect(conflicting.report.counts).toContainEqual(expect.objectContaining({
      entity: 'User',
      classification: 'DUPLICATE_CONFLICT',
    }));
    expect(conflicting.report.counts).toContainEqual(expect.objectContaining({
      entity: 'GitHubConnection',
      classification: 'DUPLICATE_CONFLICT',
    }));
    expect(conflicting.report.quarantinedCount).toBe(2);
    expect(conflicting.updatesByUser.size).toBe(0);
  });

  it('does not migrate a candidate when its non-empty duplicate cannot be verified', () => {
    const migrationPlan = createTokenMigrationPlan(
      snapshot('synthetic-plaintext-value', 'gh-token:v2:unknown-key:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAA:AA'),
      { encryptionConfig, provenance: PROVENANCE },
      migrationRunId
    );

    expect(migrationPlan.report.eligibleCount).toBe(0);
    expect(migrationPlan.report.quarantinedCount).toBe(2);
    expect(migrationPlan.report.quarantineRecords).toEqual(expect.arrayContaining([
      expect.objectContaining({ entity: 'User', reasonCode: 'DUPLICATE_PEER_NOT_VERIFIABLE' }),
      expect.objectContaining({ entity: 'GitHubConnection', reasonCode: 'UNKNOWN_KEY' }),
    ]));
  });
});

describe('GitHub token migration execution', () => {
  it('round-trips candidate plaintext before creating updates and applies updates atomically', async () => {
    const migrationPlan = plan(snapshot('synthetic-legacy-value', 'synthetic-legacy-value'));
    const store = makeStore(new Map([
      ['User:platform-user-test', 'synthetic-legacy-value'],
      ['GitHubConnection:connection-test', 'synthetic-legacy-value'],
    ]));
    const result = await executeTokenMigrationPlan(migrationPlan, store);

    expect(result.migratedCount).toBe(2);
    expect(store.values.get('User:platform-user-test')).toMatch(/^gh-token:v2:/);
    expect(store.values.get('GitHubConnection:connection-test')).toMatch(/^gh-token:v2:/);
    expect(store.values.get('User:platform-user-test'))
      .not.toBe(store.values.get('GitHubConnection:connection-test'));
  });

  it('uses compare-and-swap and quarantines records changed since classification', async () => {
    const migrationPlan = plan(snapshot(null, 'synthetic-cas-value'));
    const store = makeStore(new Map([
      ['GitHubConnection:connection-test', 'concurrently-replaced-value'],
    ]));
    const result = await executeTokenMigrationPlan(migrationPlan, store);

    expect(result.migratedCount).toBe(0);
    expect(store.values.get('GitHubConnection:connection-test')).toBe('concurrently-replaced-value');
    expect(result.report.quarantineRecords).toContainEqual(expect.objectContaining({
      entity: 'GitHubConnection',
      reasonCode: 'TRANSACTION_OR_CAS_FAILED',
    }));
    expect(result.failedCount).toBe(1);
    expect(result.outcomesByUser).toContainEqual(expect.objectContaining({
      userId: 'platform-user-test',
      status: 'partial',
      errorCode: 'TRANSACTION_OR_CAS_FAILED',
    }));
  });

  it('rolls back both duplicate field updates if either conditional write fails', async () => {
    const migrationPlan = plan(snapshot('same-synthetic-value', 'same-synthetic-value'));
    const initialValues = new Map([
      ['User:platform-user-test', 'same-synthetic-value'],
      ['GitHubConnection:connection-test', 'same-synthetic-value'],
    ]);
    const store = makeStore(initialValues, 'GitHubConnection:connection-test');
    const result = await executeTokenMigrationPlan(migrationPlan, store);

    expect(result.migratedCount).toBe(0);
    expect(store.values).toEqual(initialValues);
    expect(result.failedCount).toBe(2);
    expect(result.report.quarantineRecords).toHaveLength(2);
    expect(result.finalCounts.reduce((sum, item) => sum + item.count, 0)).toBe(2);
  });

  it('keeps a failed user atomic while continuing an independent user', async () => {
    const migrationPlan = createTokenMigrationPlan(
      {
        users: [
          { id: 'user-one', userId: 'user-one', accessToken: 'legacy-one' },
          { id: 'user-two', userId: 'user-two', accessToken: 'legacy-two' },
        ],
        connections: [],
      },
      { encryptionConfig, provenance: PROVENANCE },
      migrationRunId
    );
    const values = new Map([
      ['User:user-one', 'legacy-one'],
      ['User:user-two', 'legacy-two'],
    ]);
    const store: TokenMigrationStore = {
      async updateTokensAtomically(userId, updates) {
        if (userId === 'user-one') throw new Error('simulated transaction rollback');
        for (const update of updates) {
          expect(values.get(`${update.entity}:${update.recordId}`)).toBe(update.originalValue);
          values.set(`${update.entity}:${update.recordId}`, update.encryptedValue);
        }
      },
    };

    const result = await executeTokenMigrationPlan(migrationPlan, store);

    expect(values.get('User:user-one')).toBe('legacy-one');
    expect(values.get('User:user-two')).toMatch(/^gh-token:v2:/);
    expect(result.outcomesByUser).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: 'user-one', status: 'failed', failedCount: 1 }),
      expect.objectContaining({ userId: 'user-two', status: 'success', migratedCount: 1 }),
    ]));
    expect(result.migratedCount + result.failedCount + result.skippedCount + result.quarantinedCount)
      .toBe(result.recordOutcomes.length);
  });

  it('is idempotent when rerun against already-encrypted matching fields', async () => {
    const firstPlan = plan(snapshot('synthetic-rerun-value', 'synthetic-rerun-value'));
    const store = makeStore(new Map([
      ['User:platform-user-test', 'synthetic-rerun-value'],
      ['GitHubConnection:connection-test', 'synthetic-rerun-value'],
    ]));
    await executeTokenMigrationPlan(firstPlan, store);

    const userEnvelope = store.values.get('User:platform-user-test')!;
    const connectionEnvelope = store.values.get('GitHubConnection:connection-test')!;
    const secondPlan = plan(snapshot(userEnvelope, connectionEnvelope));
    const secondStore = { updateTokensAtomically: vi.fn() };
    const secondResult = await executeTokenMigrationPlan(secondPlan, secondStore);

    expect(secondPlan.report.eligibleCount).toBe(0);
    expect(secondResult.migratedCount).toBe(0);
    expect(secondStore.updateTokensAtomically).not.toHaveBeenCalled();
  });

  it('keeps quarantine metadata free of token, ciphertext, and key material', () => {
    const token = 'synthetic-quarantine-token';
    const migrationPlan = createTokenMigrationPlan(
      snapshot(token, 'different-synthetic-quarantine-token'),
      { encryptionConfig, provenance: PROVENANCE },
      migrationRunId
    );
    const serialized = JSON.stringify(migrationPlan.report.quarantineRecords);

    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain('different-synthetic-quarantine-token');
    expect(serialized).not.toContain('migration-test');
    expect(serialized).not.toContain(encryptionConfig.keys.get('migration-test')!.toString('base64'));
    expect(migrationPlan.report.quarantineRecords[0]).toEqual(expect.objectContaining({
      recordId: expect.any(String),
      entity: expect.any(String),
      field: 'accessToken',
      reasonCode: 'DUPLICATE_TOKEN_VALUES_DISAGREE',
      timestamp: expect.any(String),
      migrationRunId,
    }));
  });

  it('creates safe summaries without token material or key values', () => {
    const token = 'synthetic-summary-token';
    const migrationPlan = createTokenMigrationPlan(
      snapshot(token, 'different-synthetic-summary-token'),
      { encryptionConfig, provenance: PROVENANCE },
      migrationRunId
    );
    const summary = createSafeTokenMigrationSummary('dry-run', migrationPlan.report);
    const serialized = JSON.stringify(summary);

    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain('different-synthetic-summary-token');
    expect(serialized).not.toContain('migration-test');
    expect(serialized).not.toContain(encryptionConfig.keys.get('migration-test')!.toString('base64'));
    expect(summary.writesPerformed).toBe(0);
  });
});
