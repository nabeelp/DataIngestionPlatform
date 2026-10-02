// =============================================================================
// Upload Model - Database operations for Uploads table
// =============================================================================

import { getConnection } from '../config/database';
import { v4 as uuidv4 } from 'uuid';
import { isUserAdmin } from '../utils/userUtils';
import type { 
    IUpload, 
    ICreateUploadDto,
    IUpdateUploadDto,
    UploadStatus
} from '../interfaces/upload.interface';

export class Upload {
    private static readonly TABLE_NAME = 'Uploads';
    private static readonly ACCESS_TABLE = 'UploadAccess';

    /**
     * Find upload by ID
     */
    static async findById(id: string): Promise<IUpload | null> {
        const pool = await getConnection();
        const result = await pool.request()
            .input('Id', id)
            .query(`SELECT * FROM ${this.TABLE_NAME} WHERE Id = @Id`);
        
        if (!result.recordset[0]) {
            return null;
        }

        return result.recordset[0];
    }

    /**
     * Find uploads for a user (including shared uploads)
     */
    static async findForUser(
        userId: string, 
        options: { page?: number; pageSize?: number; status?: string } = {}
    ): Promise<{ uploads: IUpload[]; total: number }> {
        const pool = await getConnection();
        const { page = 1, pageSize = 20, status } = options;
        const offset = (page - 1) * pageSize;

        // Check if user is admin using utility function (handles both DB and mock users)
        const isAdmin = await isUserAdmin(userId);

        let query: string;
        let countQuery: string;

        if (isAdmin) {
            // Admin sees all uploads
            if (status) {
                query = `
                    SELECT * FROM ${this.TABLE_NAME} 
                    WHERE Status = @Status
                    ORDER BY UploadedAt DESC
                    OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY
                `;
                countQuery = `
                    SELECT COUNT(*) as total FROM ${this.TABLE_NAME} 
                    WHERE Status = @Status
                `;
            } else {
                query = `
                    SELECT * FROM ${this.TABLE_NAME} 
                    ORDER BY UploadedAt DESC
                    OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY
                `;
                countQuery = `SELECT COUNT(*) as total FROM ${this.TABLE_NAME}`;
            }
        } else {
            // Regular user sees their uploads and shared uploads
            if (status) {
                query = `
                    SELECT DISTINCT u.* FROM ${this.TABLE_NAME} u
                    LEFT JOIN ${this.ACCESS_TABLE} ua ON u.Id = ua.UploadId
                    WHERE (u.UploadedBy = @UserId OR ua.UserId = @UserId)
                    AND u.Status = @Status
                    ORDER BY u.UploadedAt DESC
                    OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY
                `;
                countQuery = `
                    SELECT COUNT(DISTINCT u.Id) as total FROM ${this.TABLE_NAME} u
                    LEFT JOIN ${this.ACCESS_TABLE} ua ON u.Id = ua.UploadId
                    WHERE (u.UploadedBy = @UserId OR ua.UserId = @UserId)
                    AND u.Status = @Status
                `;
            } else {
                query = `
                    SELECT DISTINCT u.* FROM ${this.TABLE_NAME} u
                    LEFT JOIN ${this.ACCESS_TABLE} ua ON u.Id = ua.UploadId
                    WHERE (u.UploadedBy = @UserId OR ua.UserId = @UserId)
                    ORDER BY u.UploadedAt DESC
                    OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY
                `;
                countQuery = `
                    SELECT COUNT(DISTINCT u.Id) as total FROM ${this.TABLE_NAME} u
                    LEFT JOIN ${this.ACCESS_TABLE} ua ON u.Id = ua.UploadId
                    WHERE (u.UploadedBy = @UserId OR ua.UserId = @UserId)
                `;
            }
        }

        const request = pool.request()
            .input('UserId', userId)
            .input('Offset', offset)
            .input('PageSize', pageSize);

        if (status) {
            request.input('Status', status);
        }

        const [uploadsResult, countResult] = await Promise.all([
            request.query(query),
            request.query(countQuery)
        ]);

        return {
            uploads: uploadsResult.recordset,
            total: countResult.recordset[0]?.total || 0
        };
    }

