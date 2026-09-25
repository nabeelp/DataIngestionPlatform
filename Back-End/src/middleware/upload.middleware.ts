import multer from 'multer';
import path from 'path';
import { ALLOWED_TEMPLATE_EXTENSIONS } from '../services/TemplateStorage.service';

const ALLOWED_TEMPLATE_MIME_TYPES = new Set([
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv',
    'application/csv',
    'text/plain',
    // Some browsers/OSes send a generic type for spreadsheets and CSV files.
    'application/octet-stream',
]);

/**
 * Multer upload middleware for template files. Files are held in memory (max 10MB) and persisted
 * through TemplateStorage so they follow the configured storage provider.
 */
export const uploadTemplate = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024,
        files: 1,
    },
    fileFilter: (_req, file, cb) => {
        const extension = path.extname(file.originalname).toLowerCase();
        if (ALLOWED_TEMPLATE_EXTENSIONS.includes(extension) && ALLOWED_TEMPLATE_MIME_TYPES.has(file.mimetype)) {
            cb(null, true);
            return;
        }
        cb(new Error('Only Excel (xlsx, xls), CSV, or TXT template files are allowed'));
    },
});
