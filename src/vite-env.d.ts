/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Build-time switch for the optional functions/login feature.
   * "off" (default) = pure frontend build, identical to the pre-server app.
   * "optional" = shared build: server login is offered but never required.
   */
  readonly VITE_SERVER_MODE?: "off" | "optional";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
