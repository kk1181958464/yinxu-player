import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'

export interface AppUpdaterPlugin {
  downloadAndInstall(options: { url: string; fileName?: string }): Promise<{ started: boolean }>
  addListener(
    eventName: 'downloadProgress',
    listener: (data: { percent: number }) => void
  ): Promise<PluginListenerHandle>
  addListener(
    eventName: 'downloadError',
    listener: (data: { message: string }) => void
  ): Promise<PluginListenerHandle>
  addListener(
    eventName: 'installStarted',
    listener: (data: { message?: string }) => void
  ): Promise<PluginListenerHandle>
}

export const AppUpdater = registerPlugin<AppUpdaterPlugin>('AppUpdater')
