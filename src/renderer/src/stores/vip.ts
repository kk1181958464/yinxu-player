/**
 * 概念版每日会员领取（逻辑移植自 echo-auto-vip）
 * https://github.com/YTDB0/echo-auto-vip
 */
import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'
import {
  claimDayVip,
  fetchUserVipDetail,
  fetchYouthUnionVip,
  getStoredUserid,
  reportYouthAdPlay,
  upgradeDayVip
} from '../api/kugou'

const SETTINGS_KEY = 'kugou_vip_settings'
const STATE_KEY = 'kugou_vip_state'

export interface VipSettings {
  enabled: boolean
  autoUpgrade: boolean
  futureDays: number
  receiveDay: string
  delaySeconds: number
  notify: boolean
  adHoursCount: number
}

export interface ClaimHistoryEntry {
  time: string
  ok: boolean
  message: string
}

interface ClaimedDate {
  ok: boolean
  already?: boolean
  time: string
}

interface VipPersistState {
  userid: string
  claimedDates: Record<string, ClaimedDate>
  lastUpgradeDate: string
  upgradedCount: number
  adLastDate: string
  adDoneToday: number
  history: ClaimHistoryEntry[]
  lastResult: string
  lastAttemptAt: string
}

export interface VipProductStatus {
  key: string
  label: string
  active: boolean
  endTime: string
}

export type ToastLevel = 'success' | 'warning' | 'info'

const DEFAULTS: VipSettings = {
  enabled: true,
  autoUpgrade: true,
  futureDays: 7,
  receiveDay: 'auto',
  delaySeconds: 8,
  notify: true,
  adHoursCount: 8
}

function emptyPersist(): VipPersistState {
  return {
    userid: '',
    claimedDates: {},
    lastUpgradeDate: '',
    upgradedCount: 0,
    adLastDate: '',
    adDoneToday: 0,
    history: [],
    lastResult: '',
    lastAttemptAt: ''
  }
}

function todayStr(): string {
  return formatDate(new Date())
}

function formatDate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function addDays(iso: string, n: number): string {
  const [y, m, d] = String(iso).split('-').map(Number)
  return formatDate(new Date(y, m - 1, d + n))
}

function localTimestamp(): string {
  const d = new Date()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${formatDate(d)} ${hh}:${mm}:${ss}`
}

export function formatEndTime(v: unknown): string {
  if (v === null || v === undefined || v === '') return ''
  let ts: number
  if (typeof v === 'number') ts = v > 1e12 ? v : v * 1000
  else if (/^\d{10}$/.test(String(v))) ts = Number(v) * 1000
  else if (/^\d{13}$/.test(String(v))) ts = Number(v)
  else {
    const d = new Date(String(v))
    return Number.isNaN(d.getTime()) ? String(v) : String(v)
  }
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return String(v)
  return `${formatDate(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, n))
}

function loadSettings(): VipSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return { ...DEFAULTS }
    const saved = JSON.parse(raw) as Partial<VipSettings>
    return {
      enabled: saved.enabled !== false,
      autoUpgrade: saved.autoUpgrade !== false,
      futureDays: clamp(Number(saved.futureDays), 0, 31),
      receiveDay: String(saved.receiveDay || 'auto').trim() || 'auto',
      delaySeconds: clamp(Number(saved.delaySeconds), 0, 60),
      notify: saved.notify !== false,
      adHoursCount: clamp(Number(saved.adHoursCount), 0, 8)
    }
  } catch {
    return { ...DEFAULTS }
  }
}

function loadPersist(): VipPersistState {
  try {
    const raw = localStorage.getItem(STATE_KEY)
    if (!raw) return emptyPersist()
    const saved = JSON.parse(raw) as Partial<VipPersistState>
    return {
      ...emptyPersist(),
      userid: String(saved.userid || ''),
      claimedDates:
        saved.claimedDates && typeof saved.claimedDates === 'object' ? saved.claimedDates : {},
      lastUpgradeDate: String(saved.lastUpgradeDate || ''),
      upgradedCount: Number(saved.upgradedCount) || 0,
      adLastDate: String(saved.adLastDate || ''),
      adDoneToday: Number(saved.adDoneToday) || 0,
      history: Array.isArray(saved.history) ? saved.history.slice(0, 12) : [],
      lastResult: String(saved.lastResult || ''),
      lastAttemptAt: String(saved.lastAttemptAt || '')
    }
  } catch {
    return emptyPersist()
  }
}

