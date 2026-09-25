import { apiConfig } from '../config/api';

/**
 * JSON request helper for the backend API. Adds the bearer token and surfaces the server's
 * error message (or the first validation error) when the request fails.
 */
export async function apiRequest<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = localStorage.getItem('token');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) {
    headers.Authorization = 'Bearer ' + token;
  }

  const response = await fetch(`${apiConfig.getBaseUrl()}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    const firstError = Array.isArray(data.errors) ? data.errors[0]?.msg : undefined;
    throw new Error(data.message || firstError || `Request failed (${response.status})`);
  }
  return data as T;
}
