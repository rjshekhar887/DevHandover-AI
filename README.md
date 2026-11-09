# DevHandover AI

> AI-powered developer knowledge continuity and project handover platform

DevHandover AI solves the problem of critical project knowledge disappearing when developers leave projects, change roles, or hand over responsibilities.

## 🚀 Features

- **Repository Ingestion** - Connect to and ingest GitHub repositories
- **Architecture Reconstruction** - Reconstruct project architecture, modules, dependencies, contributors and technical decisions
- **Knowledge Gap Detection** - Identify undocumented areas and project risks
- **AI-Powered Interviews** - Conduct knowledge handover interviews with AI
- **Evidence Verification** - Verify generated insights against repository evidence
- **Handover Documentation** - Generate comprehensive handover documentation
- **Successor Readiness** - Evaluate successor readiness and support manager approval

## 🏗️ Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React, TypeScript, Vite, Tailwind CSS |
| Backend | Node.js, Express.js, TypeScript |
| Database | SQLite (dev), PostgreSQL (prod), Prisma ORM |
| AI | Configurable LLM provider (OpenAI, NVIDIA NIM, custom) |
| Integrations | GitHub REST API |

## 📁 Project Structure

```
devhandover-ai/
├── apps/
│   ├── backend/          # Express.js API server
│   └── frontend/         # React frontend (scaffold)
├── packages/
│   └── shared/           # Shared TypeScript types & utilities
├── docs/                 # Documentation
├── .env.example          # Environment variables template
├── package.json          # Root workspace config
└── tsconfig.json         # Root TypeScript config
```

## 🛠️ Getting Started

### Prerequisites

- Node.js 20+
- npm 10+
- GitHub account (for repository access)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/rjshekhar887/DevHandover-AI.git
   cd DevHandover-AI
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. **Set up the database**
   ```bash
   npm run db:generate  # Generate Prisma client
   npm run db:migrate   # Run migrations
   ```

5. **Start development servers**
   ```bash
   # Terminal 1 - Backend
   npm run dev:backend

   # Terminal 2 - Frontend (when implemented)
   # npm run dev --workspace=apps/frontend
   ```

### Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev:backend` | Start backend dev server with hot reload |
| `npm run build:backend` | Build backend for production |
| `npm run start:backend` | Start production backend |
| `npm run db:generate` | Generate Prisma client |
| `npm run db:migrate` | Run database migrations |
| `npm run db:push` | Push schema changes to database |
| `npm run db:studio` | Open Prisma Studio |

## 🔐 GitHub OAuth Setup

### Create a GitHub OAuth App

1. Go to **GitHub Settings** → **Developer settings** → **OAuth Apps** → **New OAuth App**
2. Fill in the application details:
   - **Application name**: DevHandover AI (or your preferred name)
   - **Homepage URL**: `http://localhost:3000` (or your production URL)
   - **Authorization callback URL**: `http://localhost:3000/api/v1/github/callback`
3. Click **Register application**
4. Copy the **Client ID** and generate a **Client Secret**

### Configure Environment Variables

Add the following to your `.env` file:

```env
GITHUB_CLIENT_ID=your_client_id_here
GITHUB_CLIENT_SECRET=your_client_secret_here
GITHUB_CALLBACK_URL=http://localhost:3000/api/v1/github/callback
```

### OAuth Flow

1. Frontend calls `GET /api/v1/github/auth` to get the GitHub authorization URL
2. User is redirected to GitHub to authorize the application
3. GitHub redirects back to `/api/v1/github/callback` with an authorization code
4. Backend exchanges the code for an access token
5. User's GitHub profile is fetched and stored
6. Frontend receives a redirect with success status

## 🔌 API Endpoints

### Health Checks
- `GET /health` - Comprehensive health check
- `GET /ready` - Kubernetes readiness probe
- `GET /live` - Kubernetes liveness probe

### GitHub Integration

