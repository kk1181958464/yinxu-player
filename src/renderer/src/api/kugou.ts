import axios, { type AxiosInstance } from 'axios'

const COOKIE_KEY = 'kugou_api_cookie'
const API_BASE_KEY = 'kugou_api_base'
const DEFAULT_BASE = 'https://music.98104.cn'

let client: AxiosInstance | null = null
let apiBase = DEFAULT_BASE

/**
 * 服务端按 `;` 切分 cookie 且不会去掉键名前后的空格。
 * 浏览器端统一用 `;` 连接，并顺手清理历史数据里的 `; `。
 */
function normalizeCookie(raw: string): string {
  return raw
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .join(';')
}

function readCookie(): string {
  const raw = localStorage.getItem(COOKIE_KEY) || ''
  if (!raw) return ''
  const normalized = normalizeCookie(raw)
  if (normalized !== raw) localStorage.setItem(COOKIE_KEY, normalized)
  return normalized
}

function writeCookie(cookie: string): void {
  localStorage.setItem(COOKIE_KEY, normalizeCookie(cookie))
}

function setCookiePair(key: string, value: string): void {
  const map = new Map<string, string>()
  for (const c of readCookie().split(';').map((s) => s.trim()).filter(Boolean)) {
    const i = c.indexOf('=')
    if (i > 0) map.set(c.slice(0, i), c.slice(i + 1))
  }
  // skip overwrite stable device cookie（服务端若未读到 query cookie 会重发）
  const stable = key.startsWith('KUGOU_API_') && key !== 'KUGOU_API_PLATFORM'
  const prev = map.get(key)
  if (stable && prev && String(prev).length > 0 && value) {
    // keep existing
  } else {
    map.set(key, value)
  }
  writeCookie([...map.entries()].map(([k, v]) => `${k}=${v}`).join(';'))
}

function mergeSetCookie(headers: Record<string, unknown>): void {
  const raw = headers['set-cookie'] || headers['Set-Cookie']
  if (!raw) return
  const parts = Array.isArray(raw) ? raw : [String(raw)]
  for (const line of parts) {
    const first = String(line).split(';')[0]
    const i = first.indexOf('=')
    if (i > 0) setCookiePair(first.slice(0, i).trim(), first.slice(i + 1).trim())
  }
}
function mergeKugouApiCookies(headers: Record<string, unknown>): void {
  const raw = headers['kugou-api-cookies'] || headers['Kugou-Api-Cookies']
  if (!raw) return
  const parts = Array.isArray(raw) ? raw : [String(raw)]
  for (const line of parts) {
    for (const piece of String(line).split(/,(?=\s*[A-Za-z0-9_]+=)/)) {
      const first = piece.trim().split(';')[0]
      const i = first.indexOf('=')
      if (i > 0) setCookiePair(first.slice(0, i).trim(), first.slice(i + 1).trim())
    }
  }
}


export async function initApiBase(): Promise<string> {
  // 桌面端由 Electron 主进程拉起本地 API，优先走本地，避免 file:// 跨域和云端延迟
  if (typeof window !== 'undefined' && typeof window.kugou?.getApiBase === 'function') {
    try {
      const local = await window.kugou.getApiBase()
      if (local) {
        apiBase = local.trim().replace(/\/+$/, '')
        localStorage.setItem(API_BASE_KEY, apiBase)
        client = null
        return apiBase
      }
    } catch {
      /* 本地服务不可用时回退云端 */
    }
  }
  // 移动端 / Web 端使用内置云端 API
  apiBase = DEFAULT_BASE
  localStorage.setItem(API_BASE_KEY, apiBase)
  client = null
  return apiBase
}

export function getApiBase(): string {
  return apiBase
}

/** @deprecated 地址已内置云端，保留函数避免外部引用报错 */
export function setApiBase(url: string): string {
  const cleaned = url.trim().replace(/\/+$/, '')
  apiBase = cleaned || DEFAULT_BASE
  localStorage.setItem(API_BASE_KEY, apiBase)
  client = null
  return apiBase
}

export function getDefaultApiBase(): string {
  return DEFAULT_BASE
}

export const API_BASE_STORAGE_KEY = API_BASE_KEY

