/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly DEV_BYPASS_AUTH: boolean | string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

