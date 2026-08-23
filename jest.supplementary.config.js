/**
 * Jest config for the optional supplementary/ suite ONLY.
 *
 * Kept separate from jest.config.js on purpose: `npm test` must run exactly the
 * 38 required tests in tests/ and nothing else, so the graded deliverable's
 * result is never inflated by supplementary work. Run this one with
 * `npm run test:supplementary`.
 *
 * @type {import('jest').Config}
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Tests live in tests/supplementary/; the helpers and the benchmark they lean
  // on live in supplementary/. Both are listed so module resolution reaches the
  // helpers — only tests/supplementary/ actually contains *.test.ts files.
  roots: ['<rootDir>/tests/supplementary', '<rootDir>/supplementary'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: 'tsconfig.json',
    }],
  },
};
