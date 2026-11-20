/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WIDGET_URL: string;
  readonly VITE_WIDGET_BOOTSTRAP_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
