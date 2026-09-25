// Jest runs CommonJS; uuid v13 is ESM-only, so tests use Node's built-in UUID generator.
import { randomUUID } from 'crypto';

export const v4 = (): string => randomUUID();
