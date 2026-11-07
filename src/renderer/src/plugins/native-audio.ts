import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'

export type NativeAudioStatus = {
  currentTime: number
  duration: number
  playing: boolean
}

export type NativeAudioError = {
  message?: string
}

export interface NativeAudioPlugin {
  play(options: {
    url: string
    volume?: number
    muted?: boolean
    title?: string
    artist?: string
    cover?: string
    duration?: number
  }): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  /** release=true 时同时结束前台服务和锁屏/蓝牙媒体会话；切歌时不要传 */
  stop(options?: { release?: boolean }): Promise<void>
  seek(options: { time: number }): Promise<void>
  setVolume(options: { volume: number; muted?: boolean }): Promise<void>
  getStatus(): Promise<NativeAudioStatus>
  addListener(
    eventName: 'timeupdate' | 'playing' | 'ended' | 'error' | 'mediaControl',
    listenerFunc: (
      event: NativeAudioStatus &
        NativeAudioError & { action?: string; position?: number }
    ) => void
  ): Promise<PluginListenerHandle>
}

export const NativeAudio = registerPlugin<NativeAudioPlugin>('NativeAudio')