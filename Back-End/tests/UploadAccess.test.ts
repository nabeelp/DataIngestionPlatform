const queries: string[] = [];

jest.mock('../src/config/database', () => ({
    getConnection: jest.fn(async () => ({
        request: () => {
            const request = {
                input: () => request,
                query: async (text: string) => {
                    queries.push(text);
                    return { recordset: [{ total: 0 }] };
                },
            };
            return request;
        },
    })),
}));

jest.mock('../src/utils/userUtils', () => ({
    isUserAdmin: jest.fn(async () => false),
}));

import { Upload } from '../src/models/Upload.model';

describe('Upload access filters', () => {
    beforeEach(() => queries.splice(0));

    it('groups the ownership/share condition before applying the status filter', async () => {
        await Upload.findForUser('user-1', { status: 'VALIDATION_FAILED' });

        expect(queries).toHaveLength(2);
        for (const query of queries) {
            const normalized = query.replace(/\s+/g, ' ');
            expect(normalized).toContain('WHERE (u.UploadedBy = @UserId OR ua.UserId = @UserId) AND u.Status = @Status');
        }
    });

    it('counts distinct uploads for shared access joins', async () => {
        await Upload.findForUser('user-1');
        expect(queries.some(q => q.includes('COUNT(DISTINCT u.Id)'))).toBe(true);
    });
});
