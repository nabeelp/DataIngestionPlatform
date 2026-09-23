// =============================================================================
// Auth Service - Business logic for SSO + Password Authentication
// =============================================================================

import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { appConfig } from '../config/appConfig';
import { User } from '../models/User.model';
import type { 
    IUser, 
    ILoginDto, 
    ISsoLoginDto, 
    ILoginResponse, 
    IUserResponse,
    IJwtPayload,
    LoginMethod,
    SsoProvider 
} from '../interfaces/user.interface';
import { logger } from '../utils/logger';

// Microsoft Azure AD Token Verification
interface MicrosoftTokenResponse {
    aud: string;
    iss: string;
    iat: number;
    nbf: number;
    exp: number;
    aio: string;
    oid: string;
    tid: string;
    ver: string;
    name: string;
    preferred_username: string;
    email?: string;
    given_name?: string;
    family_name?: string;
}

export class AuthService {
    /**
     * Main login handler - determines login method and processes accordingly
     */
    static async login(loginData: ILoginDto | ISsoLoginDto): Promise<ILoginResponse> {
        // Check if this is SSO login or password login
        if ('Provider' in loginData && 'AccessToken' in loginData) {
            return await this.handleSsoLogin(loginData as ISsoLoginDto);
        } else {
            return await this.handlePasswordLogin(loginData as ILoginDto);
        }
    }

    /**
     * Handle SSO Login (Microsoft Azure AD)
     */
    static async handleSsoLogin(ssoData: ISsoLoginDto): Promise<ILoginResponse> {
        const { Provider, AccessToken, IdToken } = ssoData;

        try {
            let userInfo: MicrosoftTokenResponse;

            // Verify token based on provider
            switch (Provider) {
                case 'microsoft':
                    userInfo = await this.verifyMicrosoftToken(AccessToken, IdToken);
                    break;
                default:
                    throw new Error(`Unsupported SSO provider: ${Provider}`);
            }

            // Find or create user from SSO
            const user = await User.findOrCreateFromSso(
                Provider,
                userInfo.oid,
                userInfo.preferred_username || userInfo.email || '',
                userInfo.given_name,
                userInfo.family_name
            );

            // Check if SSO is enabled for this user
            if (!user.IsSsoAuthEnabled) {
                throw new Error('SSO authentication is not enabled for this account');
            }

            // Check if user is active
            if (!user.IsActive) {
                throw new Error('Account is disabled');
            }

            // Update last login
            await User.updateLastLogin(user.Id);

            // Generate JWT
            const token = this.generateToken(user, 'sso');

            logger.info(`User ${user.Email} logged in via SSO (${Provider})`);

            return {
                success: true,
                token,
                user: this.formatUserResponse(user, 'sso'),
                loginMethod: 'sso'
            };
        } catch (error) {
            logger.error('SSO Login error:', error);
            throw new Error('SSO authentication failed');
        }
    }

    /**
     * Verify Microsoft Azure AD Access Token
     */
    private static async verifyMicrosoftToken(accessToken: string, idToken?: string): Promise<MicrosoftTokenResponse> {
        // In production, you would validate the token against Microsoft's OAuth endpoints
        // For now, we'll decode and validate the token structure
        try {
            // Decode the ID token or access token to get user info
            // In production, use proper token validation with jwks-rsa
            const decoded = jwt.decode(accessToken) as MicrosoftTokenResponse;
            
            if (!decoded || !decoded.oid) {
                throw new Error('Invalid token');
            }

            // Validate token expiration
            if (decoded.exp && decoded.exp * 1000 < Date.now()) {
                throw new Error('Token expired');
            }

            // Validate issuer
            const expectedIss = `${appConfig.sso.microsoft.authority}/${appConfig.sso.microsoft.tenantId}`;
            if (decoded.iss !== expectedIss && !decoded.iss.startsWith(appConfig.sso.microsoft.authority)) {
                logger.warn(`Token issuer mismatch: ${decoded.iss}`);
            }

            return decoded;
        } catch (error) {
            logger.error('Microsoft token verification failed:', error);
            throw new Error('Failed to verify Microsoft token');
        }
    }

