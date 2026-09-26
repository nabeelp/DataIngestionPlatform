// =============================================================================
// FileDefinitionVersion Model - Database operations for FileDefinitionVersions
// =============================================================================

import type { ConnectionPool, Request, Transaction } from 'mssql';
import { v4 as uuidv4 } from 'uuid';
import { buildContractSnapshot, type ContractSnapshot } from '../services/validation/DefinitionContract';
import type { IFileDefinitionVersion } from '../interfaces/fileDefinition.interface';

type Queryable = ConnectionPool | Transaction;

const parseJson = (value: unknown): any[] => {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string' || !value.trim()) return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

export function mapVersionRow(row: any): IFileDefinitionVersion {
    const contract = buildContractSnapshot(parseJson(row.Columns), parseJson(row.Rules));
    return {
        Id: row.Id,
        FileDefinitionId: row.FileDefinitionId,
        VersionNumber: row.VersionNumber,
        Status: row.Status,
        Columns: contract.columns,
        Rules: contract.rules,
        ChangeNote: row.ChangeNote ?? null,
        CreatedBy: row.CreatedBy ?? null,
        CreatedByName: row.CreatedByName ?? null,
        ActivatedAt: row.ActivatedAt,
        SupersededAt: row.SupersededAt ?? null,
    };
}

const SELECT_VERSION = `
    SELECT v.*,
        COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(u.FirstName, ' ', u.LastName))), ''), u.Username, u.Email) AS CreatedByName
    FROM FileDefinitionVersions v
    LEFT JOIN Users u ON u.Id = v.CreatedBy
`;

export class FileDefinitionVersion {
    static async findById(db: Queryable, id: string): Promise<IFileDefinitionVersion | null> {
        const result = await db.request().input('Id', id).query(`${SELECT_VERSION} WHERE v.Id = @Id`);
        return result.recordset[0] ? mapVersionRow(result.recordset[0]) : null;
    }

    static async findActive(db: Queryable, fileDefinitionId: string): Promise<IFileDefinitionVersion | null> {
        const result = await db.request()
            .input('FileDefinitionId', fileDefinitionId)
            .query(`${SELECT_VERSION} WHERE v.FileDefinitionId = @FileDefinitionId AND v.Status = 'Active'`);
        return result.recordset[0] ? mapVersionRow(result.recordset[0]) : null;
    }

    static async findAllActive(db: Queryable): Promise<IFileDefinitionVersion[]> {
        const result = await db.request().query(`${SELECT_VERSION} WHERE v.Status = 'Active'`);
        return result.recordset.map(mapVersionRow);
    }

    static async findByDefinition(db: Queryable, fileDefinitionId: string): Promise<IFileDefinitionVersion[]> {
        const result = await db.request()
            .input('FileDefinitionId', fileDefinitionId)
            .query(`${SELECT_VERSION} WHERE v.FileDefinitionId = @FileDefinitionId ORDER BY v.VersionNumber DESC`);
        return result.recordset.map(mapVersionRow);
    }

    /**
     * Supersede the active version (if any) and insert `contract` as the new active version.
     * Callers must hold a lock on the definition row so version numbers are allocated serially.
     */
    static async activate(
        tx: Transaction,
        fileDefinitionId: string,
        contract: ContractSnapshot,
        createdBy: string | null,
        changeNote: string | null,
    ): Promise<string> {
        const id = uuidv4();
        const now = new Date();
        const request = (): Request => tx.request().input('FileDefinitionId', fileDefinitionId).input('Now', now);

        const next = await request().query(`
            SELECT ISNULL(MAX(VersionNumber), 0) + 1 AS VersionNumber
            FROM FileDefinitionVersions WHERE FileDefinitionId = @FileDefinitionId
        `);

        await request().query(`
            UPDATE FileDefinitionVersions SET Status = 'Superseded', SupersededAt = @Now
            WHERE FileDefinitionId = @FileDefinitionId AND Status = 'Active'
        `);

        await request()
            .input('Id', id)
            .input('VersionNumber', next.recordset[0].VersionNumber)
            .input('Columns', JSON.stringify(contract.columns))
            .input('Rules', JSON.stringify(contract.rules))
            .input('ChangeNote', changeNote)
            .input('CreatedBy', createdBy)
            .query(`
                INSERT INTO FileDefinitionVersions
                    (Id, FileDefinitionId, VersionNumber, Status, Columns, Rules, ChangeNote, CreatedBy, ActivatedAt)
                VALUES
                    (@Id, @FileDefinitionId, @VersionNumber, 'Active', @Columns, @Rules, @ChangeNote, @CreatedBy, @Now)
            `);

        return id;
    }

    /**
     * Remove a deleted definition's versions, keeping any that uploads were validated against.
     */
    static async deleteUnreferenced(db: Queryable, fileDefinitionId: string): Promise<void> {
        await db.request().input('FileDefinitionId', fileDefinitionId).query(`
            DELETE FROM FileDefinitionVersions
            WHERE FileDefinitionId = @FileDefinitionId
              AND Id NOT IN (SELECT FileDefinitionVersionId FROM Uploads WHERE FileDefinitionVersionId IS NOT NULL)
        `);
    }
}
