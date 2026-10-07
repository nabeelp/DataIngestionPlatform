import { spawn } from 'child_process';
import path from 'path';

interface Envelope {
    tags?: Record<string, string>;
    data?: { baseType?: string; baseData?: { name?: string; message?: string; success?: boolean } };
}

it('exports real HTTP requests, dependencies, exceptions and Winston logs through an in-process ingestion sink', async () => {
    const envelopes: Envelope[] = [];
    const script = `
        const sdk = require('@azure/monitor-opentelemetry');
        const { createHttpHeaders } = require('@azure/core-rest-pipeline');
        const { gunzipSync } = require('zlib');
        const originalInitialize = sdk.useAzureMonitor;
        sdk.useAzureMonitor = options => {
            originalInitialize({
                ...options,
                azureMonitorExporterOptions: {
                    ...options.azureMonitorExporterOptions,
                    disableOfflineStorage: true,
                    httpClient: {
                        async sendRequest(request) {
                            const raw = request.body;
                            const decoded = request.headers.get('content-encoding') === 'gzip'
                                ? gunzipSync(raw).toString() : raw.toString();
                            const received = JSON.parse(decoded);
                            process.stdout.write('TELEMETRY_ENVELOPES=' + JSON.stringify(received) + '\\n');
                            return { request, status: 200, headers: createHttpHeaders(),
                                bodyAsText: JSON.stringify({
                                    itemsReceived: received.length, itemsAccepted: received.length, errors: []
                                })
                            };
                        }
                    }
                }
            });
        };
        const { shutdownTelemetry } = require('./src/telemetry');
        const express = require('express');
        const winston = require('winston');
        const { errorHandler } = require('./src/middleware/errorHandler');
        const app = express();
        const logger = winston.createLogger({ transports: [new winston.transports.Console()] });
        app.get('/test/:id', (req, res, next) => {
            logger.error('[RULE_CONTROLLER] sensitive-cell-value');
            next(new Error('sensitive-cell-value'));
        });
        app.use(errorHandler);
        const server = app.listen(0, '127.0.0.1', async () => {
            const response = await fetch('http://127.0.0.1:' + server.address().port + '/test/private-upload-id?token=secret');
            await response.text();
            server.close();
            await shutdownTelemetry();
            process.exit(0);
        });
    `;
    const child = spawn(process.execPath, ['-r', 'ts-node/register/transpile-only', '-e', script], {
        cwd: path.join(__dirname, '..'),
        env: {
            ...process.env,
            APPLICATIONINSIGHTS_CONNECTION_STRING:
                'InstrumentationKey=00000000-0000-0000-0000-000000000001;IngestionEndpoint=https://ingestion.example.test/',
            APPLICATIONINSIGHTS_STATSBEAT_DISABLED: 'true',
            APPLICATION_INSIGHTS_NO_STATSBEAT: 'true',
            APPLICATIONINSIGHTS_SDKSTATS_DISABLED: 'true',
            APPLICATIONINSIGHTS_AUTHENTICATION_STRING: '',
            APPLICATIONINSIGHTS_SAMPLING_RATIO: '1',
            OTEL_SERVICE_NAME: 'local-telemetry-test',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    let stdout = '';
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    const timeout = setTimeout(() => child.kill(), 20_000);
    try {
        const exitCode = await new Promise<number | null>((resolve, reject) => {
            child.once('error', reject);
            child.once('close', resolve);
        });
        if (exitCode !== 0) throw new Error(`Telemetry process exited ${exitCode}: ${stderr}`);
        for (const line of stdout.split('\n')) {
            if (line.startsWith('TELEMETRY_ENVELOPES=')) {
                const received: Envelope[] = JSON.parse(line.substring('TELEMETRY_ENVELOPES='.length));
                envelopes.push(...received);
            }
        }
        expect(envelopes.some(item => item.data?.baseType === 'RequestData')).toBe(true);
        expect(envelopes.some(item => item.data?.baseType === 'RequestData'
            && item.tags?.['ai.operation.name'] === 'GET /test/:id')).toBe(true);
        expect(envelopes.some(item => item.data?.baseType === 'RemoteDependencyData')).toBe(true);
        expect(envelopes.some(item => item.data?.baseType === 'ExceptionData')).toBe(true);
        expect(envelopes.some(item => item.data?.baseType === 'MetricData')).toBe(true);
        expect(envelopes.some(item => item.data?.baseType === 'MessageData'
            && item.data.baseData?.message?.includes('[RULE_CONTROLLER]'))).toBe(true);
        expect(envelopes.some(item => item.tags?.['ai.cloud.role'] === 'local-telemetry-test')).toBe(true);
        expect(JSON.stringify(envelopes)).not.toMatch(/sensitive-cell-value|private-upload-id|token=secret/);
    } finally {
        clearTimeout(timeout);
        if (child.exitCode === null) child.kill();
    }
}, 30_000);
