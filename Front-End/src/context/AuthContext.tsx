import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { apiConfig } from '../config/api';
import { io, Socket } from 'socket.io-client';
import type { Socket as SocketType } from 'socket.io-client';

const devBypassAuth = import.meta.env.DEV && import.meta.env.VITE_DEV_BYPASS_AUTH === 'true';

// Local-only test users (enabled explicitly via VITE_DEV_BYPASS_AUTH)
const HARDCODED_USERS = [
  {
    id: '63BD96E4-1229-4399-8964-0795E50B3574',
    email: 'admin@company.com',
    username: 'admin',
    firstName: 'System',
    lastName: 'Administrator',
    Role: 'admin',
    loginMethod: 'password',
  },
  {
    id: '1C5E6A9B-BF1F-40E8-99DA-7893A8960CBA',
    email: 'user@company.com',
    username: 'user',
    firstName: 'Test',
    lastName: 'User',
    Role: 'user',
    loginMethod: 'password',
  },
];

const HARDCODED_PASSWORD = 'password123';

// INTERFACES
interface User {
  id: string;
  email: string;
  username: string;
  firstName: string | null;
  lastName: string | null;
  Role: string;
  loginMethod: string;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  login: (email: string, password: string) => Promise<User>;
  loginWithSso: (token: string, user: unknown) => Promise<void>;
  logout: () => Promise<void>;
  token: string | null;
  socket: SocketType | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * Normalize the backend user payload (PascalCase from the API, camelCase from storage).
 */
const normalizeUser = (raw: any, fallbackLoginMethod: string): User | null => {
  if (!raw) return null;
  const id = raw.id ?? raw.Id;
  const email = raw.email ?? raw.Email;
  if (!id || !email) return null;
  return {
    id,
    email,
    username: raw.username ?? raw.Username ?? '',
    firstName: raw.firstName ?? raw.FirstName ?? null,
    lastName: raw.lastName ?? raw.LastName ?? null,
    Role: raw.Role ?? raw.role ?? 'user',
    loginMethod: raw.loginMethod ?? raw.LoginMethod ?? fallbackLoginMethod,
  };
};

// AUTH PROVIDER
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [socket, setSocket] = useState<SocketType | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Socket connection management
  useEffect(() => {
    if (!token) {
      setSocket((prev) => {
        prev?.disconnect();
        return null;
      });
      return;
    }

    const socketUrl = (apiConfig.getWebSocketUrl?.() as string) || apiConfig.getBaseUrl().replace(/^http/, 'ws');
    const newSocket = io(socketUrl, { auth: { token } });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, [token]);

  // Initialize auth
  useEffect(() => {
    const initializeAuth = () => {
      try {
        const storedToken = localStorage.getItem('token');
        const storedUser = localStorage.getItem('user');

        if (storedToken?.startsWith('mock_token_') && !devBypassAuth) {
          localStorage.removeItem('token');
          localStorage.removeItem('user');
          return;
        }
        
        if (!storedToken || !storedUser) {
          setIsLoading(false);
          return;
        }
        
        let parsedUser: User | null = null;
        try {
          parsedUser = JSON.parse(storedUser);
        } catch {
          localStorage.removeItem('token');
          localStorage.removeItem('user');
          setIsLoading(false);
          return;
        }
        
        const isValidToken = 
          storedToken.split('.').length === 3 || 
          (devBypassAuth && storedToken.startsWith('mock_token_'));
        
        if (!isValidToken) {
          localStorage.removeItem('token');
          localStorage.removeItem('user');
          setIsLoading(false);
          return;
        }
        
        if (parsedUser && parsedUser.id && parsedUser.email) {
          setToken(storedToken);
          setUser(parsedUser);
        } else {
          localStorage.removeItem('token');
          localStorage.removeItem('user');
        }
      } catch (error) {
        console.error('Auth initialization error:', error);
        localStorage.removeItem('token');
        localStorage.removeItem('user');
      } finally {
        setIsLoading(false);
      }
    };

    initializeAuth();
  }, []);

  const toggleSidebar = () => {
    setSidebarOpen((prev) => !prev);
  };

  const login = async (email: string, password: string): Promise<User> => {
    setIsLoading(true);
    
    try {
      const normalizedEmail = email.toLowerCase().trim();
      const hardcodedUser = HARDCODED_USERS.find(
        u => u.email.toLowerCase() === normalizedEmail
      );

      if (devBypassAuth && hardcodedUser && password === HARDCODED_PASSWORD) {
        const mockToken = `mock_token_${hardcodedUser.id}_${Date.now()}`;
        
        localStorage.setItem('token', mockToken);
        localStorage.setItem('user', JSON.stringify(hardcodedUser));
        
        setToken(mockToken);
        setUser(hardcodedUser);
        setIsLoading(false);
        return hardcodedUser;
      }

      const baseUrl = apiConfig.getBaseUrl();
      const response = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ Email: email, Password: password }),
      });

      const data = await response.json();

      if (!response.ok) throw new Error(data.message || 'Login failed');

      if (!data.token || !data.user) {
        throw new Error('Invalid response');
      }

      const validatedUser = normalizeUser(data.user, 'password');
      if (!validatedUser) {
        throw new Error('Invalid response');
      }
      
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(validatedUser));
      
      setToken(data.token);
      setUser(validatedUser);
      return validatedUser;
    } catch (error: any) {
      console.error('Login error:', error);
      throw new Error(error.message || 'Login failed');
    } finally {
      setIsLoading(false);
    }
  };

  const loginWithSso = async (ssoToken: string, ssoUser: unknown): Promise<void> => {
    const validatedUser = normalizeUser(ssoUser, 'sso');
    if (!ssoToken || !validatedUser) {
      throw new Error('Invalid SSO data');
    }
    validatedUser.loginMethod = 'sso';
    
    localStorage.setItem('token', ssoToken);
    localStorage.setItem('user', JSON.stringify(validatedUser));
    
    setToken(ssoToken);
    setUser(validatedUser);
  };

  const logout = async () => {
    const currentToken = token;
    
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken(null);
    setUser(null);
    setSocket(null);
    
    if (currentToken) {
      try {
        await fetch(`${apiConfig.getBaseUrl()}/auth/logout`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${currentToken}` },
        });
      } catch {
        // Logout is best-effort; the local session is already cleared.
      }
    }
  };

  const value = {
    user,
    isLoading,
    sidebarOpen,
    toggleSidebar,
    login,
    loginWithSso,
    logout,
    token,
    socket,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
