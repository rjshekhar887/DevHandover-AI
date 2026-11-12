import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  openSync,
  realpathSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  createSafeTokenMigrationSummary,
  createTokenMigrationPlan,
  executeTokenMigrationPlan,
  type LegacyTokenFormat,
  type TokenMigrationExecutionResult,
  type TokenMigrationProvenance,
  type TokenMigrationQuarantineRecord,
  type TokenMigrationSnapshot,
  type TokenMigrationStore,
} from '../services/githubTokenMigration';
import type { TokenEncryptionConfig } from '../services/tokenEncryption';

export interface TokenMigrationCliOptions {
  execute: boolean;
  legacyFormat?: LegacyTokenFormat;
  provenanceReference?: string;
  quarantineReportPath?: string;
}

export interface QuarantineSink {
  append(records: TokenMigrationQuarantineRecord[]): Promise<void>;
  publish(): Promise<string>;
  temporaryPath: string;
}

export interface TokenMigrationCliDependencies {
  loadSnapshot(): Promise<TokenMigrationSnapshot>;
  store: TokenMigrationStore;
  encryptionConfig?: TokenEncryptionConfig;
  migrationRunId?: string;
  createQuarantineSink(
    path: string,
    records: TokenMigrationQuarantineRecord[]
  ): Promise<QuarantineSink>;
  writeOutput(value: string): void;
  writeError(value: string): void;
}

const reportToLine = (record: TokenMigrationQuarantineRecord): string =>
  `${JSON.stringify(record)}\n`;

export function parseTokenMigrationCliOptions(args: string[]): TokenMigrationCliOptions {
  const options: TokenMigrationCliOptions = { execute: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--execute') {
      options.execute = true;
    } else if (argument === '--dry-run') {
      options.execute = false;
    } else if (argument === '--legacy-format') {
      const value = args[++index];
      if (value !== 'base64' && value !== 'plaintext') {
        throw new Error('--legacy-format must be base64 or plaintext');
      }
      options.legacyFormat = value;
    } else if (argument === '--provenance-ref') {
      options.provenanceReference = args[++index];
      if (!options.provenanceReference?.trim()) {
        throw new Error('--provenance-ref requires a non-empty reference');
      }
    } else if (argument === '--quarantine-report') {
      options.quarantineReportPath = args[++index];
      if (!options.quarantineReportPath?.trim()) {
        throw new Error('--quarantine-report requires a file path');
      }
    } else {
      throw new Error('Unsupported migration command-line option');
    }
  }
  return options;
}

export function validateQuarantineReportPath(path: string): string {
  if (!isAbsolute(path) || !path.toLowerCase().endsWith('.jsonl')) {
    throw new Error('Quarantine destination must be an absolute .jsonl path');
  }
  const absolutePath = resolve(path);
  const fileName = basename(absolutePath).toLowerCase();
  if (
    fileName.startsWith('.env') ||
    /\.(?:pem|key|db|sqlite|sqlite3)$/i.test(fileName)
  ) {
    throw new Error('Quarantine destination is not a safe report path');
  }

  const parentPath = dirname(absolutePath);
  let parentStat;
  try {
    parentStat = lstatSync(parentPath);
  } catch {
    throw new Error('Quarantine destination directory must already exist');
  }
  if (!parentStat.isDirectory()) {
    throw new Error('Quarantine destination parent must be a directory');
  }
  if (existsSync(absolutePath)) {
    throw new Error('Quarantine destination already exists');
  }
  return resolve(realpathSync(parentPath), basename(absolutePath));
}

export async function createAtomicQuarantineSink(
  path: string,
  records: TokenMigrationQuarantineRecord[]
): Promise<QuarantineSink> {
  const reportPath = validateQuarantineReportPath(path);
  const temporaryPath = resolve(
    dirname(reportPath),
    `.${basename(reportPath)}.${randomUUID()}.tmp`
  );
  const descriptor = openSync(temporaryPath, 'wx', 0o600);
  try {
    for (const record of records) writeSync(descriptor, reportToLine(record));
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }

  return {
    temporaryPath,
    async append(newRecords) {
      if (newRecords.length === 0) return;
      const appendDescriptor = openSync(temporaryPath, 'a', 0o600);
      try {
        for (const record of newRecords) writeSync(appendDescriptor, reportToLine(record));
        fsyncSync(appendDescriptor);
      } finally {
        closeSync(appendDescriptor);
      }
    },
    async publish() {
      // Same-directory hard-link publication is atomic and cannot replace an existing report.
      linkSync(temporaryPath, reportPath);
      unlinkSync(temporaryPath);
      return reportPath;
    },
  };
}

function assertExecutionOptions(
  options: TokenMigrationCliOptions,
  encryptionConfig?: TokenEncryptionConfig
): void {
  if (!options.execute) return;
  if (!options.legacyFormat) {
    throw new Error('Execution requires an explicit legacy format');
  }
  if (!options.provenanceReference?.trim()) {
    throw new Error('Execution requires an operator provenance reference');
  }
  if (!encryptionConfig) {
    throw new Error('Execution requires configured GitHub token encryption keys');
  }
  if (!options.quarantineReportPath) {
    throw new Error('Execution requires a new quarantine report path');
  }
  validateQuarantineReportPath(options.quarantineReportPath);
}

export async function runTokenMigrationCli(
  args: string[],
  dependencies: TokenMigrationCliDependencies
): Promise<{ exitCode: number }> {
  let options: TokenMigrationCliOptions;
  try {
    options = parseTokenMigrationCliOptions(args);
    assertExecutionOptions(options, dependencies.encryptionConfig);
  } catch (error) {
    dependencies.writeError(error instanceof Error ? error.message : 'Invalid migration options');
    return { exitCode: 2 };
  }

  let sink: QuarantineSink | undefined;
  try {
    const snapshot = await dependencies.loadSnapshot();
    const provenance: TokenMigrationProvenance = {
      format: options.legacyFormat,
      reference: options.provenanceReference,
    };
    const plan = createTokenMigrationPlan(
      snapshot,
      { encryptionConfig: dependencies.encryptionConfig, provenance },
      dependencies.migrationRunId || randomUUID()
    );

    if (!options.execute) {
      dependencies.writeOutput(JSON.stringify(
        createSafeTokenMigrationSummary('dry-run', plan.report),
        null,
        2
      ));
      return { exitCode: 0 };
    }

    sink = await dependencies.createQuarantineSink(
      options.quarantineReportPath!,
      plan.report.quarantineRecords
    );
    const execution: TokenMigrationExecutionResult = await executeTokenMigrationPlan(
      plan,
      dependencies.store,
      records => sink!.append(records)
    );
    const publishedPath = await sink.publish();
    dependencies.writeOutput(JSON.stringify({
      ...createSafeTokenMigrationSummary('execute', execution.report, execution),
      status: execution.failedCount > 0
        ? 'failed'
        : execution.quarantinedCount > 0
          ? 'completed_with_quarantines'
          : 'completed',
      quarantineReport: publishedPath,
    }, null, 2));
    return { exitCode: execution.failedCount > 0 ? 1 : 0 };
  } catch {
    const recoveryPath = sink ? ` Temporary quarantine data: ${sink.temporaryPath}` : '';
    dependencies.writeError(
      `Token migration failed safely; the run must not be considered complete.${recoveryPath}`
    );
    return { exitCode: 1 };
  }
}
