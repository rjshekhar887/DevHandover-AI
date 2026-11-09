/**
 * Ingestion Service Tests
 * Tests for file filtering and categorization utilities
 */

import { describe, it, expect } from 'vitest';
import {
  shouldExcludeFile,
  isTextFile,
  isBinaryContent,
  categorizeFile,
  getLanguageFromPath,
} from './ingestionService';

describe('File Filtering', () => {
  describe('shouldExcludeFile', () => {
    it('should exclude .git directory', () => {
      expect(shouldExcludeFile('.git/config')).toBe(true);
      expect(shouldExcludeFile('src/.git/HEAD')).toBe(true);
    });

    it('should exclude node_modules', () => {
      expect(shouldExcludeFile('node_modules/lodash/index.js')).toBe(true);
      expect(shouldExcludeFile('src/node_modules/test.js')).toBe(true);
    });

    it('should exclude dist/build directories', () => {
      expect(shouldExcludeFile('dist/index.js')).toBe(true);
      expect(shouldExcludeFile('build/main.js')).toBe(true);
    });

    it('should exclude hidden directories (except .github, .vscode, .idea)', () => {
      expect(shouldExcludeFile('.hidden/file.js')).toBe(true);
      expect(shouldExcludeFile('.github/workflows/ci.yml')).toBe(false);
      expect(shouldExcludeFile('.vscode/settings.json')).toBe(false);
      expect(shouldExcludeFile('.idea/workspace.xml')).toBe(false);
    });

    it('should exclude lock files', () => {
      expect(shouldExcludeFile('package-lock.json')).toBe(true);
      expect(shouldExcludeFile('yarn.lock')).toBe(true);
      expect(shouldExcludeFile('pnpm-lock.yaml')).toBe(true);
    });

    it('should exclude .min.js and .map files', () => {
      expect(shouldExcludeFile('dist/app.min.js')).toBe(true);
      expect(shouldExcludeFile('dist/app.js.map')).toBe(true);
    });

    it('should not exclude source files', () => {
      expect(shouldExcludeFile('src/index.ts')).toBe(false);
      expect(shouldExcludeFile('src/components/Button.tsx')).toBe(false);
      expect(shouldExcludeFile('README.md')).toBe(false);
      expect(shouldExcludeFile('package.json')).toBe(false);
    });
  });

  describe('isTextFile', () => {
    it('should identify common source files as text', () => {
      expect(isTextFile('src/index.ts')).toBe(true);
      expect(isTextFile('src/App.tsx')).toBe(true);
      expect(isTextFile('src/main.js')).toBe(true);
      expect(isTextFile('src/component.jsx')).toBe(true);
    });

    it('should identify config files as text', () => {
      expect(isTextFile('package.json')).toBe(true);
      expect(isTextFile('tsconfig.json')).toBe(true);
      expect(isTextFile('.eslintrc')).toBe(true);
      expect(isTextFile('Dockerfile')).toBe(true);
      expect(isTextFile('Makefile')).toBe(true);
    });

    it('should identify documentation as text', () => {
      expect(isTextFile('README.md')).toBe(true);
      expect(isTextFile('CHANGELOG.md')).toBe(true);
      expect(isTextFile('LICENSE')).toBe(true);
    });

    it('should identify other text formats', () => {
      expect(isTextFile('config.yaml')).toBe(true);
      expect(isTextFile('settings.toml')).toBe(true);
      expect(isTextFile('.env.example')).toBe(true);
    });

    it('should not identify binary files as text', () => {
      expect(isTextFile('image.png')).toBe(false);
      expect(isTextFile('binary.exe')).toBe(false);
      expect(isTextFile('data.bin')).toBe(false);
    });
  });

  describe('isBinaryContent', () => {
    it('should detect null bytes', () => {
      expect(isBinaryContent('hello\0world')).toBe(true);
    });

    it('should detect high ratio of non-printable chars', () => {
      const binaryLike = String.fromCharCode(1, 2, 3, 4, 5, 6, 7, 8, 9, 10);
      expect(isBinaryContent(binaryLike)).toBe(true);
    });

    it('should not flag normal text as binary', () => {
      expect(isBinaryContent('Hello world\nThis is a test')).toBe(false);
      expect(isBinaryContent('const x = 1;\nconsole.log(x);')).toBe(false);
    });
  });

  describe('categorizeFile', () => {
    it('should identify test files', () => {
      const result = categorizeFile('src/__tests__/component.test.ts');
      expect(result.isTest).toBe(true);
    });

    it('should identify config files', () => {
      expect(categorizeFile('package.json').isConfig).toBe(true);
      expect(categorizeFile('tsconfig.json').isConfig).toBe(true);
      expect(categorizeFile('.eslintrc.json').isConfig).toBe(true);
      expect(categorizeFile('Dockerfile').isConfig).toBe(true);
    });

    it('should identify documentation files', () => {
      expect(categorizeFile('README.md').isDocumentation).toBe(true);
      expect(categorizeFile('docs/guide.md').isDocumentation).toBe(true);
      expect(categorizeFile('LICENSE').isDocumentation).toBe(true);
    });

    it('should identify generated files', () => {
      expect(categorizeFile('dist/main.js').isGenerated).toBe(true);
      expect(categorizeFile('build/bundle.min.js').isGenerated).toBe(true);
    });
  });

  describe('getLanguageFromPath', () => {
    it('should return correct language for common extensions', () => {
      expect(getLanguageFromPath('src/index.ts')).toBe('TypeScript');
      expect(getLanguageFromPath('src/App.tsx')).toBe('TypeScript');
      expect(getLanguageFromPath('src/main.js')).toBe('JavaScript');
      expect(getLanguageFromPath('src/component.jsx')).toBe('JavaScript');
      expect(getLanguageFromPath('config.json')).toBe('JSON');
      expect(getLanguageFromPath('README.md')).toBe('Markdown');
      expect(getLanguageFromPath('script.py')).toBe('Python');
      expect(getLanguageFromPath('main.go')).toBe('Go');
      expect(getLanguageFromPath('lib.rs')).toBe('Rust');
    });

    it('should return null for unknown extensions', () => {
      expect(getLanguageFromPath('data.xyz')).toBeNull();
      expect(getLanguageFromPath('README')).toBeNull();
    });
  });
});