    /**
     * Find recent uploads for a user
     */
    static async findRecentForUser(userId: string, limit: number = 10): Promise<IUpload[]> {
        // Check if user is admin using utility function (handles both DB and mock users)
        const isAdmin = await isUserAdmin(userId);

        let query: string;

        if (isAdmin) {
            // Admin sees all recent uploads
            query = `
                SELECT TOP (@Limit) * FROM ${this.TABLE_NAME} 
                ORDER BY UploadedAt DESC
            `;
        } else {
            const pool = await getConnection();
            // Regular user sees their uploads and shared uploads
            query = `
                SELECT DISTINCT TOP (@Limit) u.* FROM ${this.TABLE_NAME} u
                LEFT JOIN ${this.ACCESS_TABLE} ua ON u.Id = ua.UploadId
                WHERE (u.UploadedBy = @UserId OR ua.UserId = @UserId)
                ORDER BY u.UploadedAt DESC
            `;
        }

        const pool = await getConnection();
        const result = await pool.request()
            .input('UserId', userId)
            .input('Limit', limit)
            .query(query);

        return result.recordset;
    }

    /**
     * Create new upload
     */
    static async create(dto: ICreateUploadDto, userId: string): Promise<IUpload> {
        const pool = await getConnection();
        const id = uuidv4();
        const now = new Date();

        await pool.request()
            .input('Id', id)
            .input('FileDefinitionId', dto.FileDefinitionId)
            .input('FileDefinitionVersionId', dto.FileDefinitionVersionId || null)
            .input('UploadedBy', userId)
            .input('OriginalFilename', dto.OriginalFilename)
            .input('StoredFilename', dto.StoredFilename)
            .input('BlobContainer', dto.BlobContainer || 'uploads')
            .input('BlobName', dto.BlobName || dto.StoredFilename)
            .input('FileSha256', dto.FileSha256 ?? null)
            .input('DetectedEncoding', dto.DetectedEncoding ?? null)
            .input('ValidationDate', dto.ValidationDate ?? null)
            .input('EngineVersion', dto.EngineVersion ?? null)
            .input('ReportBlobName', dto.ReportBlobName ?? null)
            .input('ParquetPrefix', dto.ParquetPrefix ?? null)
            .input('AzureBlobUrl', dto.AzureBlobUrl || null)
            .input('FileSize', dto.FileSize)
            .input('FileType', dto.FileType)
            .input('CompressedFileSize', dto.CompressedFileSize || null)
            .input('CompressedBlobUrl', dto.CompressedBlobUrl || null)
            .input('RetryCount', dto.RetryCount || 0)
            .input('RowCountNo', dto.RowCountNo || 0)
            .input('SheetCount', dto.SheetCount || 1)
            .input('Status', 'UPLOADED')
            .input('UploadedAt', now)
            .query(`
                INSERT INTO ${this.TABLE_NAME} 
                                    (Id, FileDefinitionId, FileDefinitionVersionId, UploadedBy, OriginalFilename, StoredFilename, BlobContainer, BlobName, FileSha256, DetectedEncoding, ValidationDate, EngineVersion, ReportBlobName, ParquetPrefix, AzureBlobUrl, FileSize, FileType, CompressedFileSize, CompressedBlobUrl, RetryCount, RowCountNo, SheetCount, Status, UploadedAt)
                VALUES 
                                    (@Id, @FileDefinitionId, @FileDefinitionVersionId, @UploadedBy, @OriginalFilename, @StoredFilename, @BlobContainer, @BlobName, @FileSha256, @DetectedEncoding, @ValidationDate, @EngineVersion, @ReportBlobName, @ParquetPrefix, @AzureBlobUrl, @FileSize, @FileType, @CompressedFileSize, @CompressedBlobUrl, @RetryCount, @RowCountNo, @SheetCount, @Status, @UploadedAt)
            `);


        return (await this.findById(id))!;
    }

