import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { App as CapacitorApp } from '@capacitor/app'
import { isCapacitorNative, isElectron } from '../utils/platform'
import { AppUpdater } from '../plugins/app-updater'

const RELEASE_API = 'https://api.github.com/repos/kk1181958464/yinxu-player/releases/latest'

export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'latest'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error'

interface GithubAsset {
  name: string
  browser_download_url: string
}

interface GithubRelease {
  tag_name?: string
  assets?: GithubAsset[]
}

function parseVersion(value: string): number[] {
  return String(value)
    .replace(/^v/i, '')
    .split(/[.+-]/)
    .map((part) => Number(part.replace(/\D/g, '')) || 0)
}

function compareVersions(a: string, b: string): number {
  const left = parseVersion(a)
  const right = parseVersion(b)
  const length = Math.max(left.length, right.length)
  for (let i = 0; i < length; i += 1) {
    const diff = (left[i] || 0) - (right[i] || 0)
    if (diff !== 0) return diff
  }
  return 0
}

function apkVersion(name: string): string {
  const match = name.match(/Yinxu-(\d+\.\d+\.\d+)\.apk$/i)
  return match ? match[1] : ''
}

export const useUpdateStore = defineStore('update', () => {
  const open = ref(false)
  const currentVersion = ref('')
  const latestVersion = ref('')
  const downloadUrl = ref('')
  const phase = ref<UpdatePhase>('idle')
  const progress = ref(0)
  const message = ref('')

  const desktop = isElectron()
  const native = isCapacitorNative()
  const hasUpdate = computed(
    () => phase.value === 'available' || phase.value === 'downloading' || phase.value === 'downloaded'
  )
  const canDownload = computed(() => phase.value === 'available' && Boolean(downloadUrl.value || desktop))
  const canInstall = computed(() => phase.value === 'downloaded' && desktop)

  let desktopBound = false
  let mobileBound = false
  let checkedOnce = false

  function applyDesktopStatus(status: UpdaterStatus): void {
    const state = String(status.state || '')
    const version = status.version ? String(status.version) : ''
    if (state === 'checking') {
      phase.value = 'checking'
      message.value = '正在检查更新…'
    } else if (state === 'available') {
      phase.value = 'available'
      latestVersion.value = version
      message.value = `发现新版本 ${version}`
    } else if (state === 'not-available') {
      phase.value = 'latest'
      message.value = '已是最新版本'
    } else if (state === 'downloading') {
      phase.value = 'downloading'
      progress.value = Number(status.percent) || 0
      message.value = `正在下载 ${progress.value}%`
    } else if (state === 'downloaded') {
      phase.value = 'downloaded'
      latestVersion.value = version || latestVersion.value
      message.value = '更新包已下载完成，安装后会自动重启'
    } else if (state === 'error') {
      phase.value = 'error'
      message.value = String(status.message || '检查更新失败')
    }
  }

  function bindDesktop(): void {
    if (!desktop || desktopBound) return
    const updater = window.kugou?.updater
    if (!updater) return
    desktopBound = true
    updater.onStatus(applyDesktopStatus)
    void updater
      .version()
      .then((version) => {
        currentVersion.value = version
      })
      .catch(() => {
        /* ignore */
      })
  }

  async function bindMobile(): Promise<void> {
    if (!native || mobileBound) return
    mobileBound = true
    try {
      const info = await CapacitorApp.getInfo()
      currentVersion.value = info.version || ''
    } catch {
      /* ignore */
    }
    try {
      await AppUpdater.addListener('downloadProgress', ({ percent }) => {
        phase.value = 'downloading'
        progress.value = Math.max(0, Math.min(100, Math.round(percent || 0)))
        message.value = `正在下载 ${progress.value}%`
      })
      await AppUpdater.addListener('downloadError', ({ message: error }) => {
        phase.value = 'error'
        message.value = error || '下载更新失败'
      })
      await AppUpdater.addListener('installStarted', () => {
        phase.value = 'downloaded'
        message.value = '安装器已打开，请按系统提示安装'
      })
    } catch {
      /* 插件不可用时在检查阶段提示 */
    }
  }

  async function init(): Promise<void> {
    if (desktop) bindDesktop()
    if (native) await bindMobile()
  }

  async function check(): Promise<void> {
    if (phase.value === 'checking' || phase.value === 'downloading') return
    if (desktop) {
      bindDesktop()
      phase.value = 'checking'
      message.value = '正在检查更新…'
      const result = (await window.kugou?.updater?.check()) as
        | { state?: string; message?: string }
        | undefined
      if (result?.state === 'error') {
        phase.value = 'error'
        message.value = result.message || '检查更新失败'
      }
      return
    }

    if (!native) {
      phase.value = 'error'
      message.value = '网页版不支持自动更新，请下载安装包'
      return
    }

    phase.value = 'checking'
    progress.value = 0
    message.value = '正在检查更新…'
    try {
      await bindMobile()
      const info = await CapacitorApp.getInfo()
      currentVersion.value = info.version || currentVersion.value
      const response = await fetch(RELEASE_API, {
        headers: { Accept: 'application/vnd.github+json' }
      })
      if (!response.ok) throw new Error(`GitHub 返回 ${response.status}`)
      const release = (await response.json()) as GithubRelease
      const apks = (release.assets || []).filter((asset) => /\.apk$/i.test(asset.name))
      const latestAsset = apks
        .map((asset) => ({ asset, version: apkVersion(asset.name) }))
        .filter((item) => item.version)
        .sort((a, b) => compareVersions(b.version, a.version))[0]
      if (!latestAsset) throw new Error('最新版本没有找到 APK 安装包')
      latestVersion.value = latestAsset.version
      downloadUrl.value = latestAsset.asset.browser_download_url
      if (compareVersions(latestVersion.value, currentVersion.value) > 0) {
        phase.value = 'available'
        message.value = `发现新版本 ${latestVersion.value}`
      } else {
        phase.value = 'latest'
        message.value = '已是最新版本'
      }
    } catch (error) {
      phase.value = 'error'
      message.value = error instanceof Error ? error.message : '检查更新失败'
    }
  }

  async function autoCheck(): Promise<void> {
    if (checkedOnce) return
    checkedOnce = true
    await init()
    await check()
  }

  async function download(): Promise<void> {
    if (!canDownload.value && phase.value !== 'available') return
    if (desktop) {
      phase.value = 'downloading'
      progress.value = 0
      message.value = '正在下载更新…'
      await window.kugou?.updater?.download()
      return
    }
    if (!native || !downloadUrl.value) return
    phase.value = 'downloading'
    progress.value = 0
    message.value = '正在下载更新…'
    try {
      await AppUpdater.downloadAndInstall({
        url: downloadUrl.value,
        fileName: `Yinxu-${latestVersion.value}.apk`
      })
    } catch (error) {
      phase.value = 'error'
      message.value = error instanceof Error ? error.message : '下载更新失败'
    }
  }

  async function install(): Promise<void> {
    if (!canInstall.value) return
    await window.kugou?.updater?.install()
  }

  function openPanel(): void {
    open.value = true
  }

  function closePanel(): void {
    open.value = false
  }

  return {
    open,
    currentVersion,
    latestVersion,
    downloadUrl,
    phase,
    progress,
    message,
    hasUpdate,
    canDownload,
    canInstall,
    init,
    check,
    autoCheck,
    download,
    install,
    openPanel,
    closePanel
  }
})
