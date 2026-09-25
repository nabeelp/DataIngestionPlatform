import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from './http';

const storage = new Map<string, string>();

beforeEach(() => {
  storage.clear();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const mockFetch = (status: number, body: unknown) => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

describe('apiRequest', () => {
  it('sends JSON with the bearer token', async () => {
    storage.set('token', 'abc');
    const fetchMock = mockFetch(200, { success: true, value: 1 });

    const result = await apiRequest<{ value: number }>('/things', { method: 'POST', body: { a: 1 } });

    expect(result.value).toBe(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/things');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer abc');
    expect(init.body).toBe(JSON.stringify({ a: 1 }));
  });

  it('surfaces the server message on failure', async () => {
    mockFetch(409, { success: false, message: 'A lookup with this name already exists' });
    await expect(apiRequest('/lookups')).rejects.toThrow('A lookup with this name already exists');
  });

  it('falls back to the first validation error', async () => {
    mockFetch(400, { errors: [{ msg: 'Name is required' }] });
    await expect(apiRequest('/lookups')).rejects.toThrow('Name is required');
  });

  it('treats success:false with 200 as an error', async () => {
    mockFetch(200, { success: false, message: 'Nope' });
    await expect(apiRequest('/x')).rejects.toThrow('Nope');
  });
});
