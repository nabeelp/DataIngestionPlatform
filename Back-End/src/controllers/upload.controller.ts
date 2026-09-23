// =============================================================================
// Upload Controller - API endpoints for file uploads
// =============================================================================

import { Request, Response } from 'express';
import { UploadService } from '../services/Upload.service';
import { Upload } from '../models/Upload.model';
import { sharePointStorage } from '../services/SharePointStorage.service';
import { desktopStorage } from '../services/DesktopStorage.service';
import { azureStorage } from '../services/AzureStorage.service';
import { failStuckJobs, getStuckJobs } from '../services/Queue.service';
import { appConfig } from '../config/appConfig';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { logger } from '../utils/logger';

const getStorageService = () => {
    switch (appConfig.storage.provider) {
        case 'desktop':
            if (desktopStorage) return desktopStorage;
            break;
        case 'sharepoint':
            if (sharePointStorage) return sharePointStorage;
            break;
        case 'azure':
            if (azureStorage && appConfig.azure.storage.connectionString) return azureStorage;
            break;
        default:
            throw new Error(`Unsupported STORAGE_PROVIDER: ${appConfig.storage.provider}`);
    }
    throw new Error(`STORAGE_PROVIDER ${appConfig.storage.provider} is not configured`);
};

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
            logger.error('Error fetching uploads:', error);
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
            logger.error('Error fetching upload:', error);
            res.status(500).json({
                success: false,
                message: error.message || 'Failed to fetch upload'
            });
        }
    }

    /**
     * Get upload progress (for real-time updates)
     */
    static async getUploadProgress(req: Request, res: Response): Promise<void> {
        console.log('Getting upload progress...');
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

            const progress = await UploadService.getUploadProgress(id);

            if (!progress) {
                res.status(404).json({
                    success: false,
                    message: 'Upload not found'
                });
                return;
            }

            res.json({
                success: true,
                ...progress
            });
        } catch (error: any) {
            logger.error('Error fetching upload progress:', error);
            res.status(500).json({
                success: false,
                message: error.message || 'Failed to fetch upload progress'
            });
        }
    }

    /**
     * Upload a file (multipart form data)
     */
    static async uploadFile(req: Request, res: Response): Promise<void> {
        console.log('Starting upload process...');
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

            const fileSize = req.file.size;
            const fileType = path.extname(req.file.originalname).toLowerCase().slice(1);
            logger.info(`[UPLOAD-START] User: ${userId}, File: ${req.file.originalname}, Size: ${fileSize}B, Type: ${fileType}, DefId: ${definitionId}`);

            // Generate unique IDs
            const uploadId = uuidv4();
            const storedFilename = `${uploadId}_${req.file.originalname}`;
            const tempFilename = `${uploadId}_${req.file.originalname}`;
            
            // 1. FIRST: Persist copy to temp directory for validation worker
            const tempDir = appConfig.upload.tempDirectory;
            const tempPath = path.join(tempDir, tempFilename);
            
            // Ensure temp dir exists
            const { mkdirSync } = await import('fs');
            mkdirSync(tempDir, { recursive: true });
            
            // Copy multer temp → persistent temp
            const { copyFileSync } = await import('fs');
            copyFileSync(req.file.path, tempPath);
            logger.info(`[UPLOAD-TEMP] Persisted: ${tempPath}`);
            
            // 2. THEN: Copy to configured storage
            const storageService = getStorageService();
            const uploadResult = await storageService.uploadFile(req.file.path, storedFilename);
            
            const storedUrl = 'fileUrl' in uploadResult ? uploadResult.fileUrl : uploadResult.blobUrl;
            logger.info(`[UPLOAD-STORAGE] UploadId: ${uploadId}, Path: ${storedUrl}`);
            
            // NOTE: Keep multer temp until validation complete (or clean later)

            // 3. Create upload record WITH TempLocalPath
            const upload = await UploadService.createUpload({
                FileDefinitionId: definitionId,
                OriginalFilename: req.file.originalname,
                StoredFilename: storedFilename,
                TempLocalPath: tempPath,  // ← CRITICAL: Set temp path
                FileSize: fileSize,
                FileType: fileType,
                RowCountNo: 0,
                SheetCount: 1
            }, userId);
            
            // 4. Update with storage URL (keep TempLocalPath)
            await Upload.update(upload.Id!, {
                AzureBlobUrl: storedUrl
                // TempLocalPath preserved from createUpload
            });

            // Queue validation only after the upload record and storage URL exist.
            await UploadService.startValidation(upload.Id!);
            const queuedUpload = await Upload.findById(upload.Id!);

            res.status(201).json({
                success: true,
                upload: queuedUpload || upload,
                message: 'File uploaded and queued for validation.'
            });

        } catch (error: any) {
            logger.error('Error uploading file:', error);
            res.status(500).json({
                success: false,
                message: error.message || 'Failed to upload file'
            });
        }
    }


    /**
     * Start validation for an uploaded file
     */
    static async startVerification(req: Request, res: Response): Promise<void> {
        console.log('Starting verification process...');
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
            console.log('We are validating, validation has started: ');
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
            logger.error('Error starting verification:', error);
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
            logger.error('Error retrying validation:', error);
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

            // Check if upload can be deleted
            if (upload.Status === 'VALIDATION_IN_PROGRESS' || upload.Status === 'DELIVERY_IN_PROGRESS') {
                res.status(400).json({
                    success: false,
                    message: 'Cannot delete upload that is currently being processed'
                });
                return;
            }

            // Delete temp file if exists and conditions met (Delivered or RetryCount >= 2)
            try {
                if (upload.TempLocalPath && fs.existsSync(upload.TempLocalPath)) {
                    const shouldDeleteTemp = upload.Status === 'DELIVERED' || upload.RetryCount >= 2;
                    if (shouldDeleteTemp) {
                        fs.unlinkSync(upload.TempLocalPath);
                        logger.info(`[DELETE-TEMP] Deleted temp file: ${upload.TempLocalPath}`);
                    } else {
                        logger.info(`[DELETE-SKIP] Keeping temp file for retry: ${upload.TempLocalPath} (Status: ${upload.Status}, Retries: ${upload.RetryCount})`);
                    }
                }
                
                // Delete from storage if exists
                if (upload.AzureBlobUrl || upload.CompressedBlobUrl) {
                    const storageService = getStorageService();
                    await (storageService as any).deleteBlob(upload.StoredFilename);
                    if (upload.CompressedBlobUrl) {
                        await (storageService as any).deleteBlob(upload.StoredFilename + '.gz');
                    }
                }
            } catch (e) {
                logger.warn('Failed to clean up files:', e);
            }


            // Delete from database (cascades to related records)
            await Upload.delete(id);

            res.json({
                success: true,
                message: 'Upload deleted successfully'
            });
        } catch (error: any) {
            logger.error('Error deleting upload:', error);
            res.status(500).json({
                success: false,
                message: error.message || 'Failed to delete upload'
            });
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
            logger.error('Error fetching recent uploads:', error);
            res.status(500).json({
                success: false,
                message: error.message || 'Failed to fetch recent uploads'
            });
        }
    }

    /**
     * Fail all stuck jobs that have been running longer than the timeout
     */
    static async failStuckJobs(req: Request, res: Response): Promise<void> {
        try {
            // Check if user is admin (only admins can trigger stuck job cleanup)
            const userId = (req as any).user?.userId;
            const userRole = (req as any).user?.role;
            
            if (userRole !== 'admin') {
                res.status(403).json({
                    success: false,
                    message: 'Only administrators can trigger stuck job cleanup'
                });
                return;
            }

            // Get optional timeout override from request body
            const timeoutMs = Array.isArray(req.body.timeoutMs) ? (req.body.timeoutMs[0] as string) : (req.body.timeoutMs as string);
            const timeout = timeoutMs ? parseInt(timeoutMs) : undefined;

            // Fail stuck jobs
            const result = await failStuckJobs(timeout);

            // Also update the upload statuses for the failed jobs
            for (const detail of result.details) {
                const jobType = detail.queueName === 'validation-queue' ? 'VALIDATION' : 'DELIVERY';
                await UploadService.handleTimeoutFailure(detail.uploadId, jobType, detail.stuckDurationMs);
            }

            res.json({
                success: true,
                message: `Failed ${result.validationJobsFailed + result.deliveryJobsFailed} stuck jobs`,
                validationJobsFailed: result.validationJobsFailed,
                deliveryJobsFailed: result.deliveryJobsFailed,
                details: result.details
            });
        } catch (error: any) {
            logger.error('Error failing stuck jobs:', error);
            res.status(500).json({
                success: false,
                message: error.message || 'Failed to fail stuck jobs'
            });
        }
    }

    /**
     * Get list of stuck jobs (jobs that have been running longer than timeout)
     */
    static async getStuckJobs(req: Request, res: Response): Promise<void> {
        try {
            // Check if user is admin
            const userRole = (req as any).user?.role;
            
            if (userRole !== 'admin') {
                res.status(403).json({
                    success: false,
                    message: 'Only administrators can view stuck jobs'
                });
                return;
            }

            // Get optional timeout override from query params
            const timeoutMsStr = Array.isArray(req.query.timeoutMs) ? (req.query.timeoutMs[0] as string) : (req.query.timeoutMs as string);
            const timeoutMs = timeoutMsStr ? timeoutMsStr : undefined;
            const timeout = timeoutMs ? parseInt(timeoutMs) : undefined;

            const stuckJobs = await getStuckJobs(timeout);
            
            const timeoutSetting = appConfig.workers.jobTimeout || 60000;

            res.json({
                success: true,
                timeoutMs: timeoutSetting,
                validationJobs: stuckJobs.validationJobs,
                deliveryJobs: stuckJobs.deliveryJobs,
                totalStuck: stuckJobs.validationJobs.length + stuckJobs.deliveryJobs.length
            });
        } catch (error: any) {
            logger.error('Error getting stuck jobs:', error);
            res.status(500).json({
                success: false,
                message: error.message || 'Failed to get stuck jobs'
            });
        }
    }
}
