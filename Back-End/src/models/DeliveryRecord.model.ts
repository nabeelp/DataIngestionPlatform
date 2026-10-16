// =============================================================================
// DeliveryRecord Model - Database operations for DeliveryRecords table
// =============================================================================

import { getConnection } from '../config/database';
import { v4 as uuidv4 } from 'uuid';
import type { 
    IDeliveryRecord, 
    ICreateDeliveryRecordDto,
    IUpdateDeliveryRecordDto
} from '../interfaces/upload.interface';

export class DeliveryRecord {
    private static readonly TABLE_NAME = 'DeliveryRecords';

    /**
     * Find delivery record by ID
     */
    static async findById(id: string): Promise<IDeliveryRecord | null> {
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
     * Find all delivery records for an upload
     */
    static async findByUploadId(uploadId: string): Promise<IDeliveryRecord[]> {
        const pool = await getConnection();
        const result = await pool.request()
            .input('UploadId', uploadId)
            .query(`
                SELECT * FROM ${this.TABLE_NAME} 
                WHERE UploadId = @UploadId 
                ORDER BY CreatedAt ASC
            `);
        
        return result.recordset;
    }

    /**
     * Create new delivery record
     */
    static async create(dto: ICreateDeliveryRecordDto): Promise<IDeliveryRecord> {
        const pool = await getConnection();
        const id = uuidv4();

        await pool.request()
            .input('Id', id)
            .input('UploadId', dto.UploadId)
            .input('UploadSheetId', dto.UploadSheetId || undefined)
            .input('DeliveryType', dto.DeliveryType)
            .input('DestinationPath', dto.DestinationPath)
            .input('DestinationName', dto.DestinationName ?? undefined)
            .input('Status', 'PENDING')
            .input('ProgressPercent', 0)
            .input('StartedAt', null)
            .input('CompletedAt', null)
            .input('ErrorMessage', null)
            .input('RecordsDelivered', 0)
            .query(`
                INSERT INTO ${this.TABLE_NAME} 
                (Id, UploadId, UploadSheetId, DeliveryType, DestinationPath, DestinationName, Status, ProgressPercent, StartedAt, CompletedAt, ErrorMessage, RecordsDelivered)
                VALUES 
                (@Id, @UploadId, @UploadSheetId, @DeliveryType, @DestinationPath, @DestinationName, @Status, @ProgressPercent, @StartedAt, @CompletedAt, @ErrorMessage, @RecordsDelivered)
            `);

        return (await this.findById(id))!;
    }

    /**
     * Update delivery record
     */
    static async update(id: string, updates: IUpdateDeliveryRecordDto): Promise<IDeliveryRecord | null> {
        const pool = await getConnection();

        const setClauses: string[] = [];
        const request = pool.request()
            .input('Id', id);

        if (updates.Status !== undefined) {
            setClauses.push('Status = @Status');
            request.input('Status', updates.Status);
        }
        if (updates.ProgressPercent !== undefined) {
            setClauses.push('ProgressPercent = @ProgressPercent');
            request.input('ProgressPercent', updates.ProgressPercent);
        }
        if (updates.StartedAt !== undefined) {
            setClauses.push('StartedAt = @StartedAt');
            request.input('StartedAt', updates.StartedAt);
        }
        if (updates.CompletedAt !== undefined) {
            setClauses.push('CompletedAt = @CompletedAt');
            request.input('CompletedAt', updates.CompletedAt);
        }
        if (updates.ErrorMessage !== undefined) {
            setClauses.push('ErrorMessage = @ErrorMessage');
            request.input('ErrorMessage', updates.ErrorMessage);
        }
        if (updates.RecordsDelivered !== undefined) {
            setClauses.push('RecordsDelivered = @RecordsDelivered');
            request.input('RecordsDelivered', updates.RecordsDelivered);
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
     * Mark delivery as started
     */
    static async markStarted(id: string): Promise<void> {
        await this.update(id, {
            Status: 'IN_PROGRESS',
            StartedAt: new Date()
        });
    }

    /**
     * Mark delivery as completed
     */
    static async markCompleted(id: string, recordsDelivered: number): Promise<void> {
        await this.update(id, {
            Status: 'DELIVERED',
            CompletedAt: new Date(),
            ProgressPercent: 100,
            RecordsDelivered: recordsDelivered
        });
    }

    /**
     * Mark delivery as failed
     */
    static async markFailed(id: string, errorMessage: string): Promise<void> {
        await this.update(id, {
            Status: 'FAILED',
            CompletedAt: new Date(),
            ErrorMessage: errorMessage
        });
    }

    /**
     * Update progress
     */
    static async updateProgress(id: string, percent: number, recordsDelivered?: number): Promise<void> {
        const updates: IUpdateDeliveryRecordDto = {
            ProgressPercent: percent
        };
        if (recordsDelivered !== undefined) {
            updates.RecordsDelivered = recordsDelivered;
        }
        await this.update(id, updates);
    }

    /**
     * Delete delivery records by upload ID
     */
    static async deleteByUploadId(uploadId: string): Promise<void> {
        const pool = await getConnection();
        
        await pool.request()
            .input('UploadId', uploadId)
            .query(`DELETE FROM ${this.TABLE_NAME} WHERE UploadId = @UploadId`);
    }
}

