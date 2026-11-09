/**
 * Request validation middleware using Zod schemas
 */

import { Request, Response, NextFunction } from 'express';
import { AnyZodObject, ZodError } from 'zod';
import { ValidationError } from '../utils/errors';

/**
 * Validate request against a Zod schema
 * Supports validating body, query, params, or all
 */
export const validate = (schema: AnyZodObject) =>
  async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params,
      });
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        next(new ValidationError('Validation failed', error.issues));
      } else {
        next(error);
      }
    }
  };

/**
 * Validate only request body
 */
export const validateBody = (schema: AnyZodObject) =>
  async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      req.body = await schema.parseAsync(req.body);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        next(new ValidationError('Invalid request body', error.issues));
      } else {
        next(error);
      }
    }
  };

/**
 * Validate only query parameters
 */
export const validateQuery = (schema: AnyZodObject) =>
  async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      req.query = await schema.parseAsync(req.query);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        next(new ValidationError('Invalid query parameters', error.issues));
      } else {
        next(error);
      }
    }
  };

/**
 * Validate only route parameters
 */
export const validateParams = (schema: AnyZodObject) =>
  async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      req.params = await schema.parseAsync(req.params);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        next(new ValidationError('Invalid route parameters', error.issues));
      } else {
        next(error);
      }
    }
  };