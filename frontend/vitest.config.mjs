import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/**
 * No JSX loader configuration here, deliberately — see the convention note in
 * AGENTS.md. A file containing JSX is named `.jsx`, so every tool in the chain
 * knows what it is holding without being told.
 *
 * The alternative was configuring Vite to parse JSX inside `.js`. It does not
 * work cleanly on this toolchain: plugin-react's default `include` already
 * matches `.js`, but the transform underneath it is oxc, which decides whether
 * to accept JSX from the FILE EXTENSION. Setting `esbuild.loader = 'jsx'` on
 * top of that produced a worse failure — `RollupError: Parse failure` — and a
 * test suite that started timing out.
 */
export default defineConfig({
  plugins: [react()],

  /**
   * The AUTOMATIC JSX runtime, stated explicitly.
   *
   * Without it, esbuild transforms `.jsx` with the classic runtime and emits
   * `React.createElement(...)` — so every component test fails with
   * "React is not defined", because no file in this codebase imports React by
   * name and none should have to since React 17.
   *
   * Next uses the automatic runtime by default; vitest's esbuild pass does not
   * inherit that.
   */
  esbuild: { jsx: 'automatic', jsxImportSource: 'react' },

  resolve: {
    alias: { '@': path.resolve('./src') },
  },

  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.js'],
    include: ['test/**/*.test.{js,jsx}'],

    /**
     * 20s, not the 5s default.
     *
     * Nothing here is slow by design. The first `new Intl.NumberFormat()` in a
     * worker loads ICU data, and on this machine that has measured between 2.5
     * and 5.6 seconds — enough to fail the first money test at the default and
     * pass every one after it. A timeout tuned so tightly that ICU loading
     * trips it produces a suite that fails at random, which is a suite people
     * stop reading.
     */
    testTimeout: 20_000,

    /**
     * NODE 25+ SHIPS ITS OWN `localStorage`, and it wins over jsdom's: the
     * worker sees Node's global (unusable without `--localstorage-file`), so
     * `window.localStorage` reads as undefined and 21 tests fail in
     * nearbyEvents and aiTools — on the machine, not in the code. Measured
     * 2026-11-05 on Node 26: 747/747 with the flag, 726/747 without.
     *
     * Switched off only where it exists. Node 22 (the version this project
     * pins — .nvmrc, docs/DEPLOY.md) does not know the flag in every patch
     * release, so it is not passed there.
     */
    ...(Number(process.versions.node.split('.')[0]) >= 25 && {
      poolOptions: {
        forks: { execArgv: ['--no-experimental-webstorage'] },
        threads: { execArgv: ['--no-experimental-webstorage'] },
      },
    }),
  },
});
