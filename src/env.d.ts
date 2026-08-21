/// <reference types="vite/client" />

interface Window {
  nodeflow?: {
    platform: string;
    versions: { electron: string; chrome: string; node: string };
  };
}
