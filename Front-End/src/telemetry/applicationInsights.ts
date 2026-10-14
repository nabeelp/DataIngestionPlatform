import { ApplicationInsights, DistributedTracingModes } from '@microsoft/applicationinsights-web';
import { apiConfig } from '../config/api';

/** Browser sampling defaults to 100%; the SDK accepts percentages in the range (0, 100]. */
export const DEFAULT_SAMPLING_PERCENTAGE = 100;
const APP_ROLE_NAME = 'data-ingestion-web';

const staticRoutes = new Set([
  '/',
  '/login',
  '/auth/callback',
  '/upload',
  '/history',
  '/definitions',
  '/lookups',
  '/admin',
  '/admin/my-dashboard',
  '/admin/upload',
  '/admin/definitions',
  '/admin/users',
  '/admin/file-definitions',
  '/admin/audit-logs',
  '/admin/monitoring',
  '/admin/compliance',
  '/admin/history',
  '/admin/lookups',
]);

type BrowserExceptionKind = 'window-error' | 'unhandled-rejection' | 'react-render';
export interface TelemetryEnvelope {
  baseType?: string;
  baseData?: unknown;
  data?: unknown;
  tags?: Record<string, string>;
  ext?: unknown;
}

let telemetryClient: ApplicationInsights | null = null;
let initializationAttempted = false;
let exceptionListenersInstalled = false;

export function normalizeTelemetryRoute(pathname: string): string {
  const normalizedPath = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (staticRoutes.has(normalizedPath)) {
    return normalizedPath;
  }

  if (/^\/(?:admin\/)?history\/[^/]+$/.test(normalizedPath)) {
    return normalizedPath.startsWith('/admin/') ? '/admin/history/:id' : '/history/:id';
  }

  if (normalizedPath === '/admin/file-definitions/new') {
    return normalizedPath;
  }

  const definitionWorkspaceRoute = normalizedPath.match(/^\/admin\/file-definitions\/[^/]+\/(edit|rules|versions)$/);
  if (definitionWorkspaceRoute) {
    return `/admin/file-definitions/:id/${definitionWorkspaceRoute[1]}`;
  }

  return '/unknown';
}

function getApiOrigin(): string | undefined {
  try {
    return new URL(apiConfig.getBaseUrl(), window.location.origin).origin;
  } catch {
    return undefined;
  }
}

export function sanitizeTelemetryEnvelope(envelope: TelemetryEnvelope, apiOrigin: string): boolean {
  if (!envelope.baseData || typeof envelope.baseData !== 'object') {
    return false;
  }

  envelope.data = {};
  const baseData = envelope.baseData as Record<string, unknown>;
  const safeRoute = normalizeTelemetryRoute(window.location.pathname);
  const sourceTags = envelope.tags ?? {};
  envelope.tags = {};
  for (const tagName of ['ai.operation.id', 'ai.operation.parentId']) {
    const value = sourceTags[tagName];
    if (value) {
      envelope.tags[tagName] = value;
    }
  }
  envelope.tags['ai.cloud.role'] = APP_ROLE_NAME;
  envelope.tags['ai.operation.name'] = safeRoute;
  envelope.ext = {};

  if (envelope.baseType === 'PageviewData') {
    for (const key of Object.keys(baseData)) {
      if (key !== 'ver' && key !== 'duration') {
        delete baseData[key];
      }
    }
    const route = safeRoute;
    baseData.name = route;
    baseData.uri = `${window.location.origin}${route}`;
    baseData.properties = {};
    return true;
  }

  if (envelope.baseType === 'RemoteDependencyData') {
    const rawUrl = typeof baseData.data === 'string' ? baseData.data : '';
    let dependencyOrigin: string;
    try {
      dependencyOrigin = new URL(rawUrl, window.location.origin).origin;
    } catch {
      return false;
    }

    if (dependencyOrigin !== apiOrigin) {
      return false;
    }

    for (const key of Object.keys(baseData)) {
      if (!['ver', 'id', 'duration', 'success', 'resultCode'].includes(key)) {
        delete baseData[key];
      }
    }
    baseData.name = 'API request';
    baseData.data = apiOrigin;
    baseData.target = apiOrigin;
    baseData.type = 'API';
    baseData.properties = {};
    return true;
  }

  if (envelope.baseType === 'ExceptionData') {
    const exceptionProperties = baseData.properties;
    const kind = exceptionProperties && typeof exceptionProperties === 'object'
      ? (exceptionProperties as Record<string, unknown>).kind
      : undefined;
    for (const key of Object.keys(baseData)) {
      if (key !== 'ver') {
        delete baseData[key];
      }
    }
    baseData.ver = 2;
    baseData.exceptions = [{
      id: 0,
      outerId: 0,
      typeName: 'BrowserError',
      message: 'Browser error',
      hasFullStack: false,
      stack: '',
      parsedStack: [],
    }];
    baseData.properties = {
      kind: kind === 'window-error' || kind === 'unhandled-rejection' || kind === 'react-render'
        ? kind
        : 'browser-error',
    };
    return true;
  }

  return false;
}

function installExceptionListeners(): void {
  if (exceptionListenersInstalled) {
    return;
  }
  exceptionListenersInstalled = true;
  window.addEventListener('error', () => trackBrowserException('window-error'));
  window.addEventListener('unhandledrejection', () => trackBrowserException('unhandled-rejection'));
}

export function initializeTelemetry(): ApplicationInsights | null {
  if (initializationAttempted) {
    return telemetryClient;
  }
  initializationAttempted = true;

  const connectionString = window.__APP_CONFIG__?.applicationInsightsConnectionString;
  if (!connectionString) {
    return null;
  }

  try {
    const samplingPercentage = window.__APP_CONFIG__?.applicationInsightsSamplingPercentage
      ?? DEFAULT_SAMPLING_PERCENTAGE;
    if (!Number.isFinite(samplingPercentage) || samplingPercentage <= 0 || samplingPercentage > 100) {
      throw new Error('Invalid browser sampling percentage');
    }
    const apiOrigin = getApiOrigin();
    if (!apiOrigin) {
      throw new Error('Invalid API origin');
    }
    // The SDK escapes dots in configured domains and treats "*" as a wildcard.
    const correlationDomain = `^${new URL(apiOrigin).host}$`;
    const appInsights = new ApplicationInsights({
      config: {
        connectionString,
        disableExceptionTracking: true,
        enableAutoRouteTracking: false,
        enableCorsCorrelation: true,
        distributedTracingMode: DistributedTracingModes.W3C,
        correlationHeaderDomains: [correlationDomain],
        enableRequestHeaderTracking: false,
        enableResponseHeaderTracking: false,
        enableAjaxErrorStatusText: false,
        enableAjaxPerfTracking: false,
        samplingPercentage,
      },
    });
    appInsights.loadAppInsights();
    appInsights.addTelemetryInitializer((envelope) =>
      sanitizeTelemetryEnvelope(envelope, apiOrigin),
    );
    installExceptionListeners();
    telemetryClient = appInsights;
    return telemetryClient;
  } catch {
    console.warn('[Telemetry] Application Insights initialization failed; telemetry is disabled.');
    return null;
  }
}

export function trackRoutePageView(pathname: string): void {
  if (!telemetryClient) {
    return;
  }
  const route = normalizeTelemetryRoute(pathname);
  telemetryClient.trackPageView({
    name: route,
    uri: `${window.location.origin}${route}`,
  });
}

export function trackBrowserException(kind: BrowserExceptionKind): void {
  if (!telemetryClient) {
    return;
  }
  telemetryClient.trackException({
    exception: new Error('Browser error'),
    properties: { kind },
  });
}