    /**
     * Update upload
     */
    static async update(id: string, updates: IUpdateUploadDto): Promise<IUpload | null> {
        const pool = await getConnection();

        const setClauses: string[] = [];
        const request = pool.request()
            .input('Id', id);

        if (updates.FileDefinitionVersionId !== undefined) {
            setClauses.push('FileDefinitionVersionId = @FileDefinitionVersionId');
            request.input('FileDefinitionVersionId', updates.FileDefinitionVersionId);
        }
        if (updates.BlobContainer !== undefined) {
            setClauses.push('BlobContainer = @BlobContainer');
            request.input('BlobContainer', updates.BlobContainer);
        }
        if (updates.BlobName !== undefined) {
            setClauses.push('BlobName = @BlobName');
            request.input('BlobName', updates.BlobName);
        }
        if (updates.FileSha256 !== undefined) {
            setClauses.push('FileSha256 = @FileSha256');
            request.input('FileSha256', updates.FileSha256);
        }
        if (updates.DetectedEncoding !== undefined) {
            setClauses.push('DetectedEncoding = @DetectedEncoding');
            request.input('DetectedEncoding', updates.DetectedEncoding);
        }
        if (updates.ValidationDate !== undefined) {
            setClauses.push('ValidationDate = @ValidationDate');
            request.input('ValidationDate', updates.ValidationDate);
        }
        if (updates.EngineVersion !== undefined) {
            setClauses.push('EngineVersion = @EngineVersion');
            request.input('EngineVersion', updates.EngineVersion);
        }
        if (updates.ReportBlobName !== undefined) {
            setClauses.push('ReportBlobName = @ReportBlobName');
            request.input('ReportBlobName', updates.ReportBlobName);
        }
        if (updates.ParquetPrefix !== undefined) {
            setClauses.push('ParquetPrefix = @ParquetPrefix');
            request.input('ParquetPrefix', updates.ParquetPrefix);
        }
        if (updates.RetryCount !== undefined) {
            setClauses.push('RetryCount = @RetryCount');
            request.input('RetryCount', updates.RetryCount);
        }
        if (updates.Status !== undefined) {
            setClauses.push('Status = @Status');
            request.input('Status', updates.Status);
        }
        if (updates.RowCountNo !== undefined) {
            setClauses.push('RowCountNo = @RowCountNo');
            request.input('RowCountNo', updates.RowCountNo);
        }

        if (updates.SheetCount !== undefined) {
            setClauses.push('SheetCount = @SheetCount');
            request.input('SheetCount', updates.SheetCount);
        }
        if (updates.AzureBlobUrl !== undefined) {
            setClauses.push('AzureBlobUrl = @AzureBlobUrl');
            request.input('AzureBlobUrl', updates.AzureBlobUrl);
        }
        if (updates.CompressedBlobUrl !== undefined) {
            setClauses.push('CompressedBlobUrl = @CompressedBlobUrl');
            request.input('CompressedBlobUrl', updates.CompressedBlobUrl);
        }
        if (updates.DeliveryJobId !== undefined) {
            setClauses.push('DeliveryJobId = @DeliveryJobId');
            request.input('DeliveryJobId', updates.DeliveryJobId);
        }
        if (updates.DeliveredTo !== undefined) {
            setClauses.push('DeliveredTo = @DeliveredTo');
            request.input('DeliveredTo', updates.DeliveredTo);
        }
        if (updates.ErrorMessage !== undefined) {
            setClauses.push('ErrorMessage = @ErrorMessage');
            request.input('ErrorMessage', updates.ErrorMessage);
        }
        if (updates.ValidationStartedAt !== undefined) {
            setClauses.push('ValidationStartedAt = @ValidationStartedAt');
            request.input('ValidationStartedAt', updates.ValidationStartedAt);
        }
        if (updates.ValidationCompletedAt !== undefined) {
            setClauses.push('ValidationCompletedAt = @ValidationCompletedAt');
            request.input('ValidationCompletedAt', updates.ValidationCompletedAt);
        }
        if (updates.DeliveryStartedAt !== undefined) {
            setClauses.push('DeliveryStartedAt = @DeliveryStartedAt');
            request.input('DeliveryStartedAt', updates.DeliveryStartedAt);
        }
        if (updates.DeliveryCompletedAt !== undefined) {
            setClauses.push('DeliveryCompletedAt = @DeliveryCompletedAt');
            request.input('DeliveryCompletedAt', updates.DeliveryCompletedAt);
        }
        if (updates.DeliveredAt !== undefined) {
            setClauses.push('DeliveredAt = @DeliveredAt');
            request.input('DeliveredAt', updates.DeliveredAt);
        }

        if (setClauses.length === 0) {
            return await this.findById(id);
        }

        await request.query(`
            UPDATE ${this.TABLE_NAME} 
            SET ${setClauses.join(', ')}
            WHERE Id = @Id
        `);

        return await this.findById(id);
    }

    /**
     * Update upload status
     */
    static async updateStatus(id: string, status: UploadStatus): Promise<void> {
        const pool = await getConnection();
        
        await pool.request()
            .input('Id', id)
            .input('Status', status)
            .query(`UPDATE ${this.TABLE_NAME} SET Status = @Status WHERE Id = @Id`);
    }

    /**
     * Delete upload
     */
    static async delete(id: string): Promise<void> {
        const pool = await getConnection();
        
        // Delete access records first
        await pool.request()
            .input('Id', id)
            .query(`DELETE FROM ${this.ACCESS_TABLE} WHERE UploadId = @Id`);

        // Delete the upload (cascades to related tables if configured)
        await pool.request()
            .input('Id', id)
            .query(`DELETE FROM ${this.TABLE_NAME} WHERE Id = @Id`);
    }

