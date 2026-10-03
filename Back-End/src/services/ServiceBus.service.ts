import {
    ServiceBusAdministrationClient,
    ServiceBusClient,
    type ServiceBusMessage,
    type ServiceBusReceivedMessage,
} from '@azure/service-bus';
import { DefaultAzureCredential } from '@azure/identity';
import { v4 as uuidv4 } from 'uuid';
import type { DeliveryRequest } from '../contracts/delivery-request';
import type { ValidationEvent } from '../contracts/validation-event';
import type { ValidationRequest } from '../contracts/validation-request';
import { appConfig } from '../config/appConfig';
import { logger } from '../utils/logger';

export interface QueueRuntimeStats {
    activeMessageCount: number;
    deadLetterMessageCount: number;
}

export interface QueueMonitoringStats {
    available: boolean;
    validation: QueueRuntimeStats | null;
    delivery: QueueRuntimeStats | null;
}

type ValidationEventHandler = (event: ValidationEvent) => Promise<void>;
type DeliveryRequestHandler = (request: DeliveryRequest) => Promise<void>;

const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

function messageBody(message: ServiceBusReceivedMessage): unknown {
    if (typeof message.body === 'string') {
        try {
            return JSON.parse(message.body) as unknown;
        } catch {
            return null;
        }
    }
    return message.body;
}

function isValidationEvent(value: unknown): value is ValidationEvent {
    if (!isObject(value)) return false;
    const summary = value.summary;
    const validSummary = summary === undefined || (
        isObject(summary) &&
        ['PASSED', 'WARNING', 'FAILED'].includes(String(summary.status)) &&
        Number.isInteger(summary.passed) &&
        Number.isInteger(summary.failed) &&
        Number.isInteger(summary.warnings) &&
        Number.isInteger(summary.rowCount)
    );
    return value.schemaVersion === 1 &&
        typeof value.uploadId === 'string' &&
        ['progress', 'completed', 'failed'].includes(String(value.type)) &&
        ['download', 'sniff', 'parse', 'rules', 'persist'].includes(String(value.stage)) &&
        Number.isInteger(value.percent) &&
        Number(value.percent) >= 0 &&
        Number(value.percent) <= 100 &&
        validSummary &&
        (value.error === undefined || typeof value.error === 'string');
}

function isDeliveryRequest(value: unknown): value is DeliveryRequest {
    return isObject(value) &&
        value.schemaVersion === 1 &&
        typeof value.uploadId === 'string' &&
        Number.isInteger(value.attempt) &&
        Number(value.attempt) >= 1 &&
        Number(value.attempt) <= 5;
}

class ServiceBusService {
    private client: ServiceBusClient | null = null;
    private adminClient: ServiceBusAdministrationClient | null = null;
    private validationSender: ReturnType<ServiceBusClient['createSender']> | null = null;
    private deliverySender: ReturnType<ServiceBusClient['createSender']> | null = null;
    private eventsReceiver: ReturnType<ServiceBusClient['createReceiver']> | null = null;
    private deliveryReceiver: ReturnType<ServiceBusClient['createReceiver']> | null = null;

    private createClient(): ServiceBusClient {
        if (appConfig.serviceBus.connectionString) {
            return new ServiceBusClient(appConfig.serviceBus.connectionString);
        }
        if (appConfig.serviceBus.namespace) {
            return new ServiceBusClient(appConfig.serviceBus.namespace, new DefaultAzureCredential());
        }
        throw new Error('Configure SERVICEBUS_CONNECTION_STRING or SERVICEBUS_NAMESPACE.');
    }

    async initialize(
        onValidationEvent: ValidationEventHandler,
        onDeliveryRequest: DeliveryRequestHandler,
    ): Promise<void> {
        if (this.client) return;

        const client = this.createClient();
        this.client = client;
        this.validationSender = client.createSender(appConfig.serviceBus.validationQueue);
        this.deliverySender = client.createSender(appConfig.serviceBus.deliveryQueue);
        this.eventsReceiver = client.createReceiver(
            appConfig.serviceBus.eventsTopic,
            appConfig.serviceBus.eventsSubscription,
        );
        this.deliveryReceiver = client.createReceiver(appConfig.serviceBus.deliveryQueue);

        this.eventsReceiver.subscribe({
            processMessage: async message => {
                const event = messageBody(message);
                if (!isValidationEvent(event)) {
                    await this.eventsReceiver!.deadLetterMessage(message, {
                        deadLetterReason: 'InvalidValidationEvent',
                        deadLetterErrorDescription: 'Message does not match ValidationEvent schema version 1.',
                    });
                    return;
                }
                try {
                    await onValidationEvent(event);
                    await this.eventsReceiver!.completeMessage(message);
                } catch (error) {
                    this.logProcessorError('validation-events', error);
                    await this.eventsReceiver!.abandonMessage(message);
                }
            },
            processError: async args => this.logProcessorError('validation-events', args.error),
        }, { autoCompleteMessages: false, maxConcurrentCalls: appConfig.workers.validation.concurrency });

        this.deliveryReceiver.subscribe({
            processMessage: async message => {
                const request = messageBody(message);
                if (!isDeliveryRequest(request)) {
                    await this.deliveryReceiver!.deadLetterMessage(message, {
                        deadLetterReason: 'InvalidDeliveryRequest',
                        deadLetterErrorDescription: 'Message does not match DeliveryRequest schema version 1.',
                    });
                    return;
                }
                try {
                    await onDeliveryRequest(request);
                    await this.deliveryReceiver!.completeMessage(message);
                } catch (error) {
                    this.logProcessorError(appConfig.serviceBus.deliveryQueue, error);
                    await this.deliveryReceiver!.abandonMessage(message);
                }
            },
            processError: async args => this.logProcessorError(appConfig.serviceBus.deliveryQueue, args.error),
        }, { autoCompleteMessages: false, maxConcurrentCalls: appConfig.workers.delivery.concurrency });
    }

