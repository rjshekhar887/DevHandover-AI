/**
 * Repository Ingestion Service
 * Handles fetching, processing, and storing repository files
 */

import { prisma } from '../prisma/client';
import { logger } from '../utils/logger';
import { fetchRepositoryTree, fetchFileContent, GitHubTreeItem, GitHubFileContent } from './githubService';
import { BadRequestError, ServiceUnavailableError } from '../utils/errors';

// Configuration constants
const MAX_FILE_SIZE = 1024 * 1024; // 1MB per file
const MAX_TOTAL_SIZE = 50 * 1024 * 1024; // 50MB total
const MAX_FILE_COUNT = 5000;
const EXCLUDED_DIRS = ['.git', 'node_modules', 'dist', 'build', 'vendor', 'coverage', '.next', '.nuxt', 'target', 'out', 'bin', 'obj'];
const EXCLUDED_EXTENSIONS = ['.lock', '.log', '.map', '.min.js', '.min.css'];
const TEXT_EXTENSIONS = [
  '.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.mdx', '.txt', '.yaml', '.yml',
  '.toml', '.ini', '.cfg', '.conf', '.config', '.env', '.env.example',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift', '.php', '.cs',
  '.html', '.htm', '.css', '.scss', '.sass', '.less', '.vue', '.svelte',
  '.sql', '.graphql', '.gql', '.proto', '.dockerfile', '.dockerignore',
  '.gitignore', '.gitattributes', '.editorconfig', '.eslintrc', '.prettierrc',
  'Dockerfile', 'Makefile', 'CMakeLists.txt', 'package.json', 'tsconfig.json',
  'README', 'LICENSE', 'CHANGELOG', 'CONTRIBUTING', 'CODE_OF_CONDUCT',
];

/**
 * Check if a file path should be excluded
 */
export function shouldExcludeFile(path: string): boolean {
  const parts = path.split('/');

  // Check excluded directories
  for (const part of parts) {
    if (EXCLUDED_DIRS.includes(part)) {
      return true;
    }
    // Skip hidden directories (starting with .)
    if (part.startsWith('.') && part !== '.github' && part !== '.vscode' && part !== '.idea') {
      return true;
    }
  }

  // Check excluded extensions
  const lowerPath = path.toLowerCase();
  for (const ext of EXCLUDED_EXTENSIONS) {
    if (lowerPath.endsWith(ext)) {
      return true;
    }
  }

  // Skip very large lock files
  if (lowerPath.includes('package-lock.json') || lowerPath.includes('yarn.lock') || lowerPath.includes('pnpm-lock.yaml')) {
    return true;
  }

  return false;
}

/**
 * Check if a file is likely a text file based on extension
 */
export function isTextFile(path: string): boolean {
  const lowerPath = path.toLowerCase();
  const fileName = lowerPath.split('/').pop() || '';

  // Check known text extensions
  for (const ext of TEXT_EXTENSIONS) {
    if (lowerPath.endsWith(ext) || fileName === ext.replace('.', '')) {
      return true;
    }
  }

  // Check for common config files without extensions
  const configFiles = ['dockerfile', 'makefile', 'cmakelists.txt', 'license', 'readme', 'changelog', 'contributing', 'code_of_conduct'];
  if (configFiles.includes(fileName)) {
    return true;
  }

  return false;
}

/**
 * Detect if file is binary based on content
 */
export function isBinaryContent(content: string): boolean {
  // Check for null bytes or high ratio of non-printable characters
  const nullByteIndex = content.indexOf('\0');
  if (nullByteIndex !== -1) return true;

  // Sample first 1000 chars
  const sample = content.slice(0, 1000);
  let nonPrintable = 0;
  for (let i = 0; i < sample.length; i++) {
    const charCode = sample.charCodeAt(i);
    // Allow printable ASCII, newlines, tabs
    if (charCode < 32 && charCode !== 9 && charCode !== 10 && charCode !== 13) {
      nonPrintable++;
    }
  }
  return nonPrintable / sample.length > 0.1;
}

/**
 * Categorize file type
 */
