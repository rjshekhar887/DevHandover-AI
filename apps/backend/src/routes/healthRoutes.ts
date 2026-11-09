/**
 * Health Check Routes
 * Provides health, readiness, and liveness endpoints
 */

import { Router } from 'express';
import { healthCheck, readinessCheck, livenessCheck } from '../controllers/healthController';

const router = Router();

/**
 * @route GET /health
 * @description Comprehensive health check including database connectivity
 * @access Public
 */
router.get('/health', healthCheck);

/**
 * @route GET /ready
 * @description Kubernetes readiness probe - checks if service can handle requests
 * @access Public
 */
router.get('/ready', readinessCheck);

/**
 * @route GET /live
 * @description Kubernetes liveness probe - checks if service is alive
 * @access Public
 */
router.get('/live', livenessCheck);

export default router;