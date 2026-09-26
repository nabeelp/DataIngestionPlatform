import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import express from 'express';
import jwt from 'jsonwebtoken';
import * as XLSX from 'xlsx';

const JWT_SECRET = 'example-analysis-test-secret';
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'example-route-test-'));
process.env.JWT_SECRET = JWT_SECRET;
process.env.REDIS_ENABLED = 'false';
process.env.LOG_LEVEL = 'error';
process.env.UPLOAD_TEMP_DIR = tempDir;

// Required after the environment is set so appConfig picks it up.
const adminRoutes: express.Router = require('../src/routes/admin.routes').default;

const tokenFor = (role: 'admin' | 'user') =>
    jwt.sign({ userId: `${role}-id`, email: `${role}@company.com`, role, loginMethod: 'password' }, JWT_SECRET, { algorithm: 'HS256' });

const authHeader = (role: 'admin' | 'user') => ({ Authorization: 'Bearer ' + tokenFor(role) });

describe('POST /api/admin/file-definitions/analyze-example', () => {
    let server: Server;
    let url: string;

    beforeAll(async () => {
        const app = express();
        app.use('/api/admin', adminRoutes);
        await new Promise<void>(resolve => { server = app.listen(0, () => resolve()); });
        url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/admin/file-definitions/analyze-example`;
    });

    afterAll(async () => {
        await new Promise<void>(resolve => server.close(() => resolve()));
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    const post = async (role: 'admin' | 'user', name: string, content: string | Buffer, type: string) => {
        const form = new FormData();
        form.append('file', new Blob([typeof content === 'string' ? content : new Uint8Array(content)], { type }), name);
        const res = await fetch(url, { method: 'POST', headers: authHeader(role), body: form });
        return { status: res.status, body: await res.json() as any };
    };

    const examplesLeftOnDisk = () => fs.readdirSync(tempDir).filter(name => name.startsWith('example-'));

    afterEach(() => {
        for (const name of examplesLeftOnDisk()) fs.rmSync(path.join(tempDir, name), { force: true });
    });

    it('analyzes a CSV example and does not keep the file', async () => {
        const res = await post('admin', 'orders.csv', 'Id,Status\n1,Open\n2,Closed\n3,Open\n4,Closed\n', 'text/csv');

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
            success: true,
            fileName: 'orders.csv',
            fileType: 'csv',
            sheets: [{ name: null, headerRow: 1, rowsAnalyzed: 4, columns: [{ name: 'Id', type: 'integer', required: true }, { name: 'Status', type: 'string', required: true }] }],
        });
        expect(res.body.sheets[0].suggestedRules[0].expression).toBe('Status: Closed, Open');
        expect(examplesLeftOnDisk()).toEqual([]);
    });

    it('analyzes each sheet of an XLSX example', async () => {
        const book = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Code'], ['A']]), 'Codes');
        XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Amount'], [1.5]]), 'Amounts');
        const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

        const res = await post('admin', 'book.xlsx', buffer, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

        expect(res.status).toBe(200);
        expect(res.body.sheets.map((s: any) => [s.name, s.columns[0].name, s.columns[0].type])).toEqual([
            ['Codes', 'Code', 'string'],
            ['Amounts', 'Amount', 'decimal'],
        ]);
        expect(examplesLeftOnDisk()).toEqual([]);
    });

    it('rejects unsupported types, fake workbooks and oversized files', async () => {
        const xls = await post('admin', 'old.xls', 'Id\n1\n', 'application/vnd.ms-excel');
        expect(xls).toMatchObject({ status: 400, body: { message: expect.stringContaining('.csv') } });

        const fake = await post('admin', 'fake.xlsx', 'Id\n1\n', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        expect(fake).toMatchObject({ status: 400, body: { message: 'The example file is not a valid XLSX workbook' } });

        const big = await post('admin', 'big.csv', Buffer.alloc(10 * 1024 * 1024 + 1, 'a'), 'text/csv');
        expect(big).toMatchObject({ status: 400, body: { message: 'Example files are limited to 10 MB' } });
        expect(examplesLeftOnDisk()).toEqual([]);
    });

    it('requires a file', async () => {
        const res = await fetch(url, { method: 'POST', headers: authHeader('admin'), body: new FormData() });
        expect(res.status).toBe(400);
    });

    it('is admin only', async () => {
        expect((await post('user', 'orders.csv', 'Id\n1\n', 'text/csv')).status).toBe(403);
    });
});