export function categorizeFile(path: string, content?: string): { isTest: boolean; isConfig: boolean; isDocumentation: boolean; isGenerated: boolean } {
  const lowerPath = path.toLowerCase();
  const fileName = lowerPath.split('/').pop() || '';

  // Test files
  const isTest =
    lowerPath.includes('/test/') ||
    lowerPath.includes('/tests/') ||
    lowerPath.includes('/__tests__/') ||
    lowerPath.includes('/spec/') ||
    lowerPath.includes('/specs/') ||
    fileName.endsWith('.test.ts') ||
    fileName.endsWith('.test.js') ||
    fileName.endsWith('.spec.ts') ||
    fileName.endsWith('.spec.js') ||
    fileName.endsWith('_test.py') ||
    fileName.endsWith('_test.go') ||
    fileName.startsWith('test_');

  // Config files
  const isConfig =
    fileName === 'package.json' ||
    fileName === 'tsconfig.json' ||
    fileName === 'tsconfig.build.json' ||
    fileName === 'jsconfig.json' ||
    fileName === '.eslintrc' ||
    fileName === '.eslintrc.json' ||
    fileName === '.eslintrc.js' ||
    fileName === '.prettierrc' ||
    fileName === '.prettierrc.json' ||
    fileName === '.prettierrc.js' ||
    fileName === '.babelrc' ||
    fileName === '.babelrc.json' ||
    fileName === '.babelrc.js' ||
    fileName === 'webpack.config.js' ||
    fileName === 'vite.config.ts' ||
    fileName === 'vite.config.js' ||
    fileName === 'rollup.config.js' ||
    fileName === 'jest.config.js' ||
    fileName === 'jest.config.ts' ||
    fileName === 'tailwind.config.js' ||
    fileName === 'tailwind.config.ts' ||
    fileName === 'next.config.js' ||
    fileName === 'nuxt.config.ts' ||
    fileName === '.env' ||
    fileName === '.env.example' ||
    fileName === '.env.local' ||
    fileName === '.env.production' ||
    fileName === 'dockerfile' ||
    fileName === 'docker-compose.yml' ||
    fileName === 'docker-compose.yaml' ||
    fileName === '.dockerignore' ||
    fileName === 'makefile' ||
    fileName === 'cmakelists.txt' ||
    lowerPath.endsWith('.config.js') ||
    lowerPath.endsWith('.config.ts') ||
    lowerPath.endsWith('.conf') ||
    lowerPath.endsWith('.ini') ||
    lowerPath.endsWith('.yaml') ||
    lowerPath.endsWith('.yml') ||
    lowerPath.endsWith('.toml');

  // Documentation files
  const isDocumentation =
    fileName === 'readme' ||
    fileName === 'readme.md' ||
    fileName === 'readme.txt' ||
    fileName === 'license' ||
    fileName === 'license.md' ||
    fileName === 'license.txt' ||
    fileName === 'changelog' ||
    fileName === 'changelog.md' ||
    fileName === 'contributing' ||
    fileName === 'contributing.md' ||
    fileName === 'code_of_conduct' ||
    fileName === 'code_of_conduct.md' ||
    lowerPath.includes('/docs/') ||
    lowerPath.includes('/doc/') ||
    lowerPath.endsWith('.md') ||
    lowerPath.endsWith('.mdx') ||
    lowerPath.endsWith('.rst') ||
    lowerPath.endsWith('.txt') && (fileName === 'authors' || fileName === 'credits' || fileName === 'todo');

  // Generated files (heuristics)
  const isGenerated =
    lowerPath.includes('/dist/') ||
    lowerPath.includes('/build/') ||
    lowerPath.includes('/generated/') ||
    lowerPath.includes('/.generated/') ||
    fileName.endsWith('.min.js') ||
    fileName.endsWith('.min.css') ||
    fileName.endsWith('.map') ||
    fileName.endsWith('.d.ts') && !lowerPath.includes('src/');

  return { isTest, isConfig, isDocumentation, isGenerated };
}

/**
 * Get language from file extension
 */
