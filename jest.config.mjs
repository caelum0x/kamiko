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
const getConfig = createJestConfig(config)

/*
 * The AIRI streaming-speech pipeline (src/features/chat/streamingSpeech.ts) pulls in ESM-only
 * packages — `@moeru/eventa`, `@moeru/std`, `clustr`, and their `nanoid/non-secure` dependency —
 * that ship `"type": "module"` / `.mjs` with bare `import` syntax. Jest does not transform
 * node_modules by default, so it tries to run those files as CommonJS and dies with
 * "Cannot use import statement outside a module".
 *
 * next/jest force-prepends a blanket `/node_modules/` ignore pattern, and since a file is skipped
 * when it matches ANY transformIgnorePattern, a plain negative-lookahead entry can never override
 * it. So we resolve next/jest's config and replace transformIgnorePatterns wholesale: whitelist just
 * these packages for SWC transformation (everything else in node_modules stays ignored), and
 * keep next's CSS-module ignore rule. This is Next.js's documented workaround for ESM deps.
 *
 * `three` is on the list for the same reason and a wider consequence. `three/examples/jsm/**` is
 * ESM-only, and `src/utils/config.ts` reaches it through a chain nobody would guess from the import
 * (config → externalAPI → amicaLife/eventHandler → loadVRMAnimation → GLTFLoader). So ANY test that
 * touched the app's configuration defaults died with "Cannot use import statement outside a module",
 * which quietly put every default — the background the stage boots with among them — out of reach
 * of the suite.
 */
export default async () => {
  const resolved = await getConfig()
  resolved.transformIgnorePatterns = [
    'node_modules/(?!(?:@moeru|clustr|nanoid|three)/)',
    '^.+\\.module\\.(css|sass|scss)$',
  ]
  return resolved
}
