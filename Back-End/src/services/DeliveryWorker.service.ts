// =============================================================================
// Delivery Worker Service - Processes delivery jobs from the delivery queue
// =============================================================================

import fs from 'fs';
import path from 'path';
import { Job } from 'bullmq';
import { Upload } from '../models/Upload.model';
import { DeliveryRecord } from '../models/DeliveryRecord.model';
import { UploadService } from './Upload.service';
import { createDeliveryWorker } from './Queue.service';
import type { IDeliveryJobData } from '../interfaces/upload.interface';
import { logger } from '../utils/logger';
import { FILE_COPY_DELIVERY, assertInsideDeliveryRoot } from './DeliveryTargets.service';

async function processDeliveryJob(job: Job<IDeliveryJobData>): Promise<void> {
    const { uploadId, uploadSheetId, deliveryType, destinationPath } = job.data;
    const upload = await Upload.findById(uploadId);

    if (!upload) {
        throw new Error(`Upload not found: ${uploadId}`);
    }

    const records = await DeliveryRecord.findByUploadId(uploadId);
    const record = records.find((item) =>
        (item.UploadSheetId ?? null) === (uploadSheetId ?? null) &&
        item.DeliveryType === deliveryType &&
        item.DestinationPath === destinationPath
    );

    if (!record) {
        throw new Error(`Delivery record not found for upload: ${uploadId}`);
    }

    await DeliveryRecord.markStarted(record.Id);

    try {
        if (!upload.TempLocalPath || !fs.existsSync(upload.TempLocalPath)) {
            throw new Error(`Delivery source file not found for upload: ${uploadId}`);
        }

        if (deliveryType !== FILE_COPY_DELIVERY) {
            throw new Error(`Delivery type ${deliveryType} is not supported`);
        }

        const destination = path.resolve(destinationPath);
        assertInsideDeliveryRoot(destination);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(upload.TempLocalPath, destination);

        await DeliveryRecord.markCompleted(record.Id, upload.RowCountNo || 0);
        await UploadService.updateDeliveryProgress(record.Id, 100, upload.RowCountNo || 0);
        await UploadService.completeDelivery(uploadId);
    } catch (error: any) {
        await DeliveryRecord.markFailed(record.Id, error.message || 'Delivery failed');
        await UploadService.failDelivery(uploadId, error.message || 'Delivery failed');
        throw error;
    }
}

export function initializeDeliveryWorker() {
    logger.info('Initializing delivery worker');
    return createDeliveryWorker(processDeliveryJob);
}
