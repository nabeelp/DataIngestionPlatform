// =============================================================================
// Lookup Model - reusable reference value lists
// =============================================================================

import { v4 as uuidv4 } from 'uuid';
import { getConnection } from '../config/database';

export interface ILookup {
    id: string;
    name: string;
    description: string;
    values: string[];
    createdBy: string | null;
    createdAt: Date;
    updatedAt: Date;
}

export interface ILookupInput {
    name: string;
    description?: string;
    values: string[];
}

const mapRow = (row: any): ILookup => {
    let values: string[] = [];
    try {
        const parsed = JSON.parse(row.Values || '[]');
        values = Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
        values = [];
    }
    return {
        id: row.Id,
        name: row.Name,
        description: row.Description || '',
        values,
        createdBy: row.CreatedBy || null,
        createdAt: row.CreatedAt,
        updatedAt: row.UpdatedAt,
    };
};

export class Lookup {
    private static readonly TABLE_NAME = 'Lookups';

    static async findAll(search?: string): Promise<ILookup[]> {
        const pool = await getConnection();
        const request = pool.request();
        let where = '';
        if (search) {
            request.input('Search', `%${search}%`);
            where = 'WHERE Name LIKE @Search OR Description LIKE @Search';
        }
        const result = await request.query(`SELECT * FROM ${this.TABLE_NAME} ${where} ORDER BY Name`);
        return result.recordset.map(mapRow);
    }

    static async findById(id: string): Promise<ILookup | null> {
        const pool = await getConnection();
        const result = await pool.request()
            .input('Id', id)
            .query(`SELECT * FROM ${this.TABLE_NAME} WHERE Id = @Id`);
        return result.recordset[0] ? mapRow(result.recordset[0]) : null;
    }

    static async findByName(name: string): Promise<ILookup | null> {
        const pool = await getConnection();
        const result = await pool.request()
            .input('Name', name)
            .query(`SELECT * FROM ${this.TABLE_NAME} WHERE Name = @Name`);
        return result.recordset[0] ? mapRow(result.recordset[0]) : null;
    }

    static async create(input: ILookupInput, createdBy: string): Promise<ILookup> {
        const pool = await getConnection();
        const id = uuidv4();
        const now = new Date();
        await pool.request()
            .input('Id', id)
            .input('Name', input.name)
            .input('Description', input.description || '')
            .input('Values', JSON.stringify(input.values))
            .input('CreatedBy', createdBy)
            .input('Now', now)
            .query(`
                INSERT INTO ${this.TABLE_NAME} (Id, Name, Description, [Values], CreatedBy, CreatedAt, UpdatedAt)
                VALUES (@Id, @Name, @Description, @Values, @CreatedBy, @Now, @Now)
            `);
        return (await this.findById(id))!;
    }

    static async update(id: string, input: ILookupInput): Promise<ILookup | null> {
        const pool = await getConnection();
        await pool.request()
            .input('Id', id)
            .input('Name', input.name)
            .input('Description', input.description || '')
            .input('Values', JSON.stringify(input.values))
            .input('Now', new Date())
            .query(`
                UPDATE ${this.TABLE_NAME}
                SET Name = @Name, Description = @Description, [Values] = @Values, UpdatedAt = @Now
                WHERE Id = @Id
            `);
        return this.findById(id);
    }

    static async delete(id: string): Promise<boolean> {
        const pool = await getConnection();
        const result = await pool.request()
            .input('Id', id)
            .query(`DELETE FROM ${this.TABLE_NAME} WHERE Id = @Id`);
        return (result.rowsAffected[0] || 0) > 0;
    }
}
