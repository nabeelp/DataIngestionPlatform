import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { Readable } from 'stream';
import express from 'express';
import jwt from 'jsonwebtoken';

const jwtSecret = 'upload-delivery-route-test';
process.env.JWT_SECRET = jwtSecret;

const mockHasAccessToUpload = jest.fn();
const mockFindUpload = jest.fn();
const mockDeleteUpload = jest.fn();
const mockFindDeliveryById = jest.fn();
const mockFindDeliveryByUploadId = jest.fn();
const mockOpenBlobReadStream = jest.fn();
const mockDeleteBlob = jest.fn();

jest.mock('../src/models/Upload.model', () => ({
    Upload: {
        hasAccessToUpload: mockHasAccessToUpload,
        findById: mockFindUpload,
        delete: mockDeleteUpload,
    },
}));
jest.mock('../src/models/DeliveryRecord.model', () => ({
    DeliveryRecord: {
        findById: mockFindDeliveryById,
        findByUploadId: mockFindDeliveryByUploadId,
    },
}));
jest.mock('../src/services/AzureStorage.service', () => ({
    azureStorage: {
        openBlobReadStream: mockOpenBlobReadStream,
        deleteBlob: mockDeleteBlob,
    },
}));

const uploadRoutes: express.Router = require('../src/routes/upload.routes').default;

describe('upload delivery routes', () => {
    let server: Server;
    let baseUrl: string;

    beforeAll(async () => {
        const app = express();
        app.use('/api/uploads', uploadRoutes);
        await new Promise<void>(resolve => {
            server = app.listen(0, () => resolve());
        });
        baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/uploads`;
    });

    afterAll(async () => {
        await new Promise<void>(resolve => server.close(() => resolve()));
    });

    beforeEach(() => {
        jest.clearAllMocks();
        mockHasAccessToUpload.mockResolvedValue(true);
        mockFindUpload.mockResolvedValue({
            Id: 'upload-1',
            Status: 'DELIVERED',
            BlobName: 'source.csv',
            BlobContainer: 'uploads',
            ReportBlobName: null,
        });
        mockFindDeliveryById.mockResolvedValue({
            Id: 'delivery-1',
            UploadId: 'upload-1',
            DeliveryType: 'AzureBlob',
            DestinationPath: 'finance/upload-1_sales.csv',
            Status: 'DELIVERED',
        });
        mockFindDeliveryByUploadId.mockResolvedValue([{
            Id: 'delivery-1',
            UploadId: 'upload-1',
            DeliveryType: 'AzureBlob',
            DestinationPath: 'finance/upload-1_sales.csv',
            Status: 'DELIVERED',
        }]);
        mockOpenBlobReadStream.mockResolvedValue(Readable.from(['id,value\n1,ready\n']));
        mockDeleteBlob.mockResolvedValue(undefined);
        mockDeleteUpload.mockResolvedValue(undefined);
    });

    const request = (role: 'admin' | 'user', url: string, method = 'GET') => {
        const token = jwt.sign({ userId: `${role}-1`, role }, jwtSecret, { algorithm: 'HS256' });
        return fetch(url, { method, headers: { Authorization: `Bearer ${token}` } });
    };

    it('checks upload access before reading the delivery record or blob', async () => {
        mockHasAccessToUpload.mockResolvedValue(false);

        const response = await request('user', `${baseUrl}/upload-1/deliveries/delivery-1`);

        expect(response.status).toBe(403);
        expect(mockFindDeliveryById).not.toHaveBeenCalled();
        expect(mockOpenBlobReadStream).not.toHaveBeenCalled();
    });

    it('streams the completed delivery from the private container', async () => {
        const response = await request('user', `${baseUrl}/upload-1/deliveries/delivery-1`);

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain('text/csv');
        expect(response.headers.get('content-disposition')).toContain('upload-1_sales.csv');
        expect(await response.text()).toBe('id,value\n1,ready\n');
        expect(mockOpenBlobReadStream).toHaveBeenCalledWith('finance/upload-1_sales.csv', 'deliveries');
    });

    it('rejects a delivery record belonging to a different upload', async () => {
        mockFindDeliveryById.mockResolvedValue({
            Id: 'delivery-1',
            UploadId: 'other-upload',
            DeliveryType: 'AzureBlob',
            DestinationPath: 'finance/other.csv',
            Status: 'DELIVERED',
        });

        const response = await request('user', `${baseUrl}/upload-1/deliveries/delivery-1`);

        expect(response.status).toBe(404);
        expect(mockOpenBlobReadStream).not.toHaveBeenCalled();
    });

    it('does not expose an output until delivery is complete', async () => {
        mockFindDeliveryById.mockResolvedValue({
            Id: 'delivery-1',
            UploadId: 'upload-1',
            DeliveryType: 'AzureBlob',
            DestinationPath: 'finance/upload-1_sales.csv',
            Status: 'IN_PROGRESS',
        });

        const response = await request('user', `${baseUrl}/upload-1/deliveries/delivery-1`);

        expect(response.status).toBe(409);
        expect(mockOpenBlobReadStream).not.toHaveBeenCalled();
    });

    it('deletes cloud delivery output before deleting its upload record', async () => {
        const response = await request('admin', `${baseUrl}/upload-1`, 'DELETE');

        expect(response.status).toBe(200);
        expect(mockDeleteBlob).toHaveBeenNthCalledWith(1, 'finance/upload-1_sales.csv', 'deliveries');
        expect(mockDeleteBlob).toHaveBeenNthCalledWith(2, 'source.csv', 'uploads');
        expect(mockDeleteBlob.mock.invocationCallOrder[0]).toBeLessThan(mockDeleteUpload.mock.invocationCallOrder[0]);
        expect(mockDeleteUpload).toHaveBeenCalledWith('upload-1');
    });
});
