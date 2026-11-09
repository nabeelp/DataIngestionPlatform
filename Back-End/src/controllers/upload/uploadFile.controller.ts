// =============================================================================
// Upload Controller - Multipart file upload (validation, blob upload, cleanup)
// =============================================================================

import { UploadService } from '../../services/Upload.service';
import { Upload } from '../../models/Upload.model';
import { FileDefinition } from '../../models/FileDefinition.model';
import { DefinitionVersionService } from '../../services/DefinitionVersion.service';
import { sanitizeFilename } from '../../services/TemplateStorage.service';
import { azureStorage } from '../../services/AzureStorage.service';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { logger } from '../../utils/logger';
import { asyncHandler } from '../../middleware/asyncHandler';
import { BadRequestError, ForbiddenError, HttpError } from '../../utils/httpError';

const EXCEL_FILE_TYPES = ['xlsx', 'xlsm', 'xls', 'xlsb'];

/**
 * Upload a file (multipart form data)
 */
export const uploadFile = asyncHandler(async (req, res) => {
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
        if (activeVersion.Contract.layout === 'sheets' && !EXCEL_FILE_TYPES.includes(fileType)) {
            const sheets = activeVersion.Contract.tables.map(table => `"${table.sheet}"`).join(', ');
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
