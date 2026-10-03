// =============================================================================
// Desktop Storage Service - Simple date-based Desktop folder storage
// Uses a configurable local destination by date.
// =============================================================================

import path from 'path';
import { mkdirSync, copyFileSync, existsSync, unlinkSync, statSync, readdirSync } from 'fs';
import { appConfig } from '../config/appConfig';
import { logger } from '../utils/logger';

export interface UploadedFileInfo {
    fileUrl: string;
    containerName: string;
    filename: string;
    size: number;
    year: string;
    month: string;
    day: string;
}

const BASE_PATH = process.env.DESKTOP_STORAGE_PATH || path.join(process.cwd(), 'desktop-uploads');

export class DesktopStorageService {
    private basePath: string = BASE_PATH;

    constructor() {
        this.ensureBasePath();
        logger.info(`[DesktopStorage] Initialized at: ${this.basePath}`);
    }

    private ensureBasePath(): void {
        if (!existsSync(this.basePath)) {
            mkdirSync(this.basePath, { recursive: true });
            logger.info(`[DesktopStorage] Created base path: ${this.basePath}`);
        }
    }

    private getDatePath(date: Date = new Date()): string {
        const year = date.getFullYear().toString();
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');
        return path.join(this.basePath, year, month, day);
    }

    private ensureDatePath(datePath: string): void {
        if (!existsSync(datePath)) {
            mkdirSync(datePath, { recursive: true });
            logger.info(`[DesktopStorage] Created date path: ${datePath}`);
        }
    }

    /**
     * Upload file to date-based Desktop folder
     */
    async uploadFile(localFilePath: string, filename: string): Promise<UploadedFileInfo> {
        const todayPath = this.getDatePath();
        this.ensureDatePath(todayPath);
        const destPath = path.join(todayPath, filename);

        copyFileSync(localFilePath, destPath);
        
        const stats = statSync(destPath);
        const size = stats.size;
        const fileUrl = destPath.replace(/C:\\Users\\\w+/, 'Desktop').replace(/\\/g, '/');

        logger.info(`[DesktopStorage] Uploaded: ${filename} → ${destPath} (${size}B)`);

        return {
            fileUrl,
            containerName: 'desktop',
            filename,
            size,
            year: todayPath.split(path.sep)[todayPath.split(path.sep).length - 3],
            month: todayPath.split(path.sep)[todayPath.split(path.sep).length - 2],
            day: todayPath.split(path.sep)[todayPath.split(path.sep).length - 1]
        };
    }

    /**
     * Copy file for delivery (post-validation)
     */
    async copyDeliveredFile(sourcePath: string, uploadId: string, originalFilename: string): Promise<UploadedFileInfo> {
        const deliveredPath = path.join(this.getDatePath(), `DELIVERED_${uploadId}_${originalFilename}`);
        this.ensureDatePath(path.dirname(deliveredPath));
        
        copyFileSync(sourcePath, deliveredPath);
        
        const stats = statSync(deliveredPath);
        const size = stats.size;
        const fileUrl = deliveredPath.replace(/C:\\Users\\\w+/, 'Desktop').replace(/\\/g, '/');

        logger.info(`[DesktopStorage] Delivered: ${originalFilename} → ${deliveredPath}`);

        return {
            fileUrl,
            containerName: 'desktop-delivered',
            filename: path.basename(deliveredPath),
            size,
            year: path.dirname(deliveredPath).split(path.sep)[path.dirname(deliveredPath).split(path.sep).length - 3],
            month: path.dirname(deliveredPath).split(path.sep)[path.dirname(deliveredPath).split(path.sep).length - 2],
            day: path.dirname(deliveredPath).split(path.sep)[path.dirname(deliveredPath).split(path.sep).length - 1]
        };
    }

    /**
     * Delete file
     */
    async deleteFile(filename: string, year?: string, month?: string, day?: string): Promise<void> {
        const datePath = year && month && day 
            ? path.join(this.basePath, year, month, day)
            : this.getDatePath();
        const fullPath = path.join(datePath, filename);
        
        if (existsSync(fullPath)) {
            unlinkSync(fullPath);
            logger.info(`[DesktopStorage] Deleted: ${fullPath}`);
        }
    }

    /**
     * List files in date path
     */
    listFiles(year?: string, month?: string, day?: string): string[] {
        const datePath = year && month && day 
            ? path.join(this.basePath, year, month, day)
            : this.getDatePath();
        
        if (!existsSync(datePath)) return [];
        
        return readdirSync(datePath);
    }

}

// Singleton export
let desktopStorage: DesktopStorageService | null = null;
if (appConfig.storage.provider === 'desktop') {
    desktopStorage = new DesktopStorageService();
}
export { desktopStorage };
