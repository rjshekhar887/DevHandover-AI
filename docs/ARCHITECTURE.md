# DevHandover AI - Architecture Documentation

## Overview

DevHandover AI follows a modular, layered architecture designed for maintainability, scalability, and testability. The system is built as a monorepo with clear separation between backend, frontend, and shared packages.

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        DevHandover AI                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │   Frontend   │    │   Backend    │    │   Database   │      │
│  │  (React)     │◄───│  (Express)   │◄───│  (SQLite/    │      │
│  │              │    │              │    │   PostgreSQL)│      │
│  └──────────────┘    └──────┬───────┘    └──────────────┘      │
│                             │                                    │
│                    ┌────────┴────────┐                           │
│                    │   External      │                           │
│                    │   Services      │                           │
│                    │  ┌───────────┐  │                           │
│                    │  │  GitHub   │  │                           │
│                    │  │  API      │  │                           │
│                    │  └───────────┘  │                           │
│                    │  ┌───────────┐  │                           │
│                    │  │  LLM      │  │                           │
│                    │  │  Provider │  │                           │
│                    │  └───────────┘  │                           │
│                    └─────────────────┘                           │
└─────────────────────────────────────────────────────────────────┘
```

## Backend Architecture

### Layered Structure

```
src/
├── config/          # Centralized configuration (Zod-validated)
├── controllers/     # Request handlers (thin, delegate to services)
├── services/        # Business logic (reusable, testable)
│   ├── githubService.ts      # GitHub OAuth & API interactions
│   └── ingestionService.ts   # Repository ingestion & file processing
├── routes/          # Route definitions with middleware
├── middleware/      # Cross-cutting concerns (auth, validation, errors)
├── validators/      # Zod schemas for request validation
├── prisma/          # Database client and utilities
├── utils/           # Shared utilities (logger, errors, helpers)
└── index.ts         # Application entry point
```

### GitHub Integration Architecture

The GitHub integration follows a service-oriented design:

1. **githubService.ts** - Handles all GitHub API interactions:
   - OAuth state generation and validation (CSRF protection)
   - Authorization code exchange for access tokens
   - User profile and email fetching
   - Repository listing with pagination
   - Repository tree and file content fetching
   - Secure token storage (encrypted)

2. **ingestionService.ts** - Handles repository ingestion:
   - Repository tree traversal with recursive fetching
   - Intelligent file filtering (excludes node_modules, dist, build, .git, lock files, binary files)
   - File categorization (test, config, documentation, generated)
   - Language detection from file extensions
   - Binary content detection
   - Configurable limits (file count, file size, total size)
   - Progress tracking with status updates
   - Framework/dependency detection from config files

3. **Security Considerations**:
   - OAuth state parameter with 10-minute expiry
   - Access tokens encrypted before database storage (base64 encoding - production should use AES-256-GCM)
   - Tokens never exposed to frontend
   - Rate limit handling with retry logic
   - Input validation on all GitHub API parameters

### Design Principles

1. **Separation of Concerns** - Controllers handle HTTP, services handle business logic
2. **Dependency Injection** - Services are instantiated and passed where needed
3. **Single Responsibility** - Each module has one clear purpose
4. **Type Safety** - Strict TypeScript with Zod runtime validation
5. **Error Handling** - Centralized, consistent error responses
6. **Observability** - Structured logging, health checks, request tracing

### Request Flow

```
HTTP Request
     │
     ▼
┌─────────────┐
│  Middleware │  ──► CORS, Helmet, Body Parsing, Logging
└─────────────┘
     │
     ▼
┌─────────────┐
│   Routes    │  ──► Path matching, middleware chain
└─────────────┘
     │
     ▼
┌─────────────┐
│  Validation │  ──► Zod schema validation (body/query/params)
└─────────────┘
     │
     ▼
┌─────────────┐
│ Controller  │  ──► Extract input, call service, format response
└─────────────┘
     │
     ▼
┌─────────────┐
│  Service    │  ──► Business logic, data access, external APIs
└─────────────┘
     │
     ▼
┌─────────────┐
│  Database   │  ──► Prisma ORM (type-safe queries)
└─────────────┘
     │
     ▼
┌─────────────┐
│  Response   │  ──► JSON response via controller
└─────────────┘
```

## Database Design

### Entity Relationship Diagram

```
User ◄──────► WorkspaceMember ◄──────► Workspace
  │                                          │
  │                                          ▼
  │                                    Project ◄──────► Repository ◄──────► RepositoryFile
  │                                          │                    │
  │              ┌───────────────────────────┼────────────────────┼───────────────────────┐
  │              ▼                           ▼                    ▼                       ▼
  │        ProjectAnalysis              KnowledgeGap            ProjectRisk         RepositoryIngestion
  │              │                           │                    │
  │              ▼                           ▼                    ▼
  │        Interview ◄──────► InterviewQuestion                         │
  │              │                                                    │
  │              ▼                                                    │
  │        HandoverDocument ◄──────► Evidence                         │
  │                                                                  │
  └──────────────────────────────────────────────────────────────────┘
