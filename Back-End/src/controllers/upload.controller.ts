// =============================================================================
// Upload Controller - API endpoints for file uploads.
// Facade over the focused handlers in ./upload so routes and tests keep the same UploadController shape.
// =============================================================================

import { getUploads, getUploadById, getRecentUploads } from './upload/uploadQueries.controller';
import { dryRun } from './upload/dryRun.controller';
import { uploadFile } from './upload/uploadFile.controller';
import { startVerification, retryValidation, deleteUpload } from './upload/lifecycle.controller';
import { downloadReport, downloadDelivery } from './upload/downloads.controller';

export class UploadController {
    static getUploads = getUploads;
    static getUploadById = getUploadById;
    static getRecentUploads = getRecentUploads;
    static dryRun = dryRun;
    static uploadFile = uploadFile;
    static startVerification = startVerification;
    static retryValidation = retryValidation;
    static deleteUpload = deleteUpload;
    static downloadReport = downloadReport;
    static downloadDelivery = downloadDelivery;
}
