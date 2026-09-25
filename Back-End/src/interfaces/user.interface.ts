// =============================================================================
// User Interface - Defines the User type for authentication
// =============================================================================

/**
 * User roles in the system
 */
export type UserRole = 'admin' | 'user';

/**
 * SSO Providers supported
 */
export type SsoProvider = 'microsoft' | null;

/**
 * Login method used
 */
export type LoginMethod = 'sso' | 'password';

/**
 * User entity interface
 */
export interface IUser {
    Id: string;
    Email: string;
    Username: string;
    PasswordHash: string | null;
    FirstName: string | null;
    LastName: string | null;
    Role: UserRole;
    IsActive: boolean;
    
    // SSO Fields
    SsoProvider: SsoProvider;
    SsoSubjectId: string | null;
    
    // Authentication flags
    IsPasswordAuthEnabled: boolean;
    IsSsoAuthEnabled: boolean;
    
    // Security
    LastLoginAt: Date | null;
    FailedLoginAttempts: number;
    LockedUntil: Date | null;
    
    // Timestamps
    CreatedAt: Date;
    UpdatedAt: Date;
}

/**
 * User registration DTO
 */
export interface ICreateUserDto {
    Email: string;
    Username: string;
    Password?: string;
    FirstName?: string;
    LastName?: string;
    Role?: UserRole;
    SsoProvider?: SsoProvider;
    SsoSubjectId?: string;
    IsPasswordAuthEnabled?: boolean;
    IsSsoAuthEnabled?: boolean;
}

/**
 * User login DTO (password-based)
 */
export interface ILoginDto {
    Email: string;
    Password: string;
}

/**
 * SSO login DTO
 */
export interface ISsoLoginDto {
    Provider: SsoProvider;
    /** OAuth authorization code returned to the redirect URI */
    Code: string;
    /** State value returned on the redirect (must match the session) */
    State: string;
    /** Signed session token issued by GET /auth/sso/url and kept by the client */
    Session: string;
}

/**
 * Authenticated user response (without sensitive data)
 */
export interface IUserResponse {
    Id: string;
    Email: string;
    Username: string;
    FirstName: string | null;
    LastName: string | null;
    Role: UserRole;
    LoginMethod: LoginMethod;
}

/**
 * Login response
 */
export interface ILoginResponse {
    success: boolean;
    token: string;
    user: IUserResponse;
    loginMethod: LoginMethod;
}

/**
 * JWT Payload
 */
export interface IJwtPayload {
    userId: string;
    email: string;
    role: UserRole;
    loginMethod: LoginMethod;
    iat?: number;
    exp?: number;
}