export function getLanguageFromPath(path: string): string | null {
  const ext = path.split('.').pop()?.toLowerCase();
  if (!ext) return null;

  const languageMap: Record<string, string> = {
    ts: 'TypeScript',
    tsx: 'TypeScript',
    js: 'JavaScript',
    jsx: 'JavaScript',
    json: 'JSON',
    md: 'Markdown',
    mdx: 'Markdown',
    py: 'Python',
    rb: 'Ruby',
    go: 'Go',
    rs: 'Rust',
    java: 'Java',
    kt: 'Kotlin',
    swift: 'Swift',
    php: 'PHP',
    cs: 'C#',
    html: 'HTML',
    htm: 'HTML',
    css: 'CSS',
    scss: 'SCSS',
    sass: 'Sass',
    less: 'Less',
    vue: 'Vue',
    svelte: 'Svelte',
    sql: 'SQL',
    graphql: 'GraphQL',
    gql: 'GraphQL',
    proto: 'Protocol Buffers',
    yaml: 'YAML',
    yml: 'YAML',
    toml: 'TOML',
    ini: 'INI',
    cfg: 'INI',
    conf: 'INI',
    config: 'INI',
    dockerfile: 'Dockerfile',
    dockerignore: 'Dockerfile',
    gitignore: 'Git',
    gitattributes: 'Git',
    editorconfig: 'EditorConfig',
    makefile: 'Makefile',
  };

  return languageMap[ext] || null;
}

/**
 * Start repository ingestion
 */
export async function startRepositoryIngestion(
  repositoryId: string,
  accessToken: string,
  owner: string,
  repo: string,
  branch: string
) {
  // Create ingestion record
  const ingestion = await prisma.repositoryIngestion.create({
    data: {
      repositoryId,
      status: 'PROCESSING',
      startedAt: new Date(),
    },
  });

  // Start ingestion asynchronously
  processIngestion(ingestion.id, accessToken, owner, repo, branch).catch(error => {
    logger.error('Ingestion failed', { ingestionId: ingestion.id, error });
  });

  return ingestion;
}

/**
 * Process repository ingestion
 */
async function processIngestion(
  ingestionId: string,
  accessToken: string,
  owner: string,
  repo: string,
  branch: string
): Promise<void> {
  try {
    // Fetch repository tree
    const treeResponse = await fetchRepositoryTree(accessToken, owner, repo, branch, true);

    // Filter relevant files
    const relevantFiles = treeResponse.tree
      .filter(item => item.type === 'blob')
      .filter(item => !shouldExcludeFile(item.path))
      .filter(item => isTextFile(item.path))
      .filter(item => (item.size || 0) <= MAX_FILE_SIZE);

    // Limit file count
    const filesToProcess = relevantFiles.slice(0, MAX_FILE_COUNT);

    // Update ingestion with totals
    await prisma.repositoryIngestion.update({
      where: { id: ingestionId },
      data: {
        totalFiles: filesToProcess.length,
        totalSize: filesToProcess.reduce((sum, f) => sum + (f.size || 0), 0),
      },
    });

    // Process files in batches
    const batchSize = 50;
    let processedFiles = 0;
    let processedSize = 0;

    for (let i = 0; i < filesToProcess.length; i += batchSize) {
      const batch = filesToProcess.slice(i, i + batchSize);

      for (const file of batch) {
        try {
          const fileContent = await fetchFileContent(accessToken, owner, repo, file.path, branch);

          // Decode content
          let content: string;
          if (fileContent.encoding === 'base64') {
            content = Buffer.from(fileContent.content, 'base64').toString('utf-8');
          } else {
            content = fileContent.content;
          }

          // Check if binary
          const isBinary = isBinaryContent(content);

          // Categorize
          const { isTest, isConfig, isDocumentation, isGenerated } = categorizeFile(file.path, content);

          // Get language
          const language = getLanguageFromPath(file.path);

          // Store file
          await prisma.repositoryFile.create({
            data: {
              repositoryId: (await prisma.repositoryIngestion.findUnique({ where: { id: ingestionId } }))?.repositoryId || '',
              path: file.path,
              name: file.path.split('/').pop() || file.path,
              extension: file.path.split('.').pop(),
              size: fileContent.size,
              language,
              content: isBinary ? null : content,
              contentHash: fileContent.sha,
              isBinary,
              isGenerated,
              isTest,
              isConfig,
              isDocumentation,
            },
          });

          processedFiles++;
          processedSize += fileContent.size;

          // Update progress
          await prisma.repositoryIngestion.update({
            where: { id: ingestionId },
            data: {
              processedFiles,
              processedSize,
            },
          });
        } catch (fileError) {
          logger.warn('Failed to process file', { path: file.path, error: fileError });
          // Continue with other files
        }
      }
    }

    // Mark as completed
    await prisma.repositoryIngestion.update({
      where: { id: ingestionId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        processedFiles,
        processedSize,
      },
    });

    logger.info('Ingestion completed', { ingestionId, processedFiles });
  } catch (error) {
    logger.error('Ingestion failed', { ingestionId, error });

    await prisma.repositoryIngestion.update({
      where: { id: ingestionId },
      data: {
        status: 'FAILED',
        error: error instanceof Error ? error.message : 'Unknown error',
        errorDetails: JSON.stringify({ stack: error instanceof Error ? error.stack : undefined }),
        completedAt: new Date(),
      },
    });
  }
}

