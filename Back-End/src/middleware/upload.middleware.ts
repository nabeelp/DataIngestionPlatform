import multer from 'multer';
import path from 'path';
import { mkdirSync } from 'fs';

/**
 * Multer upload middleware for template files
 */
export const uploadTemplate = multer({
    dest: 'uploads/templates/',
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = /xlsx?|xls|csv|txt/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);

        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Only Excel (xlsx, xls), CSV, TXT files are allowed'));
        }
    },
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            const templateDir = path.join(process.cwd(), 'uploads', 'templates');
            mkdirSync(templateDir, { recursive: true });
            cb(null, templateDir);
        },
        filename: (req, file, cb) => {
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
            cb(null, `${file.fieldname}-${uniqueSuffix}${path.extname(file.originalname)}`);
        }
    })
});
