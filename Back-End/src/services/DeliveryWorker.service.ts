import fs from 'fs/promises';
import path from 'path';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import type { DeliveryRequest } from '../contracts/delivery-request';
import { Upload } from '../models/Upload.model';
import { DeliveryRecord } from '../models/DeliveryRecord.model';
import { UploadService } from './Upload.service';
import { azureStorage } from './AzureStorage.service';
import { serviceBusService } from './ServiceBus.service';
import { logger } from '../utils/logger';
import { FILE_COPY_DELIVERY, assertInsideDeliveryRoot } from './DeliveryTargets.service';

const MAX_DELIVERY_ATTEMPTS = 5;

export async function processDeliveryRequest(request: DeliveryRequest): Promise<void> {
    const { uploadId, attempt } = request;
    const upload = await Upload.findById(uploadId);
    if (!upload) throw new Error(`Upload not found for delivery request ${uploadId}.`);
    if (!azureStorage) throw new Error('Azure Blob Storage is not configured.');

    const records = await DeliveryRecord.findByUploadId(uploadId);
    const pendingRecords = records.filter(record => record.Status !== 'DELIVERED');
    if (pendingRecords.length === 0) {
        await UploadService.completeDelivery(uploadId);
        return;
    }

    try {
        for (const record of pendingRecords) {
            if (record.DeliveryType !== FILE_COPY_DELIVERY) {
                throw new Error(`Unsupported delivery type for upload ${uploadId}.`);
            }

            const destination = path.resolve(record.DestinationPath);
            assertInsideDeliveryRoot(destination);
            await fs.mkdir(path.dirname(destination), { recursive: true });
            await DeliveryRecord.markStarted(record.Id);

            const source = await azureStorage.openBlobReadStream(upload.BlobName, upload.BlobContainer);
            await pipeline(source, createWriteStream(destination));

            await DeliveryRecord.markCompleted(record.Id, upload.RowCountNo || 0);
            await UploadService.updateDeliveryProgress(record.Id, 100, upload.RowCountNo || 0);
        }
        await UploadService.completeDelivery(uploadId);
    } catch (error) {
        if (attempt < MAX_DELIVERY_ATTEMPTS) {
            await serviceBusService.scheduleDeliveryRetry({
                schemaVersion: 1,
                uploadId,
                attempt: attempt + 1,
            });
            logger.warn(`[DELIVERY] Scheduled retry for upload ${uploadId}; attempt=${attempt + 1}; error=${error instanceof Error ? error.name : 'UnknownError'}`);
            return;
        }

        await UploadService.failDelivery(uploadId, 'Delivery failed after the maximum retry attempts.');
        logger.error(`[DELIVERY] Failed upload ${uploadId} after ${attempt} attempts; error=${error instanceof Error ? error.name : 'UnknownError'}`);
    }
}