/**
 * Get ingestion status
 */
export async function getIngestionStatus(ingestionId: string) {
  return prisma.repositoryIngestion.findUnique({
    where: { id: ingestionId },
  });
}

/**
 * Get ingested files with filtering and pagination
 */
export async function getIngestedFiles(
  repositoryId: string,
  options: {
    page: number;
    limit: number;
    language?: string;
    isTest?: boolean;
    isConfig?: boolean;
    isDocumentation?: boolean;
  }
) {
  const { page, limit, language, isTest, isConfig, isDocumentation } = options;
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = { repositoryId };

  if (language) where.language = language;
  if (isTest !== undefined) where.isTest = isTest;
  if (isConfig !== undefined) where.isConfig = isConfig;
  if (isDocumentation !== undefined) where.isDocumentation = isDocumentation;

  const [files, total] = await Promise.all([
    prisma.repositoryFile.findMany({
      where,
      skip,
      take: limit,
      orderBy: { path: 'asc' },
      select: {
        id: true,
        path: true,
        name: true,
        extension: true,
        size: true,
        language: true,
        content: true,
        contentHash: true,
        isBinary: true,
        isGenerated: true,
        isTest: true,
        isConfig: true,
        isDocumentation: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.repositoryFile.count({ where }),
  ]);

  return {
    data: files,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

/**
 * Detect project languages and frameworks
 */
export async function detectProjectTech(repositoryId: string): Promise<{ languages: string[]; frameworks: string[]; dependencies: string[] }> {
  const files = await prisma.repositoryFile.findMany({
    where: { repositoryId, isBinary: false },
    select: { path: true, name: true, language: true, content: true },
  });

  const languages = new Set<string>();
  const frameworks = new Set<string>();
  const dependencies = new Set<string>();

  for (const file of files) {
    if (file.language) languages.add(file.language);

    const lowerPath = file.path.toLowerCase();
    const content = file.content || '';

    // Detect frameworks from config files
    if (file.name === 'package.json') {
      try {
        const pkg = JSON.parse(content);
        const allDeps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };

        for (const dep of Object.keys(allDeps)) {
          dependencies.add(dep);

          // Framework detection
          if (dep === 'react' || dep === '@types/react') frameworks.add('React');
          if (dep === 'vue') frameworks.add('Vue');
          if (dep === '@angular/core') frameworks.add('Angular');
          if (dep === 'svelte') frameworks.add('Svelte');
          if (dep === 'next') frameworks.add('Next.js');
          if (dep === 'nuxt') frameworks.add('Nuxt');
          if (dep === 'express') frameworks.add('Express');
          if (dep === 'fastify') frameworks.add('Fastify');
          if (dep === 'nestjs') frameworks.add('NestJS');
          if (dep === 'django') frameworks.add('Django');
          if (dep === 'flask') frameworks.add('Flask');
          if (dep === 'rails') frameworks.add('Rails');
          if (dep === 'spring-boot') frameworks.add('Spring Boot');
        }
      } catch {
        // Ignore parse errors
      }
    }

    // Python frameworks
    if (file.name === 'requirements.txt' || file.name === 'pyproject.toml' || file.name === 'setup.py') {
      if (content.includes('django')) frameworks.add('Django');
      if (content.includes('flask')) frameworks.add('Flask');
      if (content.includes('fastapi')) frameworks.add('FastAPI');
      if (content.includes('pytest')) dependencies.add('pytest');
    }

    // Go modules
    if (file.name === 'go.mod') {
      if (content.includes('gin')) frameworks.add('Gin');
      if (content.includes('echo')) frameworks.add('Echo');
    }

    // Rust
    if (file.name === 'cargo.toml') {
      if (content.includes('actix-web')) frameworks.add('Actix');
      if (content.includes('rocket')) frameworks.add('Rocket');
    }
  }

  return {
    languages: Array.from(languages).sort(),
    frameworks: Array.from(frameworks).sort(),
    dependencies: Array.from(dependencies).sort(),
  };
}