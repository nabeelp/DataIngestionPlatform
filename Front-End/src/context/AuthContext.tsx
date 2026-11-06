import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiConfig } from '../config/api';
import { apiRequest } from '../services/http';
import { devBypassAuth, tryMockLogin } from '../dev/mockAuth';
import { io } from 'socket.io-client';
import type { Socket as SocketType } from 'socket.io-client';
import {
  TOKEN_KEY,
  USER_KEY,
  clearStoredSession,
  readStoredSession,
  toSessionUser,
  type ServerUser,
  type User,
} from './session';

export type { ServerUser } from './session';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  login: (email: string, password: string) => Promise<User>;
  loginWithSso: (token: string, user: ServerUser) => Promise<void>;
  logout: () => Promise<void>;
  token: string | null;
  socket: SocketType | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// AUTH PROVIDER
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
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
    try {
      const session = readStoredSession(localStorage, devBypassAuth);
      if (session) {
        setToken(session.token);
        setUser(session.user);
      }
    } catch (error) {
      console.error('Auth initialization error:', error);
      clearStoredSession(localStorage);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const toggleSidebar = () => {
    setSidebarOpen((prev) => !prev);
  };

  const login = async (email: string, password: string): Promise<User> => {
    setIsLoading(true);
    
    try {
      const mockSession = tryMockLogin(email, password);
      if (mockSession) {
        localStorage.setItem(TOKEN_KEY, mockSession.token);
        localStorage.setItem(USER_KEY, JSON.stringify(mockSession.user));

        setToken(mockSession.token);
        setUser(mockSession.user);
        setIsLoading(false);
        return mockSession.user;
      }

      const data = await apiRequest<{ token?: string; user?: ServerUser }>('/auth/login', {
        method: 'POST',
        auth: false,
        fallbackMessage: 'Login failed',
        body: { Email: email, Password: password },
      });

      if (!data.token || !data.user) throw new Error('Invalid response');

      const validatedUser = toSessionUser(data.user, 'password');
      if (!validatedUser) {
        throw new Error('Invalid response');
      }
      
      queryClient.clear();
      localStorage.setItem(TOKEN_KEY, data.token);
      localStorage.setItem(USER_KEY, JSON.stringify(validatedUser));
      
      setToken(data.token);
      setUser(validatedUser);
      return validatedUser;
    } catch (error) {
      console.error('Login error:', error);
      throw new Error(error instanceof Error && error.message ? error.message : 'Login failed');
    } finally {
      setIsLoading(false);
    }
  };

  const loginWithSso = async (ssoToken: string, ssoUser: ServerUser): Promise<void> => {
    const validatedUser = toSessionUser(ssoUser, 'sso');
    if (!ssoToken || !validatedUser) {
      throw new Error('Invalid SSO data');
    }
    validatedUser.loginMethod = 'sso';
    
    queryClient.clear();
    localStorage.setItem(TOKEN_KEY, ssoToken);
    localStorage.setItem(USER_KEY, JSON.stringify(validatedUser));
    
    setToken(ssoToken);
    setUser(validatedUser);
  };

  const logout = async () => {
    const hadSession = Boolean(token);
    // Started before the stored session is cleared so the request still carries its bearer token.
    const logoutRequest = hadSession ? apiRequest('/auth/logout', { method: 'POST' }) : null;

    clearStoredSession(localStorage);
    queryClient.clear();
    setToken(null);
    setUser(null);
    setSocket(null);
    
    try {
      await logoutRequest;
    } catch {
      // Logout is best-effort; the local session is already cleared.
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
