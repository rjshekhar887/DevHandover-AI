/**
 * Health check controller
 * Provides endpoints for monitoring service health
 */

import { Request, Response } from 'express';
import { prisma } from '../prisma/client';
import { config } from '../config';

export const healthCheck = async (_req: Request, res: Response): Promise<void> => {
  const timestamp = new Date().toISOString();
  let dbStatus = 'disconnected';

  try {
    // Test database connection
    await prisma.$queryRaw`SELECT 1`;
    dbStatus = 'connected';
  } catch {
    dbStatus = 'error';
  }

  const health = {
    status: dbStatus === 'connected' ? 'healthy' : 'degraded',
    timestamp,
    version: process.env.npm_package_version || '1.0.0',
    environment: config.NODE_ENV,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    database: dbStatus,
  };

  const statusCode = health.status === 'healthy' ? 200 : 503;
  res.status(statusCode).json(health);
};

export const readinessCheck = async (_req: Request, res: Response): Promise<void> => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ status: 'ready', timestamp: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: 'not ready', timestamp: new Date().toISOString() });
  }
};

export const livenessCheck = (_req: Request, res: Response): void => {
  res.status(200).json({ status: 'alive', timestamp: new Date().toISOString() });
};