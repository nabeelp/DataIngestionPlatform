import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { Readable } from 'stream';
import express from 'express';
import jwt from 'jsonwebtoken';

const jwtSecret = 'upload-report-route-test';
process.env.JWT_SECRET = jwtSecret;

const mockHasAccessToUpload = jest.fn();
const mockFindById = jest.fn();
const mockOpenBlobReadStream = jest.fn();

jest.mock('../src/models/Upload.model', () => ({
    Upload: {
        hasAccessToUpload: mockHasAccessToUpload,
        findById: mockFindById,
    },
}));
jest.mock('../src/services/AzureStorage.service', () => ({
    azureStorage: { openBlobReadStream: mockOpenBlobReadStream },
}));

const uploadRoutes: express.Router = require('../src/routes/upload.routes').default;

describe('GET /api/uploads/:id/report', () => {
    let server: Server;
    let url: string;

    beforeAll(async () => {
        const app = express();
        app.use('/api/uploads', uploadRoutes);
        await new Promise<void>(resolve => {
            server = app.listen(0, () => resolve());
        });
        url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/uploads/upload-1/report`;
    });

    afterAll(async () => {
        await new Promise<void>(resolve => server.close(() => resolve()));
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    const getReport = (role: 'admin' | 'user' = 'user') => {
        const token = jwt.sign({ userId: `${role}-1`, role }, jwtSecret, { algorithm: 'HS256' });
        return fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    };

    it('checks upload access before opening the report blob', async () => {
        mockHasAccessToUpload.mockResolvedValue(false);

        const response = await getReport();

        expect(response.status).toBe(403);
        expect(mockOpenBlobReadStream).not.toHaveBeenCalled();
    });

    it('streams the report blob for a user who can access the upload', async () => {
        mockHasAccessToUpload.mockResolvedValue(true);
        mockFindById.mockResolvedValue({
            Id: 'upload-1',
            ReportBlobName: 'reports/upload-1/issues report.csv',
        });
        mockOpenBlobReadStream.mockResolvedValue(Readable.from(['row,error\n1,invalid\n']));

        const response = await getReport();

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain('text/csv');
        expect(response.headers.get('content-disposition')).toContain('issues_report.csv');
        expect(await response.text()).toBe('row,error\n1,invalid\n');
        expect(mockOpenBlobReadStream).toHaveBeenCalledWith(
            'reports/upload-1/issues report.csv',
            'reports',
        );
    });
});
