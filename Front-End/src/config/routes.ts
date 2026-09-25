/**
 * Route prefix for the signed-in user's area of the app.
 * Admins use the /admin route tree for both admin-only and standard user pages.
 */
export const roleBasePath = (role?: string | null): string => (role === 'admin' ? '/admin' : '');
