import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  type SongItem,
  type AudioQuality,
  songTitle,
  songArtist,
  songCover,
  songDurationSeconds,
  fetchSongUrl,
  getApiBase,
  SongUnavailableError
} from '../api/kugou'
import { isCapacitorNative } from '../utils/platform'
import { NativeAudio } from '../plugins/native-audio'
import type { PluginListenerHandle } from '@capacitor/core'

/** 三种互斥的播放模式：列表循环 / 随机播放 / 单曲循环 */
export type PlayMode = 'order' | 'shuffle' | 'one'

const VOLUME_KEY = 'kugou_player_volume'
const QUALITY_KEY = 'kugou_player_quality'
const PLAY_MODE_KEY = 'kugou_player_mode'
const LEGACY_SHUFFLE_KEY = 'kugou_player_shuffle'
const LEGACY_REPEAT_KEY = 'kugou_player_repeat'
const RECENT_KEY = 'kugou_recent_played'
const UNAVAILABLE_KEY = 'kugou_unavailable_songs'
/** MSE 首包尽量小，尽快开播；后续分片加大，保证下载速度跟上播放 */
const MSE_FIRST_CHUNK = 128 * 1024
const MSE_CHUNK = 384 * 1024

interface MseSession {
  aborted: boolean
  mediaSource: MediaSource
  sourceBuffer: SourceBuffer | null
  objectUrl: string
  epoch: number
}

function initialVolume(): number {
  // 原生端没有应用内音量条，交给系统媒体音量；忽略历史缓存里的 0，避免装完没声音
  if (isCapacitorNative()) return 1
  const raw = Number(localStorage.getItem(VOLUME_KEY))
  if (Number.isFinite(raw) && raw >= 0 && raw <= 1) return raw
  return 0.8
}

function initialQuality(): AudioQuality {
  return Number(localStorage.getItem(QUALITY_KEY)) === 320 ? 320 : 128
}

function initialPlayMode(): PlayMode {
  const raw = localStorage.getItem(PLAY_MODE_KEY)
  if (raw === 'order' || raw === 'shuffle' || raw === 'one') return raw
  // 旧版本随机/循环是两个独立开关
  if (localStorage.getItem(LEGACY_SHUFFLE_KEY) === '1') return 'shuffle'
  if (localStorage.getItem(LEGACY_REPEAT_KEY) === 'one') return 'one'
  return 'order'
}

function readStringList(key: string): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || '[]') as unknown
    return Array.isArray(raw)
      ? raw.filter((item): item is string => typeof item === 'string').slice(-300)
      : []
  } catch {
    return []
  }
}