#### Authentication
- `GET /api/v1/github/auth` - Initiate GitHub OAuth flow (returns auth URL)
- `GET /api/v1/github/callback` - Handle GitHub OAuth callback
- `GET /api/v1/github/connection` - Get current GitHub connection status
- `DELETE /api/v1/github/connection` - Disconnect GitHub account

#### Repositories
- `GET /api/v1/github/repositories` - List authenticated user's repositories
  - Query params: `page`, `perPage`, `sort`, `direction`, `type`
- `GET /api/v1/github/repositories/:owner/:repo` - Get repository details
- `GET /api/v1/github/repositories/:owner/:repo/contents/*path` - Get file content

#### Ingestion
- `POST /api/v1/github/repositories/:owner/:repo/ingest` - Start repository ingestion
  - Body: `{ branch?: string, projectId?: string }`
- `GET /api/v1/github/ingestions/:ingestionId` - Get ingestion status
- `GET /api/v1/github/ingestions/:ingestionId/files` - Get ingested files (with filters)

### Projects
- `GET /api/v1/projects` - List projects (with pagination)
- `POST /api/v1/projects` - Create a new project
- `GET /api/v1/projects/:id` - Get project details
- `PATCH /api/v1/projects/:id` - Update a project
- `DELETE /api/v1/projects/:id` - Delete a project

See [API Documentation](docs/API.md) for full details.

## 🗄️ Database Schema

The platform uses the following core models:

- **User** - Platform users (GitHub OAuth)
- **GitHubConnection** - GitHub OAuth connection with encrypted access token
- **Workspace** - Team/organization workspaces
- **Project** - Software projects being handed over
- **Repository** - GitHub repositories linked to projects
- **RepositoryFile** - Ingested repository files with metadata
- **RepositoryIngestion** - Ingestion job tracking (status, progress, errors)
- **ProjectAnalysis** - AI-generated project analysis results
- **KnowledgeGap** - Identified knowledge gaps
- **ProjectRisk** - Project risks and mitigation strategies
- **Interview** - Knowledge handover interviews
- **InterviewQuestion** - Questions and answers from interviews
- **HandoverDocument** - Generated handover documentation
- **Evidence** - Source references backing documentation

See [Architecture Documentation](docs/ARCHITECTURE.md) for details.

## 🔐 Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NODE_ENV` | No | Environment (development/production/test) |
| `PORT` | No | Server port (default: 3000) |
| `DATABASE_URL` | Yes | Database connection string |
| `CORS_ORIGIN` | No | CORS allowed origin (default: http://localhost:5173) |
| `GITHUB_CLIENT_ID` | No | GitHub OAuth client ID |
| `GITHUB_CLIENT_SECRET` | No | GitHub OAuth client secret |
| `GITHUB_CALLBACK_URL` | No | GitHub OAuth callback URL |
| `LLM_PROVIDER` | No | LLM provider (openai/nim/custom) |
| `LLM_API_KEY` | Yes* | LLM API key (*required if using AI features) |
| `LLM_BASE_URL` | No | Custom LLM endpoint URL |
| `LLM_MODEL` | No | LLM model to use (default: gpt-4o) |
| `JWT_SECRET` | No | JWT signing secret |
| `LOG_LEVEL` | No | Logging level (default: info) |

## 📖 Documentation

- [Architecture](docs/ARCHITECTURE.md) - System architecture and design decisions
- [API Reference](docs/API.md) - Complete API documentation
- [Progress Tracking](PROGRESS.md) - Development progress and milestones

## 🧪 Testing

```bash
# Run all tests
npm run test

# Run specific test file
npx vitest run src/services/ingestionService.test.ts
```

### Test Coverage
- OAuth state generation and validation
- GitHub OAuth URL building
- Token encryption/decryption
- File filtering (exclusions, text detection)
- File categorization (test, config, docs, generated)
- Language detection from file extensions
- Binary content detection

## 🤝 Contributing

This is a hackathon project. For now, see [PROGRESS.md](PROGRESS.md) for current status.

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

## 🙏 Acknowledgments

- Built for a 24-hour hackathon
- Powered by modern TypeScript, Prisma, and Express