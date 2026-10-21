import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('kugou', {
  getApiBase: (): Promise<string> => ipcRenderer.invoke('get-api-base'),
  windowMinimize: (): Promise<void> => ipcRenderer.invoke('window-minimize'),
  windowMaximize: (): Promise<boolean> => ipcRenderer.invoke('window-maximize'),
  windowClose: (): Promise<void> => ipcRenderer.invoke('window-close'),
  windowIsMaximized: (): Promise<boolean> => ipcRenderer.invoke('window-is-maximized')
})