interface ParsedBody {
  ok: boolean
  code: number
  status: number
  msg: string
  data: unknown
}

function parseBody(body: unknown): ParsedBody {
  if (!body || typeof body !== 'object') {
    return { ok: false, code: -1, status: 0, msg: '空响应', data: null }
  }
  const rec = body as Record<string, unknown>
  const code = Number(rec.error_code ?? rec.errcode ?? 0)
  const status = Number(rec.status ?? 1)
  const ok = code === 0 && status !== 0
  const rawMsg = String(rec.error_msg || rec.errmsg || rec.msg || rec.message || rec.error || '')
  return {
    ok,
    code,
    status,
    msg: rawMsg || (ok ? '成功' : `错误码 ${code || status}`),
    data: rec.data ?? null
  }
}

function errorToParsed(err: unknown): ParsedBody {
  const ax = err as { response?: { data?: unknown }; message?: string }
  if (ax?.response?.data && typeof ax.response.data === 'object') return parseBody(ax.response.data)
  return { ok: false, code: -1, status: 0, msg: String(ax?.message || err), data: null }
}

function extractBusiVip(body: unknown): Record<string, unknown>[] | null {
  const stack: unknown[] = [body]
  const seen = new Set<unknown>()
  while (stack.length) {
    const cur = stack.pop()
    if (!cur || typeof cur !== 'object' || seen.has(cur)) continue
    seen.add(cur)
    if (Array.isArray(cur)) {
      stack.push(...cur)
      continue
    }
    for (const [k, v] of Object.entries(cur as Record<string, unknown>)) {
      if (k === 'busi_vip' && Array.isArray(v)) return v as Record<string, unknown>[]
      if (v && typeof v === 'object') stack.push(v)
    }
  }
  return null
}

function friendlyClaimResult(parsed: ParsedBody): string {
  const d = parsed.data && typeof parsed.data === 'object' ? (parsed.data as Record<string, unknown>) : {}
  const addDay = d.add_day ?? d.addDay ?? d.add_num ?? d.recharge_num ?? d.day
  const endTime = d.vip_end_time ?? d.vipEndTime ?? d.end_time
  let msg = parsed.msg === '成功' ? '领取成功' : parsed.msg
  if (parsed.ok && addDay !== undefined && addDay !== null) msg = `领取成功 +${addDay} 天`
  if (parsed.ok && endTime) msg += `，有效期至 ${formatEndTime(endTime)}`
  return msg
}

function isAlreadyClaimedMsg(msg: string): boolean {
  return /已领|已经领|重复领|领过/.test(msg)
}

function isNetworkError(parsed: ParsedBody): boolean {
  return parsed.code === -1 || /Request failed|network|timeout|ECONN|fetch|无法连接/i.test(parsed.msg)
}

function productLabel(type: unknown): string {
  if (type === 'tvip') return '畅听会员'
  if (type === 'svip') return '概念会员'
  if (type === 'dvip') return '豪华会员'
  if (type === 'qvip') return '超级会员'
  return String(type || '会员')
}

