/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}

interface UpdaterStatus {
  state: string
  version?: string
  percent?: number
  message?: string
}

interface Window {
  kugou?: {
    getApiBase: () => Promise<string>
    windowMinimize: () => Promise<void>
    windowMaximize: () => Promise<boolean>
    windowClose: () => Promise<void>
    windowIsMaximized: () => Promise<boolean>
    updater?: {
      version: () => Promise<string>
      check: () => Promise<unknown>
      download: () => Promise<unknown>
      install: () => Promise<unknown>
      onStatus: (callback: (status: UpdaterStatus) => void) => () => void
    }
  }
}