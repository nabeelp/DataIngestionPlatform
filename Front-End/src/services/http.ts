import { apiConfig } from '../config/api';

/** Error thrown for every failed backend call; `status` is the HTTP status (200 for `success: false` bodies). */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export type QueryParams = Record<string, string | number | boolean | null | undefined>;

export interface RequestOptions {
  method?: string;
  /** JSON-serialised unless it is a FormData (sent as multipart; the browser adds the boundary). */
  body?: unknown;
  /** Appended as a query string; undefined, null and empty values are skipped. */
  query?: QueryParams;
  signal?: AbortSignal;
  /** Set to false for unauthenticated endpoints (login, SSO) so no Authorization header is sent. */
  auth?: boolean;
  /** Message used when the server provides neither a `message` nor a validation error. */
  fallbackMessage?: string;
}

export interface DownloadOptions {
  query?: QueryParams;
  signal?: AbortSignal;
  fallbackFilename: string;
  /** Message used when the failure response carries no readable server message. */
  failureMessage?: string | ((status: number) => string);
}

export interface DownloadedFile {
  blob: Blob;
  filename: string;
}

/** The bearer header for the stored session, or no headers when signed out. */
export const authHeaders = (): Record<string, string> => {
  const token = localStorage.getItem('token');
  return token ? { Authorization: 'Bearer ' + token } : {};
};

export const buildQueryString = (query?: QueryParams): string => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') params.append(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
};

export const apiUrl = (path: string, query?: QueryParams): string =>
  `${apiConfig.getBaseUrl()}${path}${buildQueryString(query)}`;

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};

const readBody = async (response: Response): Promise<Record<string, unknown>> =>
  asRecord(await response.json().catch(() => ({})));

const serverMessage = (data: Record<string, unknown>): string | undefined => {
  if (typeof data.message === 'string' && data.message) return data.message;
  const firstError = Array.isArray(data.errors) ? asRecord(data.errors[0]).msg : undefined;
  return typeof firstError === 'string' && firstError ? firstError : undefined;
};

/**
 * JSON request helper for the backend API. Adds the bearer token and surfaces the server's
 * error message (or the first validation error) when the request fails.
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, auth = true } = options;
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const headers: Record<string, string> = auth ? authHeaders() : {};
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';

  const response = await fetch(apiUrl(path, options.query), {
    method: options.method || 'GET',
    headers,
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    signal: options.signal,
  });

  const data = await readBody(response);
  if (!response.ok || data.success === false) {
    throw new ApiError(
      serverMessage(data) || options.fallbackMessage || `Request failed (${response.status})`,
      response.status,
    );
  }
  return data as T;
}

/** Filename from a Content-Disposition header (handles `filename*=UTF-8''…`, quoted and bare values). */
export const parseContentDisposition = (header: string | null): string | null => {
  if (!header) return null;
  const encoded = header.match(/filename\*\s*=\s*(?:[\w-]+'[^']*')?([^;\n]+)/i)?.[1]?.trim();
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  }
  const plain = header.match(/filename\s*=\s*(?:"([^"]*)"|([^;\n]*))/i);
  return (plain?.[1] ?? plain?.[2])?.trim() || null;
};

/** Authenticated binary download; failures surface the server's JSON message when there is one. */
export async function apiDownload(path: string, options: DownloadOptions): Promise<DownloadedFile> {
  const response = await fetch(apiUrl(path, options.query), {
    method: 'GET',
    headers: authHeaders(),
    signal: options.signal,
  });

  if (!response.ok) {
    const { failureMessage = status => `Download failed (HTTP ${status})` } = options;
    const fallback = typeof failureMessage === 'function' ? failureMessage(response.status) : failureMessage;
    throw new ApiError(serverMessage(await readBody(response)) || fallback, response.status);
  }

  return {
    blob: await response.blob(),
    filename: parseContentDisposition(response.headers.get('Content-Disposition')) ?? options.fallbackFilename,
  };
}
