import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('kugou', {
  getApiBase: (): Promise<string> => ipcRenderer.invoke('get-api-base'),
  windowMinimize: (): Promise<void> => ipcRenderer.invoke('window-minimize'),
  windowMaximize: (): Promise<boolean> => ipcRenderer.invoke('window-maximize'),
  windowClose: (): Promise<void> => ipcRenderer.invoke('window-close'),
  windowIsMaximized: (): Promise<boolean> => ipcRenderer.invoke('window-is-maximized'),
  updater: {
    version: (): Promise<string> => ipcRenderer.invoke('updater-version'),
    check: (): Promise<unknown> => ipcRenderer.invoke('updater-check'),
    download: (): Promise<unknown> => ipcRenderer.invoke('updater-download'),
    install: (): Promise<unknown> => ipcRenderer.invoke('updater-install'),
    onStatus: (callback: (status: Record<string, unknown>) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, status: Record<string, unknown>): void => {
        callback(status)
      }
      ipcRenderer.on('updater-status', listener)
      return () => ipcRenderer.removeListener('updater-status', listener)
    }
  }
})
