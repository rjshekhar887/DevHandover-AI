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

## GitHub Integration Endpoints

### Authentication

#### GET /api/v1/github/auth

Initiate GitHub OAuth flow.

**Query Parameters**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `redirectUri` | string | No | Frontend redirect URL after OAuth completion |

**Response (200)**
```json
{
  "success": true,
  "data": {
    "authUrl": "https://github.com/login/oauth/authorize?client_id=...",
    "state": "cryptographically-secure-random-state"
  }
}
```

#### GET /api/v1/github/callback

Handle GitHub OAuth callback. This endpoint is called by GitHub after user authorization.

**Query Parameters**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `code` | string | Yes | Authorization code from GitHub |
| `state` | string | Yes | OAuth state parameter for CSRF protection |
| `error` | string | No | Error code if user denied authorization |
| `error_description` | string | No | Human-readable error description |

**Response**: Redirects to frontend with success or error parameters.

#### GET /api/v1/github/connection

Get current GitHub connection status.

**Response (200 - Connected)**
```json
{
  "success": true,
  "data": {
    "connected": true,
    "githubId": "12345678",
    "login": "octocat",
    "name": "The Octocat",
    "email": "octocat@github.com",
    "avatarUrl": "https://avatars.githubusercontent.com/u/12345678?v=4",
    "scope": "repo read:user user:email",
    "connectedAt": "2026-11-09T12:00:00.000Z"
  }
}
```

**Response (200 - Not Connected)**
```json
{
  "success": true,
  "data": {
    "connected": false
  }
}
```

#### DELETE /api/v1/github/connection

Disconnect GitHub account.

**Response (200)**
```json
{
  "success": true,
  "message": "GitHub account disconnected successfully"
}
```

### Repositories

#### GET /api/v1/github/repositories

List repositories accessible to the authenticated user.

**Query Parameters**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `page` | integer | No | 1 | Page number (min: 1) |
| `perPage` | integer | No | 30 | Items per page (max: 100) |
| `sort` | string | No | `updated` | Sort field: `created`, `updated`, `pushed`, `full_name` |
| `direction` | string | No | `desc` | Sort direction: `asc`, `desc` |
| `type` | string | No | `owner` | Repository type: `all`, `owner`, `public`, `private`, `member` |

**Response (200)**
```json
{
  "success": true,
  "data": [
    {
      "id": "123456789",
      "name": "hello-world",
      "fullName": "octocat/hello-world",
      "url": "https://github.com/octocat/hello-world",
      "cloneUrl": "https://github.com/octocat/hello-world.git",
      "defaultBranch": "main",
      "language": "TypeScript",
      "description": "My first repository",
      "isPrivate": false,
      "isFork": false,
      "size": 1024,
      "stargazersCount": 42,
      "forksCount": 5,
      "openIssuesCount": 3,
      "pushedAt": "2026-11-09T10:00:00.000Z",
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-11-09T10:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "perPage": 30,
    "hasNextPage": true
  }
}
```

#### GET /api/v1/github/repositories/:owner/:repo

Get repository details.

**Path Parameters**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `owner` | string | Yes | Repository owner (user or organization) |
| `repo` | string | Yes | Repository name |

**Response (200)**
```json
{
  "success": true,
  "data": {
    "id": "clx123repo",
    "githubId": "123456789",
    "name": "hello-world",
    "fullName": "octocat/hello-world",
    "url": "https://github.com/octocat/hello-world",
    "cloneUrl": "https://github.com/octocat/hello-world.git",
    "defaultBranch": "main",
    "language": "TypeScript",
    "description": "My first repository",
    "isPrivate": false,
    "isFork": false,
    "size": 1024,
    "stargazersCount": 42,
    "forksCount": 5,
    "openIssuesCount": 3,
    "pushedAt": "2026-11-09T10:00:00.000Z",
    "githubCreatedAt": "2026-01-01T00:00:00.000Z",
    "githubUpdatedAt": "2026-11-09T10:00:00.000Z",
    "createdAt": "2026-11-09T12:00:00.000Z",
    "updatedAt": "2026-11-09T12:00:00.000Z"
  }
}
```

