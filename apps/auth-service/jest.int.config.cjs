// Integration tests (testcontainers — real Postgres). Run via `pnpm test:int`. Not part of unit `test`.
module.exports = {
  ...require('../../jest.preset.cjs'),
  testMatch: ['**/test/integration/**/*.spec.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  testTimeout: 180000,
  collectCoverage: false,
};
