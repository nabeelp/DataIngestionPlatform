const mocks = {
    cache: { get: jest.fn(), set: jest.fn() },
    query: jest.fn(),
    queue: jest.fn(),
    counts: {
        users: jest.fn(), sessions: jest.fn(), today: jest.fn(), status: jest.fn(), definitions: jest.fn(),
    },
};

jest.mock('../src/config/appConfig', () => ({ appConfig: { stats: { cacheTtl: 30 } } }));
jest.mock('../src/models/User.model', () => ({ User: { getActiveCount: mocks.counts.users, getActiveSessionsCount: mocks.counts.sessions } }));
jest.mock('../src/models/Upload.model', () => ({ Upload: { getTodayCount: mocks.counts.today, getStatusCounts: mocks.counts.status } }));
jest.mock('../src/models/FileDefinition.model', () => ({ FileDefinition: { getCount: mocks.counts.definitions } }));
jest.mock('../src/config/database', () => ({ getConnection: async () => ({ request: () => ({ query: mocks.query }) }) }));
jest.mock('../src/services/MemoryCache.service', () => ({ cacheService: mocks.cache }));
jest.mock('../src/services/ServiceBus.service', () => ({ serviceBusService: { getQueueMonitoringStats: mocks.queue } }));
jest.mock('../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import { StatsService } from '../src/services/Stats.service';

// The service asks for throughput first, then for failures, in that order.
const databaseCounts = (uploads: number, failed: number) => {
    mocks.query.mockImplementation(async (sql: string) => ({
        recordset: [sql.includes('Failed') ? { Failed: failed } : { Uploads: uploads }],
    }));
};

beforeEach(() => {
    mocks.cache.get.mockResolvedValue(undefined);
    mocks.cache.set.mockResolvedValue(undefined);
    mocks.counts.users.mockResolvedValue(4);
    mocks.counts.sessions.mockResolvedValue(2);
    mocks.counts.today.mockResolvedValue(7);
    mocks.counts.status.mockResolvedValue({ filesInQueue: 3, filesValidating: 1, filesDelivering: 0 });
    mocks.counts.definitions.mockResolvedValue(5);
    mocks.queue.mockResolvedValue({ available: false });
});

describe('admin stats', () => {
    it('returns cached stats without touching the database', async () => {
        const cached = { totalUsers: 1 };
        mocks.cache.get.mockResolvedValue(cached);

        await expect(StatsService.getAdminStats()).resolves.toBe(cached);
        expect(mocks.query).not.toHaveBeenCalled();
    });

    it('combines the counts, derives the health score and caches the result', async () => {
        databaseCounts(20, 5);

        const stats = await StatsService.getAdminStats();

        expect(stats).toMatchObject({
            totalUsers: 4,
            activeSessions: 2,
            todayUploads: 7,
            totalDefinitions: 5,
            filesInQueue: 3,
            filesValidating: 1,
            filesDelivering: 0,
            systemHealth: '75%',
            recentUploadThroughput: { windowMinutes: 60, uploads: 20, uploadsPerMinute: 0.33 },
        });
        expect(mocks.cache.set).toHaveBeenCalledWith('admin:stats', stats, 30);
    });

    it('reports full health when nothing was uploaded recently', async () => {
        databaseCounts(0, 0);

        await expect(StatsService.getAdminStats()).resolves.toMatchObject({ systemHealth: '100%' });
    });

    it('never reports a negative health score', async () => {
        databaseCounts(2, 9);

        await expect(StatsService.getAdminStats()).resolves.toMatchObject({ systemHealth: '0%' });
    });

    it('defaults missing queue counts to zero', async () => {
        databaseCounts(1, 0);
        mocks.counts.status.mockResolvedValue({});

        await expect(StatsService.getAdminStats()).resolves.toMatchObject({ filesInQueue: 0, filesValidating: 0, filesDelivering: 0 });
    });

    it('does not cache a failed refresh', async () => {
        databaseCounts(1, 0);
        mocks.counts.users.mockRejectedValue(new Error('database unavailable'));

        await expect(StatsService.getAdminStats()).rejects.toThrow('database unavailable');
        expect(mocks.cache.set).not.toHaveBeenCalled();
    });
});

describe('queue monitoring', () => {
    it('returns the queue statistics with recent throughput', async () => {
        databaseCounts(30, 0);
        mocks.queue.mockResolvedValue({ available: true, validationQueue: { active: 2 } });

        await expect(StatsService.getQueueMonitoring()).resolves.toEqual({
            stats: { available: true, validationQueue: { active: 2 } },
            recentUploadThroughput: { windowMinutes: 60, uploads: 30, uploadsPerMinute: 0.5 },
        });
    });
});
