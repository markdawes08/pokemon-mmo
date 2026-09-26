import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules/**', '**/dist/**', '.tools/**', '.local/**', '.venv/**', 'reference/**', 'content/generated/**', 'reports/**', 'playwright-report/**', 'test-results/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ['**/*.ts'], rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }] } },
  { files: ['apps/client/src/**/*.ts'], rules: { 'no-restricted-imports': ['error', { patterns: ['@pokewaterblue/database', '@pokewaterblue/server', '@pokewaterblue/battle-core', '@pokewaterblue/battle-core/**', '**/battle-core/**', '**/server/**', '**/database/**'] }] } },
  { files: ['packages/game-rules/src/**/*.ts', 'packages/battle-core/**/*.ts'], rules: { 'no-restricted-imports': ['error', { patterns: ['phaser', '@colyseus/*', 'colyseus', '@pokewaterblue/database'] }] } },
  { files: ['**/*.mjs'], languageOptions: { globals: { process: 'readonly', console: 'readonly', Buffer: 'readonly', URL: 'readonly', fetch: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly' } } }
);
