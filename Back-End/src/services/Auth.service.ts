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
import { redeemAuthorizationCode, type MicrosoftIdTokenClaims } from './MicrosoftSso.service';

export class AuthService {
    /**
     * Main login handler - determines login method and processes accordingly
     */
    static async login(loginData: ILoginDto | ISsoLoginDto): Promise<ILoginResponse> {
        // Check if this is SSO login or password login
        if ('Provider' in loginData && 'Code' in loginData) {
            return await this.handleSsoLogin(loginData as ISsoLoginDto);
        } else {
            return await this.handlePasswordLogin(loginData as ILoginDto);
        }
    }

    /**
     * Handle SSO Login (Microsoft Azure AD)
     */
    static async handleSsoLogin(ssoData: ISsoLoginDto): Promise<ILoginResponse> {
        const { Provider, Code, State, Session } = ssoData;

        try {
            let userInfo: MicrosoftIdTokenClaims;

            // Verify token based on provider
            switch (Provider) {
                case 'microsoft':
                    userInfo = await redeemAuthorizationCode(Code, State, Session);
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
     * Handle Password Login
     */
    static async handlePasswordLogin(credentials: ILoginDto): Promise<ILoginResponse> {
        const { Email, Password } = credentials;

        const user = await User.findByEmail(Email);
        if (!user) {
            logger.warn('[AUTH] Login attempt for unknown account');
            throw new Error('Invalid email or password');
        }

        if (!user.IsPasswordAuthEnabled) {
            logger.warn(`[AUTH] Password login disabled for user ${user.Id}`);
            throw new Error('Password authentication is not enabled for this account');
        }

        if (!user.PasswordHash) {
            logger.warn(`[AUTH] No password set for user ${user.Id}`);
            throw new Error('Invalid email or password');
        }

        if (user.LockedUntil && new Date(user.LockedUntil) > new Date()) {
            const remainingMinutes = Math.ceil((new Date(user.LockedUntil).getTime() - Date.now()) / 60000);
            throw new Error(`Account is locked. Try again in ${remainingMinutes} minutes`);
        }

        if (!user.IsActive) {
            throw new Error('Account is disabled');
        }

        const isPasswordValid = await bcrypt.compare(Password, user.PasswordHash);
        if (!isPasswordValid) {
            await User.incrementFailedAttempts(user.Id);
            logger.warn(`[AUTH] Failed login attempt for user ${user.Id}`);
            throw new Error('Invalid email or password');
        }

        await User.updateLastLogin(user.Id);
        const token = this.generateToken(user, 'password');
        logger.info(`[AUTH] User ${user.Id} logged in with password`);

        return {
            success: true,
            token,
            user: this.formatUserResponse(user, 'password'),
            loginMethod: 'password'
        };
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

