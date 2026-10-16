// =============================================================================
// Auth Service - Business logic for SSO + Password Authentication
// =============================================================================

import jwt from 'jsonwebtoken';
import { appConfig } from '../config/appConfig';
import { User } from '../models/User.model';
import type { 
    IUser, 
    ILoginDto, 
    ISsoLoginDto, 
    ILoginResponse, 
    IUserResponse,
    IJwtPayload,
    LoginMethod
} from '../interfaces/user.interface';
import { logger } from '../utils/logger';
import { verifyPassword } from '../utils/password';
import { redeemAuthorizationCode, type MicrosoftIdTokenClaims } from './MicrosoftSso.service';

export class AuthService {
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

        const isPasswordValid = await verifyPassword(Password, user.PasswordHash);
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
}

