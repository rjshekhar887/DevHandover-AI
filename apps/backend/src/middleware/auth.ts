import { NextFunction, Request, Response } from 'express';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { config } from '../config';
import { UnauthorizedError } from '../utils/errors';

export interface AuthenticatedUser {
  id: string;
  email: string;
  name?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

const getJwtSecret = (): string => {
  if (!config.JWT_SECRET) {
    throw new UnauthorizedError('Authentication is not configured');
  }
  return config.JWT_SECRET;
};

export const requireAuth = (req: Request, _res: Response, next: NextFunction): void => {
  const authorization = req.header('authorization');
  if (!authorization?.startsWith('Bearer ')) {
    next(new UnauthorizedError('A bearer token is required'));
    return;
  }

  try {
    const payload = jwt.verify(authorization.slice(7), getJwtSecret()) as JwtPayload;
    if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') {
      throw new UnauthorizedError('Invalid authentication token');
    }

    req.user = {
      id: payload.sub,
      email: payload.email,
      name: typeof payload.name === 'string' ? payload.name : undefined,
    };
    next();
  } catch (error) {
    next(error instanceof UnauthorizedError ? error : new UnauthorizedError('Invalid or expired authentication token'));
  }
};
