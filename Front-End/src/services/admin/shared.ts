import { apiConfig } from '../../config/api';

export const getBaseUrl = () => apiConfig.getBaseUrl();

// Get auth token from localStorage
export const getAuthToken = (): string | null => {
  return localStorage.getItem('token');
};

// Common fetch options
export const getFetchOptions = (method: string, body?: any): RequestInit => {
  const token = getAuthToken();
  const options: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  };
  if (body) {
    options.body = JSON.stringify(body);
  }
  return options;
};
