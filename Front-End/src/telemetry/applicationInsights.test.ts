import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TelemetryEnvelope } from './applicationInsights';

const sdk = vi.hoisted(() => ({
  options: undefined as unknown,
  initializer: undefined as ((item: TelemetryEnvelope) => boolean) | undefined,
  emitted: [] as TelemetryEnvelope[],
  loadAppInsights: vi.fn(),
  addTelemetryInitializer: vi.fn((initializer: (item: TelemetryEnvelope) => boolean) => {
    sdk.initializer = initializer;
  }),
  trackPageView: vi.fn((pageView: { name: string; uri: string }) => {
    const envelope: TelemetryEnvelope = {
      baseType: 'PageviewData',
      baseData: {
        ...pageView,
        refUri: 'https://referrer.example/?authCode=private',
        properties: { uploadName: 'private-file.csv' },
      },
      tags: { 'ai.user.id': 'private-user' },
    };
    if (sdk.initializer?.(envelope)) {
      sdk.emitted.push(envelope);
    }
  }),
  trackException: vi.fn((details: { exception: Error; properties: Record<string, string> }) => {
    const envelope: TelemetryEnvelope = {
      baseType: 'ExceptionData',
      baseData: {
        exceptions: [{ message: details.exception.message, stack: details.exception.stack }],
        properties: details.properties,
      },
    };
    if (sdk.initializer?.(envelope)) {
      sdk.emitted.push(envelope);
    }
  }),
}));

vi.mock('@microsoft/applicationinsights-web', () => ({
  DistributedTracingModes: { W3C: 2 },
  ApplicationInsights: vi.fn().mockImplementation((options: unknown) => {
    sdk.options = options;
    return {
      loadAppInsights: sdk.loadAppInsights,
      addTelemetryInitializer: sdk.addTelemetryInitializer,
      trackPageView: sdk.trackPageView,
      trackException: sdk.trackException,
    };
  }),
}));

const defaultLocation = {
  origin: 'https://web.example',
  pathname: '/history/123',
  search: '?code=secret',
  hash: '#sensitive-fragment',
};

