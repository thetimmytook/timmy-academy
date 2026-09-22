import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { flatConfigs as importConfigs } from 'eslint-plugin-import-x';
import reactHooks from 'eslint-plugin-react-hooks';
import security from 'eslint-plugin-security';
import sonarjs from 'eslint-plugin-sonarjs';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/.wrangler/**',
      '**/node_modules/**',
      '**/styled-system/**',
    ],
  },
  js.configs.recommended,
  sonarjs.configs.recommended,
  security.configs.recommended,
  importConfigs.recommended,
  ...tseslint.configs.recommendedTypeChecked.map(config => ({
    ...config,
    files: ['**/*.{ts,tsx}'],
  })),
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: { projectService: true },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/only-throw-error': 'error',
      'import-x/no-duplicates': 'error',
      'import-x/order': [
        'warn',
        {
          groups: [
            'builtin',
            'external',
            'internal',
            'parent',
            'sibling',
            'index',
            'object',
            'type',
          ],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      'sonarjs/no-duplicate-string': 'warn',
      'security/detect-object-injection': 'warn',
    },
  },
  ...['apps/api', 'apps/web', 'packages/contracts'].map(workspace => ({
    files: [`${workspace}/**/*.{ts,tsx}`],
    settings: {
      'import-x/resolver': {
        typescript: { project: `${workspace}/tsconfig.json` },
      },
    },
  })),
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
    },
  },
  {
    files: ['apps/api/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.serviceworker },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
  prettier,
);
