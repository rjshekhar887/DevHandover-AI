/**
 * Winston logger configuration
 * Provides structured logging with different levels and formats
 */

import winston from 'winston';
import { config, isDevelopment } from '../config';

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : '';
    return `${timestamp} [${level.toUpperCase()}]: ${message} ${metaStr}`;
  })
);

const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
    return `${timestamp} ${level}: ${message} ${metaStr}`;
  })
);

const transports: winston.transport[] = [
  new winston.transports.Console({
    format: isDevelopment ? consoleFormat : logFormat,
    level: config.LOG_LEVEL,
  }),
];

// Add file transport in production
if (!isDevelopment) {
  transports.push(
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      format: logFormat,
      maxsize: 5_242_880, // 5MB
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: 'logs/combined.log',
      format: logFormat,
      maxsize: 5_242_880,
      maxFiles: 5,
    })
  );
}

export const logger = winston.createLogger({
  level: config.LOG_LEVEL,
  format: logFormat,
  transports,
  exitOnError: false,
});

// Helper functions for common log patterns
export const logError = (message: string, error: Error | unknown, meta?: Record<string, unknown>) => {
  const errorMeta = error instanceof Error
    ? { error: error.message, stack: error.stack, ...meta }
    : { error: String(error), ...meta };
  logger.error(message, errorMeta);
};

export const logInfo = (message: string, meta?: Record<string, unknown>) => {
  logger.info(message, meta);
};

export const logWarn = (message: string, meta?: Record<string, unknown>) => {
  logger.warn(message, meta);
};

export const logDebug = (message: string, meta?: Record<string, unknown>) => {
  logger.debug(message, meta);
};

export const logHttp = (message: string, meta?: Record<string, unknown>) => {
  logger.http(message, meta);
};