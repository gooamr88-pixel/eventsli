// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const globals = require('globals');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', '.expo/*', 'android/*', 'ios/*'],
  },
  // Tooling run with Node on a computer (the end-to-end runner), not in the app.
  {
    files: ['scripts/**/*.js'],
    languageOptions: { globals: globals.node },
  },
]);
