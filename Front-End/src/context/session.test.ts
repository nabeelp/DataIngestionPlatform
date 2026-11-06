import { describe, expect, it } from 'vitest';
import {
  TOKEN_KEY,
  USER_KEY,
  clearStoredSession,
  readStoredSession,
  toSessionUser,
  type ServerUser,
} from './session';

const memoryStorage = (initial: Record<string, string> = {}) => {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => { values.delete(key); },
    has: (key: string) => values.has(key),
  };
};

const JWT = 'header.payload.signature';
const MOCK = 'mock_token_63BD96E4-1229-4399-8964-0795E50B3574_1';
const user = { id: 'u1', email: 'a@b.c', username: 'a', firstName: null, lastName: null, Role: 'user', loginMethod: 'password' };
const stored = (token: string, value: unknown = user) =>
  memoryStorage({ [TOKEN_KEY]: token, [USER_KEY]: typeof value === 'string' ? value : JSON.stringify(value) });

describe('toSessionUser', () => {
  const server: ServerUser = {
    Id: 'u1', Email: 'a@b.c', Username: 'ann', FirstName: 'Ann', LastName: 'Lee', Role: 'admin', LoginMethod: 'sso',
  };

  it('maps the API user to the session user', () => {
    expect(toSessionUser(server, 'password')).toEqual({
      id: 'u1', email: 'a@b.c', username: 'ann', firstName: 'Ann', lastName: 'Lee', Role: 'admin', loginMethod: 'sso',
    });
  });

  it('fills missing optional fields', () => {
    const sparse = { Id: 'u1', Email: 'a@b.c' } as ServerUser;

    expect(toSessionUser(sparse, 'password')).toEqual({
      id: 'u1', email: 'a@b.c', username: '', firstName: null, lastName: null, Role: 'user', loginMethod: 'password',
    });
  });

  it.each([null, undefined, { Id: '', Email: 'a@b.c' }, { Id: 'u1', Email: '' }])('rejects an incomplete user (%j)', raw => {
    expect(toSessionUser(raw as ServerUser | null | undefined, 'password')).toBeNull();
  });
});

describe('readStoredSession', () => {
  it('restores a stored session with a signed token', () => {
    expect(readStoredSession(stored(JWT), false)).toEqual({ token: JWT, user });
  });

  it('returns nothing, and keeps the storage, when there is no saved session', () => {
    const storage = memoryStorage();

    expect(readStoredSession(storage, false)).toBeNull();
    expect(storage.has(TOKEN_KEY)).toBe(false);
  });

  it('does not clear a token that has no saved user yet', () => {
    const storage = memoryStorage({ [TOKEN_KEY]: JWT });

    expect(readStoredSession(storage, false)).toBeNull();
    expect(storage.has(TOKEN_KEY)).toBe(true);
  });

  it('accepts a mock token only while the development bypass is on', () => {
    expect(readStoredSession(stored(MOCK), true)?.token).toBe(MOCK);

    const storage = stored(MOCK);
    expect(readStoredSession(storage, false)).toBeNull();
    expect(storage.has(TOKEN_KEY)).toBe(false);
    expect(storage.has(USER_KEY)).toBe(false);
  });

  it('removes a mock token that has no saved user when the bypass is off', () => {
    const storage = memoryStorage({ [TOKEN_KEY]: MOCK });

    expect(readStoredSession(storage, false)).toBeNull();
    expect(storage.has(TOKEN_KEY)).toBe(false);
  });

  it.each([
    ['a token that is not a JWT', stored('not-a-jwt')],
    ['a malformed user', stored(JWT, '{not json')],
    ['a user without an id', stored(JWT, { email: 'a@b.c' })],
    ['a user without an email', stored(JWT, { id: 'u1' })],
    ['a null user', stored(JWT, 'null')],
  ])('discards %s', (_label, storage) => {
    expect(readStoredSession(storage, false)).toBeNull();
    expect(storage.has(TOKEN_KEY)).toBe(false);
    expect(storage.has(USER_KEY)).toBe(false);
  });
});

describe('clearStoredSession', () => {
  it('removes both saved values', () => {
    const storage = stored(JWT);

    clearStoredSession(storage);

    expect(storage.has(TOKEN_KEY) || storage.has(USER_KEY)).toBe(false);
  });
});
