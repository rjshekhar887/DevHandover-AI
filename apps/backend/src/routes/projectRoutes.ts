/**
 * Project Routes
 * Defines all project-related API endpoints
 */

import { Router } from 'express';
import {
  listProjects,
  createProject,
  getProject,
  updateProject,
  deleteProject,
} from '../controllers/projectController';
import { validate } from '../middleware/validation';
import {
  createProjectSchema,
  updateProjectSchema,
  projectIdParamSchema,
  listProjectsQuerySchema,
} from '../validators/projectValidator';

const router = Router();

/**
 * @route GET /api/v1/projects
 * @description List all projects with pagination and filtering
 * @access Private (will be protected by auth middleware)
 */
router.get(
  '/',
  validate(listProjectsQuerySchema),
  listProjects
);

/**
 * @route POST /api/v1/projects
 * @description Create a new project
 * @access Private
 */
router.post(
  '/',
  validate(createProjectSchema),
  createProject
);

/**
 * @route GET /api/v1/projects/:id
 * @description Get a single project by ID
 * @access Private
 */
router.get(
  '/:id',
  validate(projectIdParamSchema),
  getProject
);

/**
 * @route PATCH /api/v1/projects/:id
 * @description Update a project
 * @access Private
 */
router.patch(
  '/:id',
  validate(updateProjectSchema),
  updateProject
);

/**
 * @route DELETE /api/v1/projects/:id
 * @description Delete a project
 * @access Private
 */
router.delete(
  '/:id',
  validate(projectIdParamSchema),
  deleteProject
);

export default router;