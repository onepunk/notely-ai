declare global {
  const __APP_VERSION__: string;
  interface Window {
    api: import('../../preload').PreloadApi;
  }
}
export {};
