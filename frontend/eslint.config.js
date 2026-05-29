// ESLint flat config (ESLint 9+).
// React + react-hooks + react-refresh + typescript-eslint, recommended rules.
// Tightened where the codebase has agreed conventions; lax where the project
// disagrees with defaults (e.g. unused-vars is enforced by tsc strict, not ESLint).

import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'node_modules', '*.tsbuildinfo'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      // TypeScript handles unused-vars more accurately.
      '@typescript-eslint/no-unused-vars': 'off',
      'no-unused-vars': 'off',
      // Allow the `(err as Error)` pattern that lives throughout the codebase;
      // P1-5 will replace it with `toErrorMessage`, after which this rule
      // could be re-enabled.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
)
