import next from 'eslint-config-next/core-web-vitals';

/**
 * Flat config, natively.
 *
 * NOT through `FlatCompat`. eslint-config-next 16 already exports a flat config
 * array (`Linter.Config[]`), and running it back through the eslintrc compat
 * layer makes ESLint 9.39 throw `Converting circular structure to JSON` from
 * inside its own config validator — a stack trace with no file and no rule in
 * it, which reads like a broken install rather than a config mistake. The
 * FlatCompat recipe is what most Next projects still carry, and it is the wrong
 * one on this version.
 */
const config = [
  ...next,

  { ignores: ['.next/**', 'node_modules/**', 'out/**', 'next-env.d.ts'] },

  {
    rules: {
      /**
       * THE RULE THE README IS BUILT ON: the browser never queries Supabase.
       *
       * A convention decays. Someone reaches for a quick read, the import looks
       * harmless beside the twenty others in the file, and authorisation that
       * middleware was enforcing becomes reachable from a browser console with
       * an anon key.
       *
       * As a lint failure it cannot decay quietly — it has to be argued with,
       * in a pull request, by somebody deleting this block.
       */
      'no-restricted-imports': ['error', {
        paths: [{
          name: '@supabase/supabase-js',
          message:
            'The browser never queries Supabase. Every read and write goes through the API — '
            + 'see the conventions table in README.md. For an image upload, use the signed URL '
            + 'from POST /events/:id/cover-upload; it needs no Supabase client.',
        }],
        patterns: [{
          group: ['**/backend/**'],
          message: 'The frontend does not import backend source. Talk to it over HTTP.',
        }],
      }],

      // A stray console.log ships and stays. warn and error survive because
      // both are used deliberately — see describeError in utils/errors.js.
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  {
    // Tests read the backend's error table straight off disk to prove the two
    // have not drifted. That is the point of the test, not a leak of the rule.
    files: ['test/**', 'scripts/**'],
    rules: { 'no-restricted-imports': 'off', 'no-console': 'off' },
  },

  {
    /**
     * The service worker's globals, declared HERE rather than with the
     * `/* eslint-env serviceworker *\/` comment the file used to carry.
     *
     * Flat config does not read `eslint-env` comments at all — it only warns
     * about them, and ESLint 10 turns that warning into an error, which would
     * fail `npm run lint` on a file nobody had touched. Declaring the globals
     * is the migration ESLint's own notice points at, and it is also the
     * honest one: the comment was doing nothing here already.
     *
     * `readonly` because the worker reads these; it never reassigns one.
     */
    files: ['public/gate-sw.js'],
    languageOptions: {
      globals: {
        self: 'readonly',
        caches: 'readonly',
        clients: 'readonly',
        skipWaiting: 'readonly',
        fetch: 'readonly',
        location: 'readonly',
        Response: 'readonly',
        URL: 'readonly',
      },
    },
  },
];

export default config;
