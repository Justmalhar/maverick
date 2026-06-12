/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_VERSION?: string;
  readonly VITE_APP_COMMIT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Declare the slim ESM editor API path so TypeScript resolves it during tsc.
// Vite handles the actual chunk split at build time; tsc just needs to know the
// shape, which matches the main monaco-editor types.
declare module "monaco-editor/esm/vs/editor/editor.api" {
  export * from "monaco-editor";
}

