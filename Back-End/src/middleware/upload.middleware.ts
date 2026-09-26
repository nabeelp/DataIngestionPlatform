import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { ALLOWED_TEMPLATE_EXTENSIONS } from '../services/TemplateStorage.service';
import { appConfig } from '../config/appConfig';

export const EXAMPLE_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

const EXAMPLE_MIME_TYPES: Record<string, Set<string>> = {
    '.csv': new Set(['text/csv', 'application/csv', 'text/plain', 'application/vnd.ms-excel', 'application/octet-stream']),
    '.xlsx': new Set(['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream']),
};

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

/**
 * Multer upload middleware for example files analyzed to propose a definition. The file is written to the
 * upload temp directory under a random name; the handler must delete it once analyzed. It is never stored.
 */
export const uploadExample = multer({
    storage: multer.diskStorage({
        destination: (_req, _file, cb) => {
            const dir = appConfig.upload.tempDirectory;
            fs.mkdirSync(dir, { recursive: true });
            cb(null, dir);
        },
        filename: (_req, file, cb) => cb(null, `example-${randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
    }),
    limits: {
        fileSize: EXAMPLE_MAX_FILE_SIZE_BYTES,
        files: 1,
    },
    fileFilter: (_req, file, cb) => {
        const extension = path.extname(file.originalname).toLowerCase();
        if (EXAMPLE_MIME_TYPES[extension]?.has(file.mimetype)) {
            cb(null, true);
            return;
        }
        cb(new Error('Example files must be CSV (.csv) or Excel workbooks (.xlsx)'));
    },
});
