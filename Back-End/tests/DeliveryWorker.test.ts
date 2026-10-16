import { Readable } from 'stream';
import type { DeliveryRequest } from '../src/contracts/delivery-request';

const mockFindUpload = jest.fn();
const mockFindDeliveryRecords = jest.fn();
const mockMarkStarted = jest.fn();
const mockMarkCompleted = jest.fn();
const mockOpenBlobReadStream = jest.fn();
const mockUploadStreamToBlob = jest.fn();
const mockCompleteDelivery = jest.fn();
const mockUpdateDeliveryProgress = jest.fn();
const mockScheduleDeliveryRetry = jest.fn();

jest.mock('../src/models/Upload.model', () => ({
    Upload: { findById: mockFindUpload },
}));
jest.mock('../src/models/DeliveryRecord.model', () => ({
    DeliveryRecord: {
        findByUploadId: mockFindDeliveryRecords,
        markStarted: mockMarkStarted,
        markCompleted: mockMarkCompleted,
    },
}));
jest.mock('../src/services/AzureStorage.service', () => ({
    azureStorage: {
        openBlobReadStream: mockOpenBlobReadStream,
        uploadStreamToBlob: mockUploadStreamToBlob,
    },
}));
jest.mock('../src/services/ServiceBus.service', () => ({
    serviceBusService: { scheduleDeliveryRetry: mockScheduleDeliveryRetry },
}));
jest.mock('../src/services/Upload.service', () => ({
    UploadService: {
        completeDelivery: mockCompleteDelivery,
        updateDeliveryProgress: mockUpdateDeliveryProgress,
    },
}));
jest.mock('../src/utils/logger', () => ({
    logger: { warn: jest.fn(), error: jest.fn() },
}));

import { processDeliveryRequest } from '../src/services/DeliveryWorker.service';
import { appConfig } from '../src/config/appConfig';

const request: DeliveryRequest = { schemaVersion: 1, uploadId: 'upload-1', attempt: 1 };

describe('processDeliveryRequest', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockFindUpload.mockResolvedValue({
            Id: 'upload-1',
            BlobName: 'source.csv',
            BlobContainer: 'uploads',
            RowCountNo: 3,
        });
        mockFindDeliveryRecords.mockResolvedValue([{
            Id: 'delivery-1',
            DeliveryType: 'AzureBlob',
            DestinationPath: 'finance/upload-1_source.csv',
            Status: 'PENDING',
        }]);
        mockMarkStarted.mockResolvedValue(undefined);
        mockMarkCompleted.mockResolvedValue(undefined);
        mockOpenBlobReadStream.mockResolvedValue(Readable.from(['id,value\n1,ok\n']));
        mockUploadStreamToBlob.mockResolvedValue(undefined);
        mockCompleteDelivery.mockResolvedValue(undefined);
        mockUpdateDeliveryProgress.mockResolvedValue(undefined);
        mockScheduleDeliveryRetry.mockResolvedValue(undefined);
    });

    it('streams cloud deliveries to a deterministic private Blob destination', async () => {
        await processDeliveryRequest(request);

        expect(mockUploadStreamToBlob).toHaveBeenCalledWith(
            expect.any(Readable),
            'finance/upload-1_source.csv',
            appConfig.azure.storage.deliveriesContainerName,
        );
        expect(mockMarkCompleted).toHaveBeenCalledWith('delivery-1', 3);
        expect(mockCompleteDelivery).toHaveBeenCalledWith('upload-1');
        expect(mockScheduleDeliveryRetry).not.toHaveBeenCalled();
    });

    it('replays the same blob destination after a transient write failure', async () => {
        mockUploadStreamToBlob.mockRejectedValueOnce(new Error('temporary storage failure'));

        await processDeliveryRequest(request);

        expect(mockScheduleDeliveryRetry).toHaveBeenCalledWith({
            schemaVersion: 1,
            uploadId: 'upload-1',
            attempt: 2,
        });
        expect(mockMarkCompleted).not.toHaveBeenCalled();
        expect(mockCompleteDelivery).not.toHaveBeenCalled();
    });

    it('does not rewrite outputs already marked delivered', async () => {
        mockFindDeliveryRecords.mockResolvedValue([{
            Id: 'delivery-1',
            DeliveryType: 'AzureBlob',
            DestinationPath: 'finance/upload-1_source.csv',
            Status: 'DELIVERED',
        }]);

        await processDeliveryRequest(request);

        expect(mockUploadStreamToBlob).not.toHaveBeenCalled();
        expect(mockCompleteDelivery).toHaveBeenCalledWith('upload-1');
    });
});
