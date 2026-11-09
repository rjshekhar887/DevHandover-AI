/**
 * Application Entry Point
 * Starts the HTTP server
 */

import 'dotenv/config';
import app from './app';
import { config } from './config';
import { logger, logError } from './utils/logger';
import { prisma } from './prisma/client';

const PORT = config.PORT;

const server = app.listen(PORT, () => {
  logger.info(`🚀 Server started`, {
    port: PORT,
    environment: config.NODE_ENV,
    apiPrefix: config.API_PREFIX,
  });
});

// Graceful shutdown
const shutdown = async (signal: string) => {
  logger.info(`${signal} received, starting graceful shutdown...`);

  server.close(async () => {
    logger.info('HTTP server closed');

    try {
      await prisma.$disconnect();
      logger.info('Database connections closed');
      process.exit(0);
    } catch (error) {
      logError('Error during shutdown', error);
      process.exit(1);
    }
  });

  // Force shutdown after 30 seconds
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 30_000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason) => {
  logError('Unhandled Rejection', reason);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logError('Uncaught Exception', error);
  process.exit(1);
});

export { server };