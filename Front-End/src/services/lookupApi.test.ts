import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLookup, deleteLookup, getLookups, updateLookup, type LookupInput } from './lookupApi';

const input: LookupInput = { name: 'Countries', description: 'ISO codes', values: ['FR', 'DE'] };
const lookup = { id: 'l/1', ...input, createdAt: '2026-01-01', updatedAt: '2026-01-02' };

const respond = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('localStorage', { getItem: () => 'jwt-token' });
});

afterEach(() => vi.unstubAllGlobals());

const lastCall = () => {
  const calls = fetchMock.mock.calls;
  const [url, options] = calls[calls.length - 1] as [string, RequestInit];
  return { url, method: options.method, body: options.body, headers: options.headers as Record<string, string> };
};

describe('lookup API', () => {
  it('lists lookups, passing the search term only when there is one', async () => {
    fetchMock.mockImplementation(() => respond({ success: true, lookups: [lookup] }));

    await expect(getLookups('coun try')).resolves.toEqual([lookup]);
    expect(lastCall().url).toMatch(/\/lookups\?search=coun(\+|%20)try$/);

    await getLookups();
    expect(lastCall().url).toMatch(/\/lookups$/);
    await getLookups('');
    expect(lastCall().url).toMatch(/\/lookups$/);
  });

  it('sends the signed-in user token', async () => {
    fetchMock.mockImplementation(() => respond({ success: true, lookups: [] }));

    await getLookups();

    expect(lastCall().headers.Authorization).toBe('Bearer jwt-token');
  });

  it('creates a lookup with the entered values and returns the saved one', async () => {
    fetchMock.mockImplementation(() => respond({ success: true, lookup }));

    await expect(createLookup(input)).resolves.toEqual(lookup);
    expect(lastCall().method).toBe('POST');
    expect(JSON.parse(String(lastCall().body))).toEqual(input);
  });

  it('updates a lookup by its encoded id', async () => {
    fetchMock.mockImplementation(() => respond({ success: true, lookup }));

    await updateLookup('l/1', input);

    expect(lastCall().url).toMatch(/\/lookups\/l%2F1$/);
    expect(lastCall().method).toBe('PUT');
  });

  it('deletes a lookup by its encoded id', async () => {
    fetchMock.mockImplementation(() => respond({ success: true }));

    await expect(deleteLookup('l/1')).resolves.toBeUndefined();

    expect(lastCall().url).toMatch(/\/lookups\/l%2F1$/);
    expect(lastCall().method).toBe('DELETE');
  });

  it.each([
    ['the server message', { success: false, message: 'Lookup name already exists' }, 409, 'Lookup name already exists'],
    ['the first validation error', { errors: [{ msg: 'Name is required' }] }, 400, 'Name is required'],
    ['a status message', {}, 500, 'Request failed (500)'],
  ])('surfaces %s when saving fails', async (_label, body, status, message) => {
    fetchMock.mockImplementation(() => respond(body, status));

    await expect(createLookup(input)).rejects.toThrow(message);
  });
});
