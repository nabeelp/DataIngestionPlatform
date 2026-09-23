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

//#region EXPORTS
export const apiConfig = {
    //#region API URL METHODS
    /**
     * Get the API base URL from environment variable
     * Falls back to localhost for development
     */
    getBaseUrl: (): string => {
        // First check for explicit VITE_API_URL
        let url = import.meta.env.VITE_API_URL;
        
        debugLog('VITE_API_URL from env:', url);
        
        if (url) {
            debugLog('Using VITE_API_URL:', url);
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
        
        // Default WebSocket URL based on current location
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrlResult = `${protocol}//${window.location.host}`;
        debugLog('Using default WebSocket URL:', wsUrlResult);
        return wsUrlResult;
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

