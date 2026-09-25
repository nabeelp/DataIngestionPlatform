import crypto from 'crypto';
import jwt from 'jsonwebtoken';

const TENANT = '11111111-1111-1111-1111-111111111111';
const CLIENT = '22222222-2222-2222-2222-222222222222';
const ISSUER = `https://login.microsoftonline.com/${TENANT}/v2.0`;

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

jest.mock('jwks-rsa', () => ({
    JwksClient: jest.fn().mockImplementation(() => ({
        getSigningKey: jest.fn().mockImplementation(async (kid: string) => {
            if (kid !== 'test-key') throw new Error('unknown kid');
            return { getPublicKey: () => publicPem };
        }),
    })),
}));

type SsoModule = typeof import('../src/services/MicrosoftSso.service');

const loadModule = (): SsoModule => {
    process.env.MS_SSO_ENABLED = 'true';
    process.env.MS_TENANT_ID = TENANT;
    process.env.MS_CLIENT_ID = CLIENT;
    process.env.MS_CLIENT_SECRET = 'test-secret';
    process.env.JWT_SECRET = 'unit-test-jwt-secret';
    let mod: SsoModule | undefined;
    jest.isolateModules(() => {
        mod = require('../src/services/MicrosoftSso.service');
    });
    return mod!;
};

const sign = (claims: Record<string, unknown>, options: jwt.SignOptions = {}, key: crypto.KeyObject = privateKey) =>
    jwt.sign({ oid: 'user-oid', tid: TENANT, nonce: 'n-1', preferred_username: 'a@contoso.com', ...claims }, key, {
        algorithm: 'RS256',
        keyid: 'test-key',
        audience: CLIENT,
        issuer: ISSUER,
        ...('exp' in claims ? {} : { expiresIn: '5m' }),
        ...options,
    });

describe('Microsoft SSO ID token verification', () => {
    const sso = loadModule();

    it('accepts a correctly signed token for this app, tenant, and nonce', async () => {
        const claims = await sso.verifyIdToken(sign({}), 'n-1');
        expect(claims.oid).toBe('user-oid');
    });

    it('rejects a token signed with another key', async () => {
        const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
        await expect(sso.verifyIdToken(sign({}, {}, other), 'n-1')).rejects.toThrow('ID token verification failed');
    });

    it('rejects an unsigned (alg none) token', async () => {
        const unsigned = jwt.sign({ oid: 'x', tid: TENANT, nonce: 'n-1', aud: CLIENT, iss: ISSUER }, '', { algorithm: 'none' });
        await expect(sso.verifyIdToken(unsigned, 'n-1')).rejects.toThrow();
    });

    it('rejects the wrong audience, issuer, tenant, or nonce', async () => {
        await expect(sso.verifyIdToken(sign({}, { audience: 'other-app' }), 'n-1')).rejects.toThrow();
        await expect(sso.verifyIdToken(sign({}, { issuer: 'https://evil.example/v2.0' }), 'n-1')).rejects.toThrow();
        await expect(sso.verifyIdToken(sign({ tid: 'other-tenant' }), 'n-1')).rejects.toThrow('tenant mismatch');
        await expect(sso.verifyIdToken(sign({}), 'different-nonce')).rejects.toThrow('nonce mismatch');
    });

    it('rejects expired tokens', async () => {
        const expired = sign({ exp: Math.floor(Date.now() / 1000) - 3600 });
        await expect(sso.verifyIdToken(expired, 'n-1')).rejects.toThrow();
    });

    it('keeps the PKCE verifier out of the authorize URL', () => {
        const { url, state, session } = sso.buildAuthorizeUrl();
        const params = new URL(url).searchParams;
        expect(params.get('client_id')).toBe(CLIENT);
        expect(params.get('code_challenge_method')).toBe('S256');
        expect(params.get('state')).toBe(state);

        const decoded = jwt.verify(session, 'unit-test-jwt-secret') as { nonce: string; verifier: string; state: string };
        expect(decoded.state).toBe(state);
        expect(params.get('nonce')).toBe(decoded.nonce);
        expect(url).not.toContain(decoded.verifier);
        expect(url).not.toContain(session);
    });

    it('refuses to redeem a code with a forged or mismatched session', async () => {
        const forged = jwt.sign({ purpose: 'ms-sso-session', state: 's', nonce: 'x', verifier: 'y' }, 'wrong-secret');
        await expect(sso.redeemAuthorizationCode('code', 's', forged)).rejects.toThrow('Invalid or expired SSO session');

        const { session } = sso.buildAuthorizeUrl();
        await expect(sso.redeemAuthorizationCode('code', 'other-state', session)).rejects.toThrow('Invalid or expired SSO session');
    });
});
