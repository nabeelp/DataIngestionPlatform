// =============================================================================
// Upload Controller - API endpoints for file uploads
// =============================================================================

import { Request, Response } from 'express';
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
    static async getUploads(req: Request, res: Response): Promise<void> {
        try {
            const userId = (req as any).user?.userId;
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
        } catch (error: any) {
            logger.error(`[UPLOAD] Listing failed: ${error instanceof Error ? error.name : 'UnknownError'}`);
            res.status(500).json({
                success: false,
                message: error.message || 'Failed to fetch uploads'
            });
        }
    }

    /**
     * Get single upload details
     */
    static async getUploadById(req: Request, res: Response): Promise<void> {
        try {
            const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
            const userId = (req as any).user?.userId;

            // Check if user has access to this upload
            const hasAccess = await Upload.hasAccessToUpload(id, userId);
            if (!hasAccess) {
                res.status(403).json({
                    success: false,
                    message: 'Access denied'
                });
                return;
            }

            const result = await UploadService.getUploadDetails(id);

            if (!result.success || !result.upload) {
                res.status(404).json({
                    success: false,
                    message: 'Upload not found'
                });
                return;
            }

            res.json(result);
        } catch (error: any) {
            logger.error(`[UPLOAD] Lookup failed: ${error instanceof Error ? error.name : 'UnknownError'}`);
            res.status(500).json({
                success: false,
                message: error.message || 'Failed to fetch upload'
            });
        }
    }

    static async dryRun(req: Request, res: Response): Promise<void> {
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const userId = (req as any).user?.userId;
        try {
            if (!await Upload.hasAccessToUpload(id, userId)) {
                res.status(403).json({ success: false, message: 'Access denied' });
                return;
            }
            const upload = await Upload.findById(id);
            if (!upload) {
                res.status(404).json({ success: false, message: 'Upload not found' });
                return;
            }
            // The definition workspace previews its unsaved structure and rules (admins only).
            const draftBody = req.body?.Contract;
            if (draftBody && (req as any).user?.role !== 'admin') {
                res.status(403).json({ success: false, message: 'Admin access required' });
                return;
            }
            const draftContract = draftBody
                ? await buildAuthoringContract(draftBody, req.body?.Rules)
                : await DefinitionVersionService.getDraftContract(upload.FileDefinitionId);
            const result = await RulesService.dryRun(draftContract, upload.Id);
            res.json({ success: true, ...result });
        } catch (error) {
            logger.error(`[UPLOAD-DRY-RUN] Failed for upload ${id}: ${error instanceof Error ? error.name : 'UnknownError'}`);
            if (error instanceof AuthoringInputError) {
                res.status(400).json({ success: false, message: error.message });
                return;
            }
            if (error instanceof RulesServiceError && error.statusCode === 400) {
                res.status(422).json({ success: false, message: 'The uploaded file could not be previewed.' });
                return;
            }
            res.status(500).json({ success: false, message: 'Failed to run validation preview' });
        }
    }

    /**
     * Upload a file (multipart form data)
     */
    static async uploadFile(req: Request, res: Response): Promise<void> {
        let uploadId = '';
        let uploadedBlobName: string | null = null;
        let uploadRecordCreationAttempted = false;
        try {
            const userId = (req as any).user?.userId;
            const definitionId = Array.isArray(req.body.definitionId) ? req.body.definitionId[0] : req.body.definitionId as string;

            if (!definitionId) {
                res.status(400).json({
                    success: false,
                    message: 'File definition ID is required'
                });
                return;
            }

            if (!req.file) {
                res.status(400).json({
                    success: false,
                    message: 'No file uploaded'
                });
                return;
            }

            const hasDefinitionAccess = await FileDefinition.hasAccess(definitionId, userId);
            if (!hasDefinitionAccess) {
                res.status(403).json({
                    success: false,
                    message: 'You do not have access to this file definition'
                });
                return;
            }

            const fileSize = req.file.size;
            const fileType = path.extname(req.file.originalname).toLowerCase().slice(1);

            // Definitions with one table per sheet can only validate workbooks.
            const activeVersion = await DefinitionVersionService.ensureActiveVersion(definitionId, userId);
            if (activeVersion.Tables.length > 0 && !EXCEL_FILE_TYPES.includes(fileType)) {
                const sheets = activeVersion.Tables.map(table => `"${table.sheet}"`).join(', ');
                res.status(400).json({
                    success: false,
                    message: `This definition expects an Excel workbook (.xlsx or .xls) with the sheets ${sheets}`
                });
                return;
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

        } catch (error: any) {
            logger.error(`[UPLOAD] Failed for upload ${uploadId || 'not-created'}: ${error instanceof Error ? error.name : 'UnknownError'}`);
            if (uploadedBlobName && !uploadRecordCreationAttempted && azureStorage) {
                try {
                    await azureStorage.deleteBlob(uploadedBlobName);
                } catch (cleanupError) {
                    logger.warn(`[UPLOAD] Blob cleanup failed for upload ${uploadId}: ${cleanupError instanceof Error ? cleanupError.name : 'UnknownError'}`);
                }
            }
            res.status(500).json({
                success: false,
                message: error instanceof Error ? error.message : 'Failed to upload file'
            });
        } finally {
            if (req.file?.path) {
                try {
                    await fs.promises.rm(req.file.path, { force: true });
                } catch (cleanupError) {
                    logger.warn(`[UPLOAD] Multipart temporary file cleanup failed for upload ${uploadId || 'not-created'}: ${cleanupError instanceof Error ? cleanupError.name : 'UnknownError'}`);
                }
            }
        }
    }


    /**
     * Start validation for an uploaded file
     */
    static async startVerification(req: Request, res: Response): Promise<void> {
        try {
            const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
            const userId = (req as any).user?.userId;

            // Check access
            const hasAccess = await Upload.hasAccessToUpload(id, userId);
            if (!hasAccess) {
                res.status(403).json({
                    success: false,
                    message: 'Access denied'
                });
                return;
            }

            const upload = await Upload.findById(id);
            if (!upload) {
                res.status(404).json({
                    success: false,
                    message: 'Upload not found'
                });
                return;
            }
            // Check if upload is in valid state for verification
            if (upload.Status !== 'UPLOADED' && upload.Status !== 'VALIDATION_FAILED') {
                res.status(400).json({
                    success: false,
                    message: `Cannot start validation. Current status: ${upload.Status}`
                });
                return;
            }

            // Start validation
            await UploadService.startValidation(id);

            res.json({
                success: true,
                message: 'Validation started successfully'
            });
        } catch (error: any) {
            logger.error(`[UPLOAD] Validation request failed: ${error instanceof Error ? error.name : 'UnknownError'}`);
            res.status(500).json({
                success: false,
                message: error.message || 'Failed to start verification'
            });
        }
    }

    /**
     * Retry validation for a failed upload
     */
    static async retryValidation(req: Request, res: Response): Promise<void> {
        try {
            const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
            const userId = (req as any).user?.userId;

            // Check access
            const hasAccess = await Upload.hasAccessToUpload(id, userId);
            if (!hasAccess) {
                res.status(403).json({
                    success: false,
                    message: 'Access denied'
                });
                return;
            }

            const upload = await Upload.findById(id);
            if (!upload) {
                res.status(404).json({
                    success: false,
                    message: 'Upload not found'
                });
                return;
            }

            // Check if upload can be retried
            if (upload.Status !== 'VALIDATION_FAILED' && upload.Status !== 'DELIVERY_FAILED') {
                res.status(400).json({
                    success: false,
                    message: `Cannot retry. Current status: ${upload.Status}`
                });
                return;
            }

            // Reset status and start validation again
            await Upload.updateStatus(id, 'UPLOADED');
            await UploadService.startValidation(id);

            res.json({
                success: true,
                message: 'Validation retry started successfully'
            });
        } catch (error: any) {
            logger.error(`[UPLOAD] Validation retry failed: ${error instanceof Error ? error.name : 'UnknownError'}`);
            res.status(500).json({
                success: false,
                message: error.message || 'Failed to retry validation'
            });
        }
    }

    /**
     * Delete an upload
     */
    static async deleteUpload(req: Request, res: Response): Promise<void> {
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        try {
            const userId = (req as any).user?.userId;

            // Check access
            const hasAccess = await Upload.hasAccessToUpload(id, userId);
            if (!hasAccess) {
                res.status(403).json({
                    success: false,
                    message: 'Access denied'
                });
                return;
            }

            const upload = await Upload.findById(id);
            if (!upload) {
                res.status(404).json({
                    success: false,
                    message: 'Upload not found'
                });
                return;
            }

            // Check if upload can be deleted
            if (upload.Status === 'VALIDATION_IN_PROGRESS' || upload.Status === 'DELIVERY_IN_PROGRESS') {
                res.status(400).json({
                    success: false,
                    message: 'Cannot delete upload that is currently being processed'
                });
                return;
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
        } catch (error: any) {
            logger.error(`[UPLOAD] Delete failed for upload ${id}: ${error instanceof Error ? error.name : 'UnknownError'}`);
            res.status(500).json({
                success: false,
                message: error.message || 'Failed to delete upload'
            });
        }
    }

    static async downloadReport(req: Request, res: Response): Promise<void> {
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const userId = (req as any).user?.userId;
        try {
            if (!await Upload.hasAccessToUpload(id, userId)) {
                res.status(403).json({ success: false, message: 'Access denied' });
                return;
            }

            const upload = await Upload.findById(id);
            if (!upload) {
                res.status(404).json({ success: false, message: 'Upload not found' });
                return;
            }
            if (!upload.ReportBlobName) {
                res.status(404).json({ success: false, message: 'Issues report is not available' });
                return;
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
            const statusCode = (error as { statusCode?: unknown })?.statusCode;
            if (statusCode === 404) {
                res.status(404).json({ success: false, message: 'Issues report is not available' });
                return;
            }
            logger.error(`[UPLOAD-REPORT] Download failed for upload ${id}: ${error instanceof Error ? error.name : 'UnknownError'}`);
            if (res.headersSent) {
                res.destroy();
                return;
            }
            res.status(500).json({ success: false, message: 'Failed to download issues report' });
        }
    }

    static async downloadDelivery(req: Request, res: Response): Promise<void> {
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const deliveryId = Array.isArray(req.params.deliveryId) ? req.params.deliveryId[0] : req.params.deliveryId;
        const userId = (req as any).user?.userId;
        try {
            if (!await Upload.hasAccessToUpload(id, userId)) {
                res.status(403).json({ success: false, message: 'Access denied' });
                return;
            }

            const upload = await Upload.findById(id);
            if (!upload) {
                res.status(404).json({ success: false, message: 'Upload not found' });
                return;
            }

            const record = await DeliveryRecord.findById(deliveryId);
            if (!record || record.UploadId !== id) {
                res.status(404).json({ success: false, message: 'Delivery output not found' });
                return;
            }
            if (record.Status !== 'DELIVERED') {
                res.status(409).json({ success: false, message: 'Delivery output is not ready' });
                return;
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
                res.status(404).json({ success: false, message: 'Delivery output is not downloadable' });
                return;
            }

            const filename = sanitizeFilename(record.DestinationPath.split(/[\\/]/).pop() || 'delivery');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.setHeader(
                'Content-Type',
                path.extname(filename).toLowerCase() === '.csv' ? 'text/csv' : 'application/octet-stream',
            );
            await pipeline(stream, res);
        } catch (error) {
            const statusCode = (error as { statusCode?: unknown })?.statusCode;
            const errorCode = (error as NodeJS.ErrnoException)?.code;
            if (statusCode === 404 || errorCode === 'ENOENT') {
                if (!res.headersSent) {
                    res.status(404).json({ success: false, message: 'Delivery output is not available' });
                } else {
                    res.destroy();
                }
                return;
            }
            logger.error(`[UPLOAD-DELIVERY] Download failed for upload ${id}: ${error instanceof Error ? error.name : 'UnknownError'}`);
            if (res.headersSent) {
                res.destroy();
                return;
            }
            res.status(500).json({ success: false, message: 'Failed to download delivery output' });
        }
    }

    /**
     * Get recent uploads (for dashboard)
     */
    static async getRecentUploads(req: Request, res: Response): Promise<void> {
        try {
            const userId = (req as any).user?.userId;
            const limitStr = Array.isArray(req.query.limit) ? (req.query.limit[0] as string) : (req.query.limit as string);
            const limit = limitStr || '10';

            const uploads = await Upload.findRecentForUser(userId, parseInt(limit));

            res.json({
                success: true,
                uploads
            });
        } catch (error: any) {
            logger.error(`[UPLOAD] Recent uploads lookup failed: ${error instanceof Error ? error.name : 'UnknownError'}`);
            res.status(500).json({
                success: false,
                message: error.message || 'Failed to fetch recent uploads'
            });
        }
    }

}
