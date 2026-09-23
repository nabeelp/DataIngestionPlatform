//#region IMPORTS
import { useState, FormEvent, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiConfig } from '../config/api';
//#endregion

//#region MAIN COMPONENT
export default function Login() {
  //#region STATE
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSsoLoading, setIsSsoLoading] = useState(false);
  //#endregion

  //#region HOOKS
  const { login, loginWithSso } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  
  // Check for SSO callback parameters
  const code = searchParams.get('code');
  const errorParam = searchParams.get('error');
  const errorDescription = searchParams.get('error_description');
  //#endregion

  //#region EFFECTS
  // Handle SSO callback from Microsoft redirect
  useEffect(() => {
    console.log('[LOGIN] Component mounted, checking for callback params');
    console.log('[LOGIN] Code:', code ? 'present' : 'not present');
    console.log('[LOGIN] Error param:', errorParam);
    
    if (code) {
      console.log('[LOGIN] SSO callback detected with code');
      handleSsoCallback(code);
    }
    if (errorParam) {
      console.log('[LOGIN] SSO error detected:', errorParam, errorDescription);
      setError(decodeURIComponent(errorDescription || errorParam));
    }
  }, [code, errorParam, errorDescription]);
  //#endregion

  //#region SSO HANDLER
  const handleSsoLogin = async () => {
    console.log('[LOGIN] handleSsoLogin called');
    setIsSsoLoading(true);
    setError('');

    try {
      // Get the Microsoft OAuth URL from backend
      const baseUrl = apiConfig.getBaseUrl();
      console.log('[LOGIN] Fetching SSO URL from:', `${baseUrl}/auth/sso/url?provider=microsoft`);
      
      const response = await fetch(`${baseUrl}/auth/sso/url?provider=microsoft`);
      console.log('[LOGIN] SSO URL response status:', response.status);
      
      if (!response.ok) {
        const errorData = await response.json();
        console.error('[LOGIN] SSO URL error:', errorData);
        throw new Error('Failed to get SSO URL');
      }

      const data = await response.json();
      console.log('[LOGIN] SSO URL data:', data);
      
      if (data.success && data.url) {
        console.log('[LOGIN] Redirecting to Microsoft OAuth');
        window.location.href = data.url;
      } else {
        console.error('[LOGIN] SSO URL missing from response');
        throw new Error(data.message || 'Failed to initiate SSO');
      }
    } catch (err) {
      console.error('[LOGIN] SSO login error:', err);
      setError(err instanceof Error ? err.message : 'SSO login failed');
      setIsSsoLoading(false);
    }
  };

  const handleSsoCallback = async (authCode: string) => {
    console.log('[LOGIN] handleSsoCallback called with code:', authCode.substring(0, 20) + '...');
    setIsSsoLoading(true);
    setError('');

    try {
      const baseUrl = apiConfig.getBaseUrl();
      console.log('[LOGIN] Sending SSO code to backend:', `${baseUrl}/auth/sso/login`);
      
      const response = await fetch(`${baseUrl}/auth/sso/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          Provider: 'microsoft',
          AccessToken: authCode,
        }),
      });

      console.log('[LOGIN] SSO login response status:', response.status);
      const data = await response.json();
      console.log('[LOGIN] SSO login response data:', data);

      if (!response.ok) {
        console.error('[LOGIN] SSO login failed:', data.message);
        throw new Error(data.message || 'SSO login failed');
      }

      // Use the loginWithSso function from AuthContext
      console.log('[LOGIN] SSO successful, calling loginWithSso');
      await loginWithSso(data.token, data.user);
      
      // Redirect to appropriate dashboard
      const redirectPath = data.user.Role === 'admin' ? '/admin' : '/';
      console.log('[LOGIN] Redirecting to:', redirectPath);
      navigate(redirectPath, { replace: true });
    } catch (err) {
      console.error('[LOGIN] SSO callback error:', err);
      setError(err instanceof Error ? err.message : 'SSO login failed');
      setIsSsoLoading(false);
    }
  };
  //#endregion

  //#region PASSWORD LOGIN HANDLER
  const handlePasswordSubmit = async (e: FormEvent) => {
    console.log('[LOGIN] Email:', email);
    e.preventDefault();
    console.log('[LOGIN] Email:', email);
    setError('');
    setIsLoading(true);

    try {
      console.log('[LOGIN] Calling login function from AuthContext');
      const user = await login(email, password);
      console.log('[LOGIN] Login successful, user:', user);
      
      // Redirect to appropriate dashboard based on user role
      const redirectPath = user.Role === 'admin' ? '/admin' : '/';
      console.log('[LOGIN] Redirecting to:', redirectPath);
      navigate(redirectPath);
    } catch (err) {
      console.error('[LOGIN] Password login error:', err);
      const errorMessage = err instanceof Error ? err.message : 'Login failed';
      console.log('[LOGIN] Setting error message:', errorMessage);
      setError(errorMessage);
    } finally {
      setIsLoading(false);
      console.log('[LOGIN] Loading state set to false');
    }
  };
  //#endregion

  //#region RENDER
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-6 sm:space-y-8">
        {/* Header */}
        <div className="text-center">
          <h2 className="mt-2 text-2xl sm:text-3xl font-extrabold text-gray-900">
            Data Ingestion Platform
          </h2>
          <p className="mt-2 text-sm sm:text-base text-gray-600">
            Sign in to your account
          </p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="rounded-md bg-red-50 p-4 border border-red-200">
            <div className="flex items-center">
              <svg className="w-5 h-5 text-red-500 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="text-sm text-red-700">{error}</div>
            </div>
          </div>
        )}

        {/* Microsoft SSO Button */}
        <button
          type="button"
          onClick={handleSsoLogin}
          disabled={isSsoLoading}
          className="group relative w-full flex justify-center py-3 px-4 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 transition-colors"
        >
          {isSsoLoading ? (
            <span className="flex items-center">
              <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-gray-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Connecting to Microsoft...
            </span>
          ) : (
            <span className="flex items-center">
              <svg className="w-5 h-5 mr-2" viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg">
                <rect x="1" y="1" width="9" height="9" fill="#f25022"/>
                <rect x="11" y="1" width="9" height="9" fill="#7fba00"/>
                <rect x="1" y="11" width="9" height="9" fill="#00a4ef"/>
                <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
              </svg>
              Sign in with Microsoft
            </span>
          )}
        </button>

        {/* Divider */}
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-300" />
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-2 bg-gray-50 text-gray-500">Or continue with</span>
          </div>
        </div>

        {/* Password Login Form */}
        <form className="mt-6 sm:mt-8 space-y-4 sm:space-y-6" onSubmit={handlePasswordSubmit}>
          <div className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                Email address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => {
                  console.log('[LOGIN] Email changed:', e.target.value);
                  setEmail(e.target.value);
                }}
                className="appearance-none block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                placeholder="Email address"
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => {
                  console.log('[LOGIN] Password changed, length:', e.target.value.length);
                  setPassword(e.target.value);
                }}
                className="appearance-none block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                placeholder="Password"
              />
            </div>
          </div>

          <div>
           <button
            type="submit"
            disabled={isLoading}
            className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50"
          >
            {isLoading ? 'Signing in...' : 'Sign in with Email'}
          </button>
          </div>
        </form>
      </div>
    </div>
  );
  //#endregion
}
//#endregion

