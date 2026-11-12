import {
  decryptToken,
  encryptToken,
  type TokenEncryptionConfig,
  type TokenEncryptionContext,
} from './tokenEncryption';

export const TOKEN_MIGRATION_CLASSIFICATIONS = [
  'NULL_OR_EMPTY',
  'ALREADY_ENCRYPTED_VALID',
  'ALREADY_ENCRYPTED_INVALID',
  'LEGACY_BASE64_CANDIDATE',
  'LEGACY_PLAINTEXT_CANDIDATE',
  'AMBIGUOUS',
  'DUPLICATE_CONFLICT',
  'UNKNOWN_FORMAT',
  'UNKNOWN_KEY_OR_CONTEXT',
] as const;

export type TokenMigrationClassification =
  (typeof TOKEN_MIGRATION_CLASSIFICATIONS)[number];
export type LegacyTokenFormat = 'base64' | 'plaintext';
export type TokenMigrationEntity = 'GitHubConnection' | 'User';

export interface TokenMigrationRecord {
  id: string;
  userId: string;
  accessToken: string | null;
}

export interface TokenMigrationSnapshot {
  users: TokenMigrationRecord[];
  connections: TokenMigrationRecord[];
}

export interface TokenMigrationProvenance {
  format?: LegacyTokenFormat;
  reference?: string;
}

export interface TokenMigrationSettings {
  encryptionConfig?: TokenEncryptionConfig;
  provenance: TokenMigrationProvenance;
}

export interface TokenMigrationReportEntry {
  entity: TokenMigrationEntity;
  field: 'accessToken';
  classification: TokenMigrationClassification;
  eligible: boolean;
  quarantined: boolean;
  reasonCode?: string;
}

export interface TokenMigrationQuarantineRecord {
  recordId: string;
  entity: TokenMigrationEntity;
  field: 'accessToken';
  reasonCode: string;
  timestamp: string;
  migrationRunId: string;
}

export interface TokenMigrationReport {
  migrationRunId: string;
  counts: Array<{
    entity: TokenMigrationEntity;
    field: 'accessToken';
    classification: TokenMigrationClassification;
    count: number;
    eligibleCount: number;
    quarantinedCount: number;
  }>;
  eligibleCount: number;
  quarantinedCount: number;
  quarantineRecords: TokenMigrationQuarantineRecord[];
}

export interface TokenMigrationUpdate {
  entity: TokenMigrationEntity;
  recordId: string;
  userId: string;
  originalValue: string;
  encryptedValue: string;
}

export interface TokenMigrationStore {
  updateTokensAtomically(userId: string, updates: TokenMigrationUpdate[]): Promise<void>;
}

export interface TokenMigrationPlan {
  report: TokenMigrationReport;
  updatesByUser: Map<string, TokenMigrationUpdate[]>;
  records: Array<{
    entity: TokenMigrationEntity;
    recordId: string;
    userId: string;
    classification: TokenMigrationClassification;
    status: 'pending' | 'skipped' | 'quarantined';
    reasonCode?: string;
  }>;
}

export type TokenMigrationRecordStatus =
  | 'migrated'
  | 'skipped'
  | 'failed'
  | 'quarantined';

export interface TokenMigrationRecordOutcome {
  entity: TokenMigrationEntity;
  recordId: string;
  userId: string;
  classification: TokenMigrationClassification;
  status: TokenMigrationRecordStatus;
  reasonCode?: string;
}

export interface TokenMigrationUserOutcome {
  userId: string;
  status: 'success' | 'failed' | 'skipped' | 'quarantined' | 'partial';
  migratedCount: number;
  skippedCount: number;
  failedCount: number;
  quarantinedCount: number;
  errorCode?: string;
}

export interface TokenMigrationExecutionResult {
  report: TokenMigrationReport;
  migratedCount: number;
  skippedCount: number;
  failedCount: number;
  quarantinedCount: number;
  outcomesByUser: TokenMigrationUserOutcome[];
  recordOutcomes: TokenMigrationRecordOutcome[];
  finalCounts: Array<{
    status: TokenMigrationRecordStatus;
    count: number;
  }>;
}

