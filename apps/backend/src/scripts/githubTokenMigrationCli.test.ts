import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAtomicQuarantineSink,
  runTokenMigrationCli,
  validateQuarantineReportPath,
  type QuarantineSink,
  type TokenMigrationCliDependencies,
} from './githubTokenMigrationCli';
import type {
  TokenMigrationSnapshot,
  TokenMigrationStore,
  TokenMigrationUpdate,
} from '../services/githubTokenMigration';
import type { TokenEncryptionConfig } from '../services/tokenEncryption';

const encryptionConfig: TokenEncryptionConfig = {
  activeKeyId: 'cli-test',
  keys: new Map([['cli-test', Buffer.alloc(32, 29)]]),
};
const temporaryDirectories: string[] = [];

function makeTempDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), 'token-migration-cli-'));
  temporaryDirectories.push(path);
  return path;
}

function dependencies(
  overrides: Partial<TokenMigrationCliDependencies> = {}
): TokenMigrationCliDependencies {
  return {
    loadSnapshot: vi.fn(async (): Promise<TokenMigrationSnapshot> => ({
      users: [],
      connections: [],
    })),
    store: {
      updateTokensAtomically: vi.fn(async (_userId: string, _updates: TokenMigrationUpdate[]) => {}),
    },
    encryptionConfig,
    migrationRunId: 'cli-run-test',
    createQuarantineSink: vi.fn(createAtomicQuarantineSink),
    writeOutput: vi.fn(),
    writeError: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('GitHub token migration CLI', () => {
  it('defaults no arguments to dry-run and performs reads but zero writes', async () => {
    const deps = dependencies({
      loadSnapshot: vi.fn(async () => ({
        users: [{ id: 'user-id', userId: 'user-id', accessToken: 'synthetic-token' }],
        connections: [],
      })),
    });

    const result = await runTokenMigrationCli([], deps);

    expect(result.exitCode).toBe(0);
    expect(deps.loadSnapshot).toHaveBeenCalledOnce();
    expect(deps.store.updateTokensAtomically).not.toHaveBeenCalled();
    const output = vi.mocked(deps.writeOutput).mock.calls[0][0];
    expect(output).toContain('"mode": "dry-run"');
    expect(output).not.toContain('synthetic-token');
  });

  it('does not execute migration when provenance options are present without --execute', async () => {
    const reportPath = join(makeTempDirectory(), 'quarantine.jsonl');
    const deps = dependencies({
      loadSnapshot: vi.fn(async () => ({
        users: [{ id: 'user-id', userId: 'user-id', accessToken: 'synthetic-token' }],
        connections: [],
      })),
    });

    const result = await runTokenMigrationCli([
      '--legacy-format',
      'plaintext',
      '--provenance-ref',
      'operator-evidence',
      '--quarantine-report',
      reportPath,
    ], deps);

    expect(result.exitCode).toBe(0);
    expect(deps.store.updateTokensAtomically).not.toHaveBeenCalled();
    expect(deps.createQuarantineSink).not.toHaveBeenCalled();
    expect(vi.mocked(deps.writeOutput).mock.calls[0][0]).toContain('"mode": "dry-run"');
  });

  it.each([
    [['--execute'], 'format'],
    [['--execute', '--legacy-format', 'plaintext'], 'provenance'],
    [['--execute', '--legacy-format', 'plaintext', '--provenance-ref', 'evidence'], 'keys'],
    [
      ['--execute', '--legacy-format', 'plaintext', '--provenance-ref', 'evidence'],
      'quarantine',
    ],
  ])('rejects execution without required %s safeguards', async (args, _expected) => {
    const deps = dependencies({
      encryptionConfig: args.includes('--legacy-format') ? encryptionConfig : undefined,
    });
    const result = await runTokenMigrationCli(args, deps);

    expect(result.exitCode).toBe(2);
    expect(deps.loadSnapshot).not.toHaveBeenCalled();
    expect(deps.store.updateTokensAtomically).not.toHaveBeenCalled();
  });

  it('rejects unsafe and existing quarantine destinations', () => {
    const directory = makeTempDirectory();
    expect(() => validateQuarantineReportPath(join(directory, 'report.txt')))
      .toThrow('absolute .jsonl');
    expect(() => validateQuarantineReportPath(join(directory, '.env.backup.jsonl')))
      .toThrow('safe report path');

    const existing = join(directory, 'existing.jsonl');
    writeFileSync(existing, 'previous report');
    expect(() => validateQuarantineReportPath(existing))
      .toThrow('already exists');
  });

  it('rejects execution when encryption keys are not configured', async () => {
    const reportPath = join(makeTempDirectory(), 'quarantine.jsonl');
    const deps = dependencies({ encryptionConfig: undefined });
    const result = await runTokenMigrationCli([
      '--execute',
      '--legacy-format',
      'plaintext',
      '--provenance-ref',
      'operator-evidence',
      '--quarantine-report',
      reportPath,
    ], deps);

    expect(result.exitCode).toBe(2);
    expect(deps.loadSnapshot).not.toHaveBeenCalled();
    expect(deps.store.updateTokensAtomically).not.toHaveBeenCalled();
  });

  it('publishes the fully flushed quarantine report atomically without overwriting', async () => {
    const directory = makeTempDirectory();
    const reportPath = join(directory, 'quarantine.jsonl');
    const record = {
      recordId: 'record-id',
      entity: 'User' as const,
      field: 'accessToken' as const,
      reasonCode: 'TEST_REASON',
      timestamp: '2026-01-01T00:00:00.000Z',
      migrationRunId: 'run-id',
    };
    const sink = await createAtomicQuarantineSink(reportPath, [record]);

    expect(() => readFileSync(reportPath)).toThrow();
    expect(readFileSync(sink.temporaryPath, 'utf8')).toContain('"recordId":"record-id"');
    expect(await sink.publish()).toBe(reportPath);
    expect(readFileSync(reportPath, 'utf8')).toBe(`${JSON.stringify(record)}\n`);
    await expect(sink.publish()).rejects.toThrow();
  });

  it('reports partial transaction failures with reconciled final counts and non-zero status', async () => {
    const token = 'synthetic-private-token';
    const reportPath = join(makeTempDirectory(), 'quarantine.jsonl');
    const deps = dependencies({
      loadSnapshot: vi.fn(async () => ({
        users: [{ id: 'user-id', userId: 'user-id', accessToken: token }],
        connections: [],
      })),
      store: {
        updateTokensAtomically: vi.fn(async () => {
          throw new Error(`database failure contains ${token}`);
        }),
      },
    });
    const result = await runTokenMigrationCli([
      '--execute',
      '--legacy-format',
      'plaintext',
      '--provenance-ref',
      'operator-evidence',
      '--quarantine-report',
      reportPath,
    ], deps);

    expect(result.exitCode).toBe(1);
    const output = vi.mocked(deps.writeOutput).mock.calls[0][0];
    expect(output).toContain('"failedCount": 1');
    expect(output).toContain('"migratedCount": 0');
    expect(output).toContain('"totalRecords": 1');
    expect(output).not.toContain(token);
    expect(vi.mocked(deps.writeError).mock.calls.join()).not.toContain(token);
    expect(readFileSync(reportPath, 'utf8')).not.toContain(token);
    expect(readFileSync(reportPath, 'utf8')).toContain('TRANSACTION_OR_CAS_FAILED');
  });

  it('does not label a run with unresolved quarantines as complete', async () => {
    const reportPath = join(makeTempDirectory(), 'quarantine.jsonl');
    const deps = dependencies({
      loadSnapshot: vi.fn(async () => ({
        users: [{
          id: 'user-id',
          userId: 'user-id',
          accessToken: 'gh-token:v2:unknown-key:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAA:AA',
        }],
        connections: [],
      })),
    });

    const result = await runTokenMigrationCli([
      '--execute',
      '--legacy-format',
      'plaintext',
      '--provenance-ref',
      'operator-evidence',
      '--quarantine-report',
      reportPath,
    ], deps);

    expect(result.exitCode).toBe(0);
    expect(vi.mocked(deps.writeOutput).mock.calls[0][0])
      .toContain('"status": "completed_with_quarantines"');
    expect(deps.store.updateTokensAtomically).not.toHaveBeenCalled();
  });

  it('fails safely if quarantine publication cannot be prepared or appended', async () => {
    const token = 'synthetic-report-failure-token';
    const reportPath = join(makeTempDirectory(), 'quarantine.jsonl');
    const failingSink: QuarantineSink = {
      temporaryPath: join(tmpdir(), 'safe-migration-report.temp'),
      append: vi.fn(async () => {
        throw new Error(`write failure contains ${token}`);
      }),
      publish: vi.fn(async () => reportPath),
    };
    const deps = dependencies({
      loadSnapshot: vi.fn(async () => ({
        users: [{ id: 'user-id', userId: 'user-id', accessToken: token }],
        connections: [],
      })),
      store: {
        updateTokensAtomically: vi.fn(async () => {
          throw new Error('transaction failure');
        }),
      },
      createQuarantineSink: vi.fn(async () => failingSink),
    });

    const result = await runTokenMigrationCli([
      '--execute',
      '--legacy-format',
      'plaintext',
      '--provenance-ref',
      'operator-evidence',
      '--quarantine-report',
      reportPath,
    ], deps);

    expect(result.exitCode).toBe(1);
    expect(failingSink.publish).not.toHaveBeenCalled();
    expect(deps.writeOutput).not.toHaveBeenCalled();
    expect(vi.mocked(deps.writeError).mock.calls.join()).not.toContain(token);
    expect(vi.mocked(deps.writeError).mock.calls.join()).toContain(failingSink.temporaryPath);
  });

  it('rejects an existing report destination before reading database state', async () => {
    const existingReport = join(makeTempDirectory(), 'existing.jsonl');
    writeFileSync(existingReport, 'preserve');
    const deps = dependencies();

    const result = await runTokenMigrationCli([
      '--execute',
      '--legacy-format',
      'plaintext',
      '--provenance-ref',
      'operator-evidence',
      '--quarantine-report',
      existingReport,
    ], deps);

    expect(result.exitCode).toBe(2);
    expect(deps.loadSnapshot).not.toHaveBeenCalled();
    expect(readFileSync(existingReport, 'utf8')).toBe('preserve');
  });
});
