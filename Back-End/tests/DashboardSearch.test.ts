const mocks = {
    isAdmin: jest.fn(),
    inputs: [] as Array<Record<string, unknown>>,
    queries: [] as string[],
    result: jest.fn(),
};

jest.mock('../src/utils/userUtils', () => ({ isUserAdmin: mocks.isAdmin }));
jest.mock('../src/config/database', () => ({
    getConnection: async () => ({
        request: () => {
            const bound: Record<string, unknown> = {};
            mocks.inputs.push(bound);
            const request = {
                input(name: string, value: unknown) { bound[name] = value; return request; },
                async query(sql: string) { mocks.queries.push(sql); return mocks.result(sql); },
            };
            return request;
        },
    }),
}));

import { DashboardService } from '../src/services/Dashboard.service';

beforeEach(() => {
    mocks.inputs.length = 0;
    mocks.queries.length = 0;
    mocks.result.mockImplementation(async (sql: string) => ({
        recordset: sql.includes('FileDefinitions')
            ? [{ id: 'd1', name: 'Orders', description: null }]
            : [{ id: 'u1', filename: 'orders.csv', status: 'VALIDATED', uploadedAt: '2026-01-01' }],
    }));
});

describe('global search', () => {
    it('scopes a standard user to the definitions and uploads they can access', async () => {
        mocks.isAdmin.mockResolvedValue(false);

        await DashboardService.search('user-1', 'orders');

        expect(mocks.inputs).toHaveLength(2);
        for (const bound of mocks.inputs) {
            expect(bound).toMatchObject({ UserId: 'user-1', IsAdmin: 0, Term: '%orders%' });
        }
        expect(mocks.queries.some(sql => sql.includes('FileDefinitionUserAccess'))).toBe(true);
        expect(mocks.queries.every(sql => sql.includes('@IsAdmin = 1'))).toBe(true);
    });

    it('lets an administrator search everything', async () => {
        mocks.isAdmin.mockResolvedValue(true);

        await DashboardService.search('admin-1', 'orders');

        for (const bound of mocks.inputs) expect(bound).toMatchObject({ UserId: 'admin-1', IsAdmin: 1 });
    });

    it.each([
        ['100%', '%100[%]%'],
        ['a_b', '%a[_]b%'],
        ['[x]', '%[[]x[]]%'],
    ])('escapes the LIKE wildcards in "%s"', async (term, expected) => {
        mocks.isAdmin.mockResolvedValue(false);

        await DashboardService.search('user-1', term);

        expect(mocks.inputs[0].Term).toBe(expected);
    });

    it('passes the term as a bound parameter, never into the SQL text', async () => {
        mocks.isAdmin.mockResolvedValue(false);

        await DashboardService.search('user-1', "'; DROP TABLE Uploads; --");

        expect(mocks.queries.every(sql => !sql.includes('DROP TABLE'))).toBe(true);
    });

    it('returns uploads as found and fills in a missing definition description', async () => {
        mocks.isAdmin.mockResolvedValue(false);

        const found = await DashboardService.search('user-1', 'o');

        expect(found.definitions).toEqual([{ id: 'd1', name: 'Orders', description: '' }]);
        expect(found.uploads).toHaveLength(1);
    });
});