export interface SafeTokenMigrationSummary {
  mode: 'dry-run' | 'execute';
  migrationRunId: string;
  planning: {
    counts: TokenMigrationReport['counts'];
    eligibleCount: number;
    quarantinedCount: number;
  };
  execution?: {
    migratedCount: number;
    skippedCount: number;
    failedCount: number;
    quarantinedCount: number;
    totalRecords: number;
    outcomesByUser: TokenMigrationUserOutcome[];
    finalCounts: TokenMigrationExecutionResult['finalCounts'];
  };
  writesPerformed?: number;
}

interface ClassifiedValue {
  entity: TokenMigrationEntity;
  record: TokenMigrationRecord;
  classification: TokenMigrationClassification;
  plaintext?: string;
  eligible: boolean;
  quarantined: boolean;
  reasonCode?: string;
}

const ENVELOPE_PREFIX = 'gh-token:';
const ENVELOPE_KEY_ID = /^[A-Za-z0-9_-]{1,32}$/;
const BASE64URL_COMPONENT = /^(?:[A-Za-z0-9_-]{4})*(?:[A-Za-z0-9_-]{2}|[A-Za-z0-9_-]{3})?$/;

function contextFor(entity: TokenMigrationEntity, userId: string): TokenEncryptionContext {
  return { entity, userId, field: 'accessToken' };
}

function decodeCanonicalBase64(value: string): string | undefined {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    return undefined;
  }

  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) return undefined;
  const decoded = bytes.toString('utf8');
  if (!Buffer.from(decoded, 'utf8').equals(bytes)) return undefined;
  return decoded;
}

function looksLikeMalformedEnvelope(value: string): boolean {
  if (!value.startsWith(ENVELOPE_PREFIX)) return false;

  const parts = value.split(':');
  if (parts.length !== 6 || parts[0] !== 'gh-token' || parts[1] !== 'v2') return true;
  if (!ENVELOPE_KEY_ID.test(parts[2])) return true;
  if (
    !BASE64URL_COMPONENT.test(parts[3]) ||
    !BASE64URL_COMPONENT.test(parts[4]) ||
    !BASE64URL_COMPONENT.test(parts[5])
  ) {
    return true;
  }

  const iv = Buffer.from(parts[3], 'base64url');
  const tag = Buffer.from(parts[4], 'base64url');
  return iv.length !== 12 || tag.length !== 16;
}

function classifyValue(
  entity: TokenMigrationEntity,
  record: TokenMigrationRecord,
  settings: TokenMigrationSettings
): ClassifiedValue {
  const value = record.accessToken;
  if (value === null || value.length === 0) {
    return {
      entity,
      record,
      classification: 'NULL_OR_EMPTY',
      eligible: false,
      quarantined: false,
    };
  }

  if (value.startsWith(ENVELOPE_PREFIX)) {
    if (looksLikeMalformedEnvelope(value)) {
      return {
        entity,
        record,
        classification: 'ALREADY_ENCRYPTED_INVALID',
        eligible: false,
        quarantined: true,
        reasonCode: 'INVALID_ENVELOPE',
      };
    }

    const keyId = value.split(':')[2];
    if (!settings.encryptionConfig?.keys.has(keyId)) {
      return {
        entity,
        record,
        classification: 'UNKNOWN_KEY_OR_CONTEXT',
        eligible: false,
        quarantined: true,
        reasonCode: 'UNKNOWN_KEY',
      };
    }

    try {
      const plaintext = decryptToken(
        value,
        settings.encryptionConfig,
        contextFor(entity, record.userId)
      );
      return {
        entity,
        record,
        classification: 'ALREADY_ENCRYPTED_VALID',
        plaintext,
        eligible: false,
        quarantined: false,
      };
    } catch {
      return {
        entity,
        record,
        classification: 'UNKNOWN_KEY_OR_CONTEXT',
        eligible: false,
        quarantined: true,
        reasonCode: 'KEY_OR_CONTEXT_AUTHENTICATION_FAILED',
      };
    }
  }

  if (!settings.provenance.format || !settings.provenance.reference?.trim()) {
    return {
      entity,
      record,
      classification: 'AMBIGUOUS',
      eligible: false,
      quarantined: true,
      reasonCode: 'LEGACY_PROVENANCE_REQUIRED',
    };
  }

  if (settings.provenance.format === 'base64') {
    const plaintext = decodeCanonicalBase64(value);
    if (plaintext === undefined || plaintext.length === 0) {
      return {
        entity,
        record,
        classification: 'UNKNOWN_FORMAT',
        eligible: false,
        quarantined: true,
        reasonCode: 'INVALID_PROVENANCE_BASE64',
      };
    }
    return {
      entity,
      record,
      classification: 'LEGACY_BASE64_CANDIDATE',
      plaintext,
      eligible: true,
      quarantined: false,
    };
  }

  return {
    entity,
    record,
    classification: 'LEGACY_PLAINTEXT_CANDIDATE',
    plaintext: value,
    eligible: true,
    quarantined: false,
  };
}

