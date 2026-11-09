// Development-only sign-in shortcut. It exists only when the dev server runs with VITE_DEV_BYPASS_AUTH=true and
// matches the users in Back-End/database/local/seed_local_users.sql; production builds never enable it.

export interface MockUser {
  id: string;
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  Role: string;
  loginMethod: string;
}

export const devBypassAuth = import.meta.env.DEV && import.meta.env.VITE_DEV_BYPASS_AUTH === 'true';

const MOCK_PASSWORD = 'password123';

const MOCK_USERS: MockUser[] = [
  {
    id: '63BD96E4-1229-4399-8964-0795E50B3574',
    email: 'admin@company.com',
    username: 'admin',
    firstName: 'System',
    lastName: 'Administrator',
    Role: 'admin',
    loginMethod: 'password',
  },
  {
    id: '1C5E6A9B-BF1F-40E8-99DA-7893A8960CBA',
    email: 'user@company.com',
    username: 'user',
    firstName: 'Test',
    lastName: 'User',
    Role: 'user',
    loginMethod: 'password',
  },
];

const MOCK_TOKEN_PREFIX = 'mock_token_';

export const isMockToken = (token: string): boolean => token.startsWith(MOCK_TOKEN_PREFIX);

/** Returns a mock session for a known local account, or null when the bypass is off or the credentials do not match. */
export function tryMockLogin(email: string, password: string): { token: string; user: MockUser } | null {
  if (!devBypassAuth || password !== MOCK_PASSWORD) return null;
  const normalizedEmail = email.toLowerCase().trim();
  const user = MOCK_USERS.find(candidate => candidate.email.toLowerCase() === normalizedEmail);
  return user ? { token: `${MOCK_TOKEN_PREFIX}${user.id}_${Date.now()}`, user } : null;
}
