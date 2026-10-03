import { appConfig } from '../src/config/appConfig';

const mockValidationSender = {
    sendMessages: jest.fn(),
    close: jest.fn(),
};
const mockDeliverySender = {
    sendMessages: jest.fn(),
    scheduleMessages: jest.fn(),
    close: jest.fn(),
};
const mockEventsReceiver = {
    subscribe: jest.fn(),
    deadLetterMessage: jest.fn(),
    completeMessage: jest.fn(),
    abandonMessage: jest.fn(),
    close: jest.fn(),
};
const mockDeliveryReceiver = {
    subscribe: jest.fn(),
    deadLetterMessage: jest.fn(),
    completeMessage: jest.fn(),
    abandonMessage: jest.fn(),
    close: jest.fn(),
};
const mockClient = {
    createSender: jest.fn((queue: string) =>
        queue === 'validation-requests' ? mockValidationSender : mockDeliverySender),
    createReceiver: jest.fn((entity: string) =>
        entity === 'validation-events' ? mockEventsReceiver : mockDeliveryReceiver),
    close: jest.fn(),
};

jest.mock('@azure/service-bus', () => ({
    ServiceBusClient: jest.fn().mockImplementation(() => mockClient),
    ServiceBusAdministrationClient: jest.fn(),
}));
jest.mock('@azure/identity', () => ({
    DefaultAzureCredential: jest.fn(),
}));

import { serviceBusService } from '../src/services/ServiceBus.service';

describe('ServiceBusService', () => {
    const originalNamespace = appConfig.serviceBus.namespace;
    const originalConnectionString = appConfig.serviceBus.connectionString;
    const originalRetryBase = appConfig.serviceBus.deliveryRetryBaseMs;

    beforeEach(async () => {
        await serviceBusService.close();
        jest.clearAllMocks();
        appConfig.serviceBus.namespace = 'localhost';
        appConfig.serviceBus.connectionString = '';
        appConfig.serviceBus.deliveryRetryBaseMs = 100;
    });

    afterAll(async () => {
        await serviceBusService.close();
        appConfig.serviceBus.namespace = originalNamespace;
        appConfig.serviceBus.connectionString = originalConnectionString;
        appConfig.serviceBus.deliveryRetryBaseMs = originalRetryBase;
    });

    it('sends a ValidationRequest with its correlation id', async () => {
        await serviceBusService.initialize(jest.fn(), jest.fn());
        const request = {
            schemaVersion: 1 as const,
            uploadId: 'upload-1',
            definitionVersionId: 'version-1',
            blob: { container: 'uploads', name: 'upload-1/input.csv' },
            fileType: 'csv' as const,
            requestedAt: '2026-01-01T00:00:00.000Z',
            correlationId: 'correlation-1',
        };

        await serviceBusService.sendValidationRequest(request);

        expect(mockValidationSender.sendMessages).toHaveBeenCalledWith({
            body: request,
            contentType: 'application/json',
            messageId: 'correlation-1',
            correlationId: 'correlation-1',
        });
    });

    it('dispatches and completes valid validation events', async () => {
        const onValidationEvent = jest.fn().mockResolvedValue(undefined);
        await serviceBusService.initialize(onValidationEvent, jest.fn());
        const message = {
            body: {
                schemaVersion: 1,
                uploadId: 'upload-1',
                type: 'progress',
                stage: 'rules',
                percent: 50,
            },
        };
        const { processMessage } = mockEventsReceiver.subscribe.mock.calls[0][0];

        await processMessage(message);

        expect(onValidationEvent).toHaveBeenCalledWith(message.body);
        expect(mockEventsReceiver.completeMessage).toHaveBeenCalledWith(message);
    });

    it('dead-letters validation events outside the message contract', async () => {
        await serviceBusService.initialize(jest.fn(), jest.fn());
        const message = { body: { schemaVersion: 2, uploadId: 'upload-1' } };
        const { processMessage } = mockEventsReceiver.subscribe.mock.calls[0][0];

        await processMessage(message);

        expect(mockEventsReceiver.deadLetterMessage).toHaveBeenCalledWith(message, {
            deadLetterReason: 'InvalidValidationEvent',
            deadLetterErrorDescription: 'Message does not match ValidationEvent schema version 1.',
        });
    });

    it('schedules delivery retries with exponential backoff', async () => {
        await serviceBusService.initialize(jest.fn(), jest.fn());
        const before = Date.now();

        await serviceBusService.scheduleDeliveryRetry({
            schemaVersion: 1,
            uploadId: 'upload-1',
            attempt: 3,
        });

        const [message, scheduledAt] = mockDeliverySender.scheduleMessages.mock.calls[0];
        expect(message.body).toEqual({ schemaVersion: 1, uploadId: 'upload-1', attempt: 3 });
        expect(scheduledAt.getTime()).toBeGreaterThanOrEqual(before + 200);
    });
});