function getClient(): AxiosInstance {
  if (!client) {
    client = axios.create({
      baseURL: apiBase,
      timeout: 60000,
      withCredentials: true
    })
    client.interceptors.request.use((config) => {
      const cookie = readCookie()
      if (cookie) {
        config.params = { ...(config.params || {}), cookie }
      }
      return config
    })
    client.interceptors.response.use((res) => {
      mergeSetCookie(res.headers as Record<string, unknown>)
      mergeKugouApiCookies(res.headers as Record<string, unknown>)
      const bodyCookie = res.data?.cookie
      if (typeof bodyCookie === 'string' && bodyCookie) {
        for (const part of bodyCookie.split(';')) {
          const first = part.trim()
          const i = first.indexOf('=')
          if (i > 0) setCookiePair(first.slice(0, i), first.slice(i + 1))
        }
      } else if (Array.isArray(bodyCookie)) {
        for (const line of bodyCookie) {
          const first = String(line).split(';')[0]
          const i = first.indexOf('=')
          if (i > 0) setCookiePair(first.slice(0, i).trim(), first.slice(i + 1).trim())
        }
      } else if (bodyCookie && typeof bodyCookie === 'object') {
        for (const [k, v] of Object.entries(bodyCookie)) {
          if (v != null) setCookiePair(k, String(v))
        }
      }
      return res
    }, (error: unknown) => {
      // 统一把网络/服务端错误转换成可读文案，原始 response 仍保留给登录流程判断
      const ax = error as {
        message?: string
        code?: string
        response?: { status?: number; data?: unknown }
      }
      const data = ax?.response?.data
      const serverMsg =
        data && typeof data === 'object'
          ? (data as Record<string, unknown>).error ||
            (data as Record<string, unknown>).errmsg ||
            (data as Record<string, unknown>).msg
          : ''
      if (serverMsg === '本次请求需要验证') ax.message = '平台要求安全验证，请稍后重试或重新登录'
      else if (serverMsg) ax.message = String(serverMsg)
      else if (ax?.response?.status === 401 || ax?.response?.status === 403)
        ax.message = '登录状态已失效，请重新登录'
      else if (ax?.response?.status && ax.response.status >= 500)
        ax.message = '音乐服务暂时不可用，请稍后重试'
      else if (ax?.response?.status) ax.message = '请求失败，请稍后重试'
      else if (ax?.code === 'ECONNABORTED') ax.message = '请求超时，请稍后重试'
      else if (ax?.code === 'ERR_NETWORK') ax.message = '无法连接音乐服务'
      return Promise.reject(error)
    })
  }
  return client
}

export interface SongItem {
  hash: string
  hq_hash?: string
  album_id?: string | number
  album_audio_id?: string | number
  songname?: string
  song_name?: string
  filename?: string
  author_name?: string
  singername?: string
  album_name?: string
  album_cover?: string
  cover?: string
  duration?: number
  timelength?: number
  privilege?: number
  [key: string]: unknown
}

const AUDIO_FILE_RE = /\.(mp3|flac|m4a|wav|ape|ogg|aac|wma)\s*$/i

function asText(value: unknown): string {
  return value == null ? '' : String(value)
}

