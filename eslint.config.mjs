// @ts-check
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // Lint TypeScript sources only; ignore compiled artifacts and JS config files.
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/.turbo/**',
      '**/node_modules/**',
      'libs/shared-types/src/gen/**',
      '**/*.js',
      '**/*.cjs',
      '**/*.mjs',
      '**/*.d.ts',
      '**/*.js.map',
    ],
  },
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    rules: {
      // Non-negotiable rules from CLAUDE.md §E1: no `any`, no implicit unsafe.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-non-null-assertion': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // Feature boundary (§A10.5). A feature library must not reach into another feature library:
    // cross-feature communication goes through the event bus, or through a port declared in
    // @velchat/feature-contracts and wired by the composition root.
    //
    // This rule is what keeps the 6-service topology reversible. Without it the libraries grow
    // direct references to each other within weeks, and splitting a combined service back out (or
    // merging two more together) stops being a config change and becomes a refactor.
    files: ['libs/feature-*/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@velchat/feature-*', '!@velchat/feature-contracts'],
              message:
                'Feature libs must not import each other. Use the event bus, or a port from ' +
                '@velchat/feature-contracts that the composition root wires up.',
            },
          ],
        },
      ],
    },
  },
  {
    // Tests may relax a couple of rules for fixtures/mocks.
    files: ['**/*.spec.ts', '**/*.test.ts', '**/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
