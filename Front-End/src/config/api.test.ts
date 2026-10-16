import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiConfig, resolveApiBaseUrl } from './api';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('apiConfig', () => {
  it('uses runtime API configuration and connects Socket.IO to the API origin', () => {
    vi.stubEnv('VITE_WS_URL', '');
    const runtimeApiUrl = 'https://api.example/api/v1/';
    vi.stubGlobal('window', {
      location: {
        origin: 'https://frontend.example',
        protocol: 'https:',
        host: 'frontend.example',
      },
      __APP_CONFIG__: {
        apiUrl: runtimeApiUrl,
      },
    });

    expect(resolveApiBaseUrl(undefined, runtimeApiUrl)).toBe('https://api.example/api/v1');
    expect(apiConfig.getBaseUrl()).toBe(
      resolveApiBaseUrl(import.meta.env.VITE_API_URL, runtimeApiUrl),
    );
    expect(apiConfig.getWebSocketUrl()).toBe(
      new URL(apiConfig.getBaseUrl(), window.location.origin).origin,
    );
  });

  it('uses the explicit WebSocket URL when configured', () => {
    vi.stubEnv('VITE_WS_URL', 'https://socket.example');
    vi.stubGlobal('window', {
      location: {
        origin: 'https://frontend.example',
        protocol: 'https:',
        host: 'frontend.example',
      },
    });

    expect(apiConfig.getWebSocketUrl()).toBe('https://socket.example');
  });
});
