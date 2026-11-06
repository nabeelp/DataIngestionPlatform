// =============================================================================
// Upload Controller - API endpoints for file uploads
// =============================================================================

import { UploadService } from '../services/Upload.service';
import { Upload } from '../models/Upload.model';
import { DeliveryRecord } from '../models/DeliveryRecord.model';
import { FileDefinition } from '../models/FileDefinition.model';
import { DefinitionVersionService } from '../services/DefinitionVersion.service';
import { AuthoringInputError, buildAuthoringContract } from '../services/RuleAuthoring.service';
import { sanitizeFilename } from '../services/TemplateStorage.service';
import { azureStorage } from '../services/AzureStorage.service';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { pipeline } from 'stream/promises';
import { appConfig } from '../config/appConfig';
import { logger } from '../utils/logger';
import { asyncHandler } from '../middleware/asyncHandler';
import { BadRequestError, ForbiddenError, HttpError, NotFoundError } from '../utils/httpError';
import { RulesService, RulesServiceError } from '../services/RulesService.service';
import {
    AZURE_BLOB_DELIVERY,
    FILE_COPY_DELIVERY,
    assertInsideDeliveryRoot,
    assertSafeDeliveryBlobName,
} from '../services/DeliveryTargets.service';
const EXCEL_FILE_TYPES = ['xlsx', 'xlsm', 'xls', 'xlsb'];

export class UploadController {

    /**
     * Get all uploads accessible to the user
     */
    static getUploads = asyncHandler(async (req, res) => {
        const userId = req.user!.userId;
        const page = Array.isArray(req.query.page) ? (req.query.page[0] as string) || '1' : (req.query.page as string) || '1';
        const pageSize = Array.isArray(req.query.pageSize) ? (req.query.pageSize[0] as string) || '20' : (req.query.pageSize as string) || '20';
        const status = Array.isArray(req.query.status) ? (req.query.status[0] as string) : (req.query.status as string);

        const result = await UploadService.getUploadsForUser(userId, {
            page: parseInt(page),
            pageSize: parseInt(pageSize),
            status: status || undefined
        });

        res.json({
            success: true,
            uploads: result.uploads,
            total: result.total,
            page: parseInt(page),
            pageSize: parseInt(pageSize)
        });
    });

    /**
     * Get single upload details
     */
    static getUploadById = asyncHandler(async (req, res) => {
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const userId = req.user!.userId;

        // Check if user has access to this upload
        const hasAccess = await Upload.hasAccessToUpload(id, userId);
        if (!hasAccess) {
            throw new ForbiddenError();
        }

        const result = await UploadService.getUploadDetails(id);

        if (!result.success || !result.upload) {
            throw new NotFoundError('Upload not found');
        }

        res.json(result);
    });

