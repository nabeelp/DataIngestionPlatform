/**
 * Frontend API Configuration
 * Centralized API URL configuration for the Data Ingestion Platform
 */

// Check if we're in development mode
const isDevelopment = import.meta.env.DEV;
const isProduction = import.meta.env.PROD;

// API Version
const API_VERSION = 'v1';

// Helper function for conditional logging
const debugLog = (message: string, ...args: unknown[]) => {
    if (isDevelopment) {
        console.log(`[API_CONFIG] ${message}`, ...args);
    }
};

export const resolveApiBaseUrl = (environmentUrl?: string, runtimeUrl?: string): string | undefined => {
    const url = environmentUrl || runtimeUrl;
    return url?.replace(/\/+$/, '');
};

//#region EXPORTS
export const apiConfig = {
    //#region API URL METHODS
    /**
     * Get the API base URL from environment variable
     * Falls back to localhost for development
     */
    getBaseUrl: (): string => {
        const runtimeUrl = typeof window === 'undefined' ? undefined : window.__APP_CONFIG__?.apiUrl;
        const url = resolveApiBaseUrl(import.meta.env.VITE_API_URL, runtimeUrl);
        
        debugLog('VITE_API_URL from env:', url);
        
        if (url) {
            debugLog('Using configured API URL:', url);
            return url;
        }

        debugLog('Is production:', isProduction);
        
        if (isProduction) {
            // In production, try to construct URL from window.location
            // This handles the case where frontend and backend are served from same origin
            const baseUrl = `${window.location.protocol}//${window.location.host}`;
            debugLog('Production environment detected, using:', baseUrl);
            return `${baseUrl}/api/${API_VERSION}`;
        }
        
        // Development: Use relative path to go through Vite proxy
        // The Vite proxy is configured to forward /api to http://localhost:3000
        debugLog('Using relative path /api (goes through Vite proxy)');
        return `/api/${API_VERSION}`;
    },
    //#endregion

    //#region WEBSOCKET METHODS
    /**
     * Get the WebSocket URL for real-time connections
     */
    getWebSocketUrl: (): string => {
        const wsUrl = import.meta.env.VITE_WS_URL;
        if (wsUrl) {
            debugLog('Using VITE_WS_URL:', wsUrl);
            return wsUrl;
        }
        
        // Socket.IO uses HTTP polling before upgrading to WebSocket. Resolve its
        // origin from the API URL because the SPA and API use separate hosts in Azure.
        const socketOrigin = new URL(apiConfig.getBaseUrl(), window.location.origin).origin;
        debugLog('Using default Socket.IO origin:', socketOrigin);
        return socketOrigin;
    },
    //#endregion

    //#region ENVIRONMENT METHODS
    /**
     * Check if the app is running in development mode
     */
    isDevelopment: (): boolean => {
        return isDevelopment;
    },
    
    /**
     * Check if the app is running in production mode
     */
    isProduction: (): boolean => {
        return isProduction;
    }
    //#endregion
};

export default apiConfig;
//#endregion