    /**
     * Check if user has access to an upload
     */
    static async hasAccessToUpload(uploadId: string, userId: string): Promise<boolean> {
        // Check if user is admin using the utility function (handles both DB and mock users)
        const admin = await isUserAdmin(userId);
        if (admin) {
            return true;
        }

        const pool = await getConnection();

        // Check if user is the uploader or has access via UploadAccess table
        const result = await pool.request()
            .input('UploadId', uploadId)
            .input('UserId', userId)
            .query(`
                SELECT 1 FROM ${this.TABLE_NAME}
                WHERE Id = @UploadId AND UploadedBy = @UserId
                UNION
                SELECT 1 FROM ${this.ACCESS_TABLE}
                WHERE UploadId = @UploadId AND UserId = @UserId
            `);

        return result.recordset.length > 0;
    }

    /**
     * Grant access to an upload
     */
    static async grantAccess(uploadId: string, userId: string, grantedBy: string, accessLevel: string = 'READ'): Promise<void> {
        const pool = await getConnection();
        const id = uuidv4();

        await pool.request()
            .input('Id', id)
            .input('UploadId', uploadId)
            .input('UserId', userId)
            .input('AccessLevel', accessLevel)
            .input('GrantedAt', new Date())
            .input('GrantedBy', grantedBy)
            .query(`
                IF NOT EXISTS (
                    SELECT 1 FROM ${this.ACCESS_TABLE} 
                    WHERE UploadId = @UploadId AND UserId = @UserId
                )
                BEGIN
                    INSERT INTO ${this.ACCESS_TABLE} (Id, UploadId, UserId, AccessLevel, GrantedAt, GrantedBy)
                    VALUES (@Id, @UploadId, @UserId, @AccessLevel, @GrantedAt, @GrantedBy)
                END
            `);
    }

    /**
     * Revoke access from an upload
     */
    static async revokeAccess(uploadId: string, userId: string): Promise<void> {
        const pool = await getConnection();

        await pool.request()
            .input('UploadId', uploadId)
            .input('UserId', userId)
            .query(`
                DELETE FROM ${this.ACCESS_TABLE} 
                WHERE UploadId = @UploadId AND UserId = @UserId
            `);
    }

    /**
     * Get count of uploads from today
     */
    static async getTodayCount(): Promise<number> {
        const pool = await getConnection();
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const result = await pool.request()
            .input('Today', today)
            .query(`SELECT COUNT(*) as count FROM ${this.TABLE_NAME} WHERE UploadedAt >= @Today`);
        return result.recordset[0]?.count || 0;
    }

    /**
     * Get count of uploads by status
     */
    static async getCountByStatus(statuses: string[]): Promise<number> {
        if (statuses.length === 0) return 0;
        
        const pool = await getConnection();
        const statusList = statuses.map((s, i) => `@Status${i}`).join(', ');
        
        const query = `SELECT COUNT(*) as count FROM ${this.TABLE_NAME} WHERE Status IN (${statusList})`;
        
        const request = pool.request();
        statuses.forEach((status, i) => {
            request.input(`Status${i}`, status);
        });
        
        const result = await request.query(query);
        return result.recordset[0]?.count || 0;
    }

    /**
     * Get counts for different upload statuses (for dashboard)
     */
    /**
     * Get counts for different upload statuses (dashboard)
     * Index: CREATE INDEX IX_Uploads_Status_UploadedAt ON Uploads(Status, UploadedAt DESC);
     */
    static async getStatusCounts(): Promise<{
        filesInQueue: number;
        filesValidating: number;
        filesDelivering: number;
    }> {
        const pool = await getConnection();
        
        const result = await pool.request()
            .query(`
                SELECT 
                    SUM(CASE WHEN Status IN ('UPLOADED', 'VALIDATION_QUEUED') THEN 1 ELSE 0 END) as filesInQueue,
                    SUM(CASE WHEN Status = 'VALIDATION_IN_PROGRESS' THEN 1 ELSE 0 END) as filesValidating,
                    SUM(CASE WHEN Status IN ('DELIVERY_QUEUED', 'DELIVERY_IN_PROGRESS') THEN 1 ELSE 0 END) as filesDelivering
                FROM ${this.TABLE_NAME}
            `);
        
        return {
            filesInQueue: Number(result.recordset[0]?.filesInQueue) || 0,
            filesValidating: Number(result.recordset[0]?.filesValidating) || 0,
            filesDelivering: Number(result.recordset[0]?.filesDelivering) || 0
        };
    }
}