#### GET /api/v1/github/repositories/:owner/:repo/contents/*path

Get file content from repository.

**Path Parameters**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `owner` | string | Yes | Repository owner |
| `repo` | string | Yes | Repository name |
| `path` | string | Yes | File path within repository |

**Query Parameters**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `branch` | string | No | `main` | Branch or tag name |

**Response (200)**
```json
{
  "success": true,
  "data": {
    "path": "src/index.ts",
    "name": "index.ts",
    "size": 512,
    "sha": "abc123...",
    "content": "export const hello = () => 'world';",
    "encoding": "base64"
  }
}
```

### Repository Ingestion

#### POST /api/v1/github/repositories/:owner/:repo/ingest

Start repository ingestion.

**Path Parameters**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `owner` | string | Yes | Repository owner |
| `repo` | string | Yes | Repository name |

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `branch` | string | No | Branch to ingest (default: repository default branch) |
| `projectId` | string | No | Project ID to link the repository to |

**Response (202)**
```json
{
  "success": true,
  "data": {
    "ingestionId": "clx123ingestion",
    "repositoryId": "clx123repo",
    "status": "PROCESSING",
    "message": "Repository ingestion started"
  }
}
```

#### GET /api/v1/github/ingestions/:ingestionId

Get ingestion status.

**Path Parameters**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `ingestionId` | string | Yes | Ingestion ID (CUID) |

**Response (200)**
```json
{
  "success": true,
  "data": {
    "id": "clx123ingestion",
    "repositoryId": "clx123repo",
    "status": "COMPLETED",
    "totalFiles": 150,
    "processedFiles": 150,
    "totalSize": 1048576,
    "processedSize": 1048576,
    "error": null,
    "errorDetails": null,
    "startedAt": "2026-11-09T12:00:00.000Z",
    "completedAt": "2026-11-09T12:05:00.000Z",
    "createdAt": "2026-11-09T12:00:00.000Z",
    "updatedAt": "2026-11-09T12:05:00.000Z"
  }
}
```

**Ingestion Status Values**
- `PENDING` - Ingestion queued
- `PROCESSING` - Currently fetching and processing files
- `COMPLETED` - All files processed successfully
- `FAILED` - Ingestion failed (check `error` and `errorDetails`)

#### GET /api/v1/github/ingestions/:ingestionId/files

Get ingested files with filtering and pagination.

**Path Parameters**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `ingestionId` | string | Yes | Ingestion ID (CUID) |

**Query Parameters**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `page` | integer | No | 1 | Page number |
| `limit` | integer | No | 50 | Items per page (max: 100) |
| `language` | string | No | - | Filter by programming language |
| `isTest` | boolean | No | - | Filter test files |
| `isConfig` | boolean | No | - | Filter config files |
| `isDocumentation` | boolean | No | - | Filter documentation files |

**Response (200)**
```json
{
  "success": true,
  "data": [
    {
      "id": "clx123file",
      "path": "src/index.ts",
      "name": "index.ts",
      "extension": "ts",
      "size": 512,
      "language": "TypeScript",
      "content": "export const hello = () => 'world';",
      "contentHash": "abc123...",
      "isBinary": false,
      "isGenerated": false,
      "isTest": false,
      "isConfig": false,
      "isDocumentation": false,
      "createdAt": "2026-11-09T12:00:00.000Z",
      "updatedAt": "2026-11-09T12:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 150,
    "totalPages": 3
  }
}
```

## Changelog

### v1.1.0 (2026-11-09)
- GitHub OAuth authentication
- Repository discovery and listing
- Repository ingestion with file filtering
- Ingestion status tracking
- File content retrieval

### v1.0.0 (2026-11-09)
- Initial API release
- Health check endpoints
- Project CRUD operations
- Input validation with Zod
- Standardized error responses

---

*Last updated: 2026-11-09*