/**
 * Express Application Setup
 * Configures middleware, routes, and error handling
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { config, isDevelopment } from './config';
import { logger, logHttp } from './utils/logger';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import healthRoutes from './routes/healthRoutes';
import projectRoutes from './routes/projectRoutes';

const app = express();

// Trust proxy for correct IP detection behind reverse proxies
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: isDevelopment ? false : undefined,
}));

// CORS configuration
app.use(cors({
  origin: config.CORS_ORIGIN,
  credentials: config.CORS_CREDENTIALS,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// HTTP request logging
app.use(morgan(
  isDevelopment ? 'dev' : 'combined',
  {
    stream: { write: (message) => logHttp(message.trim()) },
    skip: (req) => req.path === '/live' || req.path === '/ready',
  }
));

// API version prefix
const apiPrefix = config.API_PREFIX;

// Health routes (no version prefix for monitoring)
app.use('/', healthRoutes);

// API routes
app.use(`${apiPrefix}/projects`, projectRoutes);

// Root endpoint
app.get('/', (_req, res) => {
  res.json({
    name: 'DevHandover AI API',
    version: process.env.npm_package_version || '1.0.0',
    description: 'AI-powered developer knowledge continuity and project handover platform',
    docs: `${apiPrefix}/docs`,
    health: '/health',
  });
});

// 404 handler for unmatched routes
app.use(notFoundHandler);

// Global error handler (must be last)
app.use(errorHandler);

export default app;