export const usePlayerStore = defineStore('player', () => {
  const queue = ref<SongItem[]>([])
  const currentIndex = ref(-1)
  const playing = ref(false)
  const currentTime = ref(0)
  const duration = ref(0)
  const loading = ref(false)
  const error = ref('')
  const audioUrl = ref('')

  const volume = ref(initialVolume())
  const muted = ref(false)
  const quality = ref<AudioQuality>(initialQuality())
  const playMode = ref<PlayMode>(initialPlayMode())
  const shuffle = computed(() => playMode.value === 'shuffle')
  const recentPlayed = ref<string[]>(readStringList(RECENT_KEY))
  const unavailable = ref(new Set(readStringList(UNAVAILABLE_KEY)))
  let shuffleBack: number[] = []
  /** 下一次 loadAndPlay 遇到下架歌曲时的跳过方向；用户直接点歌时为 0，只提示不跳 */
  let skipDirection: 1 | -1 | 0 = 0
  let skippedInRow = 0

  function isUnavailable(song: SongItem): boolean {
    return Boolean(song.hash) && unavailable.value.has(song.hash)
  }

  function setUnavailable(song: SongItem, flag: boolean): void {
    if (!song.hash || isUnavailable(song) === flag) return
    const next = new Set(unavailable.value)
    if (flag) next.add(song.hash)
    else next.delete(song.hash)
    unavailable.value = next
    try {
      localStorage.setItem(UNAVAILABLE_KEY, JSON.stringify([...next].slice(-300)))
    } catch {
      /* ignore */
    }
  }

  /** 顺序切歌时跳过已知下架的歌；全部下架则退回相邻一首 */
  function stepIndex(dir: 1 | -1): number {
    const n = queue.value.length
    const from = currentIndex.value
    for (let k = 1; k < n; k++) {
      const i = (((from + dir * k) % n) + n) % n
      if (!isUnavailable(queue.value[i])) return i
    }
    return (((from + dir) % n) + n) % n
  }

  function songKey(song: SongItem): string {
    return song.hash || `${songTitle(song)}::${songArtist(song)}`
  }

  function markPlayed(song: SongItem): void {
    const key = songKey(song)
    if (!key) return
    const next = recentPlayed.value.filter((item) => item !== key)
    next.push(key)
    recentPlayed.value = next.slice(-300)
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(recentPlayed.value))
    } catch {
      /* ignore */
    }
  }

  function setPlayMode(mode: PlayMode): void {
    playMode.value = mode
    try {
      localStorage.setItem(PLAY_MODE_KEY, mode)
    } catch {
      /* ignore */
    }
  }

  /**
   * 随机播放优先选择没听过的歌；全部听过时只在“最久没听”的那一部分里随机，
   * 避免总是重复当前/最近几首。
   */
  function nextShuffleIndex(): number {
    const n = queue.value.length
    if (n <= 1) return n - 1
    const current = currentIndex.value
    const recentIndex = new Map<string, number>()
    recentPlayed.value.forEach((key, index) => recentIndex.set(key, index))
    const candidates = queue.value
      .map((song, index) => ({ index, key: songKey(song) }))
      .filter((item) => item.index !== current && !isUnavailable(queue.value[item.index]))
    if (!candidates.length) return current

    const unheard = candidates.filter((item) => !recentIndex.has(item.key))
    if (unheard.length) {
      return unheard[Math.floor(Math.random() * unheard.length)].index
    }

    const sorted = candidates.sort(
      (a, b) => (recentIndex.get(a.key) ?? 0) - (recentIndex.get(b.key) ?? 0)
    )
    const pool = sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 3)))
    return pool[Math.floor(Math.random() * pool.length)].index
  }

  let audio: HTMLAudioElement | null = null
  /** 每次切歌/停止递增，用来丢弃过期的异步播放请求 */
  let loadEpoch = 0
  /** 正在尝试多个音频源时为 true，避免中间失败提前弹出错误 */
  let tryingSources = false
  let mseSession: MseSession | null = null

  let objectUrlToRevoke: string | null = null
  let audioCtx: AudioContext | null = null
  let audioUnlocked = false
  /** Capacitor 原生 MediaPlayer 是否接管当前曲目 */
  let usingNativeAudio = false
  let nativeListeners: PluginListenerHandle[] = []

  function revokeObjectUrl(): void {
    if (objectUrlToRevoke) {
      URL.revokeObjectURL(objectUrlToRevoke)
      objectUrlToRevoke = null
    }
  }

  /**
   * 真机 WebView 有时处于 muted / AudioContext suspended，进度会走但没声音。
   * 在用户手势链路里解锁，并保证 volume / muted 生效。
   */
  async function unlockAudioOutput(): Promise<void> {
    applyVolume()
    // 原生端没有应用内音量条，静音/音量过低只可能是异常状态；桌面端要尊重用户的静音设置
    if (audio && isCapacitorNative()) {
      // 避免静音状态“播了但听不见”
      if (muted.value) {
        muted.value = false
      }
      if (volume.value < 0.05) {
        volume.value = 0.8
        localStorage.setItem(VOLUME_KEY, String(volume.value))
      }
      audio.muted = false
      audio.volume = volume.value
    }
    try {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AC) {
        audioUnlocked = true
        return
      }
      if (!audioCtx) audioCtx = new AC()
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume()
      }
      // 短促无声音缓冲，进一步解锁部分 OEM WebView 媒体通路
      if (!audioUnlocked) {
        const buffer = audioCtx.createBuffer(1, 1, 22050)
        const src = audioCtx.createBufferSource()
        src.buffer = buffer
        src.connect(audioCtx.destination)
        src.start(0)
        audioUnlocked = true
      }
    } catch {
      audioUnlocked = true
    }
  }

  /** 是否酷狗 CDN（可尝试直连 HTTPS，跳过云端反代） */
  function isKugouCdnHost(host: string): boolean {
    const h = host.toLowerCase()
    return h === 'kugou.com' || h.endsWith('.kugou.com')
  }

  /**
   * http CDN → https 同 host/path（多数酷狗 CDN 支持 HTTPS，真机可直连，开播接近桌面速度）。
   * 已是 https 则原样返回；非 http(s) 返回空串。
   */
  function httpsUpgradedCdnSrc(url: string): string {
    try {
      const u = new URL(url)
      if (!isKugouCdnHost(u.hostname)) return ''
      if (u.protocol === 'https:') return u.href
      if (u.protocol === 'http:') {
        u.protocol = 'https:'
        return u.href
      }
      return ''
    } catch {
      return ''
    }
  }

  /**
   * 原生 WebView 直接播 http CDN 会触发 mixed content。
   * 把 CDN 地址换成云端 API 的 HTTPS 流式代理（同域 HTTPS，可直接作 Audio.src）。
   * 已是 https 的 *.kugou.com 不应走此函数优先路径——由 loadAndPlay 先试直连。
   */
  function proxiedAudioSrc(url: string): string {
    if (!isCapacitorNative()) return url
    try {
      const u = new URL(url)
      // 已是 HTTPS 酷狗 CDN：仍可构造代理作兜底，但调用方应先试 raw
      if (u.protocol === 'https:' && isKugouCdnHost(u.hostname)) {
        return `${getApiBase()}/song/audio-proxy/https/${u.host}${u.pathname}${u.search}`
      }
    } catch {
      /* fall through */
    }
    const m = url.match(/^(https?):\/\/(.+)$/i)
    return m ? `${getApiBase()}/song/audio-proxy/${m[1].toLowerCase()}/${m[2]}` : url
  }

  /**
   * 原生播放候选顺序（与桌面一致优先直连）：
   * 1) 原始 fetchSongUrl（多为 http CDN，原生 MediaPlayer / 已放开 mixed-content 的 WebView 可直连）
   * 2) http→https 升级 CDN
   * 3) 云端 audio-proxy（兜底）
   */
  function nativeDirectPlayCandidates(url: string): string[] {
    const out: string[] = []
    if (url) out.push(url)
    const upgraded = httpsUpgradedCdnSrc(url)
    if (upgraded && !out.includes(upgraded)) out.push(upgraded)
    try {
      const u = new URL(url)
      if (u.protocol === 'https:' && isKugouCdnHost(u.hostname) && !out.includes(u.href)) {
        out.push(u.href)
      }
    } catch {
      /* ignore */
    }
    const proxied = proxiedAudioSrc(url)
    if (proxied && !out.includes(proxied)) out.push(proxied)
    return out
  }

  /** 兜底：直连 / MSE 都失败时，用完整下载转 blob */
  async function toBlobSrc(url: string): Promise<string> {
    const res = await fetch(proxiedAudioSrc(url), { method: 'GET', credentials: 'omit' })
    if (!res.ok) throw new Error(`音频下载失败 (${res.status})`)
    const blob = await res.blob()
    if (!blob || blob.size === 0) throw new Error('音频内容为空')
    const objectUrl = URL.createObjectURL(blob)
    revokeObjectUrl()
    objectUrlToRevoke = objectUrl
    return objectUrl
  }

  function cleanupMse(): void {
    const session = mseSession
    if (!session) return
    mseSession = null
    session.aborted = true
    try {
      if (session.sourceBuffer?.updating) session.sourceBuffer.abort()
    } catch {
      /* ignore */
    }
    try {
      if (session.mediaSource.readyState === 'open') session.mediaSource.endOfStream()
    } catch {
      /* ignore */
    }
    URL.revokeObjectURL(session.objectUrl)
  }

  function appendMseBuffer(sb: SourceBuffer, data: ArrayBuffer): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false
      const cleanup = (): void => {
        sb.removeEventListener('updateend', onEnd)
        sb.removeEventListener('error', onError)
      }
      const finish = (ok: boolean, err?: unknown): void => {
        if (settled) return
        settled = true
        cleanup()
        if (ok) resolve()
        else reject(err instanceof Error ? err : new Error('MSE 追加失败'))
      }
      const onEnd = (): void => finish(true)
      const onError = (): void => finish(false, new Error('MSE 追加失败'))
      sb.addEventListener('updateend', onEnd)
      sb.addEventListener('error', onError)
      try {
        sb.appendBuffer(data)
      } catch (e) {
        finish(false, e)
      }
    })
  }

  /**
   * 原生 WebView 的媒体栈无法直接流式播放 CDN / HTTPS 代理（实测 NotSupportedError），
   * 但可以用 CapacitorHttp 按 Range 分片拉取，再喂给 MediaSource，实现真正的边下边播。
   */
  async function playWithMse(
    url: string,
    song: SongItem,
    el: HTMLAudioElement,
    epoch: number
  ): Promise<void> {
    cleanupMse()
    if (typeof MediaSource === 'undefined' || !MediaSource.isTypeSupported('audio/mpeg')) {
      throw new Error('当前环境不支持流式音频')
    }
    const proxy = proxiedAudioSrc(url)
    const mediaSource = new MediaSource()
    const objectUrl = URL.createObjectURL(mediaSource)
    const session: MseSession = {
      aborted: false,
      mediaSource,
      sourceBuffer: null,
      objectUrl,
      epoch
    }
    mseSession = session

    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('MSE 初始化超时')), 5000)
        mediaSource.addEventListener(
          'sourceopen',
          () => {
            clearTimeout(timer)
            resolve()
          },
          { once: true }
        )
        mediaSource.addEventListener(
          'error',
          () => {
            clearTimeout(timer)
            reject(new Error('MSE 初始化失败'))
          },
          { once: true }
        )
        el.src = objectUrl
        el.preload = 'auto'
        el.load()
      })
      if (epoch !== loadEpoch || session.aborted) throw new Error('播放已取消')

      const sb = mediaSource.addSourceBuffer('audio/mpeg')
      session.sourceBuffer = sb
      const knownDuration = songDurationSeconds(song)
      if (knownDuration > 0) {
        try {
          mediaSource.duration = knownDuration
        } catch {
          /* ignore */
        }
      }

      let startedResolve!: () => void
      let startedReject!: (e: unknown) => void
      let startedSettled = false
      const started = new Promise<void>((resolve, reject) => {
        startedResolve = () => {
          if (startedSettled) return
          startedSettled = true
          resolve()
        }
        startedReject = (e: unknown) => {
          if (startedSettled) return
          startedSettled = true
          reject(e)
        }
      })
      const firstTimer = setTimeout(
        () => startedReject(new Error('音频首包超时')),
        8000
      )

      void (async () => {
        let start = 0
        let total = 0
        let first = true
        try {
          while (!session.aborted && epoch === loadEpoch) {
            const size = first ? MSE_FIRST_CHUNK : MSE_CHUNK
            const end = start + size - 1
            const res = await fetch(proxy, {
              headers: { Range: `bytes=${start}-${end}` },
              credentials: 'omit'
            })
            if (session.aborted || epoch !== loadEpoch) return
            if (!res.ok) throw new Error(`音频流请求失败 (${res.status})`)
            const contentRange = res.headers.get('content-range')
            if (contentRange) {
              const m = contentRange.match(/\/(\d+)\s*$/)
              if (m) total = Number(m[1])
            }
            const buffer = await res.arrayBuffer()
            if (session.aborted || epoch !== loadEpoch) return
            if (!buffer.byteLength) break
            await appendMseBuffer(sb, buffer)
            if (session.aborted || epoch !== loadEpoch) return
            start += buffer.byteLength

            if (first) {
              first = false
              el.play()
                .then(() => startedResolve())
                .catch((e: unknown) => startedReject(e))
            }
            if ((total > 0 && start >= total) || buffer.byteLength < size) break
          }
          if (!session.aborted && epoch === loadEpoch && mediaSource.readyState === 'open') {
            try {
              mediaSource.endOfStream()
            } catch {
              /* ignore */
            }
          }
        } catch (e) {
          if (session.aborted || epoch !== loadEpoch) return
          if (first) startedReject(e)
          else console.warn('[player] audio stream interrupted', e)
        } finally {
          clearTimeout(firstTimer)
          if (!startedSettled) startedReject(new Error('播放已取消'))
        }
      })()

      await started
    } catch (e) {
      // 只有当前会话仍归本次播放时才清理，避免旧请求误杀新歌
      if (mseSession === session) cleanupMse()
      throw e
    }
  }

  async function detachNativeListeners(): Promise<void> {
    const handles = nativeListeners
    nativeListeners = []
    await Promise.all(
      handles.map(async (h) => {
        try {
          await h.remove()
        } catch {
          /* ignore */
        }
      })
    )
  }

  async function stopNativeAudio(): Promise<void> {
    await detachNativeListeners()
    if (!usingNativeAudio) {
      try {
        await NativeAudio.stop()
      } catch {
        /* plugin may be absent on web/ios */
      }
      return
    }
    usingNativeAudio = false
    try {
      await NativeAudio.stop()
    } catch {
      /* ignore */
    }
  }

  async function attachNativeListeners(epoch: number): Promise<void> {
    await detachNativeListeners()
    const onTime = await NativeAudio.addListener('timeupdate', (ev) => {
      if (epoch !== loadEpoch || !usingNativeAudio) return
      currentTime.value = ev.currentTime || 0
      if (ev.duration && Number.isFinite(ev.duration) && ev.duration > 0) {
        duration.value = ev.duration
      }
      playing.value = Boolean(ev.playing)
      if (ev.playing) loading.value = false
    })
    const onPlaying = await NativeAudio.addListener('playing', (ev) => {
      if (epoch !== loadEpoch || !usingNativeAudio) return
      playing.value = true
      loading.value = false
      if (ev.duration && Number.isFinite(ev.duration) && ev.duration > 0) {
        duration.value = ev.duration
      }
    })
    const onEnded = await NativeAudio.addListener('ended', () => {
      if (epoch !== loadEpoch || !usingNativeAudio) return
      playing.value = false
      void handleEnded()
    })
    const onError = await NativeAudio.addListener('error', (ev) => {
      if (epoch !== loadEpoch || !usingNativeAudio) return
      console.warn('[player] native audio error', ev.message)
    })
    const onMediaControl = await NativeAudio.addListener('mediaControl', (ev) => {
      if (epoch !== loadEpoch || !usingNativeAudio) return
      if (ev.action === 'next') void next()
      else if (ev.action === 'prev') void prev()
      else if (ev.action === 'seek' && typeof ev.position === 'number') seek(ev.position)
      else if (ev.action === 'play' && !playing.value) toggle()
      else if (ev.action === 'pause' && playing.value) toggle()
      else if (ev.action === 'stop') stop()
    })
    nativeListeners = [onTime, onPlaying, onEnded, onError, onMediaControl]
  }

  /** 原生 MediaPlayer 直连 URL（可播 http CDN）；超时则失败给下一候选 */
  async function playNativeSource(url: string, epoch: number, timeoutMs: number): Promise<void> {
    await attachNativeListeners(epoch)
    usingNativeAudio = true
    // 停掉 HTML Audio，避免双路出声
    if (audio) {
      try {
        audio.pause()
        audio.removeAttribute('src')
        audio.load()
      } catch {
        /* ignore */
      }
    }
    cleanupMse()
    revokeObjectUrl()

    let timer: ReturnType<typeof setTimeout> | null = null
    try {
      const mediaSong = current.value
      await Promise.race([
        NativeAudio.play({
          url,
          volume: 1,
          muted: false,
          title: mediaSong ? songTitle(mediaSong) : '',
          artist: mediaSong ? songArtist(mediaSong) : '',
          cover: mediaSong ? songCover(mediaSong) : '',
          duration: mediaSong ? songDurationSeconds(mediaSong) : duration.value
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('原生播放超时')), timeoutMs)
        })
      ])
      if (epoch !== loadEpoch) throw new Error('abort')
      const status = await NativeAudio.getStatus()
      if (status.duration && status.duration > 0) duration.value = status.duration
      currentTime.value = status.currentTime || 0
      playing.value = true
      loading.value = false
    } catch (e) {
      usingNativeAudio = false
      await detachNativeListeners()
      try {
        await NativeAudio.stop()
      } catch {
        /* ignore */
      }
      throw e
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  /** 播放一个 src，并在 playing / play() 或超时后结束等待 */
  function playSource(el: HTMLAudioElement, src: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false
      let timer: ReturnType<typeof setTimeout> | null = null

      const cleanup = (): void => {
        el.removeEventListener('playing', onPlaying)
        el.removeEventListener('error', onError)
        if (timer) {
          clearTimeout(timer)
          timer = null
        }
      }
      const finish = (ok: boolean, err?: unknown): void => {
        if (settled) return
        settled = true
        cleanup()
        if (ok) resolve()
        else reject(err instanceof Error ? err : new Error('音频源不可用'))
      }
      const onPlaying = (): void => finish(true)
      const onError = (): void => finish(false, new Error('音频源不可用'))

      el.addEventListener('playing', onPlaying)
      el.addEventListener('error', onError)
      timer = setTimeout(() => finish(false, new Error('音频加载超时')), timeoutMs)
      el.preload = 'auto'
      el.muted = muted.value
      el.volume = volume.value
      el.src = src
      el.load()
      void unlockAudioOutput().finally(() => {
        el.muted = muted.value
        el.volume = volume.value
        el.play().then(() => finish(true)).catch((e: unknown) => finish(false, e))
      })
    })
  }

  const current = computed(() => (currentIndex.value >= 0 ? queue.value[currentIndex.value] : null))
  const title = computed(() => (current.value ? songTitle(current.value) : '未在播放'))
  const artist = computed(() => (current.value ? songArtist(current.value) : ''))
  const cover = computed(() => (current.value ? songCover(current.value) : ''))
  const hasQueue = computed(() => queue.value.length > 0)
  const progress = computed(() => {
    if (!duration.value) return 0
    return Math.min(100, Math.max(0, (currentTime.value / duration.value) * 100))
  })

  function applyVolume(): void {
    const native = isCapacitorNative()
    const outputVolume = native ? 1 : volume.value
    const outputMuted = native ? false : muted.value
    if (usingNativeAudio) {
      void NativeAudio.setVolume({ volume: outputVolume, muted: outputMuted }).catch(() => {})
    }
    if (!audio) return
    audio.volume = outputVolume
    audio.muted = outputMuted
  }

  function ensureAudio(): HTMLAudioElement {
    if (!audio) {
      audio = new Audio()
      applyVolume()
      audio.addEventListener('timeupdate', () => {
        currentTime.value = audio?.currentTime || 0
      })
      audio.addEventListener('loadedmetadata', () => {
        const value = audio?.duration
        if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
          duration.value = value
        }
      })
      audio.addEventListener('ended', () => {
        void handleEnded()
      })
      audio.addEventListener('play', () => {
        playing.value = true
      })
      audio.addEventListener('playing', () => {
        playing.value = true
        loading.value = false
      })
      audio.addEventListener('pause', () => {
        playing.value = false
      })
      audio.addEventListener('error', () => {
        if (tryingSources) return
        if (!audioUrl.value) return
        error.value = '音频加载失败，可能需要登录或该歌曲仅支持试听'
        playing.value = false
        loading.value = false
      })
    }
    return audio
  }

  async function handleEnded(): Promise<void> {
    if (playMode.value === 'one') {
      // 原生端播放器在 Java 侧，直接重新加载最稳
      if (usingNativeAudio) {
        await loadAndPlay()
        return
      }
      const el = ensureAudio()
      el.currentTime = 0
      try {
        await el.play()
      } catch {
        playing.value = false
      }
      return
    }
    if (shuffle.value) {
      await playRandom()
      return
    }
    await next()
  }

  async function playRandom(): Promise<void> {
    if (!queue.value.length) return
    if (queue.value.length < 2) {
      await loadAndPlay()
      return
    }
    skipDirection = 1
    const from = currentIndex.value
    const idx = nextShuffleIndex()
    if (idx === from) {
      await loadAndPlay()
      return
    }
    if (from >= 0) {
      shuffleBack.push(from)
      if (shuffleBack.length > 50) shuffleBack.shift()
    }
    currentIndex.value = idx
    await loadAndPlay()
  }

  async function playQueue(list: SongItem[], startIndex = 0): Promise<void> {
    if (!list.length) return
    queue.value = list
    shuffleBack = []
    currentIndex.value = Math.min(Math.max(startIndex, 0), list.length - 1)
    skipDirection = 1
    skippedInRow = 0
    await loadAndPlay()
  }

  async function playSong(song: SongItem, list?: SongItem[]): Promise<void> {
    if (list) {
      const idx = list.findIndex((s) => s.hash === song.hash)
      queue.value = list
      currentIndex.value = idx >= 0 ? idx : 0
      if (idx < 0) queue.value = [song, ...list]
    } else {
      const idx = queue.value.findIndex((s) => s.hash === song.hash)
      if (idx >= 0) {
        currentIndex.value = idx
      } else {
        queue.value.push(song)
        currentIndex.value = queue.value.length - 1
      }
    }
    shuffleBack = []
    skipDirection = 0
    skippedInRow = 0
    await loadAndPlay()
  }

  function describePlaybackError(e: unknown): string {
    const message = e instanceof Error ? e.message : ''
    if (/hash not found|song not found|歌曲不存在/i.test(message)) {
      return '这首歌暂时无法播放，请换一首'
    }
    if (/no supported source|src not supported|not supported/i.test(message)) {
      return '当前音频暂时无法播放，请稍后重试或换一首'
    }
    if (/network|failed to fetch|load failed/i.test(message)) {
      return '网络不稳定，音频加载失败'
    }
    if (/not allowed|user gesture|autoplay|play\(\) failed/i.test(message)) {
      return '请点击播放按钮开始播放'
    }
    if (/需要验证|安全验证|20028/i.test(message)) {
      return '账号登录状态需要验证，请重新登录后再试'
    }
    if (/abort/i.test(message)) return '播放已取消'
    return message || '播放失败，请稍后重试'
  }

  async function loadAndPlay(): Promise<void> {
    const song = current.value
    if (!song?.hash) return
    markPlayed(song)
    const direction = skipDirection
    skipDirection = 0
    const epoch = ++loadEpoch
    if (audio) audio.pause()
    if (isCapacitorNative()) cleanupMse()
    // 原生停止在下方 Capacitor 分支 await，避免与新 play 竞态
    currentTime.value = 0
    duration.value = songDurationSeconds(song)
    loading.value = true
    error.value = ''
    tryingSources = true
    try {
      let url = await fetchSongUrl(song, true, quality.value)
      if (epoch !== loadEpoch) return
      if (!url) {
        url = await fetchSongUrl(song, false, quality.value)
        if (epoch !== loadEpoch) return
      }
      if (!url) throw new Error('这首歌暂时没有可用音源，请稍后重试或换一首')
      setUnavailable(song, false)
      skippedInRow = 0
      audioUrl.value = url

      const el = ensureAudio()
      let lastError: unknown = null

      if (isCapacitorNative()) {
        await unlockAudioOutput()
        applyVolume()
        await stopNativeAudio()

        const candidates = nativeDirectPlayCandidates(url)

        // 1) 原生 MediaPlayer 直连（可播 http CDN，等同桌面 Electron，不经云端反代）
        for (const src of candidates) {
          const isProxy = src.includes('/song/audio-proxy/')
          const timeoutMs = isProxy ? 15000 : 10000
          try {
            error.value = ''
            await playNativeSource(src, epoch, timeoutMs)
            if (epoch !== loadEpoch) return
            playing.value = true
            loading.value = false
            return
          } catch (e) {
            lastError = e
            console.warn('[player] native MediaPlayer candidate failed', isProxy ? 'proxy' : 'direct', e)
          }
        }

        // 2) WebView HTMLAudio（mixed-content 已 ALWAYS_ALLOW）：原 http → https → proxy
        usingNativeAudio = false
        for (const src of candidates) {
          const isProxy = src.includes('/song/audio-proxy/')
          const timeoutMs = isProxy ? 12000 : 7000
          try {
            cleanupMse()
            revokeObjectUrl()
            error.value = ''
            await playSource(el, src, timeoutMs)
            if (epoch !== loadEpoch) return
            playing.value = true
            loading.value = false
            return
          } catch (e) {
            lastError = e
            if (epoch === loadEpoch) el.pause()
            console.warn('[player] HTMLAudio candidate failed', isProxy ? 'proxy' : 'direct', e)
          }
        }

        // 3) MSE + Range 分片（经代理）
        try {
          error.value = ''
          cleanupMse()
          await playWithMse(url, song, el, epoch)
          if (epoch !== loadEpoch) return
          applyVolume()
          playing.value = true
          loading.value = false
          return
        } catch (e) {
          lastError = e
          if (epoch === loadEpoch) el.pause()
        }

        // 4) 整文件 blob（慢，兼容性最好）
        try {
          error.value = ''
          const blobSrc = await toBlobSrc(url)
          if (epoch !== loadEpoch) return
          await playSource(el, blobSrc, 20000)
          if (epoch !== loadEpoch) return
          playing.value = true
          loading.value = false
          return
        } catch (e) {
          lastError = e
          if (epoch === loadEpoch) el.pause()
        }
      } else {
        try {
          await playSource(el, url, 8000)
          if (epoch !== loadEpoch) return
          playing.value = true
          loading.value = false
          return
        } catch (e) {
          lastError = e
          if (epoch === loadEpoch) el.pause()
        }
      }

      throw lastError || new Error('音频加载失败')
    } catch (e) {
      if (epoch !== loadEpoch) return
      playing.value = false
      // 暂停上一首时触发的 timeupdate 会把旧进度写回来
      currentTime.value = 0
      if (e instanceof SongUnavailableError) {
        setUnavailable(song, true)
        error.value = e.message
        if (direction !== 0 && skippedInRow < queue.value.length - 1) {
          skippedInRow += 1
          void (direction > 0 ? next() : prev())
        }
        return
      }
      error.value = describePlaybackError(e)
    } finally {
      if (epoch === loadEpoch) {
        loading.value = false
        tryingSources = false
      }
    }
  }

  function toggle(): void {
    if (!current.value) return
    // 加载失败后再次点播放时重新取一次播放地址
    if (error.value) {
      void loadAndPlay()
      return
    }
    if (usingNativeAudio) {
      void (async () => {
        try {
          const status = await NativeAudio.getStatus()
          if (status.playing) {
            await NativeAudio.pause()
            playing.value = false
          } else {
            await NativeAudio.resume()
            playing.value = true
          }
        } catch (e) {
          error.value = describePlaybackError(e)
        }
      })()
      return
    }
    const el = ensureAudio()
    if (!el.src) {
      void loadAndPlay()
      return
    }
    if (el.paused) {
      void unlockAudioOutput()
        .then(() => el.play())
        .catch((e: unknown) => {
          error.value = describePlaybackError(e)
        })
    } else {
      el.pause()
    }
  }

  function seek(t: number): void {
    if (!Number.isFinite(t)) return
    const target = Math.max(0, t)
    if (usingNativeAudio) {
      currentTime.value = target
      void NativeAudio.seek({ time: target }).catch(() => {})
      return
    }
    const el = ensureAudio()
    el.currentTime = target
    currentTime.value = el.currentTime
  }

  async function next(): Promise<void> {
    if (!queue.value.length) return
    if (shuffle.value) {
      await playRandom()
      return
    }
    currentIndex.value = stepIndex(1)
    skipDirection = 1
    await loadAndPlay()
  }

  async function prev(): Promise<void> {
    if (!queue.value.length) return
    if (shuffle.value) {
      const back = shuffleBack.pop()
      if (back != null && back >= 0 && back < queue.value.length) {
        currentIndex.value = back
        skipDirection = -1
        await loadAndPlay()
        return
      }
      await playRandom()
      return
    }
    currentIndex.value = stepIndex(-1)
    skipDirection = -1
    await loadAndPlay()
  }

  function setVolume(v: number): void {
    const clamped = Math.min(1, Math.max(0, v))
    volume.value = clamped
    muted.value = false
    applyVolume()
    localStorage.setItem(VOLUME_KEY, String(clamped))
  }

  function toggleMute(): void {
    muted.value = !muted.value
    applyVolume()
  }

  async function setQuality(next: AudioQuality): Promise<void> {
    if (quality.value === next) return
    quality.value = next
    try {
      localStorage.setItem(QUALITY_KEY, String(next))
    } catch {
      /* ignore */
    }

    const song = current.value
    if (!song) return
    const resumeAt = currentTime.value
    const wasPlaying = playing.value
    await loadAndPlay()
    if (current.value !== song) return
    if (resumeAt > 0) seek(resumeAt)
    if (!wasPlaying && playing.value) toggle()
  }

  function toggleQuality(): void {
    void setQuality(quality.value === 320 ? 128 : 320)
  }

  function toggleShuffle(): void {
    setPlayMode(playMode.value === 'shuffle' ? 'order' : 'shuffle')
  }

  function toggleRepeatOne(): void {
    setPlayMode(playMode.value === 'one' ? 'order' : 'one')
  }

  /** 手机端单按钮轮换：列表循环 → 随机播放 → 单曲循环 */
  function cyclePlayMode(): void {
    setPlayMode(playMode.value === 'order' ? 'shuffle' : playMode.value === 'shuffle' ? 'one' : 'order')
  }

  /** 退出登录时彻底停止播放并清空队列 */
  function stop(): void {
    loadEpoch += 1
    tryingSources = false
    cleanupMse()
    revokeObjectUrl()
    void stopNativeAudio()
    audioUrl.value = ''
    if (audio) {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
    }
    queue.value = []
    shuffleBack = []
    currentIndex.value = -1
    playing.value = false
    currentTime.value = 0
    duration.value = 0
    loading.value = false
    error.value = ''
  }

  return {
    queue,
    currentIndex,
    current,
    playing,
    currentTime,
    duration,
    loading,
    error,
    audioUrl,
    volume,
    muted,
    quality,
    shuffle,
    title,
    artist,
    cover,
    hasQueue,
    progress,
    playMode,
    isUnavailable,
    playSong,
    playQueue,
    loadAndPlay,
    toggle,
    seek,
    next,
    prev,
    setVolume,
    toggleMute,
    setQuality,
    toggleQuality,
    toggleShuffle,
    toggleRepeatOne,
    cyclePlayMode,
    stop
  }
})
