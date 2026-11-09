# DevHandover AI - API Documentation

## Base URL

```
Development: http://localhost:3000
Production:  https://api.devhandover.ai
```

All API endpoints are prefixed with `/api/v1` unless otherwise noted.

## Authentication

Currently in development. Future versions will use JWT Bearer tokens.

```
Authorization: Bearer <token>
```

## Response Format

### Success Response

```json
{
  "success": true,
  "data": { ... },
  "pagination": { ... }  // For list endpoints
}
```

### Error Response

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message",
    "details": { ... },  // Optional validation details
    "timestamp": "2026-11-09T12:00:00.000Z",
    "path": "/api/v1/projects",
    "method": "POST"
  }
}
```

## HTTP Status Codes

| Code | Description |
|------|-------------|
| 200 | OK - Successful GET, PATCH |
| 201 | Created - Successful POST |
| 204 | No Content - Successful DELETE |
| 400 | Bad Request - Validation error |
| 401 | Unauthorized - Missing/invalid auth |
| 403 | Forbidden - Insufficient permissions |
| 404 | Not Found - Resource doesn't exist |
| 409 | Conflict - Duplicate resource |
| 500 | Internal Server Error |
| 503 | Service Unavailable |

## Health Endpoints

These endpoints are not versioned and available at root path.

### GET /health

Comprehensive health check including database connectivity.

**Response (200 - Healthy)**
```json
{
  "status": "healthy",
  "timestamp": "2026-11-09T12:00:00.000Z",
  "version": "1.0.0",
  "environment": "development",
  "uptime": 123.45,
  "memory": {
    "rss": 45678900,
    "heapTotal": 12345600,
    "heapUsed": 9876500,
    "external": 1234500,
    "arrayBuffers": 12300
  },
  "database": "connected"
}
```

**Response (503 - Degraded)**
```json
{
  "status": "degraded",
  "timestamp": "2026-11-09T12:00:00.000Z",
  "version": "1.0.0",
  "environment": "development",
  "uptime": 123.45,
  "memory": { ... },
  "database": "error"
}
```

### GET /ready

Kubernetes readiness probe.

**Response (200)**
```json
{
  "status": "ready",
  "timestamp": "2026-11-09T12:00:00.000Z"
}
```

**Response (503)**
```json
{
  "status": "not ready",
  "timestamp": "2026-11-09T12:00:00.000Z"
}
```

### GET /live

Kubernetes liveness probe.

**Response (200)**
```json
{
  "status": "alive",
  "timestamp": "2026-11-09T12:00:00.000Z"
}
```

## Project Endpoints

### GET /api/v1/projects

List all projects with pagination and filtering.

**Query Parameters**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `page` | integer | No | 1 | Page number (min: 1) |
| `limit` | integer | No | 20 | Items per page (max: 100) |
| `workspaceId` | string | No | - | Filter by workspace |
| `status` | string | No | - | Filter by status (ACTIVE, ARCHIVED, ON_HOLD, COMPLETED) |

**Response (200)**
```json
{
  "success": true,
  "data": [
    {
      "id": "clx123abc",
      "name": "My Project",
      "description": "Project description",
      "status": "ACTIVE",
      "repositoryUrl": "https://github.com/user/repo",
      "defaultBranch": "main",
      "language": "TypeScript",
      "framework": "React",
      "ownerId": "clx123user",
      "workspaceId": "clx123ws",
      "createdAt": "2026-11-09T12:00:00.000Z",
      "updatedAt": "2026-11-09T12:00:00.000Z",
      "owner": {
        "id": "clx123user",
        "name": "John Doe",
        "email": "john@example.com",
        "avatarUrl": "https://github.com/user.png"
      },
      "workspace": {
        "id": "clx123ws",
        "name": "My Workspace"
      },
      "_count": {
        "repositories": 1,
        "analyses": 0,
        "knowledgeGaps": 0,
        "risks": 0
      }
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 1,
    "totalPages": 1
  }
}
```

### POST /api/v1/projects

Create a new project.

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Project name (1-255 chars) |
| `description` | string | No | Project description |
| `repositoryUrl` | string | No | GitHub repository URL |
| `workspaceId` | string | No | Workspace ID (CUID) |
| `ownerId` | string | No | Owner user ID (CUID) |

**Request Example**
```json
{
  "name": "New Project",
  "description": "A new project for handover",
  "repositoryUrl": "https://github.com/user/repo",
  "workspaceId": "clx123ws"
}
```

**Response (201)**
```json
{
  "success": true,
  "data": {
    "id": "clx123new",
    "name": "New Project",
    "description": "A new project for handover",
    "status": "ACTIVE",
    "repositoryUrl": "https://github.com/user/repo",
    "defaultBranch": "main",
    "ownerId": "clx123user",
    "workspaceId": "clx123ws",
    "createdAt": "2026-11-09T12:00:00.000Z",
    "updatedAt": "2026-11-09T12:00:00.000Z",
    "owner": {
      "id": "clx123user",
      "name": "John Doe",
      "email": "john@example.com",
      "avatarUrl": "https://github.com/user.png"
    },
    "workspace": {
      "id": "clx123ws",
      "name": "My Workspace"
    }
  }
}
```

**Validation Errors (400)**
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": {
      "name": ["Name is required"],
      "repositoryUrl": ["Invalid repository URL"]
    },
    "timestamp": "2026-11-09T12:00:00.000Z",
    "path": "/api/v1/projects",
    "method": "POST"
  }
}
```

### GET /api/v1/projects/:id

Get a single project by ID with all relations.

**Path Parameters**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | Yes | Project ID (CUID) |

**Response (200)**
```json
{
  "success": true,
  "data": {
    "id": "clx123abc",
    "name": "My Project",
    "description": "Project description",
    "status": "ACTIVE",
    "repositoryUrl": "https://github.com/user/repo",
    "defaultBranch": "main",
    "language": "TypeScript",
    "framework": "React",
    "ownerId": "clx123user",
    "workspaceId": "clx123ws",
    "createdAt": "2026-11-09T12:00:00.000Z",
    "updatedAt": "2026-11-09T12:00:00.000Z",
    "owner": { ... },
    "workspace": { ... },
    "repositories": [
      {
        "id": "clx123repo",
        "name": "repo",
        "fullName": "user/repo",
        "url": "https://github.com/user/repo",
        "cloneUrl": "https://github.com/user/repo.git",
        "defaultBranch": "main",
        "language": "TypeScript",
        "description": "Repo description",
        "isPrivate": false,
        "projectId": "clx123abc",
        "createdAt": "2026-11-09T12:00:00.000Z",
        "updatedAt": "2026-11-09T12:00:00.000Z"
      }
    ],
    "analyses": [],
    "knowledgeGaps": [],
    "risks": [],
    "interviews": [],
    "documents": []
  }
}
```

**Not Found (404)**
```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Project with id clx123notfound not found",
    "details": {
      "resource": "Project",
      "id": "clx123notfound"
    },
    "timestamp": "2026-11-09T12:00:00.000Z",
    "path": "/api/v1/projects/clx123notfound",
    "method": "GET"
  }
}
```

### PATCH /api/v1/projects/:id

Update a project.

**Path Parameters**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | Yes | Project ID (CUID) |

**Request Body** (all optional)

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Project name (1-255 chars) |
| `description` | string | Project description |
| `status` | string | ACTIVE, ARCHIVED, ON_HOLD, COMPLETED |
| `repositoryUrl` | string | GitHub repository URL |
| `workspaceId` | string | Workspace ID (CUID) or null to remove |

**Request Example**
```json
{
  "status": "ARCHIVED",
  "description": "Updated description"
}
```

**Response (200)**
```json
{
  "success": true,
  "data": {
    "id": "clx123abc",
    "name": "My Project",
    "description": "Updated description",
    "status": "ARCHIVED",
    "repositoryUrl": "https://github.com/user/repo",
    "defaultBranch": "main",
    "ownerId": "clx123user",
    "workspaceId": "clx123ws",
    "createdAt": "2026-11-09T12:00:00.000Z",
    "updatedAt": "2026-11-09T12:05:00.000Z",
    "owner": { ... },
    "workspace": { ... }
  }
}
```

### DELETE /api/v1/projects/:id

Delete a project and all related data.

**Path Parameters**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | Yes | Project ID (CUID) |

**Response (204)**
No content.

**Not Found (404)**
```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Project with id clx123notfound not found",
    ...
  }
}
```

## Error Codes Reference

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `VALIDATION_ERROR` | 400 | Request validation failed |
| `BAD_REQUEST` | 400 | Invalid request |
| `UNAUTHORIZED` | 401 | Authentication required |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `NOT_FOUND` | 404 | Resource not found |
| `CONFLICT` | 409 | Resource already exists |
| `INTERNAL_ERROR` | 500 | Unexpected server error |
| `SERVICE_UNAVAILABLE` | 503 | Service temporarily unavailable |

## Rate Limiting

Not yet implemented. Planned for production.

## Versioning

API version is in the URL path: `/api/v1/`

Breaking changes will result in a new version (`/api/v2/`).

## Changelog

### v1.0.0 (2026-11-09)
- Initial API release
- Health check endpoints
- Project CRUD operations
- Input validation with Zod
- Standardized error responses

---

*Last updated: 2026-11-09*