function appendQuarantine(
  report: TokenMigrationReport,
  value: ClassifiedValue,
  reasonCode = value.reasonCode || value.classification
): void {
  if (report.quarantineRecords.some(record =>
    record.entity === value.entity && record.recordId === value.record.id
  )) {
    return;
  }
  report.quarantineRecords.push({
    recordId: value.record.id,
    entity: value.entity,
    field: 'accessToken',
    reasonCode,
    timestamp: new Date().toISOString(),
    migrationRunId: report.migrationRunId,
  });
}

function countReport(
  entries: ClassifiedValue[],
  report: TokenMigrationReport
): void {
  const counts = new Map<string, {
    entity: TokenMigrationEntity;
    classification: TokenMigrationClassification;
    count: number;
    eligibleCount: number;
    quarantinedCount: number;
  }>();
  for (const entry of entries) {
    const key = `${entry.entity}\u0000${entry.classification}`;
    const count = counts.get(key) || {
      entity: entry.entity,
      classification: entry.classification,
      count: 0,
      eligibleCount: 0,
      quarantinedCount: 0,
    };
    count.count += 1;
    if (entry.eligible && !entry.quarantined) count.eligibleCount += 1;
    if (entry.quarantined) count.quarantinedCount += 1;
    counts.set(key, count);
  }

  report.counts = Array.from(counts.values()).map(count => ({
    ...count,
    field: 'accessToken' as const,
  })).sort((left, right) =>
    left.entity.localeCompare(right.entity) ||
    left.classification.localeCompare(right.classification)
  );
  report.eligibleCount = entries.filter(entry => entry.eligible && !entry.quarantined).length;
  report.quarantinedCount = entries.filter(entry => entry.quarantined).length;
}

