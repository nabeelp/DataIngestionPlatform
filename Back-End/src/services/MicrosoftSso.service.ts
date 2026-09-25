// =============================================================================
// Microsoft Entra ID SSO - authorization code flow with PKCE and verified ID tokens
// =============================================================================

import crypto from 'crypto';
import jwt, { JwtHeader, JwtPayload } from 'jsonwebtoken';
import { JwksClient } from 'jwks-rsa';
import { appConfig } from '../config/appConfig';

export interface MicrosoftIdTokenClaims extends JwtPayload {
    oid: string;
    tid: string;
    nonce?: string;
    name?: string;
    preferred_username?: string;
    email?: string;
    given_name?: string;
    family_name?: string;
}

interface SsoSessionPayload {
    purpose: 'ms-sso-session';
    state: string;
    nonce: string;
    verifier: string;
}

const STATE_TTL_SECONDS = 600;
const SCOPES = 'openid profile email';

const base64Url = (buffer: Buffer): string =>
    buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const msConfig = () => appConfig.sso.microsoft;

const assertConfigured = (): void => {
    const { enabled, clientId, clientSecret, tenantId } = msConfig();
    if (!enabled) {
        throw new Error('Microsoft SSO is not enabled');
    }
    if (!clientId || !clientSecret || !tenantId) {
        throw new Error('Microsoft SSO is not configured (MS_CLIENT_ID, MS_CLIENT_SECRET, MS_TENANT_ID)');
    }
};

const authorityBase = (): string => `${msConfig().authority.replace(/\/+$/, '')}/${msConfig().tenantId}`;

let jwksClient: JwksClient | null = null;
const getJwksClient = (): JwksClient => {
    if (!jwksClient) {
        jwksClient = new JwksClient({
            jwksUri: `${authorityBase()}/discovery/v2.0/keys`,
            cache: true,
            cacheMaxAge: 12 * 60 * 60 * 1000,
            rateLimit: true,
            jwksRequestsPerMinute: 10,
        });
    }
    return jwksClient;
};

/**
 * Build the Entra ID authorize URL.
 * - `state` is an opaque random value that round-trips through the redirect.
 * - `session` is a short-lived signed token holding the state, nonce, and PKCE verifier. The client
 *   keeps it (never in a URL) and returns it with the authorization code, so an intercepted callback
 *   URL alone cannot be redeemed and no server-side session storage is required.
 */
export function buildAuthorizeUrl(): { url: string; state: string; session: string } {
    assertConfigured();
    const state = base64Url(crypto.randomBytes(16));
    const nonce = base64Url(crypto.randomBytes(16));
    const verifier = base64Url(crypto.randomBytes(32));
    const challenge = base64Url(crypto.createHash('sha256').update(verifier).digest());

    const sessionPayload: SsoSessionPayload = { purpose: 'ms-sso-session', state, nonce, verifier };
    const session = jwt.sign(sessionPayload, appConfig.jwt.secret, { expiresIn: STATE_TTL_SECONDS, algorithm: 'HS256' });

    const params = new URLSearchParams({
        client_id: msConfig().clientId,
        response_type: 'code',
        response_mode: 'query',
        redirect_uri: msConfig().redirectUri,
        scope: SCOPES,
        state,
        nonce,
        code_challenge: challenge,
        code_challenge_method: 'S256',
    });

    return { url: `${authorityBase()}/oauth2/v2.0/authorize?${params.toString()}`, state, session };
}

const verifySession = (session: string, state: string): SsoSessionPayload => {
    let payload: SsoSessionPayload & JwtPayload;
    try {
        payload = jwt.verify(session, appConfig.jwt.secret, { algorithms: ['HS256'] }) as SsoSessionPayload & JwtPayload;
    } catch {
        throw new Error('Invalid or expired SSO session');
    }
    const expected = Buffer.from(payload.state || '');
    const actual = Buffer.from(state || '');
    if (payload.purpose !== 'ms-sso-session' || !payload.nonce || !payload.verifier ||
        expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
        throw new Error('Invalid or expired SSO session');
    }
    return payload;
};

const getSigningKey = (header: JwtHeader, callback: (err: Error | null, key?: string) => void): void => {
    if (!header.kid) {
        callback(new Error('ID token is missing a key id'));
        return;
    }
    getJwksClient().getSigningKey(header.kid)
        .then(key => callback(null, key.getPublicKey()))
        .catch(err => callback(err as Error));
};

/**
 * Verify an Entra ID v2.0 ID token: signature (JWKS), audience, issuer, tenant, lifetime, and nonce.
 */
export function verifyIdToken(idToken: string, expectedNonce: string): Promise<MicrosoftIdTokenClaims> {
    const { clientId, tenantId } = msConfig();
    const expectedIssuer = `${authorityBase()}/v2.0`;

    return new Promise((resolve, reject) => {
        jwt.verify(
            idToken,
            getSigningKey,
            { algorithms: ['RS256'], audience: clientId, issuer: expectedIssuer, clockTolerance: 60 },
            (err, decoded) => {
                if (err || !decoded || typeof decoded === 'string') {
                    reject(new Error('ID token verification failed'));
                    return;
                }
                const claims = decoded as MicrosoftIdTokenClaims;
                if (claims.tid !== tenantId) {
                    reject(new Error('ID token tenant mismatch'));
                    return;
                }
                if (!claims.oid) {
                    reject(new Error('ID token is missing the oid claim'));
                    return;
                }
                if (claims.nonce !== expectedNonce) {
                    reject(new Error('ID token nonce mismatch'));
                    return;
                }
                resolve(claims);
            }
        );
    });
}

/**
 * Exchange an authorization code for tokens and return the verified ID token claims.
 */
export async function redeemAuthorizationCode(code: string, state: string, session: string): Promise<MicrosoftIdTokenClaims> {
    assertConfigured();
    const { nonce, verifier } = verifySession(session, state);
    const { clientId, clientSecret, redirectUri } = msConfig();

    const response = await fetch(`${authorityBase()}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri,
            code_verifier: verifier,
            scope: SCOPES,
        }).toString(),
    });

    const body = await response.json().catch(() => ({})) as { id_token?: string; error?: string };
    if (!response.ok || !body.id_token) {
        throw new Error(`Authorization code redemption failed${body.error ? `: ${body.error}` : ''}`);
    }

    return verifyIdToken(body.id_token, nonce);
}
