import type { AuthenticatedUser } from '../middleware/authMiddleware';

declare global {
    namespace Express {
        interface Request {
            /** Set by the `authenticate` middleware. */
            user?: AuthenticatedUser;
        }
    }
}

export {};
