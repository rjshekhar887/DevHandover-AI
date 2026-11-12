import 'dotenv/config';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { config } from '../config';
import {
  createAtomicQuarantineSink,
  runTokenMigrationCli,
} from './githubTokenMigrationCli';
import type {
  TokenMigrationSnapshot,
  TokenMigrationStore,
  TokenMigrationUpdate,
} from '../services/githubTokenMigration';

async function main(): Promise<void> {
  const prisma = new PrismaClient({ log: [] });
  const store: TokenMigrationStore = {
    async updateTokensAtomically(userId: string, updates: TokenMigrationUpdate[]): Promise<void> {
      await prisma.$transaction(async tx => {
        for (const update of updates) {
          const result = update.entity === 'User'
            ? await tx.user.updateMany({
              where: { id: update.recordId, accessToken: update.originalValue },
              data: { accessToken: update.encryptedValue },
            })
            : await tx.gitHubConnection.updateMany({
              where: {
                id: update.recordId,
                userId,
                accessToken: update.originalValue,
              },
              data: { accessToken: update.encryptedValue },
            });

          if (result.count !== 1) throw new Error('Compare-and-swap conflict');
        }
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    },
  };

  try {
    const result = await runTokenMigrationCli(process.argv.slice(2), {
      async loadSnapshot(): Promise<TokenMigrationSnapshot> {
        const [users, connections] = await Promise.all([
          prisma.user.findMany({ select: { id: true, accessToken: true } }),
          prisma.gitHubConnection.findMany({
            select: { id: true, userId: true, accessToken: true },
          }),
        ]);
        return {
          users: users.map(user => ({
            id: user.id,
            userId: user.id,
            accessToken: user.accessToken,
          })),
          connections: connections.map(connection => ({
            id: connection.id,
            userId: connection.userId,
            accessToken: connection.accessToken,
          })),
        };
      },
      store,
      encryptionConfig: config.TOKEN_ENCRYPTION,
      migrationRunId: randomUUID(),
      createQuarantineSink: createAtomicQuarantineSink,
      writeOutput: value => console.log(value),
      writeError: value => console.error(value),
    });
    process.exitCode = result.exitCode;
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch(() => {
  console.error('Token migration stopped safely; no sensitive details were emitted.');
  process.exitCode = 1;
});
