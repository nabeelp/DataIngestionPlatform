// =============================================================================
// Upload Controller - Issues report and delivery output downloads (streamed)
// =============================================================================

import { Upload } from '../../models/Upload.model';
import { DeliveryRecord } from '../../models/DeliveryRecord.model';
import { sanitizeFilename } from '../../services/TemplateStorage.service';
import { azureStorage } from '../../services/AzureStorage.service';
import path from 'path';
import fs from 'fs';
import { pipeline } from 'stream/promises';
import { appConfig } from '../../config/appConfig';
import { logger } from '../../utils/logger';
import { asyncHandler } from '../../middleware/asyncHandler';
import { ForbiddenError, HttpError, NotFoundError } from '../../utils/httpError';
import {
    AZURE_BLOB_DELIVERY,
    FILE_COPY_DELIVERY,
    assertInsideDeliveryRoot,
    assertSafeDeliveryBlobName,
} from '../../services/DeliveryTargets.service';

export const downloadReport = asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const userId = req.user!.userId;
    try {
        if (!await Upload.hasAccessToUpload(id, userId)) {
            throw new ForbiddenError();
        }

        const upload = await Upload.findById(id);
        if (!upload) {
            throw new NotFoundError('Upload not found');
        }
        if (!upload.ReportBlobName) {
            throw new NotFoundError('Issues report is not available');
        }
        if (!azureStorage) throw new Error('Azure Blob Storage is not configured.');

        const stream = await azureStorage.openBlobReadStream(
            upload.ReportBlobName,
            appConfig.azure.storage.reportsContainerName,
        );
        const filename = sanitizeFilename(path.basename(upload.ReportBlobName));
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Type', path.extname(filename).toLowerCase() === '.csv' ? 'text/csv' : 'application/octet-stream');
        await pipeline(stream, res);
    } catch (error) {
        if (error instanceof HttpError) throw error;
        if ((error as { statusCode?: unknown } | null)?.statusCode === 404) {
            throw new NotFoundError('Issues report is not available');
        }
        logger.error(`[UPLOAD-REPORT] Download failed for upload ${id}: ${error instanceof Error ? error.name : 'UnknownError'}`);
        if (res.headersSent) {
            res.destroy();
            return;
        }
        throw new HttpError('Failed to download issues report', 500);
    }
});

export const downloadDelivery = asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const deliveryId = Array.isArray(req.params.deliveryId) ? req.params.deliveryId[0] : req.params.deliveryId;
    const userId = req.user!.userId;
    try {
        if (!await Upload.hasAccessToUpload(id, userId)) {
            throw new ForbiddenError();
        }

        const upload = await Upload.findById(id);
        if (!upload) {
            throw new NotFoundError('Upload not found');
        }

        const record = await DeliveryRecord.findById(deliveryId);
        if (!record || record.UploadId !== id) {
            throw new NotFoundError('Delivery output not found');
        }
        if (record.Status !== 'DELIVERED') {
            throw new HttpError('Delivery output is not ready', 409);
        }

        let stream: NodeJS.ReadableStream;
        if (record.DeliveryType === AZURE_BLOB_DELIVERY) {
            if (!azureStorage) throw new Error('Azure Blob Storage is not configured.');
            assertSafeDeliveryBlobName(record.DestinationPath);
            stream = await azureStorage.openBlobReadStream(
                record.DestinationPath,
                appConfig.azure.storage.deliveriesContainerName,
            );
        } else if (record.DeliveryType === FILE_COPY_DELIVERY) {
            const destination = path.resolve(record.DestinationPath);
            assertInsideDeliveryRoot(destination);
            await fs.promises.access(destination);
            stream = fs.createReadStream(destination);
        } else {
            throw new NotFoundError('Delivery output is not downloadable');
        }

        const filename = sanitizeFilename(record.DestinationPath.split(/[\\/]/).pop() || 'delivery');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader(
            'Content-Type',
            path.extname(filename).toLowerCase() === '.csv' ? 'text/csv' : 'application/octet-stream',
        );
        await pipeline(stream, res);
    } catch (error) {
        if (error instanceof HttpError) throw error;
        const statusCode = (error as { statusCode?: unknown } | null)?.statusCode;
        const errorCode = (error as NodeJS.ErrnoException | null)?.code;
        if (statusCode === 404 || errorCode === 'ENOENT') {
            if (res.headersSent) {
                res.destroy();
                return;
            }
            throw new NotFoundError('Delivery output is not available');
        }
        logger.error(`[UPLOAD-DELIVERY] Download failed for upload ${id}: ${error instanceof Error ? error.name : 'UnknownError'}`);
        if (res.headersSent) {
            res.destroy();
            return;
        }
        throw new HttpError('Failed to download delivery output', 500);
    }
});
