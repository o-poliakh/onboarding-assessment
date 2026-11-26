// @ts-check
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: 'vitest',
  coverageAnalysis: 'perTest',
  mutate: ['src/**/*.{ts,tsx}', '!src/**/*.test.{ts,tsx}', '!src/test/**', '!src/main.tsx'],
  reporters: ['clear-text', 'progress', 'html'],
  htmlReporter: { fileName: 'reports/mutation/index.html' },
  thresholds: { high: 90, low: 80, break: null },
  // Static mutants (module-level schemas and messages) are expected here and cheap enough overall.
  warnings: {
    slow: false,
    unknownOptions: true,
    preprocessorErrors: true,
    unserializableOptions: true,
  },
  // Stryker rewrites out-of-sandbox `extends`/`references` in tsconfig via the TypeScript JS API,
  // which TypeScript 7 (native) no longer ships. Our tsconfig files need no rewriting, and Stryker
  // skips the step when the configured file is absent, so point it at a non-existent file.
  tsconfigFile: 'tsconfig.stryker-skip.json',
}
