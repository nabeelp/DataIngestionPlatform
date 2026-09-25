// =============================================================================
// Upload Routes - API endpoints for file uploads
// =============================================================================

import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import { UploadController } from '../controllers/upload.controller';
import { authenticate } from '../middleware/authMiddleware';
import { appConfig } from '../config/appConfig';
import { logger } from '../utils/logger';
import { DashboardService } from '../services/Dashboard.service';
import { sanitizeFilename } from '../services/TemplateStorage.service';

const router = Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, appConfig.upload.tempDirectory || path.join(process.cwd(), 'temp'));
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
router.get('/', async (req: Request, res: Response) => {
    await UploadController.getUploads(req, res);
});

/**
 * GET /api/uploads/recent
 * Get recent uploads for dashboard
 */
router.get('/recent', async (req: Request, res: Response) => {
    await UploadController.getRecentUploads(req, res);
});

/**
 * GET /api/uploads/dashboard?days=7
 * Upload statistics and trends for the current user's dashboard
 */
router.get('/dashboard', async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        const days = parseInt(String(req.query.days || '7'), 10);
        const dashboard = await DashboardService.getUserDashboard(userId, days);
        res.json({ success: true, dashboard });
    } catch (error) {
        logger.error('[UPLOAD_ROUTES] Dashboard query failed', error);
        res.status(500).json({ success: false, message: 'Failed to load dashboard' });
    }
});

/**
 * GET /api/uploads/stuck (declared before /:id so it is not treated as an id)
 * Get list of stuck jobs (jobs that have been running longer than timeout)
 */
router.get('/stuck', async (req: Request, res: Response) => {
    await UploadController.getStuckJobs(req, res);
});

/**
 * GET /api/uploads/:id
 * Get single upload details
 */
router.get('/:id', async (req: Request, res: Response) => {
    await UploadController.getUploadById(req, res);
});

/**
 * GET /api/uploads/:id/progress
 * Get upload progress (for real-time updates)
 */
router.get('/:id/progress', async (req: Request, res: Response) => {
    await UploadController.getUploadProgress(req, res);
});

/**
 * POST /api/uploads
 * Upload a file (multipart form data)
 */
router.post('/', upload.single('file'), async (req: Request, res: Response) => {
    await UploadController.uploadFile(req, res);
});

/**
 * POST /api/uploads/:id/verify
 * Start validation for an uploaded file
 */
router.post('/:id/verify', async (req: Request, res: Response) => {
    await UploadController.startVerification(req, res);
});

/**
 * POST /api/uploads/:id/retry
 * Retry validation for a failed upload
 */
router.post('/:id/retry', async (req: Request, res: Response) => {
    await UploadController.retryValidation(req, res);
});

/**
 * POST /api/uploads/fail-stuck
 * Fail all jobs that have been stuck for longer than the timeout
 */
router.post('/fail-stuck', async (req: Request, res: Response) => {
    await UploadController.failStuckJobs(req, res);
});

/**
 * DELETE /api/uploads/:id
 * Delete an upload
 */
router.delete('/:id', async (req: Request, res: Response) => {
    await UploadController.deleteUpload(req, res);
});

// ============================================================================
// Error handling for multer
// ============================================================================

router.use((err: any, req: Request, res: Response, next: NextFunction) => {
    logger.error(`[MULTER-ERROR] File upload failed: ${err.message}, File: ${req.file?.originalname || 'unknown'}`, err);
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
            message: err.message
        });
        return;
    }
    next();
});

export default router;