export function createTokenMigrationPlan(
  snapshot: TokenMigrationSnapshot,
  settings: TokenMigrationSettings,
  migrationRunId: string
): TokenMigrationPlan {
  const byUser = new Map<string, ClassifiedValue[]>();
  const allValues: ClassifiedValue[] = [];

  for (const [entity, records] of [
    ['User', snapshot.users],
    ['GitHubConnection', snapshot.connections],
  ] as const) {
    for (const record of records) {
      const classified = classifyValue(entity, record, settings);
      allValues.push(classified);
      const values = byUser.get(record.userId) || [];
      values.push(classified);
      byUser.set(record.userId, values);
    }
  }

  const report: TokenMigrationReport = {
    migrationRunId,
    counts: [],
    eligibleCount: 0,
    quarantinedCount: 0,
    quarantineRecords: [],
  };
  const updatesByUser = new Map<string, TokenMigrationUpdate[]>();
  const records: TokenMigrationPlan['records'] = [];

  for (const [userId, values] of byUser) {
    const present = values.filter(value =>
      value.record.accessToken !== null && value.record.accessToken.length > 0
    );

    if (present.length > 1) {
      const allComparable = present.every(value => value.plaintext !== undefined);
      const allEqual = allComparable && present.every(
        value => value.plaintext === present[0].plaintext
      );

      if (allComparable && !allEqual) {
        for (const value of present) {
          value.classification = 'DUPLICATE_CONFLICT';
          value.eligible = false;
          value.quarantined = true;
          value.reasonCode = 'DUPLICATE_TOKEN_VALUES_DISAGREE';
          appendQuarantine(report, value);
        }
      } else if (!allComparable) {
        for (const value of present) {
          if (value.eligible) {
            value.eligible = false;
            value.quarantined = true;
            value.reasonCode = 'DUPLICATE_PEER_NOT_VERIFIABLE';
          }
          if (value.quarantined) appendQuarantine(report, value);
        }
      }
    }

    const updates: TokenMigrationUpdate[] = [];
    for (const value of values) {
      if (value.quarantined) appendQuarantine(report, value);
      if (!value.eligible || value.quarantined || value.plaintext === undefined) {
        records.push({
          entity: value.entity,
          recordId: value.record.id,
          userId,
          classification: value.classification,
          status: value.quarantined ? 'quarantined' : 'skipped',
          reasonCode: value.reasonCode,
        });
        continue;
      }

      if (!settings.encryptionConfig) {
        value.eligible = false;
        value.quarantined = true;
        value.reasonCode = 'ENCRYPTION_KEYS_REQUIRED';
        appendQuarantine(report, value);
        records.push({
          entity: value.entity,
          recordId: value.record.id,
          userId,
          classification: value.classification,
          status: 'quarantined',
          reasonCode: value.reasonCode,
        });
        continue;
      }

      try {
        const context = contextFor(value.entity, userId);
        const encryptedValue = encryptToken(value.plaintext, settings.encryptionConfig, context);
        const verifiedPlaintext = decryptToken(encryptedValue, settings.encryptionConfig, context);
        if (!Buffer.from(verifiedPlaintext, 'utf8').equals(Buffer.from(value.plaintext, 'utf8'))) {
          value.eligible = false;
          value.quarantined = true;
          value.reasonCode = 'ROUND_TRIP_VERIFICATION_FAILED';
          appendQuarantine(report, value);
          records.push({
            entity: value.entity,
            recordId: value.record.id,
            userId,
            classification: value.classification,
            status: 'quarantined',
            reasonCode: value.reasonCode,
          });
          continue;
        }

        updates.push({
          entity: value.entity,
          recordId: value.record.id,
          userId,
          originalValue: value.record.accessToken!,
          encryptedValue,
        });
        records.push({
          entity: value.entity,
          recordId: value.record.id,
          userId,
          classification: value.classification,
          status: 'pending',
        });
      } catch {
        value.eligible = false;
        value.quarantined = true;
        value.reasonCode = 'ENCRYPTION_OR_VERIFICATION_FAILED';
        appendQuarantine(report, value);
        records.push({
          entity: value.entity,
          recordId: value.record.id,
          userId,
          classification: value.classification,
          status: 'quarantined',
          reasonCode: value.reasonCode,
        });
      }
    }

    if (updates.length > 0) updatesByUser.set(userId, updates);
  }

  countReport(allValues, report);
  return { report, updatesByUser, records };
}

