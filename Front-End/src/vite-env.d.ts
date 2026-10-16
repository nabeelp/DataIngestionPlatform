/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_WS_URL?: string;
  readonly VITE_DEV_BYPASS_AUTH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  __APP_CONFIG__?: {
    readonly apiUrl?: string;
    readonly applicationInsightsConnectionString?: string;
    readonly applicationInsightsSamplingPercentage?: number;
  };
}