```

### GitHub Integration Models

| Model | Purpose | Key Fields |
|-------|---------|------------|
| `GitHubConnection` | GitHub OAuth connection | userId, githubId, login, accessToken (encrypted), scope, connectedAt |
| `Repository` | GitHub repository metadata | githubId, fullName, url, cloneUrl, defaultBranch, language, isPrivate, githubConnectionId |
| `RepositoryFile` | Ingested file metadata | repositoryId, path, name, extension, size, language, content, contentHash, isBinary, isTest, isConfig, isDocumentation |
| `RepositoryIngestion` | Ingestion job tracking | repositoryId, status (PENDING/PROCESSING/COMPLETED/FAILED), totalFiles, processedFiles, totalSize, processedSize, error, startedAt, completedAt |

### Key Models

### Key Models

| Model | Purpose | Key Fields |
|-------|---------|------------|
| `User` | Platform users | email, githubId, githubLogin, accessToken (legacy) |
| `GitHubConnection` | GitHub OAuth connection | userId, githubId, login, accessToken (encrypted), scope, connectedAt |
| `Workspace` | Team/organization | name, description |
| `Project` | Software project | name, status, repositoryUrl, ownerId |
| `Repository` | GitHub repository | githubId, fullName, url, cloneUrl, defaultBranch, language, isPrivate, projectId, githubConnectionId |
| `RepositoryFile` | Ingested file metadata | repositoryId, path, name, extension, size, language, content, contentHash, isBinary, isTest, isConfig, isDocumentation |
| `RepositoryIngestion` | Ingestion job tracking | repositoryId, status, totalFiles, processedFiles, totalSize, processedSize, error, startedAt, completedAt |
| `ProjectAnalysis` | AI analysis results | architecture, modules, dependencies, status |
| `KnowledgeGap` | Identified gaps | title, category, severity, status |
| `ProjectRisk` | Project risks | title, category, likelihood, impact, mitigation |
| `Interview` | Handover interview | status, type, transcript, intervieweeId |
| `InterviewQuestion` | Q&A pairs | question, answer, category, order |
| `HandoverDocument` | Generated docs | title, content (JSON), markdown, status |
| `Evidence` | Source references | type, source, reference, confidence |

## Configuration Management

All configuration is centralized in `src/config/index.ts` using Zod schemas:

- **Validation** - Environment variables validated at startup
- **Type Safety** - Full TypeScript inference from schemas
- **Defaults** - Sensible defaults for development
- **Environment-specific** - Different behavior per NODE_ENV

### Configuration Categories

1. **Server** - Port, API prefix, environment
2. **Database** - Connection string
3. **CORS** - Allowed origins, credentials
4. **GitHub** - OAuth credentials
5. **LLM** - Provider, API key, base URL, model
6. **Auth** - JWT secret, expiration
7. **Logging** - Log level

## Error Handling Strategy

### Error Hierarchy

```
AppError (base)
├── ValidationError (400)
├── BadRequestError (400)
├── UnauthorizedError (401)
├── ForbiddenError (403)
├── NotFoundError (404)
├── ConflictError (409)
├── InternalServerError (500)
└── ServiceUnavailableError (503)
```

### Error Response Format

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": {
      "fieldName": ["Error message 1", "Error message 2"]
    },
    "timestamp": "2026-11-09T12:00:00.000Z",
    "path": "/api/v1/projects",
    "method": "POST"
  }
}
```

### Handling Rules

- **Operational errors** (known, expected) - Logged as warn, returned to client
- **Programming errors** (bugs) - Logged as error, generic message in production
- **Validation errors** - Detailed field-level messages
- **Database errors** - Mapped to appropriate HTTP codes (P2002→409, P2025→404)

## Logging Strategy

### Log Levels

| Level | Use Case |
|-------|----------|
| `error` | Unhandled exceptions, failed operations |
| `warn` | Operational errors, validation failures |
| `info` | Key lifecycle events (startup, requests) |
| `http` | HTTP request/response summary |
| `debug` | Detailed debugging (queries, external API calls) |

### Structured Logging

All logs are JSON-structured with consistent fields:
- `timestamp` - ISO 8601
- `level` - Log level
- `message` - Human-readable message
- `meta` - Contextual data (request ID, user ID, duration, etc.)

## Security Considerations

### Current Implementation

- **Helmet** - Security headers (CSP, HSTS, etc.)
- **CORS** - Configurable origin allowlist
- **Input Validation** - Zod schemas on all inputs
- **SQL Injection Prevention** - Prisma parameterized queries
- **Environment Secrets** - No hardcoded secrets, .env files gitignored

### Planned Enhancements

- Rate limiting (express-rate-limit)
- JWT authentication middleware
- API key management for LLM providers
- Audit logging for sensitive operations
- Encryption at rest for GitHub tokens

## Scalability Considerations

### Current (MVP)

- Single-process Express server
- SQLite database
- In-memory job processing (planned)

### Future (Production)

- Horizontal scaling with load balancer
- PostgreSQL with connection pooling (PgBouncer)
- Redis for caching and session storage
- BullMQ for background job processing
- Kubernetes deployment with HPA
- CDN for static assets

## Development Workflow

### Code Organization

```
Feature Development:
1. Create Zod validation schema (validators/)
2. Implement service logic (services/)
3. Create controller (controllers/)
4. Define routes with validation (routes/)
5. Add types to shared package if needed
6. Write tests
7. Update documentation
```

### Git Workflow

- Main branch: `main`
- Feature branches: `feature/description`
- Commit messages: Conventional Commits
- PR reviews required for main

## Testing Strategy

### Layers

1. **Unit Tests** - Services, utilities, validators
2. **Integration Tests** - Controllers with test database
3. **E2E Tests** - Full API flows (planned)

### Tools

- **Vitest** - Unit and integration testing
- **Supertest** - HTTP integration testing
- **Prisma Test Utilities** - Database testing helpers

---

*Last updated: 2026-11-09*