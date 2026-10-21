export {}

declare global {
  interface Window {
    kugou: {
      getApiBase: () => Promise<string>
      windowMinimize: () => Promise<void>
      windowMaximize: () => Promise<boolean>
      windowClose: () => Promise<void>
      windowIsMaximized: () => Promise<boolean>
    }
  }
}
