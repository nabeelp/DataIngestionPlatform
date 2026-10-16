// =============================================================================
// UploadSheet Model - Database operations for UploadSheets table
// =============================================================================

import { getConnection } from '../config/database';
import type { 
    IUploadSheet, 
    IUpdateUploadSheetDto
} from '../interfaces/upload.interface';

export class UploadSheet {
    private static readonly TABLE_NAME = 'UploadSheets';

    /**
     * Find upload sheet by ID
     */
    static async findById(id: string): Promise<IUploadSheet | null> {
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
     * Find all sheets for an upload
     */
    static async findByUploadId(uploadId: string): Promise<IUploadSheet[]> {
        const pool = await getConnection();
        const result = await pool.request()
            .input('UploadId', uploadId)
            .query(`
                SELECT * FROM ${this.TABLE_NAME} 
                WHERE UploadId = @UploadId 
                ORDER BY SheetIndex ASC
            `);
        
        return result.recordset;
    }

    /**
     * Update upload sheet
     */
    static async update(id: string, updates: IUpdateUploadSheetDto): Promise<IUploadSheet | null> {
        const pool = await getConnection();

        const setClauses: string[] = ['UpdatedAt = @UpdatedAt'];
        const request = pool.request()
            .input('Id', id)
            .input('UpdatedAt', new Date());

        if (updates.RowCountNo !== undefined) {
            setClauses.push('RowCountNo = @RowCountNo');
            request.input('RowCountNo', updates.RowCountNo);
        }
        if (updates.Status !== undefined) {
            setClauses.push('Status = @Status');
            request.input('Status', updates.Status);
        }
        if (updates.ValidationProgress !== undefined) {
            setClauses.push('ValidationProgress = @ValidationProgress');
            request.input('ValidationProgress', updates.ValidationProgress);
        }
        if (updates.ValidatedRules !== undefined) {
            setClauses.push('ValidatedRules = @ValidatedRules');
            request.input('ValidatedRules', updates.ValidatedRules);
        }
        if (updates.TotalRules !== undefined) {
            setClauses.push('TotalRules = @TotalRules');
            request.input('TotalRules', updates.TotalRules);
        }
        if (updates.DeliveryPath !== undefined) {
            setClauses.push('DeliveryPath = @DeliveryPath');
            request.input('DeliveryPath', updates.DeliveryPath);
        }
        if (updates.DeliveredAt !== undefined) {
            setClauses.push('DeliveredAt = @DeliveredAt');
            request.input('DeliveredAt', updates.DeliveredAt);
        }
        if (updates.ErrorMessage !== undefined) {
            setClauses.push('ErrorMessage = @ErrorMessage');
            request.input('ErrorMessage', updates.ErrorMessage);
        }

        await request.query(`
            UPDATE ${this.TABLE_NAME} 
            SET ${setClauses.join(', ')}
            WHERE Id = @Id
        `);

        return await this.findById(id);
    }
}

