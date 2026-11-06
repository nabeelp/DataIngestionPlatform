import { isMockToken } from '../dev/mockAuth';

/** The signed-in user kept in state and localStorage. */
export interface User {
  id: string;
  email: string;
  username: string;
  firstName: string | null;
  lastName: string | null;
  Role: string;
  loginMethod: string;
}

/** The user object of the login and SSO responses (see the back-end IUserResponse). */
export interface ServerUser {
  Id: string;
  Email: string;
  Username: string;
  FirstName: string | null;
  LastName: string | null;
  Role: string;
  LoginMethod: string;
}

export const TOKEN_KEY = 'token';
export const USER_KEY = 'user';

type SessionStorage = Pick<Storage, 'getItem' | 'removeItem'>;

/** Maps the API's PascalCase user to the session user kept in state and localStorage. */
export const toSessionUser = (raw: ServerUser | null | undefined, fallbackLoginMethod: string): User | null => {
  if (!raw?.Id || !raw.Email) return null;
  return {
    id: raw.Id,
    email: raw.Email,
    username: raw.Username ?? '',
    firstName: raw.FirstName ?? null,
    lastName: raw.LastName ?? null,
    Role: raw.Role ?? 'user',
    loginMethod: raw.LoginMethod ?? fallbackLoginMethod,
  };
};

export const clearStoredSession = (storage: SessionStorage): void => {
  storage.removeItem(TOKEN_KEY);
  storage.removeItem(USER_KEY);
};

/**
 * Restores the session saved by the last sign-in. Anything that is not a plausible session (a mock token outside
 * the development bypass, a malformed token or user) is discarded so it cannot be sent to the API.
 */
export const readStoredSession = (
  storage: SessionStorage,
  allowMockToken: boolean,
): { token: string; user: User } | null => {
  const token = storage.getItem(TOKEN_KEY);
  const rawUser = storage.getItem(USER_KEY);
  if (!token || !rawUser) {
    if (token && isMockToken(token) && !allowMockToken) clearStoredSession(storage);
    return null;
  }

  let user: Partial<User> | null = null;
  try {
    user = JSON.parse(rawUser) as Partial<User> | null;
  } catch {
    user = null;
  }
  const plausibleToken = token.split('.').length === 3 || (allowMockToken && isMockToken(token));
  if (!plausibleToken || !user?.id || !user.email) {
    clearStoredSession(storage);
    return null;
  }
  return { token, user: user as User };
};
