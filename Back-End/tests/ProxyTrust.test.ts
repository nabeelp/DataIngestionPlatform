import type { Server } from 'http';
import type { AddressInfo } from 'net';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { configureProxyTrust, parseTrustProxyHops } from '../src/config/proxyTrust';

describe('TRUST_PROXY_HOPS', () => {
    it.each([
        [undefined, 0],
        ['0', 0],
        ['1', 1],
        ['2', 2],
        ['9007199254740991', Number.MAX_SAFE_INTEGER],
    ])('parses %s as %s', (value, expected) => {
        expect(parseTrustProxyHops(value)).toBe(expected);
    });

    it.each(['', ' ', ' 1 ', '1\n', '-1', '+1', '1.5', 'true', 'false', '1hop', '1e2', 'Infinity', '9007199254740992'])(
        'rejects invalid value %s',
        value => {
            expect(() => parseTrustProxyHops(value)).toThrow(
                'TRUST_PROXY_HOPS must be a non-negative safe integer.',
            );
        },
    );
});

describe('proxy-aware rate limiting', () => {
    let server: Server | undefined;
    let url: string;
    let consoleError: jest.SpyInstance;

    beforeEach(() => {
        consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(async () => {
        try {
            if (server) {
                const activeServer = server;
                activeServer.closeAllConnections();
                await new Promise<void>((resolve, reject) => {
                    activeServer.close(error => error ? reject(error) : resolve());
                });
                server = undefined;
            }
        } finally {
            consoleError.mockRestore();
        }
    });

    const start = async (value: string | undefined) => {
        const app = express();
        configureProxyTrust(app, parseTrustProxyHops(value));
        app.use('/api', rateLimit({ windowMs: 60_000, limit: 2 }));
        app.get('/api/ip', (req, res) => res.json({ ip: req.ip }));
        server = await new Promise<Server>(resolve => {
            const listeningServer = app.listen(0, '127.0.0.1', () => resolve(listeningServer));
        });
        url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/ip`;
    };

    const request = (forwardedFor?: string) => fetch(url, {
        headers: forwardedFor === undefined ? {} : { 'X-Forwarded-For': forwardedFor },
    });

    it('reproduces the exact validation error when forwarding is used without proxy trust', async () => {
        await start(undefined);
        const response = await request('198.51.100.10');
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ ip: '127.0.0.1' });
        expect(consoleError).toHaveBeenCalledWith(expect.objectContaining({
            code: 'ERR_ERL_UNEXPECTED_X_FORWARDED_FOR',
        }));
    });

    it('uses the ingress-supplied rightmost IP without rate-limit validation errors', async () => {
        await start('1');
        const response = await request('203.0.113.99, 198.51.100.10');
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ ip: '198.51.100.10' });
        expect(consoleError).not.toHaveBeenCalled();
    });

    it('ignores spoofed prefixes and keeps separate client rate-limit buckets', async () => {
        await start('1');
        expect((await request('198.51.100.10')).status).toBe(200);
        const spoofed = await request('203.0.113.99, 198.51.100.10');
        expect(spoofed.status).toBe(200);
        expect(await spoofed.json()).toEqual({ ip: '198.51.100.10' });
        expect((await request('203.0.113.98, 198.51.100.10')).status).toBe(429);
        expect((await request('198.51.100.20')).status).toBe(200);
        expect(consoleError).not.toHaveBeenCalled();
    });

    it.each([undefined, '0'])('preserves direct local access with proxy setting %s', async value => {
        await start(value);
        const response = await request();
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ ip: '127.0.0.1' });
        expect((await request()).status).toBe(200);
        expect((await request()).status).toBe(429);
        expect(consoleError).not.toHaveBeenCalled();
    });
});
