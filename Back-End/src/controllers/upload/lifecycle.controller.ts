// =============================================================================
// Upload Controller - Validation lifecycle (start, retry) and deletion
// =============================================================================

import { UploadService } from '../../services/Upload.service';
import { Upload } from '../../models/Upload.model';
import { DeliveryRecord } from '../../models/DeliveryRecord.model';
import { azureStorage } from '../../services/AzureStorage.service';
import path from 'path';
import fs from 'fs';
import { appConfig } from '../../config/appConfig';
import { asyncHandler } from '../../middleware/asyncHandler';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../utils/httpError';
import {
    AZURE_BLOB_DELIVERY,
    FILE_COPY_DELIVERY,
    assertInsideDeliveryRoot,
    assertSafeDeliveryBlobName,
} from '../../services/DeliveryTargets.service';

/**
 * Start validation for an uploaded file
 */
export const startVerification = asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const userId = req.user!.userId;

    // Check access
    const hasAccess = await Upload.hasAccessToUpload(id, userId);
    if (!hasAccess) {
        throw new ForbiddenError();
    }

    const upload = await Upload.findById(id);
    if (!upload) {
        throw new NotFoundError('Upload not found');
    }
    // Check if upload is in valid state for verification
    if (upload.Status !== 'UPLOADED' && upload.Status !== 'VALIDATION_FAILED') {
        throw new BadRequestError(`Cannot start validation. Current status: ${upload.Status}`);
    }

    // Start validation
    await UploadService.startValidation(id);

    res.json({
        success: true,
        message: 'Validation started successfully'
    });
});

/**
 * Retry validation for a failed upload
 */
export const retryValidation = asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const userId = req.user!.userId;

    // Check access
    const hasAccess = await Upload.hasAccessToUpload(id, userId);
    if (!hasAccess) {
        throw new ForbiddenError();
    }

    const upload = await Upload.findById(id);
    if (!upload) {
        throw new NotFoundError('Upload not found');
    }

    // Check if upload can be retried
    if (upload.Status !== 'VALIDATION_FAILED' && upload.Status !== 'DELIVERY_FAILED') {
        throw new BadRequestError(`Cannot retry. Current status: ${upload.Status}`);
    }

    // Reset status and start validation again
    await Upload.updateStatus(id, 'UPLOADED');
    await UploadService.startValidation(id);

    res.json({
        success: true,
        message: 'Validation retry started successfully'
    });
});

/**
 * Delete an upload
 */
export const deleteUpload = asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const userId = req.user!.userId;

    // Check access
    const hasAccess = await Upload.hasAccessToUpload(id, userId);
    if (!hasAccess) {
        throw new ForbiddenError();
    }

    const upload = await Upload.findById(id);
    if (!upload) {
        throw new NotFoundError('Upload not found');
    }

    // Check if upload can be deleted
    if (upload.Status === 'VALIDATION_IN_PROGRESS' || upload.Status === 'DELIVERY_IN_PROGRESS') {
        throw new BadRequestError('Cannot delete upload that is currently being processed');
    }

    const deliveryRecords = await DeliveryRecord.findByUploadId(id);
    for (const record of deliveryRecords) {
        if (record.DeliveryType === AZURE_BLOB_DELIVERY) {
            if (!azureStorage) throw new Error('Azure Blob Storage is not configured.');
            assertSafeDeliveryBlobName(record.DestinationPath);
            await azureStorage.deleteBlob(
                record.DestinationPath,
                appConfig.azure.storage.deliveriesContainerName,
            );
        } else if (record.DeliveryType === FILE_COPY_DELIVERY) {
            const destination = path.resolve(record.DestinationPath);
            assertInsideDeliveryRoot(destination);
            try {
                await fs.promises.unlink(destination);
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
            }
        }
    }

    if (azureStorage) {
        await azureStorage.deleteBlob(upload.BlobName, upload.BlobContainer);
        if (upload.ReportBlobName) {
            await azureStorage.deleteBlob(upload.ReportBlobName, appConfig.azure.storage.reportsContainerName);
        }
    }

    // Delete from database (cascades to related records)
    await Upload.delete(id);

    res.json({
        success: true,
        message: 'Upload deleted successfully'
    });
});
