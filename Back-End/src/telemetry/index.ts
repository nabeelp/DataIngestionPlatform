import dotenv from 'dotenv';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { shutdownAzureMonitor, useAzureMonitor } from '@azure/monitor-opentelemetry';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { ExpressInstrumentation, ExpressLayerType } from '@opentelemetry/instrumentation-express';
import { TediousInstrumentation } from '@opentelemetry/instrumentation-tedious';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import { telemetryLogProcessor, telemetrySpanProcessor } from './privacy';

dotenv.config();

let enabled = false;
let shutdownPromise: Promise<void> | undefined;
let unregisterInstrumentations: (() => void) | undefined;

export function initializeTelemetry(): void {
    if (enabled) return;
    const connectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING?.trim();
    if (!connectionString) {
        process.stderr.write('[TELEMETRY] Application Insights disabled: connection string is not configured.\n');
        return;
    }

    const samplingValue = process.env.APPLICATIONINSIGHTS_SAMPLING_RATIO ?? '1';
    const samplingRatio = Number(samplingValue);
    if (!samplingValue.trim() || !Number.isFinite(samplingRatio) || samplingRatio < 0 || samplingRatio > 1) {
        throw new Error('APPLICATIONINSIGHTS_SAMPLING_RATIO must be a number between 0 and 1.');
    }

    try {
        useAzureMonitor({
            azureMonitorExporterOptions: { connectionString },
            resource: resourceFromAttributes({
                'service.name': process.env.OTEL_SERVICE_NAME || 'data-ingestion-api',
            }),
            samplingRatio,
            tracesPerSecond: 0,
            enableLiveMetrics: false,
            instrumentationOptions: {
                azureSdk: { enabled: true },
                http: { enabled: true },
                winston: { enabled: true },
                console: { enabled: false },
                mongoDb: { enabled: false },
                mySql: { enabled: false },
                postgreSql: { enabled: false },
                redis: { enabled: false },
                redis4: { enabled: false },
            },
            spanProcessors: [telemetrySpanProcessor],
            logRecordProcessors: [telemetryLogProcessor],
        });
        unregisterInstrumentations = registerInstrumentations({
            instrumentations: [
                new ExpressInstrumentation({ ignoreLayersType: [ExpressLayerType.MIDDLEWARE] }),
                new TediousInstrumentation(),
                new UndiciInstrumentation(),
            ],
        });
    } catch {
        // SDK errors can include the connection string; keep startup diagnostics safe.
        process.stderr.write('[TELEMETRY] Application Insights initialization failed.\n');
        throw new Error('Application Insights initialization failed; verify telemetry configuration.');
    }
    enabled = true;
    process.stderr.write('[TELEMETRY] Application Insights enabled.\n');
}

export async function shutdownTelemetry(): Promise<void> {
    if (!enabled) return;
    if (!shutdownPromise) {
        unregisterInstrumentations?.();
        shutdownPromise = new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Application Insights shutdown timed out.')), 5000);
            Promise.resolve().then(shutdownAzureMonitor).then(resolve, () => {
                reject(new Error('Application Insights shutdown failed.'));
            }).finally(() => clearTimeout(timer));
        });
    }
    await shutdownPromise;
}

initializeTelemetry();
