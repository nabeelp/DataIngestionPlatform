// =============================================================================
// Upload Controller - Upload listing and details
// =============================================================================

import { UploadService } from '../../services/Upload.service';
import { Upload } from '../../models/Upload.model';
import { asyncHandler } from '../../middleware/asyncHandler';
import { ForbiddenError, NotFoundError } from '../../utils/httpError';

/**
 * Get all uploads accessible to the user
 */
export const getUploads = asyncHandler(async (req, res) => {
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
export const getUploadById = asyncHandler(async (req, res) => {
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

/**
 * Get recent uploads (for dashboard)
 */
export const getRecentUploads = asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const limitStr = Array.isArray(req.query.limit) ? (req.query.limit[0] as string) : (req.query.limit as string);
    const limit = limitStr || '10';

    const uploads = await Upload.findRecentForUser(userId, parseInt(limit));

    res.json({
        success: true,
        uploads
    });
});
