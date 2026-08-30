import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // `server/` is a separate Node/CommonJS backend project (its own
  // package.json, its own dependencies) — it was already being
  // unintentionally linted here with browser/ESM globals, which flagged
  // every single `require`/`module`/`process`/`Buffer` use across the
  // entire backend as `no-undef`. That was never actionable signal for
  // this frontend project's `npm run lint`, so it is excluded here rather
  // than reconfigured — the backend has no lint script of its own yet.
  globalIgnores(['dist', 'server']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
])
