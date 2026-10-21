/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}

interface Window {
  kugou?: {
    getApiBase: () => Promise<string>
    windowMinimize: () => Promise<void>
    windowMaximize: () => Promise<boolean>
    windowClose: () => Promise<void>
    windowIsMaximized: () => Promise<boolean>
  }
}