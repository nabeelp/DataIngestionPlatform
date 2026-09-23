// =============================================================================
// UploadSheet Model - Database operations for UploadSheets table
// =============================================================================

import { getConnection } from '../config/database';
import { v4 as uuidv4 } from 'uuid';
import type { 
    IUploadSheet, 
    ICreateUploadSheetDto,
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
     * Create new upload sheet
     */
    static async create(dto: ICreateUploadSheetDto): Promise<IUploadSheet> {
        const pool = await getConnection();
        const id = uuidv4();
        const now = new Date();

        await pool.request()
            .input('Id', id)
            .input('UploadId', dto.UploadId)
            .input('SheetIndex', dto.SheetIndex)
            .input('SheetName', dto.SheetName)
.input('RowCountNo', dto.RowCountNo || 0)
            .input('Status', 'PENDING')
            .input('ValidationProgress', 0)
            .input('ValidatedRules', 0)
            .input('TotalRules', 0)
            .input('DeliveryPath', null)
            .input('DeliveredAt', null)
            .input('ErrorMessage', null)
            .input('CreatedAt', now)
            .input('UpdatedAt', now)
            .query(`
                INSERT INTO ${this.TABLE_NAME} 
(Id, UploadId, SheetIndex, SheetName, RowCountNo, Status, ValidationProgress, ValidatedRules, TotalRules, DeliveryPath, DeliveredAt, ErrorMessage, CreatedAt, UpdatedAt)
                VALUES 
                (@Id, @UploadId, @SheetIndex, @SheetName, @RowCountNo, @Status, @ValidationProgress, @ValidatedRules, @TotalRules, @DeliveryPath, @DeliveredAt, @ErrorMessage, @CreatedAt, @UpdatedAt)
            `);

        return (await this.findById(id))!;
    }

    /**
     * Create multiple sheets for an upload
     */
    static async createForUpload(
        uploadId: string,
        sheets: Array<{ index: number; name: string; rowCount?: number }>
    ): Promise<IUploadSheet[]> {
        const created: IUploadSheet[] = [];
        
        for (const sheet of sheets) {
            const createdSheet = await this.create({
                UploadId: uploadId,
                SheetIndex: sheet.index,
                SheetName: sheet.name,
                RowCountNo: sheet.rowCount
            });
            created.push(createdSheet);
        }
        
        return created;
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

    /**
     * Update validation progress
     */
    static async updateValidationProgress(
        id: string, 
        validatedRules: number, 
        totalRules: number
    ): Promise<void> {
        const progress = totalRules > 0 ? Math.round((validatedRules / totalRules) * 100) : 0;
        
        await this.update(id, {
            ValidationProgress: progress,
            ValidatedRules: validatedRules,
            TotalRules: totalRules
        });
    }

    /**
     * Delete upload sheet
     */
    static async delete(id: string): Promise<void> {
        const pool = await getConnection();
        
        await pool.request()
            .input('Id', id)
            .query(`DELETE FROM ${this.TABLE_NAME} WHERE Id = @Id`);
    }

    /**
     * Delete sheets by upload ID
     */
    static async deleteByUploadId(uploadId: string): Promise<void> {
        const pool = await getConnection();
        
        await pool.request()
            .input('UploadId', uploadId)
            .query(`DELETE FROM ${this.TABLE_NAME} WHERE UploadId = @UploadId`);
    }
}

