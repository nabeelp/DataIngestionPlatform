import type { Express } from 'express';

export const parseTrustProxyHops = (value: string | undefined): number => {
    if (value === undefined) return 0;
    if (value.length === 0 || /[^0-9]/.test(value) || !Number.isSafeInteger(Number(value))) {
        throw new Error('TRUST_PROXY_HOPS must be a non-negative safe integer.');
    }
    return Number(value);
};

export const configureProxyTrust = (app: Express, hops: number): void => {
    // Preserve forwarded-header diagnostics when proxy trust is disabled.
    app.set('trust proxy', hops === 0 ? false : hops);
};