    static dryRun = asyncHandler(async (req, res) => {
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
            // The definition workspace previews its unsaved structure and rules (admins only).
            const draftBody = req.body?.Contract;
            if (draftBody && req.user?.role !== 'admin') {
                throw new ForbiddenError('Admin access required');
            }
            const draftContract = draftBody
                ? await buildAuthoringContract(draftBody, req.body?.Rules)
                : await DefinitionVersionService.getDraftContract(upload.FileDefinitionId);
            const result = await RulesService.dryRun(draftContract, upload.Id);
            res.json({ success: true, ...result });
        } catch (error) {
            if (error instanceof HttpError) throw error;
            logger.error(`[UPLOAD-DRY-RUN] Failed for upload ${id}: ${error instanceof Error ? error.name : 'UnknownError'}`);
            if (error instanceof AuthoringInputError) {
                throw new BadRequestError(error.message);
            }
            if (error instanceof RulesServiceError && error.statusCode === 400) {
                throw new HttpError('The uploaded file could not be previewed.', 422);
            }
            throw new HttpError('Failed to run validation preview', 500);
        }
    });


    /**
     * Upload a file (multipart form data)
     */
    static uploadFile = asyncHandler(async (req, res) => {
        let uploadId = '';
        let uploadedBlobName: string | null = null;
        let uploadRecordCreationAttempted = false;
        try {
            const userId = req.user!.userId;
            const definitionId = Array.isArray(req.body.definitionId) ? req.body.definitionId[0] : req.body.definitionId as string;

            if (!definitionId) {
                throw new BadRequestError('File definition ID is required');
            }

            if (!req.file) {
                throw new BadRequestError('No file uploaded');
            }

            const hasDefinitionAccess = await FileDefinition.hasAccess(definitionId, userId);
            if (!hasDefinitionAccess) {
                throw new ForbiddenError('You do not have access to this file definition');
            }

            const fileSize = req.file.size;
            const fileType = path.extname(req.file.originalname).toLowerCase().slice(1);

            // Definitions with one table per sheet can only validate workbooks.
            const activeVersion = await DefinitionVersionService.ensureActiveVersion(definitionId, userId);
            if (activeVersion.Tables.length > 0 && !EXCEL_FILE_TYPES.includes(fileType)) {
                const sheets = activeVersion.Tables.map(table => `"${table.sheet}"`).join(', ');
                throw new BadRequestError(`This definition expects an Excel workbook (.xlsx or .xls) with the sheets ${sheets}`);
            }
            logger.info(`[UPLOAD-START] UserId: ${userId}, DefinitionId: ${definitionId}, Size: ${fileSize}B, Type: ${fileType}`);

            uploadId = uuidv4();
            const safeFilename = sanitizeFilename(req.file.originalname);
            const storedFilename = `${uploadId}_${safeFilename}`;
            const blobName = `${uploadId}/${safeFilename}`;
            if (!azureStorage) throw new Error('Azure Blob Storage is not configured.');
            const uploadResult = await azureStorage.uploadFile(req.file.path, blobName);
            uploadedBlobName = blobName;

            uploadRecordCreationAttempted = true;
            const upload = await UploadService.createUpload({
                FileDefinitionId: definitionId,
                FileDefinitionVersionId: activeVersion.Id,
                OriginalFilename: req.file.originalname,
                StoredFilename: storedFilename,
                BlobContainer: uploadResult.containerName,
                BlobName: uploadResult.blobName,
                FileSha256: uploadResult.sha256,
                ValidationDate: new Date(),
                FileSize: fileSize,
                FileType: fileType,
                RowCountNo: 0,
                SheetCount: 1
            }, userId);
            await UploadService.startValidation(upload.Id!);
            const queuedUpload = await Upload.findById(upload.Id!);

            res.status(201).json({
                success: true,
                upload: queuedUpload || upload,
                message: 'File uploaded and queued for validation.'
            });

        } catch (error) {
            if (!(error instanceof HttpError)) {
                logger.error(`[UPLOAD] Failed for upload ${uploadId || 'not-created'}: ${error instanceof Error ? error.name : 'UnknownError'}`);
            }
            if (uploadedBlobName && !uploadRecordCreationAttempted && azureStorage) {
                try {
                    await azureStorage.deleteBlob(uploadedBlobName);
                } catch (cleanupError) {
                    logger.warn(`[UPLOAD] Blob cleanup failed for upload ${uploadId}: ${cleanupError instanceof Error ? cleanupError.name : 'UnknownError'}`);
                }
            }
            throw error;
        } finally {
            if (req.file?.path) {
                try {
                    await fs.promises.rm(req.file.path, { force: true });
                } catch (cleanupError) {
                    logger.warn(`[UPLOAD] Multipart temporary file cleanup failed for upload ${uploadId || 'not-created'}: ${cleanupError instanceof Error ? cleanupError.name : 'UnknownError'}`);
                }
            }
        }
    });


    /**
     * Start validation for an uploaded file
     */
    static startVerification = asyncHandler(async (req, res) => {
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
    static retryValidation = asyncHandler(async (req, res) => {
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
    static deleteUpload = asyncHandler(async (req, res) => {
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

    static downloadReport = asyncHandler(async (req, res) => {
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

    static downloadDelivery = asyncHandler(async (req, res) => {
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

    /**
     * Get recent uploads (for dashboard)
     */
    static getRecentUploads = asyncHandler(async (req, res) => {
        const userId = req.user!.userId;
        const limitStr = Array.isArray(req.query.limit) ? (req.query.limit[0] as string) : (req.query.limit as string);
        const limit = limitStr || '10';

        const uploads = await Upload.findRecentForUser(userId, parseInt(limit));

        res.json({
            success: true,
            uploads
        });
    });

}
