/**
 * Global error handling middleware
 * Converts all errors to consistent JSON responses
 */

import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { logger, logError } from '../utils/logger';
import {
  AppError,
  ValidationError,
  NotFoundError,
  InternalServerError,
  ConflictError,
  BadRequestError,
  isAppError,
  isPrismaError,
} from '../utils/errors';

export interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
    timestamp: string;
    path: string;
    method: string;
  };
}

/**
 * Format Zod validation errors into readable format
 */
const formatZodError = (error: ZodError): Record<string, string[]> => {
  const formatted: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.');
    if (!formatted[path]) {
      formatted[path] = [];
    }
    formatted[path].push(issue.message);
  }
  return formatted;
};

/**
 * Handle Prisma-specific errors
 */
const handlePrismaError = (error: Prisma.PrismaClientKnownRequestError): AppError => {
  switch (error.code) {
    case 'P2002': {
      const target = error.meta?.target as string[] | undefined;
      const field = target?.[0] || 'field';
      return new ConflictError(`A record with this ${field} already exists`, { field, target });
    }
    case 'P2025': {
      const cause = error.meta?.cause as string | undefined;
      return new NotFoundError('Record', cause || 'unknown');
    }
    case 'P2003': {
      const field = (error.meta?.field_name as string) || 'foreign key';
      return new BadRequestError(`Invalid ${field} reference`, { field });
    }
    default:
      return new InternalServerError('Database operation failed', { code: error.code });
  }
};

/**
 * Global error handler middleware
 */
export const errorHandler = (
  error: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  const timestamp = new Date().toISOString();
  const path = req.originalUrl;
  const method = req.method;

  // Default error response
  let statusCode = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'An unexpected error occurred';
  let details: unknown = undefined;

  // Handle known application errors
  if (isAppError(error)) {
    statusCode = error.statusCode;
    code = error.code;
    message = error.message;
    details = error.details;

    // Log operational errors as warnings, programming errors as errors
    if (error.isOperational) {
      logger.warn(`${method} ${path} - ${code}: ${message}`, { details, path, method });
    } else {
      logError(`${method} ${path} - ${code}: ${message}`, error, { details, path, method });
    }
  }
  // Handle Zod validation errors
  else if (error instanceof ZodError) {
    statusCode = 400;
    code = 'VALIDATION_ERROR';
    message = 'Request validation failed';
    details = formatZodError(error);
    logger.warn(`${method} ${path} - Validation failed`, { details, path, method });
  }
  // Handle Prisma errors
  else if (isPrismaError(error) && 'code' in error && error.code.startsWith('P')) {
    const prismaError = handlePrismaError(error as Prisma.PrismaClientKnownRequestError);
    statusCode = prismaError.statusCode;
    code = prismaError.code;
    message = prismaError.message;
    details = prismaError.details;
    logError(`${method} ${path} - Prisma error: ${message}`, error, { details, path, method });
  }
  // Handle unknown errors
  else {
    const internalError = new InternalServerError();
    statusCode = internalError.statusCode;
    code = internalError.code;
    message = isProduction ? internalError.message : error.message;
    details = isProduction ? undefined : { originalMessage: error.message, stack: error.stack };
    logError(`${method} ${path} - Unhandled error`, error, { path, method });
  }

  const response: ErrorResponse = {
    success: false,
    error: {
      code,
      message,
      details,
      timestamp,
      path,
      method,
    },
  };

  res.status(statusCode).json(response);
};

/**
 * 404 handler for unmatched routes
 */
export const notFoundHandler = (req: Request, res: Response): void => {
  const response: ErrorResponse = {
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.originalUrl} not found`,
      timestamp: new Date().toISOString(),
      path: req.originalUrl,
      method: req.method,
    },
  };

  res.status(404).json(response);
};

/**
 * Async wrapper to catch errors in async route handlers
 */
export const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// Helper to check if we're in production (imported from config)
const isProduction = process.env.NODE_ENV === 'production';