describe('Application Insights telemetry', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    sdk.initializer = undefined;
    sdk.options = undefined;
    sdk.emitted.length = 0;
    vi.stubGlobal('window', {
      location: { ...defaultLocation, protocol: 'https:', host: 'web.example' },
      __APP_CONFIG__: { apiUrl: 'https://api.example/api/v1' },
      addEventListener: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('does not initialize without a connection string and remains safe on repeat calls', async () => {
    const telemetry = await import('./applicationInsights');

    expect(telemetry.initializeTelemetry()).toBeNull();
    expect(telemetry.initializeTelemetry()).toBeNull();
    expect(sdk.loadAppInsights).not.toHaveBeenCalled();
  });

  it('initializes once with a bounded sample rate and tracks normalized SPA routes', async () => {
    window.__APP_CONFIG__ = {
      apiUrl: 'https://api.example/api/v1',
      applicationInsightsConnectionString: 'InstrumentationKey=public-key',
      applicationInsightsSamplingPercentage: 25,
    };
    const telemetry = await import('./applicationInsights');

    expect(telemetry.initializeTelemetry()).not.toBeNull();
    expect(telemetry.initializeTelemetry()).not.toBeNull();
    expect(sdk.loadAppInsights).toHaveBeenCalledOnce();
    expect(sdk.options).toMatchObject({
      config: {
        connectionString: 'InstrumentationKey=public-key',
        samplingPercentage: 25,
        disableExceptionTracking: true,
        enableAutoRouteTracking: false,
        enableCorsCorrelation: true,
        distributedTracingMode: 2,
        correlationHeaderDomains: ['^api.example$'],
        enableRequestHeaderTracking: false,
        enableResponseHeaderTracking: false,
      },
    });

    telemetry.trackRoutePageView('/history/secret-upload-id');
    telemetry.trackRoutePageView('/admin/rules');
    expect(sdk.trackPageView).toHaveBeenNthCalledWith(1, {
      name: '/history/:id',
      uri: 'https://web.example/history/:id',
    });
    expect(sdk.trackPageView).toHaveBeenNthCalledWith(2, {
      name: '/admin/rules',
      uri: 'https://web.example/admin/rules',
    });
    expect(JSON.stringify(sdk.trackPageView.mock.calls)).not.toContain('secret-upload-id');
    expect(JSON.stringify(sdk.trackPageView.mock.calls)).not.toContain('code=secret');

    telemetry.trackBrowserException('unhandled-rejection');
    expect(sdk.emitted).toHaveLength(3);
    expect(JSON.stringify(sdk.emitted)).not.toContain('secret-upload-id');
    expect(JSON.stringify(sdk.emitted)).not.toContain('authCode');
    expect(JSON.stringify(sdk.emitted)).not.toContain('private-file.csv');
    expect(JSON.stringify(sdk.emitted)).not.toContain('private-user');
    expect(JSON.stringify(sdk.emitted)).not.toContain('code=secret');
    expect(sdk.emitted[0]).toMatchObject({
      baseData: {
        name: '/history/:id',
        uri: 'https://web.example/history/:id',
        properties: {},
      },
    });
    expect(sdk.emitted[2]).toMatchObject({
      baseData: {
        exceptions: [{
          typeName: 'BrowserError',
          message: 'Browser error',
          stack: '',
          hasFullStack: false,
        }],
        properties: { kind: 'unhandled-rejection' },
      },
    });
    expect(window.__APP_CONFIG__?.apiUrl).toBe('https://api.example/api/v1');
  });

  it('defaults configured telemetry to 100 percent sampling', async () => {
    window.__APP_CONFIG__ = {
      apiUrl: 'https://api.example/api/v1',
      applicationInsightsConnectionString: 'InstrumentationKey=public-key',
    };
    const { DEFAULT_SAMPLING_PERCENTAGE, initializeTelemetry } =
      await import('./applicationInsights');

    initializeTelemetry();
    expect(DEFAULT_SAMPLING_PERCENTAGE).toBe(100);
    expect(sdk.options).toMatchObject({
      config: { samplingPercentage: 100 },
    });
  });

  it.each([0, 100.01, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid runtime sampling percentage %s',
    async (samplingPercentage) => {
      window.__APP_CONFIG__ = {
        apiUrl: 'https://api.example/api/v1',
        applicationInsightsConnectionString: 'InstrumentationKey=public-key',
        applicationInsightsSamplingPercentage: samplingPercentage,
      };
      const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const { initializeTelemetry } = await import('./applicationInsights');

      expect(initializeTelemetry()).toBeNull();
      expect(sdk.loadAppInsights).not.toHaveBeenCalled();
      expect(warning).toHaveBeenCalledWith(
        '[Telemetry] Application Insights initialization failed; telemetry is disabled.',
      );
      warning.mockRestore();
    },
  );

  it('normalizes known dynamic routes and drops unknown path content', async () => {
    const { normalizeTelemetryRoute } = await import('./applicationInsights');

    expect(normalizeTelemetryRoute('/admin/history/private-id/')).toBe('/admin/history/:id');
    expect(normalizeTelemetryRoute('/admin/file-definitions/new')).toBe('/admin/file-definitions/new');
    expect(normalizeTelemetryRoute('/admin/file-definitions/private-id/edit')).toBe('/admin/file-definitions/:id/edit');
    expect(normalizeTelemetryRoute('/admin/file-definitions/private-id/versions')).toBe('/admin/file-definitions/:id/versions');
    expect(normalizeTelemetryRoute('/users/alice@example.com')).toBe('/unknown');
    expect(normalizeTelemetryRoute('/auth/callback')).toBe('/auth/callback');
  });

  it('keeps only API-origin dependency correlation and removes URLs, query strings and properties', async () => {
    const { sanitizeTelemetryEnvelope } = await import('./applicationInsights');
    const envelope: TelemetryEnvelope = {
      baseType: 'RemoteDependencyData',
      baseData: {
        name: 'GET https://api.example/api/v1/uploads/private-id?token=secret',
        data: 'https://api.example/api/v1/uploads/private-id?token=secret',
        target: 'api.example',
        properties: { authorization: 'Bearer secret', body: 'private payload' },
      },
      data: { headers: 'private headers' },
      tags: {
        'ai.user.id': 'private-user',
        'ai.operation.name': '/history/private-id?code=secret',
      },
      ext: { user: { id: 'private-user', authId: 'private-auth-id' } },
    };

    expect(sanitizeTelemetryEnvelope(envelope, 'https://api.example')).toBe(true);
    expect(JSON.stringify(envelope)).not.toContain('private-id');
    expect(JSON.stringify(envelope)).not.toContain('secret');
    expect(JSON.stringify(envelope)).not.toContain('private payload');
    expect(JSON.stringify(envelope)).not.toContain('private-auth-id');
    expect(envelope.baseData).toMatchObject({
      name: 'API request',
      data: 'https://api.example',
      target: 'https://api.example',
      properties: {},
    });
    expect(envelope.tags).toMatchObject({
      'ai.cloud.role': 'data-ingestion-web',
      'ai.operation.name': '/history/:id',
    });
    expect(envelope.tags).not.toHaveProperty('ai.user.id');
  });

  it('sanitizes page views to a known route without query, hash, referrer or custom properties', async () => {
    const { sanitizeTelemetryEnvelope } = await import('./applicationInsights');
    const pageView: TelemetryEnvelope = {
      baseType: 'PageviewData',
      baseData: {
        name: 'private route',
        uri: 'https://web.example/history/123?code=secret#private',
        refUri: 'https://referrer.example/path?token=secret',
        properties: { uploadName: 'private-file.csv' },
      },
      data: { accessToken: 'secret' },
    };

    expect(sanitizeTelemetryEnvelope(pageView, 'https://api.example')).toBe(true);
    expect(JSON.stringify(pageView)).not.toContain('secret');
    expect(JSON.stringify(pageView)).not.toContain('private');
    expect(pageView.baseData).toMatchObject({
      name: '/history/:id',
      uri: 'https://web.example/history/:id',
      properties: {},
    });
    expect(pageView.tags).toMatchObject({
      'ai.cloud.role': 'data-ingestion-web',
      'ai.operation.name': '/history/:id',
    });
  });

  it('drops non-API dependencies and sanitizes exception details to a generic diagnostic', async () => {
    const { sanitizeTelemetryEnvelope } = await import('./applicationInsights');
    const externalDependency: TelemetryEnvelope = {
      baseType: 'RemoteDependencyData',
      baseData: { data: 'https://third-party.example/path?token=secret' },
    };
    expect(sanitizeTelemetryEnvelope(externalDependency, 'https://api.example')).toBe(false);

    const exception: TelemetryEnvelope = {
      baseType: 'ExceptionData',
      baseData: {
        exceptions: [{ message: 'secret auth code', stack: 'private stack' }],
        properties: { kind: 'unhandled-rejection', details: 'private payload' },
      },
    };
    expect(sanitizeTelemetryEnvelope(exception, 'https://api.example')).toBe(true);
    expect(JSON.stringify(exception)).not.toContain('secret');
    expect(JSON.stringify(exception)).not.toContain('private');
    expect(exception.baseData).toMatchObject({
      exceptions: [{
        typeName: 'BrowserError',
        message: 'Browser error',
        hasFullStack: false,
        stack: '',
        parsedStack: [],
      }],
      properties: { kind: 'unhandled-rejection' },
    });
  });

  it('surfaces SDK initialization failure with a sanitized warning', async () => {
    sdk.loadAppInsights.mockImplementationOnce(() => {
      throw new Error('sensitive endpoint detail');
    });
    window.__APP_CONFIG__ = {
      apiUrl: 'https://api.example/api/v1',
      applicationInsightsConnectionString: 'InstrumentationKey=public-key',
    };
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { initializeTelemetry } = await import('./applicationInsights');

    expect(initializeTelemetry()).toBeNull();
    expect(warning).toHaveBeenCalledWith(
      '[Telemetry] Application Insights initialization failed; telemetry is disabled.',
    );
    expect(warning.mock.calls.flat().join(' ')).not.toContain('sensitive endpoint detail');
    warning.mockRestore();
  });
});
