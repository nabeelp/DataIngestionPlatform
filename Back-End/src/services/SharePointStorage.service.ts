// =============================================================================
// SharePoint Storage Service - Local File System as SharePoint Placeholder
// =============================================================================
// This service uses a local folder to simulate SharePoint storage.
// Replace with actual SharePoint API integration when ready.

import { appConfig } from '../config/appConfig';
import { logger } from '../utils/logger';
import { createGzip } from 'zlib';
import { pipeline } from 'stream/promises';
import { createReadStream, createWriteStream, existsSync, mkdirSync, copyFileSync, unlinkSync, readdirSync, statSync } from 'fs';
import path from 'path';
import os from 'os';

export interface UploadedFileInfo {
    blobUrl: string;
    containerName: string;
    blobName: string;
    size: number;
    compressed: boolean;
    compressedSize?: number;
    compressedBlobUrl?: string;
}

export interface StreamOptions {
    chunkSize?: number;
    onProgress?: (bytesProcessed: number, totalBytes: number) => void;
}

/**
 * SharePoint Storage Service class
 * Uses local file system as a placeholder for SharePoint
 */
export class SharePointStorageService {
    private basePath: string;
    private containerName: string;
    private compressedContainerName: string;

    constructor() {
        // Use a local folder as SharePoint placeholder
        // Can be configured via SHAREPOINT_LOCAL_PATH in .env
        this.basePath = process.env.SHAREPOINT_LOCAL_PATH || path.join(process.cwd(), 'sharepoint');
        this.containerName = 'uploads';
        this.compressedContainerName = 'compressed';
        
        this.ensureDirectoryExists(this.basePath);
        this.ensureDirectoryExists(path.join(this.basePath, this.containerName));
        this.ensureDirectoryExists(path.join(this.basePath, this.compressedContainerName));
        
        logger.info(`[SharePoint Storage] Initialized at: ${this.basePath}`);
    }

    /**
     * Ensure a directory exists, create if not
     */
    private ensureDirectoryExists(dirPath: string): void {
        if (!existsSync(dirPath)) {
            mkdirSync(dirPath, { recursive: true });
            logger.info(`[SharePoint Storage] Created directory: ${dirPath}`);
        }
    }

    /**
     * Get container path
     */
    private getContainerPath(containerName: string): string {
        return path.join(this.basePath, containerName);
    }

    /**
     * Upload a file (simulate SharePoint upload)
     */
    async uploadFile(
        localFilePath: string, 
        blobName: string,
        options: { compress?: boolean } = {}
    ): Promise<UploadedFileInfo> {
        const containerPath = this.getContainerPath(this.containerName);
        const destPath = path.join(containerPath, blobName);

        // Copy file to SharePoint placeholder
        copyFileSync(localFilePath, destPath);
        
        const stats = statSync(destPath);
        const size = stats.size;

        const blobUrl = `sharepoint://${this.containerName}/${blobName}`;
        
        let result: UploadedFileInfo = {
            blobUrl,
            containerName: this.containerName,
            blobName,
            size,
            compressed: false
        };

        // Optionally compress and upload
        if (options.compress) {
            const compressedInfo = await this.uploadCompressed(localFilePath, blobName);
            result = {
                ...result,
                compressed: true,
                compressedSize: compressedInfo.size,
                compressedBlobUrl: compressedInfo.blobUrl
            };
        }

        logger.info(`[SharePoint Storage] File uploaded: ${blobName}, size: ${size} bytes`);
        return result;
    }

    /**
     * Upload a file from a buffer
     -->
async uploadBuffer(
        buffer: Buffer,
        blobName: string,
        options: { compress?: boolean } = {}
    ): Promise<UploadedFileInfo> {
        const containerPath = this.getContainerPath(this.containerName);
        const destPath = path.join(containerPath, blobName);

        // Write buffer to file
        const { writeFileSync } = await import('fs');
        writeFileSync(destPath, buffer);
        
        const blobUrl = `sharepoint://${this.containerName}/${blobName}`;
        
        let result: UploadedFileInfo = {
            blobUrl,
            containerName: this.containerName,
            blobName,
            size: buffer.length,
            compressed: false
        };

        // Optionally compress and upload
        if (options.compress) {
            const compressedInfo = await this.uploadBufferCompressed(buffer, blobName);
            result = {
                ...result,
                compressed: true,
                compressedSize: compressedInfo.size,
                compressedBlobUrl: compressedInfo.blobUrl
            };
        }

        logger.info(`[SharePoint Storage] Buffer uploaded: ${blobName}, size: ${buffer.length} bytes`);
        return result;
    }

    /**
     * Compress and upload a file
     */
    private async uploadCompressed(localFilePath: string, blobName: string): Promise<UploadedFileInfo> {
        const containerPath = this.getContainerPath(this.compressedContainerName);
        const compressedBlobName = `${blobName}.gz`;
        const destPath = path.join(containerPath, compressedBlobName);

        // Create temp file for compressed data
        const tempFilePath = path.join(os.tmpdir(), `compressed_${Date.now()}.gz`);
        
        try {
            // Compress the file
            const gzip = createGzip();
            const source = createReadStream(localFilePath);
            const destination = createWriteStream(tempFilePath);

            await pipeline(source, gzip, destination);

            // Copy compressed file to SharePoint placeholder
            copyFileSync(tempFilePath, destPath);

            const stats = statSync(destPath);
            const size = stats.size;

            const blobUrl = `sharepoint://${this.compressedContainerName}/${compressedBlobName}`;

            logger.info(`[SharePoint Storage] Compressed file uploaded: ${compressedBlobName}, size: ${size} bytes`);

            return {
                blobUrl,
                containerName: this.compressedContainerName,
                blobName: compressedBlobName,
                size,
                compressed: true
            };
        } finally {
            // Clean up temp file
            try {
                unlinkSync(tempFilePath);
            } catch {
                // Ignore cleanup errors
            }
        }
    }

