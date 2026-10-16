import type { LogRecordProcessor } from '@opentelemetry/sdk-logs';
import type { SpanProcessor } from '@opentelemetry/sdk-trace-base';

const safeLogMessages = new Set([
    'Service Bus receivers initialized successfully',
    'Shutdown complete',
]);
const safeLogCategories = new Set([
    'AUTH', 'AUTH_CONTROLLER', 'DELIVERY', 'FILE_DEFINITION', 'NATURAL_LANGUAGE_RULE_VALIDATION',
    'RULE_CONTROLLER', 'SERVICEBUS', 'SOCKET', 'STORAGE', 'UPLOAD',
]);

const safeAttributeNames = new Set([
    'http.method', 'http.request.method', 'http.status_code', 'http.response.status_code',
    'http.route', 'http.scheme', 'url.scheme', 'server.address', 'server.port',
    'net.peer.name', 'net.peer.port', 'net.host.name', 'net.host.port', 'network.protocol.version',
    'db.system', 'db.system.name', 'db.operation', 'db.operation.name',
    'messaging.system', 'messaging.operation', 'messaging.operation.name',
    'messaging.destination.name', 'rpc.system', 'rpc.service', 'rpc.method',
    'az.namespace', 'azure.namespace', 'error.type', 'microsoft.sample_rate',
]);

export const telemetryLogProcessor: LogRecordProcessor = {
    onEmit(record) {
        // Existing console logs may contain submitted rule text or error payloads.
        const message = typeof record.body === 'string' ? record.body : '';
        const category = /^\[([A-Z_]+)\]/.exec(message)?.[1];
        const categoryLabel = category && safeLogCategories.has(category) ? ` [${category}]` : '';
        record.setBody(safeLogMessages.has(message)
            ? message
            : `Application log${categoryLabel} (${record.severityText || 'unknown'})`);
        for (const name of Object.keys(record.attributes)) {
            delete record.attributes[name];
        }
    },
    forceFlush: async () => undefined,
    shutdown: async () => undefined,
};

export const telemetrySpanProcessor: SpanProcessor = {
    onStart() {},
    onEnd(span) {
        // Runs before the Azure batch exporter; never export query strings, payloads or SQL text.
        for (const name of Object.keys(span.attributes)) {
            if (!safeAttributeNames.has(name)) {
                delete span.attributes[name];
            }
        }
        delete span.status.message;
        for (const event of span.events) {
            if (event.attributes) {
                for (const name of Object.keys(event.attributes)) {
                    delete event.attributes[name];
                }
                if (event.name === 'exception') {
                    event.attributes['exception.type'] = 'Error';
                    event.attributes['exception.message'] = 'Application operation failed';
                }
            }
        }
    },
    forceFlush: async () => undefined,
    shutdown: async () => undefined,
};