/** 图片 CDN 支持 HTTPS，统一升级避免混合内容被 WebView 拦截 */
function secureImageUrl(url: string): string {
  if (!url) return ''
  if (url.startsWith('//')) return `https:${url}`
  return url.replace(/^http:\/\//i, 'https://')
}

/** 云盘/歌单里的 filename 形式："艺人 - 歌名.mp3" */
function splitFileName(value: string): { artist: string; title: string } {
  const stem = value.replace(AUDIO_FILE_RE, '').trim()
  const index = stem.indexOf(' - ')
  if (index > 0) {
    return { artist: stem.slice(0, index).trim(), title: stem.slice(index + 3).trim() }
  }
  return { artist: '', title: stem }
}

/** 把搜索/新歌/云盘歌单等不同字段统一成 SongItem */
export function normalizeSong(raw: Record<string, unknown>): SongItem {
  const cover =
    (raw.album_cover as string) ||
    (raw.album_sizable_cover as string) ||
    (raw.AlbumImage as string) ||
    (raw.Image as string) ||
    (raw.cover as string) ||
    ((raw.trans_param as { union_cover?: string } | undefined)?.union_cover) ||
    ''

  const hash = String(
    raw.hash || raw.FileHash || raw.hash_128 || raw.HQFileHash || ''
  )
  const hqHash = String(raw.HQFileHash || raw.hqhash || raw.hq_file_hash || '')

  const singerList = Array.isArray(raw.singerinfo)
    ? (raw.singerinfo as Array<{ name?: unknown }>)
    : []
  const singerNames = singerList
    .map((item) => asText(item?.name))
    .filter(Boolean)
    .join('、')

  const albuminfo =
    raw.albuminfo && typeof raw.albuminfo === 'object'
      ? (raw.albuminfo as { name?: unknown })
      : null

  const rawName = asText(raw.name)
  const declaredName =
    asText(raw.songname || raw.SongName || raw.song_name) || rawName
  const looksLikeFile = AUDIO_FILE_RE.test(declaredName) || AUDIO_FILE_RE.test(rawName)
  const filename =
    asText(raw.filename || raw.FileName || raw.Filename) ||
    (looksLikeFile ? declaredName : '')

  const author =
    asText(raw.author_name || raw.SingerName || raw.singername || raw.AuthorName) ||
    singerNames
  const album =
    asText(raw.album_name || raw.AlbumName) || asText(albuminfo?.name)
  const duration = Number(raw.duration || raw.Duration || raw.timelength || raw.timelen)

  return {
    ...raw,
    hash,
    hq_hash: hqHash || undefined,
    album_id: (raw.album_id ?? raw.AlbumID ?? 0) as string | number,
    // 酷狗 /song/url 的 album_audio_id 取 MixSongID；搜索结果的 Audioid 不是这个字段，
    // 传错会被服务端当成无版权/无播放权限，直接返回空 URL。
    album_audio_id: (raw.MixSongID ?? raw.mixsongid ?? raw.mix_song_id ?? raw.album_audio_id ?? 0) as
      | string
      | number,
    songname: declaredName || undefined,
    filename: filename || undefined,
    author_name: author || undefined,
    album_name: album || undefined,
    album_cover: cover ? secureImageUrl(String(cover).replace('{size}', '240')) : '',
    duration: Number.isFinite(duration) && duration > 0 ? duration : undefined
  }
}

export function songTitle(s: SongItem): string {
  const declared = asText(s.songname || s.song_name)
  const filename = asText(s.filename)
  const source = declared || filename
  if (!source) return '未知歌曲'

  const isFile = AUDIO_FILE_RE.test(source) || (filename !== '' && source === filename)
  if (isFile) {
    const parsed = splitFileName(source)
    if (parsed.title) return parsed.title
  }
  return source
}

export function songArtist(s: SongItem): string {
  const explicit = asText(s.author_name || s.singername)
  if (explicit) return explicit

  const source = asText(s.filename || s.songname || s.song_name)
  if (!source) return '未知艺人'

  const isFile = AUDIO_FILE_RE.test(source) || (s.filename !== undefined && source === String(s.filename))
  if (isFile) {
    const parsed = splitFileName(source)
    if (parsed.artist) return parsed.artist
  }
  return '未知艺人'
}

export function songCover(s: SongItem): string {
  const c = (s.album_cover || s.cover || '') as string
  if (!c) return ''
  return secureImageUrl(String(c).replace('{size}', '240'))
}

/** 按需取更大尺寸封面（CDN 用 /{size}/ 控制） */
export function coverAt(url: string, size: number): string {
  if (!url) return ''
  return secureImageUrl(String(url))
    .replace(/\{size\}/g, String(size))
    .replace(/\/240\//, `/${size}/`)
}

export function songAlbum(s: SongItem): string {
  return s.album_name ? String(s.album_name) : ''
}

/** 列表展示用时长（秒）；接口里 timelength 多为毫秒 */
export function songDurationSeconds(s: SongItem): number {
  const raw = Number(s.duration ?? s.timelength ?? 0)
  if (!Number.isFinite(raw) || raw <= 0) return 0
  return raw > 1000 ? Math.round(raw / 1000) : Math.round(raw)
}

/** 注册设备，拿 dfid（播放必需） */
export async function registerDev(): Promise<void> {
  const { data } = await getClient().post('/register/dev')
  const dfid = data?.data?.dfid || data?.dfid
  if (dfid) setCookiePair('dfid', String(dfid))
}

/** 搜索歌曲 */
export async function searchSongs(keywords: string, page = 1): Promise<SongItem[]> {
  const { data } = await getClient().get('/search', {
    params: { keywords, page, pagesize: 30, type: 'song' }
  })
  const list = data?.data?.lists || data?.data?.info || data?.data?.songs || data?.data || []
  if (!Array.isArray(list)) return []
  return list.map((x: Record<string, unknown>) => normalizeSong(x))
}

/** 新歌速递（首页） */
export async function fetchTopSongs(): Promise<SongItem[]> {
  const { data } = await getClient().get('/top/song', { params: { pagesize: 20 } })
  const list = Array.isArray(data?.data)
    ? data.data
    : data?.data?.song_list || data?.data?.list || []
  if (!Array.isArray(list)) return []
  return list.map((x: Record<string, unknown>) => normalizeSong(x))
}

function pickUrl(payload: Record<string, unknown>): string {
  const candidates = [
    payload?.url,
    payload?.play_url,
    (payload?.data as Record<string, unknown> | undefined)?.url,
    (payload?.data as Record<string, unknown> | undefined)?.play_url,
    payload?.backupUrl,
    (payload?.data as Record<string, unknown> | undefined)?.backupUrl
  ]
  for (const c of candidates) {
    if (!c) continue
    if (Array.isArray(c) && c[0]) return String(c[0])
    if (typeof c === 'string' && c.startsWith('http')) return c
  }
  return ''
}

export type AudioQuality = 128 | 320

/** 酷狗已下架该音频（/song/url 返回 status 3 且无地址），重试也拿不到 */
export class SongUnavailableError extends Error {
  constructor() {
    super('这首歌已下架，暂时无法播放')
    this.name = 'SongUnavailableError'
  }
}

/** 获取播放地址；高品失败时自动回退标准 */
export async function fetchSongUrl(
  song: SongItem,
  freePart = true,
  quality: AudioQuality = 128
): Promise<string> {
  if (!readCookie().includes('dfid=')) {
    await registerDev()
  }

  const requestUrl = async (q: AudioQuality): Promise<string> => {
    const hash = q === 320 ? song.hq_hash || song.hash : song.hash
    const { data } = await getClient().get('/song/url', {
      params: {
        hash,
        album_id: song.album_id || 0,
        album_audio_id: song.album_audio_id || 0,
        // 服务端按真值判断，传 "0" 也会被当成 1，所以不要试听时直接省略
        ...(freePart ? { free_part: 1 } : {}),
        quality: q
      }
    })

    if (data?.error === '本次请求需要验证' || data?.errcode === 20028) {
      throw new Error('平台要求安全验证，请稍后再试或重新登录')
    }
    if (data?.status === 0 && data?.error) {
      throw new Error(String(data.error))
    }
    const url = pickUrl(data)
    if (!url && Number(data?.status) === 3) throw new SongUnavailableError()
    return url
  }

  if (quality === 320 && !song.hq_hash) {
    return requestUrl(128)
  }

  try {
    const url = await requestUrl(quality)
    if (url) return url
    if (quality === 320) return requestUrl(128)
    return ''
  } catch (error) {
    if (quality === 320) return requestUrl(128)
    throw error
  }
}

/** 歌单里部分老歌没有封面，用权益接口里的 info.image 补上（原地修改） */
export async function fillMissingCovers(songs: SongItem[]): Promise<void> {
  const missing = songs.filter((s) => s.hash && !songCover(s))
  for (let i = 0; i < missing.length; i += 50) {
    const chunk = missing.slice(i, i + 50)
    const data = await getApi<{ data?: Array<{ hash?: string; info?: { image?: string } }> }>(
      '/privilege/lite',
      {
        hash: chunk.map((s) => s.hash).join(','),
        album_id: chunk.map((s) => s.album_id || 0).join(','),
        qualities: '128'
      }
    )
    const images = new Map<string, string>()
    for (const item of data?.data || []) {
      if (item?.hash && item.info?.image) images.set(item.hash.toUpperCase(), item.info.image)
    }
    for (const s of chunk) {
      const image = images.get(s.hash.toUpperCase())
      if (image) s.album_cover = secureImageUrl(image.replace('{size}', '240'))
    }
  }
}

interface LyricCandidate {
  id?: string
  accesskey?: string
}

function decodeBase64Utf8(value: string): string {
  const text = value.trim()
  if (!text) return ''
  // 少数接口会直接返回明文 LRC
  if (/\[\d{1,3}:\d{1,2}/.test(text)) return text
  try {
    const binary = atob(text)
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    return new TextDecoder('utf-8').decode(bytes)
  } catch {
    return ''
  }
}

/**
 * 歌词分两步取：先用 hash 搜到歌词 id/accesskey，再下载 LRC。
 * 没有候选时用“歌名 + 歌手”再试一次。
 */
export async function fetchLyricText(song: SongItem): Promise<string> {
  const duration = Math.round(songDurationSeconds(song))
  const readCandidates = (payload: Record<string, unknown> | undefined): LyricCandidate[] => {
    const list =
      (payload?.candidates as LyricCandidate[] | undefined) ||
      ((payload?.data as Record<string, unknown> | undefined)?.candidates as
        | LyricCandidate[]
        | undefined)
    return Array.isArray(list) ? list : []
  }

  let candidates: LyricCandidate[] = []
  try {
    const { data } = await getClient().get('/search/lyric', {
      params: { hash: song.hash, duration }
    })
    candidates = readCandidates(data)
  } catch {
    /* 继续尝试关键词搜索 */
  }

  if (!candidates.some((item) => item?.id && item?.accesskey)) {
    const keyword = [songTitle(song), songArtist(song)].filter(Boolean).join(' ')
    if (keyword) {
      try {
        const { data } = await getClient().get('/search/lyric', {
          params: { keyword, duration }
        })
        candidates = readCandidates(data)
      } catch {
        /* 没有歌词就算了 */
      }
    }
  }

  const candidate = candidates.find((item) => item?.id && item?.accesskey)
  if (!candidate?.id || !candidate?.accesskey) return ''

  const { data } = await getClient().get('/lyric', {
    params: {
      id: candidate.id,
      accesskey: candidate.accesskey,
      fmt: 'lrc',
      decode: 1
    }
  })
  const payload =
    data?.data && typeof data.data === 'object' ? (data.data as Record<string, unknown>) : data
  const decoded = String(payload?.decodeContent || '')
  if (decoded) return decoded
  return decodeBase64Utf8(String(payload?.content || ''))
}

/** Bust KuGouMusicApi 2-minute GET cache (docs: always pass timestamp). */
function cacheBustParams(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...extra, timestamp: Date.now() }
}

/** QR login key (/login/qr/key may include qrcode_img) */
export async function loginQrKey(): Promise<{ key: string; qrcodeImg?: string }> {
  const { data } = await getClient().get('/login/qr/key', { params: cacheBustParams() })
  const inner = data?.data || data || {}
  const key = String(inner.qrcode || inner.key || data?.qrcode || '')
  const qrcodeImg = String(inner.qrcode_img || inner.qrcodeImg || '')
  return { key, qrcodeImg: qrcodeImg || undefined }
}

export async function loginQrCreate(key: string): Promise<{ url?: string; base64?: string; qrcode?: string }> {
  const { data } = await getClient().get('/login/qr/create', {
    params: cacheBustParams({ key, qrimg: true })
  })
  return data?.data || data || {}
}

export interface QrCheckResult {
  status: number
  message?: string
  token?: string
  userid?: string | number
  cookie?: unknown
  raw: unknown
}

export async function loginQrCheck(key: string): Promise<QrCheckResult> {
  const { data } = await getClient().get('/login/qr/check', {
    params: cacheBustParams({ key })
  })
  const inner = (data?.data && typeof data.data === 'object' ? data.data : {}) as Record<
    string,
    unknown
  >
  // Prefer nested data.status only: top-level status is API ok (often 1), not QR state.
  // 0 expired, 1 waiting, 2 confirm, 4 success
  let status = Number(inner.status)
  if (!Number.isFinite(status)) status = -1
  const token = (inner.token || data?.token) as string | undefined
  const userid = (inner.userid || data?.userid) as string | number | undefined
  // Some payloads omit status but already carry credentials
  if (status !== 4 && token && userid != null && String(userid)) status = 4
  return {
    status,
    message: String(data?.msg || data?.message || inner.msg || ''),
    token,
    userid,
    cookie: data?.cookie,
    raw: data
  }
}

/** Persist token/userid/cookie after successful QR login */
export function applyLoginCookies(res: QrCheckResult): void {
  const bodyCookie = res.cookie
  if (typeof bodyCookie === 'string' && bodyCookie) {
    for (const part of bodyCookie.split(';')) {
      const first = part.trim()
      const i = first.indexOf('=')
      if (i > 0) setCookiePair(first.slice(0, i), first.slice(i + 1))
    }
  } else if (Array.isArray(bodyCookie)) {
    for (const line of bodyCookie) {
      const first = String(line).split(';')[0]
      const i = first.indexOf('=')
      if (i > 0) setCookiePair(first.slice(0, i).trim(), first.slice(i + 1).trim())
    }
  } else if (bodyCookie && typeof bodyCookie === 'object') {
    for (const [k, v] of Object.entries(bodyCookie as Record<string, unknown>)) {
      if (v != null) setCookiePair(k, String(v))
    }
  }

  if (res.token) setCookiePair('token', String(res.token))
  if (res.userid != null && String(res.userid)) setCookiePair('userid', String(res.userid))

  const raw = res.raw as { data?: { token?: string; userid?: string | number } } | null
  if (raw?.data?.token) setCookiePair('token', String(raw.data.token))
  if (raw?.data?.userid != null) setCookiePair('userid', String(raw.data.userid))
}


/** 把响应里的 cookie 字段合并进 localStorage */
function mergeCookiePayload(bodyCookie: unknown): void {
  if (typeof bodyCookie === 'string' && bodyCookie) {
    for (const part of bodyCookie.split(';')) {
      const first = part.trim()
      const i = first.indexOf('=')
      if (i > 0) setCookiePair(first.slice(0, i), first.slice(i + 1))
    }
  } else if (Array.isArray(bodyCookie)) {
    for (const line of bodyCookie) {
      const first = String(line).split(';')[0]
      const i = first.indexOf('=')
      if (i > 0) setCookiePair(first.slice(0, i).trim(), first.slice(i + 1).trim())
    }
  } else if (bodyCookie && typeof bodyCookie === 'object') {
    for (const [k, v] of Object.entries(bodyCookie as Record<string, unknown>)) {
      if (v != null) setCookiePair(k, String(v))
    }
  }
}

function mergeLoginDataFields(data: Record<string, unknown>): void {
  mergeCookiePayload(data.cookie)
  const inner = (data.data && typeof data.data === 'object' ? data.data : {}) as Record<
    string,
    unknown
  >
  if (inner.token) setCookiePair('token', String(inner.token))
  if (inner.userid != null && String(inner.userid)) setCookiePair('userid', String(inner.userid))
  if (inner.t1 != null) setCookiePair('t1', String(inner.t1))
  if (inner.vip_token != null) setCookiePair('vip_token', String(inner.vip_token))
  if (inner.vip_type != null) setCookiePair('vip_type', String(inner.vip_type))
  if (data.token) setCookiePair('token', String(data.token))
  if (data.userid != null) setCookiePair('userid', String(data.userid))
}

export interface SoftRefreshResult {
  ok: boolean
  warning?: string
}

/** 用现有 token 换 android token + t1 */
export async function refreshLoginToken(): Promise<SoftRefreshResult> {
  try {
    const { data } = await getClient().get('/login/token', { params: cacheBustParams() })
    const errCode = data?.error_code ?? data?.errcode
    if (data?.status === 0 || (errCode != null && Number(errCode) !== 0)) {
      return { ok: false, warning: apiFailMessage(data, '换票未成功') }
    }
    mergeLoginDataFields(data as Record<string, unknown>)
    return { ok: true }
  } catch (e: unknown) {
    const ax = e as { response?: { data?: unknown; status?: number }; message?: string }
    if (ax?.response?.data) {
      return {
        ok: false,
        warning: apiFailMessage(ax.response.data, `换票失败 ${ax.response.status || ''}`.trim())
      }
    }
    return { ok: false, warning: ax?.message || '换票请求失败' }
  }
}

export interface FinalizeLoginResult {
  ok: boolean
  warning?: string
}

/**
 * 扫码：拿到 token 即视为登录成功。
 * 歌单同步失败不再拦截登录，避免辅助接口异常导致用户完全进不去。
 */
export async function finalizeQrLogin(res: QrCheckResult): Promise<FinalizeLoginResult> {
  applyLoginCookies(res)
  if (!hasLoginToken()) {
    return { ok: false, warning: '扫码未返回有效凭证，请刷新二维码后重试' }
  }
  // 换 android token 失败不阻塞登录，后续播放/歌单会给出各自的错误提示
  await refreshLoginToken()
  return { ok: true }
}

/** 验证码/密码登录：拿到 token 即视为登录成功，歌单在进入后再同步 */
export async function finalizeCredentialLogin(
  data: Record<string, unknown>
): Promise<FinalizeLoginResult> {
  mergeLoginDataFields(data)
  if (!hasLoginToken()) {
    return { ok: false, warning: apiFailMessage(data, '登录失败，未拿到登录凭证') }
  }
  await refreshLoginToken()
  return { ok: true }
}

export interface AccountCandidate {
  userid: string
  nickname: string
  pic: string
}

function extractAccountCandidates(data: Record<string, unknown>): AccountCandidate[] {
  const inner = (data.data && typeof data.data === 'object' ? data.data : data) as Record<
    string,
    unknown
  >
  const lists: unknown[] = [
    inner.list,
    inner.info,
    inner.info_list,
    inner.users,
    inner.user_list,
    inner.accounts,
    (inner.data as Record<string, unknown> | undefined)?.list,
    (inner.data as Record<string, unknown> | undefined)?.info_list
  ]
  for (const list of lists) {
    if (!Array.isArray(list) || !list.length) continue
    const out: AccountCandidate[] = []
    for (const item of list) {
      if (!item || typeof item !== 'object') continue
      const row = item as Record<string, unknown>
      const userid = String(row.userid ?? row.user_id ?? row.uid ?? '')
      if (!userid) continue
      let pic = String(row.pic ?? row.user_pic ?? row.avatar ?? row.headimg ?? '')
      if (pic.includes('{size}')) pic = pic.replace('{size}', '120')
      pic = secureImageUrl(pic)
      out.push({
        userid,
        nickname: String(row.nickname ?? row.nick_name ?? row.username ?? row.name ?? userid),
        pic
      })
    }
    if (out.length) return out
  }
  return []
}

function assertLoginOk(data: Record<string, unknown>, fallback: string): void {
  const errCode = data.error_code ?? data.errcode
  if (data.status === 0 || (errCode != null && Number(errCode) !== 0 && Number(errCode) !== 1)) {
    // status 1 = ok for kugou; some payloads omit status
    if (Number(data.status) !== 1) {
      throw new Error(apiFailMessage(data, fallback))
    }
  }
}

/** 发送手机验证码 */
export async function sendCaptcha(mobile: string): Promise<void> {
  try {
    const { data } = await getClient().post('/captcha/sent', null, {
      params: cacheBustParams({ mobile })
    })
    const errCode = data?.error_code ?? data?.errcode
    if (data?.status === 0 || (errCode != null && Number(errCode) !== 0)) {
      throw new Error(apiFailMessage(data, '验证码发送失败'))
    }
  } catch (e: unknown) {
    const ax = e as { response?: { data?: unknown; status?: number }; message?: string }
    if (ax?.response?.data) throw new Error(apiFailMessage(ax.response.data, '验证码发送失败'))
    throw e instanceof Error ? e : new Error(String(ax?.message || '验证码发送失败'))
  }
}

export interface CellphoneLoginResult {
  kind: 'ok' | 'choose'
  data?: Record<string, unknown>
  candidates?: AccountCandidate[]
}

/** 手机验证码登录；多账号时返回 candidates */
export async function loginCellphone(
  mobile: string,
  code: string,
  userid?: string
): Promise<CellphoneLoginResult> {
  try {
    const params: Record<string, unknown> = cacheBustParams({ mobile, code })
    if (userid) params.userid = userid
    const { data } = await getClient().post('/login/cellphone', null, { params })
    const body = (data || {}) as Record<string, unknown>
    const errCode = body.error_code ?? body.errcode
    const candidates = extractAccountCandidates(body)
    const hasToken =
      Boolean((body.data as Record<string, unknown> | undefined)?.token) ||
      Boolean(body.token) ||
      (Array.isArray(body.cookie) &&
        body.cookie.some((x) => String(x).startsWith('token='))) ||
      (typeof body.cookie === 'string' && body.cookie.includes('token='))

    if (hasToken && Number(body.status) !== 0) {
      return { kind: 'ok', data: body }
    }
    if (candidates.length && !userid) {
      return { kind: 'choose', candidates, data: body }
    }
    if (body.status === 0 || (errCode != null && Number(errCode) !== 0)) {
      throw new Error(apiFailMessage(body, '验证码登录失败'))
    }
    if (hasToken) return { kind: 'ok', data: body }
    if (candidates.length) return { kind: 'choose', candidates, data: body }
    throw new Error(apiFailMessage(body, '验证码登录失败'))
  } catch (e: unknown) {
    if (e instanceof Error && !('response' in e)) throw e
    const ax = e as { response?: { data?: unknown }; message?: string }
    const failed = ax?.response?.data
    if (failed && typeof failed === 'object') {
      const body = failed as Record<string, unknown>
      const candidates = extractAccountCandidates(body)
      if (candidates.length && !userid) {
        return { kind: 'choose', candidates, data: body }
      }
      throw new Error(apiFailMessage(body, '验证码登录失败'))
    }
    throw e instanceof Error ? e : new Error(String(ax?.message || '验证码登录失败'))
  }
}

/** 账号密码登录 */
export async function loginPassword(
  username: string,
  password: string
): Promise<CellphoneLoginResult> {
  try {
    const { data } = await getClient().post('/login', null, {
      params: cacheBustParams({ username, password })
    })
    const body = (data || {}) as Record<string, unknown>
    const errCode = body.error_code ?? body.errcode
    const candidates = extractAccountCandidates(body)
    const hasToken =
      Boolean((body.data as Record<string, unknown> | undefined)?.token) ||
      Boolean(body.token) ||
      (Array.isArray(body.cookie) &&
        body.cookie.some((x) => String(x).startsWith('token='))) ||
      (typeof body.cookie === 'string' && body.cookie.includes('token='))

    if (hasToken && Number(body.status) !== 0) {
      return { kind: 'ok', data: body }
    }
    if (candidates.length) {
      return { kind: 'choose', candidates, data: body }
    }
    if (body.status === 0 || (errCode != null && Number(errCode) !== 0)) {
      throw new Error(apiFailMessage(body, '账号登录失败'))
    }
    if (hasToken) return { kind: 'ok', data: body }
    throw new Error(apiFailMessage(body, '账号登录失败'))
  } catch (e: unknown) {
    if (e instanceof Error && !(e as { response?: unknown }).response) {
      // our thrown Error
      if (!String(e.message).includes('status code')) throw e
    }
    const ax = e as { response?: { data?: unknown }; message?: string }
    if (ax?.response?.data) throw new Error(apiFailMessage(ax.response.data, '账号登录失败'))
    throw e instanceof Error ? e : new Error(String(ax?.message || '账号登录失败'))
  }
}

export async function fetchUserDetail(): Promise<{
  nickname: string
  pic: string
  userid: string
  gender: number
  isNew: boolean
}> {
  const { data } = await getClient().get('/user/detail')
  const inner = (data?.data && typeof data.data === 'object' ? data.data : data) as Record<string, unknown>
  const nickname = String(
    inner?.nickname || inner?.nick_name || inner?.username || inner?.user_name || ''
  )
  let pic = String(
    inner?.pic || inner?.user_pic || inner?.userpic || inner?.avatar || inner?.headimg || ''
  )
  if (pic.includes('{size}')) pic = pic.replace('{size}', '240')
  pic = secureImageUrl(pic)
  const userid = String(inner?.userid || inner?.user_id || getStoredUserid() || '')
  const gender = Number(inner?.sex ?? inner?.gender ?? 0)
  const newFlags = ['is_new_user', 'is_new', 'new_user', 'need_set_profile', 'need_complete_info']
  const isNew =
    newFlags.some((key) => Number(inner?.[key]) === 1) ||
    (inner?.profile_completed !== undefined && Number(inner.profile_completed) === 0)
  return { nickname, pic, userid, gender: Number.isFinite(gender) ? gender : 0, isNew }
}

/** 首登完善资料：昵称 / 性别 */
export async function updateUserProfile(fields: {
  nickname?: string
  sex?: number
}): Promise<void> {
  const { data } = await getClient().post('/user/update', null, { params: fields })
  if (Number(data?.status) === 0) {
    throw new Error(apiFailMessage(data, '保存资料失败'))
  }
}

/** 首登完善资料：头像（base64 dataURL 或纯 base64） */
export async function updateUserAvatar(imgFile: string): Promise<void> {
  const { data } = await getClient().post('/user/update/avatar', { imgFile })
  if (Number(data?.status) === 0) {
    throw new Error(apiFailMessage(data, '头像上传失败'))
  }
}

export function getStoredUserid(): string {
  const c = readCookie()
  const m = c.match(/(?:^|;\s*)userid=([^;]+)/)
  return m ? decodeURIComponent(m[1]) : ''
}

export function clearCookie(): void {
  localStorage.removeItem(COOKIE_KEY)
}

/** 只清登录态，保留 KUGOU_API_* / dfid 设备字段 */
export function clearAuthCookies(): void {
  const map = new Map<string, string>()
  for (const part of readCookie().split(';').map((s) => s.trim()).filter(Boolean)) {
    const i = part.indexOf('=')
    if (i > 0) map.set(part.slice(0, i), part.slice(i + 1))
  }
  for (const k of ['token', 'userid', 't1', 't2', 'vip_token', 'vip_type', 'KuGou_Token', 'KugooID']) {
    map.delete(k)
  }
  writeCookie([...map.entries()].map(([k, v]) => `${k}=${v}`).join(';'))
}


export interface PlaylistItem {
  listid: string
  globalCollectionId: string
  name: string
  cover: string
  count: number
  type: number
}

function extractArrayPayload(data: unknown): Record<string, unknown>[] {
  const root = data as Record<string, unknown> | null
  const inner = (root?.data && typeof root.data === 'object' ? root.data : root) as
    | Record<string, unknown>
    | unknown[]
    | null
  const candidates: unknown[] = [
    Array.isArray(inner) ? inner : null,
    (inner as Record<string, unknown> | null)?.info,
    (inner as Record<string, unknown> | null)?.list,
    (inner as Record<string, unknown> | null)?.lists,
    (inner as Record<string, unknown> | null)?.playlist,
    (inner as Record<string, unknown> | null)?.playlists,
    (inner as Record<string, unknown> | null)?.songs,
    (inner as Record<string, unknown> | null)?.song_list,
    (inner as Record<string, unknown> | null)?.files,
    root?.info,
    root?.list
  ]
  for (const c of candidates) {
    if (Array.isArray(c)) return c as Record<string, unknown>[]
  }
  return []
}

export function normalizePlaylist(raw: Record<string, unknown>): PlaylistItem {
  const listid = String(raw.listid ?? raw.list_id ?? raw.create_listid ?? '')
  const globalCollectionId = String(
    raw.global_collection_id ?? raw.globalCollectionId ?? raw.gid ?? raw.create_gid ?? ''
  )
  const name = String(raw.name ?? raw.list_name ?? raw.listname ?? '未命名歌单')
  let cover = String(
    raw.pic ?? raw.pic_cover ?? raw.cover ?? raw.list_pic ?? raw.flexible_cover ?? ''
  )
  if (cover.includes('{size}')) cover = cover.replace(/\{size\}/g, '240')
  cover = secureImageUrl(cover)
  const count = Number(raw.count ?? raw.count_total ?? raw.song_count ?? raw.total ?? 0) || 0
  const type = Number(raw.type ?? raw.list_type ?? 0) || 0
  return { listid, globalCollectionId, name, cover, count, type }
}

function apiFailMessage(data: unknown, fallback: string): string {
  const d = data as Record<string, unknown> | null
  if (!d || typeof d !== 'object') return fallback
  const code = d.error_code ?? d.errcode
  const msg = d.error || d.errmsg || d.msg || d.message
  if (msg) return String(msg)
  if (Number(code) === 20028) return '平台要求安全验证，请稍后重试'
  if (code != null) return `${fallback}（error_code ${code}）`
  return fallback
}

async function getApi<T = Record<string, unknown>>(
  url: string,
  params: Record<string, unknown>
): Promise<T> {
  try {
    const { data } = await getClient().get(url, { params })
    return data as T
  } catch (e: unknown) {
    const ax = e as { response?: { data?: unknown; status?: number }; message?: string }
    if (ax?.response?.data) {
      throw new Error(apiFailMessage(ax.response.data, `请求失败 ${ax.response.status || ''}`))
    }
    throw e instanceof Error ? e : new Error(String(ax?.message || '请求失败'))
  }
}

/** 登录用户创建/收藏的歌单 */
export async function fetchUserPlaylists(page = 1, pagesize = 50): Promise<PlaylistItem[]> {
  const size = Math.min(pagesize, 30)
  const data = await getApi<Record<string, unknown>>(
    '/user/playlist',
    cacheBustParams({ page, pagesize: size })
  )
  if (data?.status === 0 || (data?.error_code != null && Number(data.error_code) !== 0)) {
    throw new Error(apiFailMessage(data, '拉取歌单失败'))
  }
  return extractArrayPayload(data).map((x) => normalizePlaylist(x))
}

export interface FetchPlaylistTracksOpts {
  listid?: string | number
  globalCollectionId?: string
  type?: number | string
  page?: number
  pagesize?: number
}

/** 歌单内歌曲：有 listid 走 /playlist/track/all/new，否则用 global_collection_id */
export async function fetchPlaylistTracks(opts: FetchPlaylistTracksOpts): Promise<SongItem[]> {
  const page = opts.page ?? 1
  const pagesize = opts.pagesize ?? 100
  const listid = opts.listid != null && String(opts.listid) ? String(opts.listid) : ''
  const gid = opts.globalCollectionId ? String(opts.globalCollectionId) : ''

  let data: Record<string, unknown>
  if (listid) {
    data = await getApi(
      '/playlist/track/all/new',
      cacheBustParams({
        listid,
        type: opts.type ?? 0,
        page,
        pagesize
      })
    )
  } else if (gid) {
    data = await getApi(
      '/playlist/track/all',
      cacheBustParams({ id: gid, page, pagesize })
    )
  } else {
    throw new Error('缺少 listid 或 global_collection_id')
  }

  if (data?.status === 0 || (data?.error_code != null && Number(data.error_code) !== 0)) {
    throw new Error(apiFailMessage(data, '拉取歌单歌曲失败'))
  }

  return extractArrayPayload(data).map((x) => {
    // 部分云歌单歌曲字段在 songinfo / base 里
    const nested =
      (x.songinfo as Record<string, unknown> | undefined) ||
      (x.base as Record<string, unknown> | undefined) ||
      (x.song as Record<string, unknown> | undefined)
    const merged = nested ? { ...nested, ...x } : x
    if (!merged.songname && merged.name) merged.songname = merged.name
    return normalizeSong(merged)
  })
}

export function hasLoginToken(): boolean {
  const c = readCookie()
  return /(?:^|;\s*)token=/.test(c) && /(?:^|;\s*)userid=/.test(c)
}

async function callYouthApi(
  method: 'get' | 'post',
  url: string,
  params: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  try {
    const { data } =
      method === 'post'
        ? await getClient().post(url, null, { params: cacheBustParams(params) })
        : await getClient().get(url, { params: cacheBustParams(params) })
    return (data || {}) as Record<string, unknown>
  } catch (e: unknown) {
    const ax = e as { response?: { data?: unknown }; message?: string }
    if (ax?.response?.data && typeof ax.response.data === 'object') {
      return ax.response.data as Record<string, unknown>
    }
    throw e instanceof Error ? e : new Error(String(ax?.message || '请求失败'))
  }
}

/** 领取指定日期的畅听会员 */
export async function claimDayVip(receiveDay: string): Promise<Record<string, unknown>> {
  return callYouthApi('get', '/youth/day/vip', { receive_day: receiveDay })
}

/** 升级概念会员（服务端每日限一次） */
export async function upgradeDayVip(): Promise<Record<string, unknown>> {
  return callYouthApi('get', '/youth/day/vip/upgrade')
}

/** 看广告领时长（每次约 +3 小时概念会员） */
export async function reportYouthAdPlay(): Promise<Record<string, unknown>> {
  return callYouthApi('post', '/youth/vip')
}

/** 会员详情（畅听 / 概念） */
export async function fetchUserVipDetail(): Promise<Record<string, unknown>> {
  return callYouthApi('get', '/user/vip/detail')
}

/** 概念版联合会员状态（备用） */
export async function fetchYouthUnionVip(): Promise<Record<string, unknown>> {
  return callYouthApi('get', '/youth/union/vip')
}
