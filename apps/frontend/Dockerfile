# DevHandover AI - Frontend Dockerfile
# Multi-stage build: builder -> nginx runtime

# ===========================================
# Stage 1: Builder
# ===========================================
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files for the entire monorepo
COPY package*.json ./
COPY apps/frontend/package*.json ./apps/frontend/
COPY packages/shared/package*.json ./packages/shared/

# Install all dependencies
RUN npm ci --workspaces --include-workspace-root

# Copy source code
COPY apps/frontend/src ./apps/frontend/src
COPY apps/frontend/index.html ./apps/frontend/
COPY apps/frontend/vite.config.ts ./apps/frontend/
COPY apps/frontend/tsconfig.json ./apps/frontend/
COPY apps/frontend/tailwind.config.js ./apps/frontend/
COPY apps/frontend/postcss.config.js ./apps/frontend/
COPY packages/shared ./packages/shared
COPY tsconfig.json ./

# Build the frontend
RUN npm run build --workspace=apps/frontend

# ===========================================
# Stage 2: Nginx Runtime
# ===========================================
FROM nginx:alpine AS runtime

# Copy built assets from builder
COPY --from=builder /app/apps/frontend/dist /usr/share/nginx/html

# Copy nginx configuration
COPY apps/frontend/nginx.conf /etc/nginx/conf.d/default.conf

# Expose port
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1/ || exit 1

# Start nginx
CMD ["nginx", "-g", "daemon off;"]