// =============================================================================
// Upload Routes - API endpoints for file uploads
// =============================================================================

import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import { UploadController } from '../controllers/upload.controller';
import { authenticate } from '../middleware/authMiddleware';
import { appConfig } from '../config/appConfig';
import { logger } from '../utils/logger';

const router = Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, appConfig.upload.tempDirectory || path.join(process.cwd(), 'temp'));
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname);
    }
});

const upload = multer({
    storage,
    limits: {
        fileSize: (appConfig.upload.maxFileSize || 100) * 1024 * 1024 // Convert MB to bytes
    },
    fileFilter: (req, file, cb) => {
        // Allow common file types
        const allowedTypes = [
            'text/csv',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/json',
            'text/xml',
            'application/xml',
            'text/plain'
        ];
        
        // Also check file extension
        const allowedExtensions = ['.csv', '.xlsx', '.xls', '.json', '.xml', '.txt'];
        const ext = path.extname(file.originalname).toLowerCase();
        
        if (allowedTypes.includes(file.mimetype) || allowedExtensions.includes(ext)) {
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
 * GET /api/uploads/stuck
 * Get list of stuck jobs (jobs that have been running longer than timeout)
 */
router.get('/stuck', async (req: Request, res: Response) => {
    await UploadController.getStuckJobs(req, res);
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

router.use((err: any, req: Request, res: Response, next: Function) => {
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

