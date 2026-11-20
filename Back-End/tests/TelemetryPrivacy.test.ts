import { LoggerProvider, InMemoryLogRecordExporter, SimpleLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { telemetryLogProcessor, telemetrySpanProcessor } from '../src/telemetry/privacy';

describe('exported telemetry privacy', () => {
    it('removes raw log payloads and attributes while keeping severity and category', async () => {
        const exporter = new InMemoryLogRecordExporter();
        const provider = new LoggerProvider({
            processors: [telemetryLogProcessor, new SimpleLogRecordProcessor({ exporter })],
        });
        provider.getLogger('test').emit({
            body: '[RULE_CONTROLLER] Submitted rule text: sensitive-cell-value',
            severityText: 'ERROR',
            severityNumber: 17,
            attributes: { secret: 'token', stack: 'sensitive-cell-value', fileName: 'private.csv' },
        });
        await provider.forceFlush();
        const record = exporter.getFinishedLogRecords()[0];
        expect(record.body).toBe('Application log [RULE_CONTROLLER] (ERROR)');
        expect(record.attributes).toEqual({});
        expect(record.severityNumber).toBe(17);
        expect(JSON.stringify(record)).not.toContain('sensitive-cell-value');
        await provider.shutdown();
    });

    it('keeps allowlisted lifecycle logs readable', async () => {
        const exporter = new InMemoryLogRecordExporter();
        const provider = new LoggerProvider({
            processors: [telemetryLogProcessor, new SimpleLogRecordProcessor({ exporter })],
        });
        provider.getLogger('test').emit({ body: 'Shutdown complete', severityText: 'INFO' });
        await provider.forceFlush();
        expect(exporter.getFinishedLogRecords()[0].body).toBe('Shutdown complete');
        await provider.shutdown();
    });

    it('does not treat arbitrary raw input as a safe log category', async () => {
        const exporter = new InMemoryLogRecordExporter();
        const provider = new LoggerProvider({
            processors: [telemetryLogProcessor, new SimpleLogRecordProcessor({ exporter })],
        });
        provider.getLogger('test').emit({ body: '[PRIVATE_CUSTOMER_NAME] uploaded a file', severityText: 'INFO' });
        await provider.forceFlush();
        expect(exporter.getFinishedLogRecords()[0].body).toBe('Application log (INFO)');
        await provider.shutdown();
    });

    it('exports transport metadata but not URLs, SQL, model payloads or raw exception data', async () => {
        const exporter = new InMemorySpanExporter();
        const provider = new BasicTracerProvider({
            spanProcessors: [telemetrySpanProcessor, new SimpleSpanProcessor(exporter)],
        });
        const span = provider.getTracer('test').startSpan('HTTP POST', {
            attributes: {
                'http.request.method': 'POST',
                'http.response.status_code': 500,
                'http.route': '/api/v1/uploads/:id',
                'url.full': 'https://api.example.test/uploads/private.csv?token=secret',
                'url.query': 'sig=sas-signature',
                'http.target': '/uploads/private.csv?token=secret',
                'db.statement': 'SELECT private-data',
                'gen_ai.input.messages': 'private-rule',
                'http.request.header.authorization': 'Bearer token',
            },
        });
        span.recordException(new Error('sensitive-cell-value'));
        span.setStatus({ code: 2, message: 'sensitive-cell-value' });
        span.end();
        await provider.forceFlush();
        const record = exporter.getFinishedSpans()[0];
        expect(record.attributes).toEqual({
            'http.request.method': 'POST',
            'http.response.status_code': 500,
            'http.route': '/api/v1/uploads/:id',
        });
        expect(record.status).toEqual({ code: 2 });
        expect(record.events[0].attributes).toEqual({
            'exception.type': 'Error',
            'exception.message': 'Application operation failed',
        });
        expect(JSON.stringify({ attributes: record.attributes, events: record.events, status: record.status }))
            .not.toMatch(/sensitive-cell-value|private.csv|private-data|private-rule|Bearer|sas-signature/);
        await provider.shutdown();
    });

    it('redacts status descriptions even on spans without attributes', async () => {
        const exporter = new InMemorySpanExporter();
        const provider = new BasicTracerProvider({
            spanProcessors: [telemetrySpanProcessor, new SimpleSpanProcessor(exporter)],
        });
        const span = provider.getTracer('test').startSpan('operation');
        span.setStatus({ code: 2, message: 'private-error-detail' });
        span.end();
        await provider.forceFlush();
        expect(exporter.getFinishedSpans()[0].status).toEqual({ code: 2 });
        await provider.shutdown();
    });
});