    async sendValidationRequest(request: ValidationRequest): Promise<void> {
        if (!this.validationSender) throw new Error('Service Bus validation sender is not initialized.');
        await this.validationSender.sendMessages({
            body: request,
            contentType: 'application/json',
            messageId: request.correlationId,
            correlationId: request.correlationId,
        });
    }

    async sendDeliveryRequest(request: DeliveryRequest): Promise<void> {
        if (!this.deliverySender) throw new Error('Service Bus delivery sender is not initialized.');
        await this.deliverySender.sendMessages({
            body: request,
            contentType: 'application/json',
            messageId: `${request.uploadId}:${request.attempt}:${uuidv4()}`,
        });
    }

    async scheduleDeliveryRetry(request: DeliveryRequest): Promise<void> {
        if (!this.deliverySender) throw new Error('Service Bus delivery sender is not initialized.');
        const delayMs = appConfig.serviceBus.deliveryRetryBaseMs * 2 ** (request.attempt - 2);
        const message: ServiceBusMessage = {
            body: request,
            contentType: 'application/json',
            messageId: `${request.uploadId}:${request.attempt}:${uuidv4()}`,
            scheduledEnqueueTimeUtc: new Date(Date.now() + delayMs),
        };
        await this.deliverySender.scheduleMessages(message, message.scheduledEnqueueTimeUtc!);
    }

    async getQueueMonitoringStats(): Promise<QueueMonitoringStats> {
        if (this.isEmulator()) {
            return { available: false, validation: null, delivery: null };
        }
        if (!this.adminClient) {
            if (appConfig.serviceBus.connectionString) {
                this.adminClient = new ServiceBusAdministrationClient(appConfig.serviceBus.connectionString);
            } else if (appConfig.serviceBus.namespace) {
                this.adminClient = new ServiceBusAdministrationClient(
                    appConfig.serviceBus.namespace,
                    new DefaultAzureCredential(),
                );
            } else {
                throw new Error('Service Bus management is not configured.');
            }
        }
        const [validation, delivery] = await Promise.all([
            this.adminClient.getQueueRuntimeProperties(appConfig.serviceBus.validationQueue),
            this.adminClient.getQueueRuntimeProperties(appConfig.serviceBus.deliveryQueue),
        ]);
        return {
            available: true,
            validation: {
                activeMessageCount: validation.activeMessageCount,
                deadLetterMessageCount: validation.deadLetterMessageCount,
            },
            delivery: {
                activeMessageCount: delivery.activeMessageCount,
                deadLetterMessageCount: delivery.deadLetterMessageCount,
            },
        };
    }

    async close(): Promise<void> {
        const resources = [
            this.eventsReceiver?.close(),
            this.deliveryReceiver?.close(),
            this.validationSender?.close(),
            this.deliverySender?.close(),
            this.client?.close(),
        ];
        await Promise.all(resources.filter((resource): resource is Promise<void> => Boolean(resource)));
        this.eventsReceiver = null;
        this.deliveryReceiver = null;
        this.validationSender = null;
        this.deliverySender = null;
        this.client = null;
        this.adminClient = null;
    }

    private isEmulator(): boolean {
        const endpoint = `${appConfig.serviceBus.connectionString} ${appConfig.serviceBus.namespace}`.toLowerCase();
        return endpoint.includes('usedevelopmentemulator=true') ||
            endpoint.includes('localhost') ||
            endpoint.includes('127.0.0.1');
    }

    private logProcessorError(entity: string, error: unknown): void {
        const errorName = error instanceof Error ? error.name : 'UnknownError';
        logger.error(`[SERVICE_BUS] Processor failed for ${entity}: ${errorName}`);
    }
}

export const serviceBusService = new ServiceBusService();
