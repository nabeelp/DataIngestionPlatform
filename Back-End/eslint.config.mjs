import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
    { ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'logs/**'] },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ['**/*.ts'],
        languageOptions: {
            globals: { ...globals.node },
        },
        rules: {
            // The existing codebase uses `any` for SQL recordsets; keep it visible without failing the build.
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
            'no-console': 'error',
        },
    },
    {
        files: ['tests/**/*.ts'],
        languageOptions: { globals: { ...globals.jest } },
        rules: { '@typescript-eslint/no-require-imports': 'off' },
    },
    {
        files: ['jest.config.js'],
        languageOptions: { globals: { ...globals.node }, sourceType: 'commonjs' },
    },
);