    /**
     * Handle Password Login
     */
    static async handlePasswordLogin(credentials: ILoginDto): Promise<ILoginResponse> {
        const { Email, Password } = credentials;

        console.log('[AUTH] handlePasswordLogin called with email:', Email);
        console.log('[AUTH] Password length:', Password?.length);

        try {
            // Find user by email
            console.log('[AUTH] Step 1: Calling User.findByEmail...');
            const user = await User.findByEmail(Email);
            console.log('[AUTH] Step 1 result - User found:', !!user);

            if (!user) {
                console.log('[AUTH] ERROR: User not found in database');
                logger.warn(`Login attempt for non-existent user: ${Email}`);
                throw new Error('Invalid email or password');
            }

            console.log('[AUTH] Step 2: User details -', {
                email: user.Email,
                IsActive: user.IsActive,
                IsPasswordAuthEnabled: user.IsPasswordAuthEnabled,
                hasPasswordHash: !!user.PasswordHash,
                PasswordHashPreview: user.PasswordHash?.substring(0, 20) + '...'
            });

            // Check if password authentication is enabled
            if (!user.IsPasswordAuthEnabled) {
                console.log('[AUTH] ERROR: Password auth is disabled for this user');
                logger.warn(`Password login disabled for user: ${Email}`);
                throw new Error('Password authentication is not enabled for this account');
            }

            // Check if user has a password set
            if (!user.PasswordHash) {
                console.log('[AUTH] ERROR: No password hash in database');
                logger.warn(`No password set for user: ${Email}`);
                throw new Error('Invalid email or password');
            }

            // Check if account is locked
            if (user.LockedUntil && new Date(user.LockedUntil) > new Date()) {
                const remainingMinutes = Math.ceil((new Date(user.LockedUntil).getTime() - Date.now()) / 60000);
                console.log('[AUTH] ERROR: Account is locked until:', user.LockedUntil);
                throw new Error(`Account is locked. Try again in ${remainingMinutes} minutes`);
            }

            // Check if user is active
            if (!user.IsActive) {
                console.log('[AUTH] ERROR: User account is inactive');
                throw new Error('Account is disabled');
            }

            console.log('[AUTH] Step 3: Verifying password with bcrypt...');
            // Verify password
            const isPasswordValid = await bcrypt.compare(Password, user.PasswordHash);
            console.log('[AUTH] Step 3 - Password valid:', isPasswordValid);
            
            if (!isPasswordValid) {
                // Increment failed login attempts
                await User.incrementFailedAttempts(user.Id);
                console.log('[AUTH] ERROR: Password does not match');
                logger.warn(`Failed login attempt for user: ${Email}`);
                throw new Error('Invalid email or password');
            }

            // Reset failed attempts and update last login
            console.log('[AUTH] Step 4: Updating last login...');
            await User.updateLastLogin(user.Id);

            // Generate JWT
            console.log('[AUTH] Step 5: Generating JWT token...');
            const token = this.generateToken(user, 'password');

            console.log('[AUTH] SUCCESS: Login completed for user:', Email);

            return {
                success: true,
                token,
                user: this.formatUserResponse(user, 'password'),
                loginMethod: 'password'
            };
        } catch (error) {
            console.log('[AUTH] ERROR in handlePasswordLogin:', error instanceof Error ? error.message : error);
            logger.error('Password login error:', error);
            throw error;
        }
    }

    /**
     * Generate JWT Token
     */
    static generateToken(user: IUser, loginMethod: LoginMethod): string {
        const payload: IJwtPayload = {
            userId: user.Id,
            email: user.Email,
            role: user.Role,
            loginMethod,
        };

        return jwt.sign(payload, appConfig.jwt.secret, {
            expiresIn: '24h',
        });
    }

    /**
     * Verify JWT Token
     */
    static verifyToken(token: string): IJwtPayload {
        try {
            return jwt.verify(token, appConfig.jwt.secret) as IJwtPayload;
        } catch (error) {
            throw new Error('Invalid or expired token');
        }
    }

    /**
     * Format user response (exclude sensitive data)
     */
    static formatUserResponse(user: IUser, loginMethod: LoginMethod): IUserResponse {
        return {
            Id: user.Id,
            Email: user.Email,
            Username: user.Username,
            FirstName: user.FirstName,
            LastName: user.LastName,
            Role: user.Role,
            LoginMethod: loginMethod,
        };
    }

    /**
     * Hash password for storage
     */
    static async hashPassword(password: string): Promise<string> {
        return await bcrypt.hash(password, appConfig.security.bcryptRounds);
    }

    /**
     * Create password reset token (for future implementation)
     */
    static createPasswordResetToken(userId: string): string {
        return jwt.sign(
            { userId, type: 'password_reset' },
            appConfig.jwt.secret,
            { expiresIn: '1h' }
        );
    }

    /**
     * Refresh token
     */
    static async refreshToken(token: string): Promise<ILoginResponse> {
        try {
            const payload = this.verifyToken(token);
            const user = await User.findById(payload.userId);

            if (!user || !user.IsActive) {
                throw new Error('User not found or inactive');
            }

            await User.updateLastLogin(user.Id);
            const newToken = this.generateToken(user, payload.loginMethod);

            return {
                success: true,
                token: newToken,
                user: this.formatUserResponse(user, payload.loginMethod),
                loginMethod: payload.loginMethod,
            };
        } catch (error) {
            throw new Error('Invalid refresh token');
        }
    }
}

