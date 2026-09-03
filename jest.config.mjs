import nextJest from 'next/jest.js'
 
const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.js and .env files in your test environment
  dir: './',
})
 
// Add any custom config to be passed to Jest
/** @type {import('jest').Config} */
const config = {
  // Add more setup options before each test is run
  // setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
 
  testEnvironment: 'jest-environment-jsdom',
  setupFilesAfterEnv: ['./jest.setup.mjs'],

  /*
   * The merged airi tree (src/airi) ships upstream's OWN suites — 53 files written against `vitest`,
   * and one against `bun:test`. Neither runner is a dependency of this app. Jest's default
   * testMatch collects every one of them and then fails on `import { describe } from 'vitest'`, so a
   * green `npm test` here is impossible until they are ignored. They are kept beside the code they
   * cover so the port stays diffable against upstream airi; tsconfig.json excludes them for the
   * same reason.
   */
  testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/src/airi/'],

  /*
   * The `@/*` alias, spelled out for jest.
   *
   * tsconfig.json declares `"@/*": ["./src/*"]` and webpack honours it, so the whole app imports
   * that way — but next/jest does not derive a moduleNameMapper from tsconfig paths here, and a
   * test that reaches an app module by its real specifier died with "Cannot find module
   * '@/features/...'". The practical effect was that any module NOT reachable by a relative path
   * from `__tests__/` was untestable, which is most of the API surface. Kept in sync with the
   * tsconfig entry by hand; there is only the one.
   */
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
}
 
// createJestConfig is exported this way to ensure that next/jest can load the Next.js config which is async
export default createJestConfig(config)