    /**
     * Compress and upload a buffer
     -->
    private async uploadBufferCompressed(buffer: Buffer, blobName: string): Promise<UploadedFileInfo> {
        const zlib = await import('zlib');
        const compressedBuffer = zlib.gzipSync(buffer);
        
        const containerPath = this.getContainerPath(this.compressedContainerName);
        const compressedBlobName = `${blobName}.gz`;
        const destPath = path.join(containerPath, compressedBlobName);

        const { writeFileSync } = await import('fs');
        writeFileSync(destPath, compressedBuffer);

        const blobUrl = `sharepoint://${this.compressedContainerName}/${compressedBlobName}`;
        
        logger.info(`[SharePoint Storage] Compressed buffer uploaded: ${compressedBlobName}, size: ${compressedBuffer.length} bytes`);

        return {
            blobUrl,
            containerName: this.compressedContainerName,
            blobName: compressedBlobName,
            size: compressedBuffer.length,
            compressed: true
        };
    }

    /**
     * Download a file from SharePoint placeholder
     */
    async downloadFile(blobName: string, localFilePath: string): Promise<void> {
        const containerPath = this.getContainerPath(this.containerName);
        const sourcePath = path.join(containerPath, blobName);

        copyFileSync(sourcePath, localFilePath);
        logger.info(`[SharePoint Storage] File downloaded: ${blobName} -> ${localFilePath}`);
    }

    /**
     * Download a file as a stream
     */
    async downloadAsStream(
        blobName: string, 
        options: StreamOptions = {}
    ): Promise<NodeJS.ReadableStream> {
        const containerPath = this.getContainerPath(this.containerName);
        const sourcePath = path.join(containerPath, blobName);

        return createReadStream(sourcePath);
    }

    /**
     * Stream a blob (for large file processing)
     */
    async streamBlob(
        blobName: string,
        options: StreamOptions = {}
    ): Promise<{ stream: NodeJS.ReadableStream; size: number }> {
        const containerPath = this.getContainerPath(this.containerName);
        const sourcePath = path.join(containerPath, blobName);

        const stats = statSync(sourcePath);
        const size = stats.size;

        const stream = createReadStream(sourcePath);

        return { stream, size };
    }

    /**
     * Delete a blob
     */
    async deleteBlob(blobName: string, containerName?: string): Promise<void> {
        const container = containerName || this.containerName;
        const containerPath = this.getContainerPath(container);
        const filePath = path.join(containerPath, blobName);

        if (existsSync(filePath)) {
            unlinkSync(filePath);
            logger.info(`[SharePoint Storage] Blob deleted: ${blobName}`);
        }
    }

    /**
     * Get blob URL
     */
    getBlobUrl(blobName: string, containerName?: string): string {
        const container = containerName || this.containerName;
        return `sharepoint://${container}/${blobName}`;
    }

    /**
     * Check if blob exists
     */
    async blobExists(blobName: string, containerName?: string): Promise<boolean> {
        const container = containerName || this.containerName;
        const containerPath = this.getContainerPath(container);
        const filePath = path.join(containerPath, blobName);
        return existsSync(filePath);
    }

    /**
     * Get blob properties
     */
    async getBlobProperties(blobName: string, containerName?: string): Promise<any> {
        const container = containerName || this.containerName;
        const containerPath = this.getContainerPath(container);
        const filePath = path.join(containerPath, blobName);
        
        const stats = statSync(filePath);
        return {
            contentLength: stats.size,
            lastModified: stats.mtime,
            created: stats.birthtime
        };
    }

    /**
     * Generate SAS token (placeholder - not implemented for local storage)
     */
    async generateSasToken(blobName: string, expiryMinutes: number = 60): Promise<string> {
        logger.warn(`[SharePoint Storage] SAS token not supported for local storage`);
        return this.getBlobUrl(blobName);
    }

    /**
     * List blobs in a container
     */
    async listBlobs(containerName?: string): Promise<string[]> {
        const container = containerName || this.containerName;
        const containerPath = this.getContainerPath(container);
        
        if (!existsSync(containerPath)) {
            return [];
        }
        
        const files = readdirSync(containerPath);
        return files;
    }
}

// Export singleton instance (FIX: Add try-catch like Azure)
let sharePointStorage: SharePointStorageService | null = null;
try {
    sharePointStorage = new SharePointStorageService();
} catch (error) {
    logger.warn('SharePointStorageService initialization failed:', error);
}
export { sharePointStorage };

