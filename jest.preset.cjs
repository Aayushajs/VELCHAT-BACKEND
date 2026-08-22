/**
 * Shared Jest preset for all workspaces (unit tests).
 * Integration tests (testcontainers) live in `test/integration/**` and run via `test:int`.
 */
/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Unit + security specs live in src/ and test/{unit,security} (present in apps, optional in libs).
  // Integration (testcontainers) lives in test/integration and runs via `test:int`, so it's ignored.
  testMatch: ['**/*.spec.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/test/integration/'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  // Per-package transform cache. Jest's default is one shared directory under the OS temp dir, and
  // with ~40 workspaces running under Turbo concurrently the writes collide — on Windows that
  // surfaces as "failed to cache transform results" and the suite fails for a reason that has
  // nothing to do with the code. Scoping the cache to each package removes the contention.
  cacheDirectory: '<rootDir>/.jest-cache',
  clearMocks: true,
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts', '!src/**/index.ts'],
  coverageDirectory: 'coverage',
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: { module: 'commonjs', noUnusedLocals: false, noUnusedParameters: false },
        isolatedModules: true,
      },
    ],
  },
};