export async function executeTokenMigrationPlan(
  plan: TokenMigrationPlan,
  store: TokenMigrationStore,
  onQuarantine?: (records: TokenMigrationQuarantineRecord[]) => Promise<void>
): Promise<TokenMigrationExecutionResult> {
  const recordOutcomes: TokenMigrationRecordOutcome[] = plan.records.map(record => ({
    ...record,
    status: record.status === 'pending' ? 'failed' : record.status,
  }));
  const outcomeById = new Map(recordOutcomes.map(outcome => [
    `${outcome.entity}\u0000${outcome.recordId}`,
    outcome,
  ]));
  const outcomesByUser = new Map<string, TokenMigrationUserOutcome>();

  const updateUserOutcome = (userId: string): void => {
    const records = recordOutcomes.filter(record => record.userId === userId);
    const migratedCount = records.filter(record => record.status === 'migrated').length;
    const skippedCount = records.filter(record => record.status === 'skipped').length;
    const failedCount = records.filter(record => record.status === 'failed').length;
    const quarantinedCount = records.filter(record => record.status === 'quarantined').length;
    const activeStatuses = [
      migratedCount > 0,
      skippedCount > 0,
      failedCount > 0,
      quarantinedCount > 0,
    ].filter(Boolean).length;
    const status: TokenMigrationUserOutcome['status'] = activeStatuses > 1
      ? 'partial'
      : failedCount > 0
        ? 'failed'
        : migratedCount > 0
          ? 'success'
          : quarantinedCount > 0
            ? 'quarantined'
            : 'skipped';

    outcomesByUser.set(userId, {
      userId,
      status,
      migratedCount,
      skippedCount,
      failedCount,
      quarantinedCount,
      ...(failedCount > 0 ? { errorCode: 'TRANSACTION_OR_CAS_FAILED' } : {}),
    });
  };

  const users = new Set(recordOutcomes.map(record => record.userId));
  for (const userId of users) updateUserOutcome(userId);

  for (const [userId, updates] of plan.updatesByUser) {
    try {
      await store.updateTokensAtomically(userId, updates);
      for (const update of updates) {
        const outcome = outcomeById.get(`${update.entity}\u0000${update.recordId}`);
        if (outcome) outcome.status = 'migrated';
      }
    } catch {
      const newQuarantines: TokenMigrationQuarantineRecord[] = [];
      for (const update of updates) {
        const outcome = outcomeById.get(`${update.entity}\u0000${update.recordId}`);
        if (outcome) {
          outcome.status = 'failed';
          outcome.reasonCode = 'TRANSACTION_OR_CAS_FAILED';
        }
        const quarantine = {
          recordId: update.recordId,
          entity: update.entity,
          field: 'accessToken' as const,
          reasonCode: 'TRANSACTION_OR_CAS_FAILED',
          timestamp: new Date().toISOString(),
          migrationRunId: plan.report.migrationRunId,
        };
        plan.report.quarantineRecords.push(quarantine);
        newQuarantines.push(quarantine);
      }
      updateUserOutcome(userId);
      if (onQuarantine && newQuarantines.length > 0) {
        try {
          await onQuarantine(newQuarantines);
        } catch {
          throw new Error('Quarantine metadata persistence failed');
        }
      }
    }
    updateUserOutcome(userId);
  }

  const finalCounts = (['migrated', 'skipped', 'failed', 'quarantined'] as const).map(status => ({
    status,
    count: recordOutcomes.filter(record => record.status === status).length,
  }));
  const migratedCount = finalCounts.find(count => count.status === 'migrated')!.count;
  const skippedCount = finalCounts.find(count => count.status === 'skipped')!.count;
  const failedCount = finalCounts.find(count => count.status === 'failed')!.count;
  const quarantinedCount = finalCounts.find(count => count.status === 'quarantined')!.count;

  return {
    report: plan.report,
    migratedCount,
    skippedCount,
    failedCount,
    quarantinedCount,
    outcomesByUser: Array.from(outcomesByUser.values()),
    recordOutcomes,
    finalCounts,
  };
}

export function createSafeTokenMigrationSummary(
  mode: 'dry-run' | 'execute',
  report: TokenMigrationReport,
  execution?: TokenMigrationExecutionResult
): SafeTokenMigrationSummary {
  return {
    mode,
    migrationRunId: report.migrationRunId,
    planning: {
      counts: report.counts,
      eligibleCount: report.eligibleCount,
      quarantinedCount: report.quarantinedCount,
    },
    ...(mode === 'dry-run'
      ? { writesPerformed: 0 }
      : {
        execution: {
          migratedCount: execution?.migratedCount || 0,
          skippedCount: execution?.skippedCount || 0,
          failedCount: execution?.failedCount || 0,
          quarantinedCount: execution?.quarantinedCount || 0,
          totalRecords: execution?.recordOutcomes.length || 0,
          outcomesByUser: execution?.outcomesByUser || [],
          finalCounts: execution?.finalCounts || [],
        },
      }),
  };
}
