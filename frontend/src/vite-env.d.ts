/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_EQ2_WORLD?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
