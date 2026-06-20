/**
 * Shared Jest preset for all workspaces (unit tests).
 * Integration tests (testcontainers) live in `test/integration/**` and run via `test:int`.
 */
/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.spec.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
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
