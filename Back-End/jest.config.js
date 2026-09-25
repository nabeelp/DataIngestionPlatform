/** @type {import('jest').Config} */
module.exports = {
    testEnvironment: 'node',
    roots: ['<rootDir>/tests'],
    testMatch: ['**/*.test.ts'],
    transform: {
        '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }],
    },
    moduleNameMapper: {
        '^uuid$': '<rootDir>/tests/shims/uuid.ts',
    },
    clearMocks: true,
};