export const useVipStore = defineStore('vip', () => {
  const settings = reactive<VipSettings>(loadSettings())
  const persist = reactive<VipPersistState>(loadPersist())
  const claiming = ref(false)
  const progress = ref('')
  const vipText = ref('尚未查询')
  const products = ref<VipProductStatus[]>([])
  const vipLoading = ref(false)
  const toast = ref<{ level: ToastLevel; text: string } | null>(null)

  let claimTimer: ReturnType<typeof setTimeout> | null = null
  let toastTimer: ReturnType<typeof setTimeout> | null = null
  let aborted = false

  const todayClaimed = computed(() => Boolean(persist.claimedDates[todayStr()]?.ok))
  const claimedCount = computed(
    () => Object.values(persist.claimedDates).filter((x) => x && x.ok).length
  )
  const adDoneLabel = computed(() =>
    persist.adLastDate === todayStr() ? `${persist.adDoneToday} 次` : '未进行'
  )
  const summaryLine = computed(() => {
    if (products.value.length) {
      return products.value
        .map((p) => (p.active ? `${p.label}至 ${p.endTime || '未知'}` : `${p.label}未生效`))
        .join(' · ')
    }
    return vipText.value
  })

  function saveSettings(): void {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...settings }))
  }

  function savePersist(): void {
    localStorage.setItem(STATE_KEY, JSON.stringify({ ...persist }))
  }

  function bindUser(): void {
    const userid = getStoredUserid()
    if (userid && persist.userid && persist.userid !== userid) {
      Object.assign(persist, emptyPersist(), { userid })
      savePersist()
      return
    }
    if (userid && !persist.userid) {
      persist.userid = userid
      savePersist()
    }
  }

  function showToast(level: ToastLevel, text: string): void {
    if (!settings.notify) return
    toast.value = { level, text }
    if (toastTimer) clearTimeout(toastTimer)
    toastTimer = setTimeout(() => {
      toast.value = null
      toastTimer = null
    }, 5200)
  }

  function patchSettings(partial: Partial<VipSettings>): void {
    if (partial.enabled !== undefined) settings.enabled = Boolean(partial.enabled)
    if (partial.autoUpgrade !== undefined) settings.autoUpgrade = Boolean(partial.autoUpgrade)
    if (partial.futureDays !== undefined) settings.futureDays = clamp(Number(partial.futureDays), 0, 31)
    if (partial.receiveDay !== undefined)
      settings.receiveDay = String(partial.receiveDay).trim() || 'auto'
    if (partial.delaySeconds !== undefined)
      settings.delaySeconds = clamp(Number(partial.delaySeconds), 0, 60)
    if (partial.notify !== undefined) settings.notify = Boolean(partial.notify)
    if (partial.adHoursCount !== undefined)
      settings.adHoursCount = clamp(Number(partial.adHoursCount), 0, 8)
    saveSettings()
    if (settings.enabled && (partial.enabled || partial.delaySeconds !== undefined)) {
      scheduleAutoClaim()
    }
  }

  function cancelSchedule(): void {
    aborted = true
    if (claimTimer) {
      clearTimeout(claimTimer)
      claimTimer = null
    }
  }

  function scheduleAutoClaim(): void {
    cancelSchedule()
    aborted = false
    if (!settings.enabled) return
    const delay = Math.max(0, settings.delaySeconds) * 1000
    claimTimer = setTimeout(() => {
      claimTimer = null
      void claimRun(false)
    }, delay)
  }

  async function refreshVip(): Promise<void> {
    vipLoading.value = true
    vipText.value = '查询中…'
    try {
      let body = await fetchUserVipDetail()
      let list = extractBusiVip(body)
      if (!list || !list.length) {
        body = await fetchYouthUnionVip()
        list = extractBusiVip(body)
      }
      if (!list || !list.length) {
        products.value = []
        vipText.value = '未获取到会员信息'
        return
      }
      const next: VipProductStatus[] = []
      for (const item of list) {
        const type = item.product_type
        if (type !== 'tvip' && type !== 'svip') continue
        const active = Number(item.is_vip) === 1
        next.push({
          key: String(type),
          label: productLabel(type),
          active,
          endTime: active ? formatEndTime(item.vip_end_time) : ''
        })
      }
      products.value = next
      vipText.value = next.length
        ? next
            .map((p) =>
              p.active ? `${p.label}生效中，到期 ${p.endTime || '未知'}` : `${p.label}未生效`
            )
            .join('；')
        : '暂无畅听 / 概念会员记录'
    } catch (err) {
      const parsed = errorToParsed(err)
      products.value = []
      vipText.value = parsed.code === 20018 ? '未登录或登录已过期' : `查询失败：${parsed.msg}`
    } finally {
      vipLoading.value = false
    }
  }

  async function buildTargetDates(force: boolean): Promise<string[]> {
    const today = todayStr()
    const claimed = persist.claimedDates
    const targets: string[] = []
    for (let i = 0; i <= Math.max(0, settings.futureDays); i++) {
      const date = addDays(today, i)
      if (!force && claimed[date]?.ok) continue
      targets.push(date)
    }
    return targets
  }

  async function ensureAdHours(force: boolean): Promise<string> {
    const today = todayStr()
    const target = settings.adHoursCount
    if (target === 0) return ''
    if (!force && persist.adLastDate === today && persist.adDoneToday >= target) return ''

    let done = force ? 0 : persist.adLastDate === today ? persist.adDoneToday : 0
    let successes = 0
    let awardPer = 0
    let lastMsg = ''
    let first = true

    for (let i = done; i < target; i++) {
      if (aborted) break
      if (!first) {
        progress.value = `广告时长间隔等待（${i + 1}/${target}）`
        await sleep(35000)
        if (aborted) break
      }
      first = false
      progress.value = `正在领取广告时长 ${i + 1}/${target}`
      let parsed: ParsedBody
      try {
        parsed = parseBody(await reportYouthAdPlay())
      } catch (err) {
        parsed = errorToParsed(err)
      }
      if (parsed.ok) {
        successes++
        const d =
          parsed.data && typeof parsed.data === 'object'
            ? (parsed.data as Record<string, unknown>)
            : {}
        done = Number(d.done) || done + 1
        awardPer = Number(d.award_vip_hour) || awardPer
        persist.adLastDate = today
        persist.adDoneToday = done
        savePersist()
        if (Number(d.remain) <= 0) {
          lastMsg = `已达每日上限（${d.done}/${d.total}）`
          break
        }
      } else {
        lastMsg = parsed.msg
        break
      }
    }

    persist.adLastDate = today
    persist.adDoneToday = done
    savePersist()

    if (successes > 0) {
      const hours = successes * (awardPer || 3)
      let text = `概念会员时长 +${hours} 小时（今日累计 ${done} 次）`
      if (lastMsg) text += `，中断：${lastMsg}`
      return text
    }
    if (lastMsg) return `广告时长未成功：${lastMsg}`
    return ''
  }

  async function dailyUpgrade(force: boolean): Promise<string> {
    const today = todayStr()
    if (!force && persist.lastUpgradeDate === today) return ''
    progress.value = '正在升级概念会员'
    let parsed: ParsedBody
    try {
      parsed = parseBody(await upgradeDayVip())
    } catch (err) {
      parsed = errorToParsed(err)
    }
    if (parsed.ok) {
      persist.lastUpgradeDate = today
      persist.upgradedCount += 1
      savePersist()
      return '概念会员 +1 天'
    }
    if (parsed.code === 297002 || /已经领取过升级/.test(parsed.msg)) {
      persist.lastUpgradeDate = today
      savePersist()
      return '概念会员今日已升级过'
    }
    return `升级未成功：${parsed.msg}`
  }

  async function claimRun(force: boolean): Promise<{ ok: boolean; message: string }> {
    if (claiming.value) return { ok: false, message: '正在领取中，请稍候' }
    if (!force && !settings.enabled) return { ok: false, message: '自动领取未启用' }

    bindUser()
    aborted = false

    const targets = await buildTargetDates(force)
    const today = todayStr()
    const adSkip =
      settings.adHoursCount <= 0 ||
      (persist.adLastDate === today && persist.adDoneToday >= Math.min(8, settings.adHoursCount))
    const upSkip = !settings.autoUpgrade || persist.lastUpgradeDate === today

    const manual = String(settings.receiveDay || 'auto').trim()
    const dateList = manual && manual.toLowerCase() !== 'auto' ? [manual] : targets

    if (!force && !dateList.length && adSkip && upSkip) {
      return { ok: true, message: '本次无需处理：领取 / 时长 / 升级均已完成' }
    }

    claiming.value = true
    progress.value = '开始领取…'

    try {
      const claimedNew: string[] = []
      const alreadyKnown: string[] = []
      const failed: string[] = []
      let authExpired = false
      let networkFailed = false

      for (const date of dateList) {
        if (aborted) break
        progress.value = `正在领取畅听会员 ${date}`
        let parsed: ParsedBody
        try {
          parsed = parseBody(await claimDayVip(date))
        } catch (err) {
          parsed = errorToParsed(err)
        }

        if (parsed.ok) {
          claimedNew.push(date)
          persist.claimedDates[date] = { ok: true, time: new Date().toISOString() }
        } else if (parsed.code === 20018) {
          authExpired = true
          failed.push(`${date}: 登录已过期`)
          break
        } else if (parsed.code === 131001 || isAlreadyClaimedMsg(parsed.msg)) {
          alreadyKnown.push(date)
          persist.claimedDates[date] = {
            ok: true,
            already: true,
            time: new Date().toISOString()
          }
        } else if (isNetworkError(parsed)) {
          networkFailed = true
          failed.push(`${date}: ${parsed.msg}`)
          break
        } else {
          failed.push(`${date}: ${friendlyClaimResult(parsed)}`)
        }
      }

      if (dateList.length) savePersist()

      let adText = ''
      if (!networkFailed && !authExpired && !aborted) {
        try {
          adText = await ensureAdHours(force)
        } catch (e) {
          adText = `广告时长未成功：${e instanceof Error ? e.message : String(e)}`
        }
      }

      let upgradeText = ''
      if (!networkFailed && !authExpired && !aborted && settings.autoUpgrade) {
        try {
          upgradeText = await dailyUpgrade(force)
        } catch (e) {
          upgradeText = `升级未成功：${e instanceof Error ? e.message : String(e)}`
        }
      }

      const parts: string[] = []
      if (claimedNew.length) parts.push(`新领取 ${claimedNew.length} 天`)
      if (alreadyKnown.length) parts.push(`${alreadyKnown.length} 天已领过`)
      if (failed.length) parts.push(`失败 ${failed.length} 天`)
      if (!parts.length && (adText || upgradeText)) parts.push('畅听会员无变化')
      let message = parts.length ? parts.join('，') : '今日任务已完成'
      if (claimedNew.length) {
        message += `（${claimedNew[0]} ~ ${claimedNew[claimedNew.length - 1]}）`
      }
      if (adText) message += `；${adText}`
      if (upgradeText) message += `；${upgradeText}`
      if (authExpired) message = '酷狗登录已过期，请重新登录后再试'
      if (aborted) message = message ? `${message}（已中止）` : '已中止'

      if (
        claimedNew.length ||
        /概念会员 \+1/.test(upgradeText) ||
        /概念会员时长 \+/.test(adText)
      ) {
        showToast('success', `自动领会员：${message}`)
      } else if (authExpired || failed.length || /未成功/.test(message)) {
        showToast('warning', `自动领会员：${message}`)
      } else {
        showToast('info', `自动领会员：${message}`)
      }

      persist.history = [
        { time: localTimestamp(), ok: !authExpired && !failed.length && !networkFailed, message },
        ...persist.history
      ].slice(0, 12)
      persist.lastAttemptAt = new Date().toISOString()
      persist.lastResult = message
      savePersist()
      void refreshVip()
      return { ok: !authExpired && !networkFailed, message }
    } finally {
      claiming.value = false
      progress.value = ''
    }
  }

  async function claimNow(): Promise<void> {
    await claimRun(true)
  }

  function resetOnLogout(): void {
    cancelSchedule()
    claiming.value = false
    progress.value = ''
    toast.value = null
  }

  function dismissToast(): void {
    toast.value = null
    if (toastTimer) {
      clearTimeout(toastTimer)
      toastTimer = null
    }
  }

  return {
    settings,
    persist,
    claiming,
    progress,
    vipText,
    products,
    vipLoading,
    toast,
    todayClaimed,
    claimedCount,
    adDoneLabel,
    summaryLine,
    patchSettings,
    scheduleAutoClaim,
    cancelSchedule,
    refreshVip,
    claimNow,
    resetOnLogout,
    dismissToast
  }
})
