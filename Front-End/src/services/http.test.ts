import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  apiDownload,
  apiRequest,
  apiUrl,
  authHeaders,
  buildQueryString,
  parseContentDisposition,
} from './http';

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

describe('authHeaders', () => {
  it('returns the bearer header only when signed in', () => {
    expect(authHeaders()).toEqual({});
    storage.set('token', 'abc');
    expect(authHeaders()).toEqual({ Authorization: 'Bearer abc' });
  });
});

describe('query strings', () => {
  it('skips undefined, null and empty values and encodes the rest', () => {
    expect(buildQueryString({ page: 2, search: 'a b&c', empty: '', none: undefined, nil: null, flag: false }))
      .toBe('?page=2&search=a+b%26c&flag=false');
    expect(buildQueryString({ search: '' })).toBe('');
    expect(buildQueryString()).toBe('');
  });

  it('is appended to the API URL', () => {
    expect(apiUrl('/uploads', { page: 1, status: undefined })).toBe('/api/v1/uploads?page=1');
  });
});

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
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.body).toBe(JSON.stringify({ a: 1 }));
  });

  it('builds the query string and forwards the abort signal', async () => {
    const fetchMock = mockFetch(200, { success: true });
    const controller = new AbortController();

    await apiRequest('/uploads', { query: { page: 3, pageSize: 20, status: undefined }, signal: controller.signal });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/uploads?page=3&pageSize=20');
    expect(init.method).toBe('GET');
    expect(init.signal).toBe(controller.signal);
    expect(init.headers).not.toHaveProperty('Content-Type');
  });

  it('sends FormData untouched so the browser sets the multipart boundary', async () => {
    storage.set('token', 'abc');
    const fetchMock = mockFetch(201, { success: true });
    const form = new FormData();
    form.append('file', new Blob(['x']), 'a.csv');

    await apiRequest('/uploads', { method: 'POST', body: form });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.body).toBe(form);
    expect(init.headers).not.toHaveProperty('Content-Type');
    expect(init.headers.Authorization).toBe('Bearer abc');
  });

  it('can skip the Authorization header for unauthenticated endpoints', async () => {
    storage.set('token', 'abc');
    const fetchMock = mockFetch(200, { success: true });

    await apiRequest('/auth/login', { method: 'POST', body: { Email: 'a' }, auth: false });

    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty('Authorization');
  });

  it('surfaces the server message on failure as an ApiError with the status', async () => {
    mockFetch(409, { success: false, message: 'A lookup with this name already exists' });
    const failure = await apiRequest('/lookups').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ message: 'A lookup with this name already exists', status: 409, name: 'ApiError' });
  });

  it('falls back to the first validation error', async () => {
    mockFetch(400, { errors: [{ msg: 'Name is required' }] });
    await expect(apiRequest('/lookups')).rejects.toThrow('Name is required');
  });

  it('falls back to the caller message, then to the status', async () => {
    mockFetch(500, {});
    await expect(apiRequest('/x', { fallbackMessage: 'Login failed' })).rejects.toThrow('Login failed');
    await expect(apiRequest('/x')).rejects.toThrow('Request failed (500)');
  });

  it('copes with a non-JSON error body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Bad gateway', { status: 502 })));
    await expect(apiRequest('/x')).rejects.toMatchObject({ message: 'Request failed (502)', status: 502 });
  });

  it('treats success:false with 200 as an error', async () => {
    mockFetch(200, { success: false, message: 'Nope' });
    await expect(apiRequest('/x')).rejects.toThrow('Nope');
  });
});

describe('parseContentDisposition', () => {
  it.each([
    ['attachment; filename="issues.csv"', 'issues.csv'],
    ['attachment; filename=plain.xlsx', 'plain.xlsx'],
    ["attachment; filename*=UTF-8''caf%C3%A9.csv", 'café.csv'],
    ['attachment; filename="a b.csv"; size=3', 'a b.csv'],
    ['attachment', null],
    [null, null],
  ])('reads %s', (header, expected) => {
    expect(parseContentDisposition(header)).toBe(expected);
  });
});

describe('apiDownload', () => {
  it('returns the blob and the server filename using the bearer token', async () => {
    storage.set('token', 'abc');
    const fetchMock = vi.fn().mockResolvedValue(new Response('data', {
      headers: { 'Content-Disposition': 'attachment; filename="report.csv"' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const file = await apiDownload('/uploads/1/report', { fallbackFilename: 'fallback.csv', query: { v: 1 } });

    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/uploads/1/report?v=1');
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ Authorization: 'Bearer abc' });
    expect(file.filename).toBe('report.csv');
    expect(await file.blob.text()).toBe('data');
  });

  it('uses the fallback filename when the header is missing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('data')));
    expect((await apiDownload('/f', { fallbackFilename: 'fallback.csv' })).filename).toBe('fallback.csv');
  });

  it('throws an ApiError with the JSON message of a failed download', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'Report unavailable' }), {
      status: 404, headers: { 'Content-Type': 'application/json' },
    })));
    await expect(apiDownload('/f', { fallbackFilename: 'x' })).rejects.toMatchObject({
      message: 'Report unavailable', status: 404,
    });
  });

  it('builds a readable message when the failure body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Gateway</html>', { status: 502 })));
    await expect(apiDownload('/f', { fallbackFilename: 'x' })).rejects.toThrow('Download failed (HTTP 502)');
    await expect(apiDownload('/f', { fallbackFilename: 'x', failureMessage: 'Custom failure' })).rejects.toThrow('Custom failure');
    await expect(apiDownload('/f', { fallbackFilename: 'x', failureMessage: status => `Failed (HTTP ${status})` }))
      .rejects.toThrow('Failed (HTTP 502)');
  });
});
