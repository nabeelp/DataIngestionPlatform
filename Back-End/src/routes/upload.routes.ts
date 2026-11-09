// =============================================================================
// Upload Routes - API endpoints for file uploads
// =============================================================================

import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { UploadController } from '../controllers/upload.controller';
import { authenticate } from '../middleware/authMiddleware';
import { appConfig } from '../config/appConfig';
import { logger } from '../utils/logger';
import { asyncHandler } from '../middleware/asyncHandler';
import { HttpError } from '../utils/httpError';
import { DashboardService } from '../services/Dashboard.service';
import { sanitizeFilename } from '../services/TemplateStorage.service';

const router = Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = appConfig.upload.tempDirectory;
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, `${uniqueSuffix}-${sanitizeFilename(file.originalname)}`);
    }
});

const ALLOWED_UPLOAD_MIME_TYPES = new Set([
    'text/csv',
    'application/csv',
    'text/tab-separated-values',
    'text/plain',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel.sheet.macroEnabled.12',
    'application/vnd.ms-excel.sheet.binary.macroEnabled.12',
    // Some browsers/OSes send a generic type for spreadsheets and CSV files.
    'application/octet-stream',
]);

const upload = multer({
    storage,
    limits: {
        fileSize: (appConfig.upload.maxFileSize || 100) * 1024 * 1024, // Convert MB to bytes
        files: 1,
    },
    fileFilter: (req, file, cb) => {
        const allowedExtensions = appConfig.upload.allowedExtensions;
        const ext = path.extname(file.originalname).toLowerCase();

        if (allowedExtensions.includes(ext) && ALLOWED_UPLOAD_MIME_TYPES.has(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error(`File type not supported. Allowed types: ${allowedExtensions.join(', ')}`));
        }
    }
});

// ============================================================================
// Public Routes (if needed)
// ============================================================================

// None for uploads - all require authentication

// ============================================================================
// Protected Routes
// ============================================================================

// All routes below require authentication
router.use(authenticate);

/**
 * GET /api/uploads
 * Get all uploads accessible to the user
 */
router.get('/', UploadController.getUploads);

/**
 * GET /api/uploads/recent
 * Get recent uploads for dashboard
 */
router.get('/recent', UploadController.getRecentUploads);

/**
 * GET /api/uploads/dashboard?days=7
 * Upload statistics and trends for the current user's dashboard
 */
router.get('/dashboard', asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const days = parseInt(String(req.query.days || '7'), 10);
    try {
        const dashboard = await DashboardService.getUserDashboard(userId, days);
        res.json({ success: true, dashboard });
    } catch (error) {
        logger.error(`[UPLOAD_ROUTES] Dashboard query failed: ${error instanceof Error ? error.name : 'UnknownError'}`);
        throw new HttpError('Failed to load dashboard', 500);
    }
}));

/**
 * GET /api/uploads/:id
 * Get single upload details
 */
router.get('/:id', UploadController.getUploadById);

/**
 * POST /api/uploads/:id/dry-run
 * Preview validation using the upload's pinned definition version.
 */
router.post('/:id/dry-run', UploadController.dryRun);

/**
 * GET /api/uploads/:id/report
 * Stream the persisted issues report after checking upload access.
 */
router.get('/:id/report', UploadController.downloadReport);

/**
 * GET /api/uploads/:id/deliveries/:deliveryId
 * Stream a delivered file after checking upload access.
 */
router.get('/:id/deliveries/:deliveryId', UploadController.downloadDelivery);

// ============================================================================
// Error handling for multer (scoped to the upload middleware so handler errors reach the central handler)
// ============================================================================

const handleUploadError = (err: unknown, _req: Request, res: Response, next: NextFunction) => {
    logger.error(`[MULTER-ERROR] File upload rejected: ${err instanceof Error ? err.name : 'UnknownError'}`);
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            res.status(400).json({
                success: false,
                message: `File size exceeds maximum allowed size of ${appConfig.upload.maxFileSize || 100}MB`
            });
            return;
        }
        res.status(400).json({
            success: false,
            message: err.message
        });
        return;
    }
    if (err) {
        res.status(400).json({
            success: false,
            message: err instanceof Error ? err.message : String(err)
        });
        return;
    }
    next();
};

/**
 * POST /api/uploads
 * Upload a file (multipart form data)
 */
router.post('/', upload.single('file'), handleUploadError, UploadController.uploadFile);

/**
 * POST /api/uploads/:id/verify
 * Start validation for an uploaded file
 */
router.post('/:id/verify', UploadController.startVerification);

/**
 * POST /api/uploads/:id/retry
 * Retry validation for a failed upload
 */
router.post('/:id/retry', UploadController.retryValidation);

/**
 * DELETE /api/uploads/:id
 * Delete an upload
 */
router.delete('/:id', UploadController.deleteUpload);

export default router;
