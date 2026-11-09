// =============================================================================
// Upload Service - Delivery scheduling and delivery state transitions
// =============================================================================

import { Upload } from '../../models/Upload.model';
import { UploadSheet } from '../../models/UploadSheet.model';
import { DeliveryRecord } from '../../models/DeliveryRecord.model';
import { FileDefinition } from '../../models/FileDefinition.model';
import { serviceBusService } from '../ServiceBus.service';
import { cacheService } from '../MemoryCache.service';
import { logger } from '../../utils/logger';
import { emitUploadEvent } from '../../websocket/socketServer';
import { getDeliveryTargets, resolveDeliveryDestination } from '../DeliveryTargets.service';
import type { DeliveryRequest } from '../../contracts/delivery-request';
import { getUploadProgress } from './readModels';

/**
 * Finish an upload that passed validation and has no delivery target configured.
 */
export async function completeWithoutDelivery(uploadId: string): Promise<void> {
    const claimed = await Upload.transitionStatus(uploadId, 'VALIDATION_PASSED', 'VALIDATED');
    if (!claimed) return;

    const sheets = await UploadSheet.findByUploadId(uploadId);
    for (const sheet of sheets) {
        await UploadSheet.update(sheet.Id, { Status: 'VALIDATED' });
    }

    await cacheService.invalidateUploadProgress(uploadId);
    void emitUploadEvent(uploadId, { uploadId, type: 'VALIDATED' });
    logger.info(`Upload ${uploadId} validated; no delivery target configured`);
}

/**
 * Start delivery process. Definitions without a delivery target finish as VALIDATED.
 */
export async function startDelivery(uploadId: string): Promise<void> {
    const upload = await Upload.findById(uploadId);
    if (!upload) {
        throw new Error('Upload not found');
    }

    const fileDefinition = await FileDefinition.findById(upload.FileDefinitionId);
    if (!fileDefinition) {
        throw new Error('File definition not found');
    }

    const deliveryTargets = getDeliveryTargets(fileDefinition);
    if (deliveryTargets.length === 0) {
        await completeWithoutDelivery(uploadId);
        return;
    }

    const claimed = await Upload.transitionStatus(uploadId, 'VALIDATION_PASSED', 'DELIVERY_IN_PROGRESS');
    if (!claimed) return;

    // One delivery request processes every configured target; completed targets are skipped on retries.
    try {
        await Upload.update(uploadId, { DeliveryStartedAt: new Date() });
        for (const target of deliveryTargets) {
            const destinationPath = resolveDeliveryDestination(target.folder, upload.Id, upload.OriginalFilename);
            await DeliveryRecord.create({
                UploadId: uploadId,
                DeliveryType: target.type,
                DestinationPath: destinationPath,
                DestinationName: target.name
            });
        }

        const deliveryRequest: DeliveryRequest = { schemaVersion: 1, uploadId: upload.Id, attempt: 1 };
        await serviceBusService.sendDeliveryRequest(deliveryRequest);
    } catch (error) {
        await DeliveryRecord.deleteByUploadId(uploadId);
        await Upload.transitionStatus(uploadId, 'DELIVERY_IN_PROGRESS', 'VALIDATION_PASSED');
        throw error;
    }

    const uploadSheets = await UploadSheet.findByUploadId(uploadId);
    for (const sheet of uploadSheets) {
        await UploadSheet.update(sheet.Id, { Status: 'DELIVERING' });
    }

    await cacheService.cacheUploadProgress(uploadId, {
        uploadId,
        status: 'DELIVERY_IN_PROGRESS',
        validation: null,
        delivery: {
            percent: 0,
            recordsDelivered: 0,
            totalRecords: deliveryTargets.length,
            status: 'IN_PROGRESS'
        }
    });

    void emitUploadEvent(uploadId, { uploadId, type: 'DELIVERY_UPDATE' });
    logger.info(`Delivery request sent for upload ${uploadId}; targets=${deliveryTargets.length}`);
}

/**
 * Update delivery progress
 */
export async function updateDeliveryProgress(
    deliveryRecordId: string,
    percent: number,
    recordsDelivered?: number
): Promise<void> {

    await DeliveryRecord.updateProgress(deliveryRecordId, percent, recordsDelivered);

    // Emit WebSocket update
    const record = await DeliveryRecord.findById(deliveryRecordId);

    if (record) {
        void emitUploadEvent(record.UploadId, {
            uploadId: record.UploadId,
            type: 'DELIVERY_UPDATE'
        });
    }

    await cacheService.invalidateUploadProgress(record?.UploadId || '');
    if (record) {
        await getUploadProgress(record.UploadId);
    }
}

/**
 * Complete delivery
 */
export async function completeDelivery(uploadId: string): Promise<void> {
    const deliveryRecords = await DeliveryRecord.findByUploadId(uploadId);

    // Check if all deliveries are complete
    const allDelivered = deliveryRecords.every(r => r.Status === 'DELIVERED');

    if (allDelivered) {
        // Update upload status to DELIVERED
        const destinations = deliveryRecords.map(r => r.DestinationPath).join(', ');
        await Upload.update(uploadId, {
            Status: 'DELIVERED',
            DeliveredTo: destinations,
            DeliveredAt: new Date(),
            DeliveryCompletedAt: new Date()
        });

        // Update sheet status
        const sheets = await UploadSheet.findByUploadId(uploadId);
        for (const sheet of sheets) {
            await UploadSheet.update(sheet.Id, {
                Status: 'DELIVERED',
                DeliveredAt: new Date()
            });
        }

        // Invalidate progress cache
        await cacheService.invalidateUploadProgress(uploadId);
        void emitUploadEvent(uploadId, { type: 'DELIVERED', progress: 100 });

        logger.info(`Delivery completed for upload: ${uploadId}`);
    }
}

/**
 * Mark delivery as failed
 */
export async function failDelivery(uploadId: string, errorMessage: string): Promise<void> {
    const deliveryRecords = await DeliveryRecord.findByUploadId(uploadId);

    // Mark all pending/in-progress deliveries as failed
    for (const record of deliveryRecords) {
        if (record.Status === 'PENDING' || record.Status === 'IN_PROGRESS') {
            await DeliveryRecord.markFailed(record.Id, errorMessage);
        }
    }

    // Update upload status
    await Upload.update(uploadId, {
        Status: 'DELIVERY_FAILED',
        ErrorMessage: errorMessage,
        DeliveryCompletedAt: new Date()
    });

    // Update sheet status
    const sheets = await UploadSheet.findByUploadId(uploadId);
    for (const sheet of sheets) {
        await UploadSheet.update(sheet.Id, { Status: 'FAILED', ErrorMessage: errorMessage });
    }

    // Invalidate progress cache
    await cacheService.invalidateUploadProgress(uploadId);
    void emitUploadEvent(uploadId, { type: 'DELIVERY_FAILED', details: { error: errorMessage } });

    logger.error(`Delivery failed for upload: ${uploadId}`);
}
