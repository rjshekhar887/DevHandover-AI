/**
 * Prisma Client Singleton
 * Ensures a single Prisma Client instance across the application
 */

import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: [
      { emit: 'event', level: 'query' },
      { emit: 'stdout', level: 'error' },
      { emit: 'stdout', level: 'warn' },
    ],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

// Log queries in development
if (process.env.NODE_ENV === 'development') {
  // @ts-expect-error - Prisma event types not properly exported
  prisma.$on('query', (e: { query: string; params: string; duration: number }) => {
    logger.debug('Query executed', {
      query: e.query,
      duration: `${e.duration}ms`,
    });
  });
}

// Graceful shutdown
process.on('beforeExit', async () => {
  await prisma.$disconnect();
});

export default prisma;