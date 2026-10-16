import type { AzureMonitorOpenTelemetryOptions } from '@azure/monitor-opentelemetry';
import { readFileSync } from 'fs';
import path from 'path';

const useAzureMonitor = jest.fn<void, [AzureMonitorOpenTelemetryOptions]>();
const shutdownAzureMonitor = jest.fn<Promise<void>, []>();
jest.mock('@azure/monitor-opentelemetry', () => ({
    useAzureMonitor: (options: AzureMonitorOpenTelemetryOptions) => useAzureMonitor(options),
    shutdownAzureMonitor: () => shutdownAzureMonitor(),
}));
jest.mock('dotenv', () => ({ config: jest.fn() }));
const unregisterInstrumentations = jest.fn();
const registerInstrumentations = jest.fn(() => unregisterInstrumentations);
jest.mock('@opentelemetry/instrumentation', () => ({
    registerInstrumentations: () => registerInstrumentations(),
}));
jest.mock('@opentelemetry/instrumentation-express', () => ({
    ExpressInstrumentation: jest.fn(),
    ExpressLayerType: { MIDDLEWARE: 'middleware' },
}));
jest.mock('@opentelemetry/instrumentation-tedious', () => ({ TediousInstrumentation: jest.fn() }));
jest.mock('@opentelemetry/instrumentation-undici', () => ({ UndiciInstrumentation: jest.fn() }));

describe('Application Insights initialization', () => {
    const originalEnv = process.env;
    let diagnostic: jest.SpyInstance;

    beforeEach(() => {
        jest.resetModules();
        process.env = { ...originalEnv };
        delete process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
        delete process.env.APPLICATIONINSIGHTS_SAMPLING_RATIO;
        delete process.env.OTEL_SERVICE_NAME;
        useAzureMonitor.mockReset();
        shutdownAzureMonitor.mockReset().mockResolvedValue(undefined);
        registerInstrumentations.mockClear();
        unregisterInstrumentations.mockClear();
        diagnostic = jest.spyOn(process.stderr, 'write').mockReturnValue(true);
    });

    afterEach(() => {
        diagnostic.mockRestore();
        process.env = originalEnv;
        jest.useRealTimers();
    });

    const load = (): typeof import('../src/telemetry') => require('../src/telemetry');

    it('keeps local operation disabled without a connection string', async () => {
        const telemetry = load();
        await telemetry.shutdownTelemetry();
        expect(useAzureMonitor).not.toHaveBeenCalled();
        expect(shutdownAzureMonitor).not.toHaveBeenCalled();
        expect(diagnostic).toHaveBeenCalledWith(expect.stringContaining('disabled'));
    });

    it('initializes once with service identity, privacy processors and Winston export', () => {
        process.env.APPLICATIONINSIGHTS_CONNECTION_STRING = 'test-connection-string';
        process.env.OTEL_SERVICE_NAME = 'custom-api';
        process.env.APPLICATIONINSIGHTS_SAMPLING_RATIO = '0.25';
        const telemetry = load();
        telemetry.initializeTelemetry();
        expect(useAzureMonitor).toHaveBeenCalledTimes(1);
        expect(registerInstrumentations).toHaveBeenCalledTimes(1);
        const options = useAzureMonitor.mock.calls[0][0];
        expect(options.resource?.attributes['service.name']).toBe('custom-api');
        expect(options.samplingRatio).toBe(0.25);
        expect(options.tracesPerSecond).toBe(0);
        expect(options.instrumentationOptions?.winston?.enabled).toBe(true);
        expect(options.spanProcessors).toHaveLength(1);
        expect(options.logRecordProcessors).toHaveLength(1);
        expect(JSON.stringify(diagnostic.mock.calls)).not.toContain('test-connection-string');
    });

    it.each(['', ' ', '-1', '1.1', 'NaN', 'Infinity', 'garbage'])('rejects invalid sampling ratio %s', ratio => {
        process.env.APPLICATIONINSIGHTS_CONNECTION_STRING = 'configured';
        process.env.APPLICATIONINSIGHTS_SAMPLING_RATIO = ratio;
        expect(load).toThrow('APPLICATIONINSIGHTS_SAMPLING_RATIO');
        expect(useAzureMonitor).not.toHaveBeenCalled();
    });

    it('surfaces SDK initialization failure without leaking its configuration', () => {
        process.env.APPLICATIONINSIGHTS_CONNECTION_STRING = 'private-test-value';
        useAzureMonitor.mockImplementation(() => { throw new Error('private-test-value'); });
        expect(load).toThrow('Application Insights initialization failed');
        expect(JSON.stringify(diagnostic.mock.calls)).not.toContain('private-test-value');
    });

    it('flushes once across repeated shutdown requests', async () => {
        process.env.APPLICATIONINSIGHTS_CONNECTION_STRING = 'configured';
        const telemetry = load();
        await Promise.all([telemetry.shutdownTelemetry(), telemetry.shutdownTelemetry()]);
        expect(shutdownAzureMonitor).toHaveBeenCalledTimes(1);
        expect(unregisterInstrumentations).toHaveBeenCalledTimes(1);
    });

    it('reports SDK shutdown failures', async () => {
        process.env.APPLICATIONINSIGHTS_CONNECTION_STRING = 'configured';
        const telemetry = load();
        shutdownAzureMonitor.mockRejectedValue(new Error('private exporter detail'));
        await expect(telemetry.shutdownTelemetry()).rejects.toThrow('Application Insights shutdown failed.');
    });

    it('sanitizes synchronous SDK shutdown failures too', async () => {
        process.env.APPLICATIONINSIGHTS_CONNECTION_STRING = 'configured';
        const telemetry = load();
        shutdownAzureMonitor.mockImplementation(() => { throw new Error('private exporter detail'); });
        await expect(telemetry.shutdownTelemetry()).rejects.toThrow('Application Insights shutdown failed.');
    });

    it('bounds exporter shutdown time', async () => {
        process.env.APPLICATIONINSIGHTS_CONNECTION_STRING = 'configured';
        const telemetry = load();
        jest.useFakeTimers();
        shutdownAzureMonitor.mockReturnValue(new Promise<void>(() => undefined));
        const shutdown = telemetry.shutdownTelemetry();
        const assertion = expect(shutdown).rejects.toThrow('Application Insights shutdown timed out.');
        await jest.advanceTimersByTimeAsync(5000);
        await assertion;
    });

    it('initializes before application imports for npm start, dev and container entrypoints', () => {
        const entrypoint = readFileSync(path.join(__dirname, '../src/index.ts'), 'utf8');
        expect(entrypoint.indexOf("from './telemetry'")).toBeLessThan(entrypoint.indexOf("from 'express'"));
        expect(entrypoint.indexOf("from './telemetry'")).toBeLessThan(entrypoint.indexOf("from './utils/logger'"));
    });
});
