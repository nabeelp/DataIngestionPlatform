import bcrypt from 'bcryptjs';
import { appConfig } from '../config/appConfig';

/** Hash a password for storage using the configured bcrypt cost. */
export const hashPassword = (password: string): Promise<string> =>
    bcrypt.hash(password, appConfig.security.bcryptRounds);

export const verifyPassword = (password: string, hash: string): Promise<boolean> =>
    bcrypt.compare(password, hash);
