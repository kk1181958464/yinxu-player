import { onBeforeUnmount, ref } from 'vue'
import {
  loginQrKey,
  loginQrCreate,
  loginQrCheck,
  finalizeQrLogin,
  finalizeCredentialLogin,
  sendCaptcha,
  loginCellphone,
  loginPassword,
  type AccountCandidate,
  type FinalizeLoginResult,
  type QrCheckResult
} from '../api/kugou'
import { useAppStore } from '../stores/app'

export type LoginTab = 'sms' | 'password' | 'qr'

/**
 * 登录流程（验证码 / 密码 / 扫码）
 * 登录成功与否以「能否拉取歌单」的探针为准，与后端接口保持一致。
 */
export function useLogin() {
  const app = useAppStore()

  const tab = ref<LoginTab>('sms')
  const busy = ref(false)
  const message = ref('')
  const error = ref('')

  const mobile = ref('')
  const smsCode = ref('')
  const smsSending = ref(false)
  const smsCountdown = ref(0)
  let smsTimer: ReturnType<typeof setInterval> | null = null

  const username = ref('')
  const password = ref('')

  const candidates = ref<AccountCandidate[]>([])
  const pendingMobile = ref('')
  const pendingCode = ref('')

  const qrImg = ref('')
  const qrLoading = ref(false)
  const polling = ref(false)
  let qrTimer: ReturnType<typeof setInterval> | null = null
  let currentKey = ''
  let checkInFlight = false

  function stopSmsTimer(): void {
    if (smsTimer) {
      clearInterval(smsTimer)
      smsTimer = null
    }
  }

  function stopPoll(): void {
    if (qrTimer) {
      clearInterval(qrTimer)
      qrTimer = null
    }
    polling.value = false
    checkInFlight = false
  }

  function clearFeedback(): void {
    message.value = ''
    error.value = ''
  }

  function normalizeQrImg(raw: string): string {
    if (!raw) return ''
    if (raw.startsWith('data:') || raw.startsWith('http')) return raw
    return `data:image/png;base64,${raw}`
  }

  function ensureApi(): boolean {
    if (app.apiReady) return true
    error.value = '本地音乐服务尚未就绪，请稍后重试'
    return false
  }

  async function handleFinalize(result: FinalizeLoginResult): Promise<void> {
    if (!result.ok) {
      error.value = result.warning || '登录未完成，请重试'
      return
    }
    await app.completeLogin()
    if (app.loggedIn) {
      message.value = '登录成功，正在进入…'
      error.value = ''
    } else {
      error.value = '登录状态校验失败，请重试'
    }
  }

  async function sendCode(): Promise<void> {
    clearFeedback()
    if (!ensureApi()) return
    const m = mobile.value.trim()
    if (!/^1\d{10}$/.test(m)) {
      error.value = '请输入 11 位手机号'
      return
    }
    if (smsCountdown.value > 0 || smsSending.value) return
    smsSending.value = true
    try {
      await sendCaptcha(m)
      message.value = '验证码已发送，请查看短信'
      smsCountdown.value = 60
      stopSmsTimer()
      smsTimer = setInterval(() => {
        smsCountdown.value -= 1
        if (smsCountdown.value <= 0) stopSmsTimer()
      }, 1000)
    } catch (e) {
      error.value = e instanceof Error ? e.message : '验证码发送失败'
    } finally {
      smsSending.value = false
    }
  }

  async function submitSms(userid?: string): Promise<void> {
    clearFeedback()
    if (!ensureApi()) return
    const m = (userid ? pendingMobile.value : mobile.value).trim()
    const code = (userid ? pendingCode.value : smsCode.value).trim()
    if (!/^1\d{10}$/.test(m)) {
      error.value = '请输入 11 位手机号'
      return
    }
    if (!code) {
      error.value = '请输入短信验证码'
      return
    }
    busy.value = true
    try {
      const res = await loginCellphone(m, code, userid)
      if (res.kind === 'choose' && res.candidates?.length) {
        pendingMobile.value = m
        pendingCode.value = code
        candidates.value = res.candidates
        message.value = '该手机号绑定多个账号，请选择一个继续'
        return
      }
      if (res.kind === 'ok' && res.data) {
        candidates.value = []
        const fin = await finalizeCredentialLogin(res.data)
        await handleFinalize(fin)
      } else {
        error.value = '登录失败，请重试'
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : '登录失败'
    } finally {
      busy.value = false
    }
  }

  async function submitPassword(): Promise<void> {
    clearFeedback()
    if (!ensureApi()) return
    const u = username.value.trim()
    const p = password.value
    if (!u || !p) {
      error.value = '请输入账号和密码'
      return
    }
    busy.value = true
    candidates.value = []
    try {
      const res = await loginPassword(u, p)
      if (res.kind === 'choose') {
        error.value = '该账号绑定了多个子账号，请改用验证码登录后选择'
        return
      }
      if (res.kind === 'ok' && res.data) {
        const fin = await finalizeCredentialLogin(res.data)
        await handleFinalize(fin)
      } else {
        error.value = '登录失败，请检查账号密码'
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : '登录失败'
      if (/20028|安全验证|需要验证/.test(msg)) {
        // 平台会对密码登录做风控，直接引导到验证码，避免用户反复试密码
        switchTab('sms')
        error.value = '密码登录被安全验证拦截，请改用「验证码」登录'
        return
      }
      error.value = msg
    } finally {
      busy.value = false
    }
  }

  function submit(): void {
    if (busy.value) return
    if (tab.value === 'sms') void submitSms()
    else if (tab.value === 'password') void submitPassword()
  }

  async function startQr(): Promise<void> {
    clearFeedback()
    if (!ensureApi()) return
    stopPoll()
    qrLoading.value = true
    qrImg.value = ''
    message.value = ''
    try {
      const keyRes = await loginQrKey()
      const key = keyRes.key
      if (!key) throw new Error('未能获取二维码凭证')
      currentKey = key

      let img = keyRes.qrcodeImg || ''
      if (!img) {
        const created = await loginQrCreate(key)
        img =
          created.base64 ||
          created.qrcode ||
          (created.url
            ? `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(created.url)}`
            : '')
      }
      qrImg.value = normalizeQrImg(img)
      if (!qrImg.value) throw new Error('二维码生成失败')
      polling.value = true

      qrTimer = setInterval(async () => {
        if (checkInFlight || !currentKey) return
        checkInFlight = true
        try {
          const res = await loginQrCheck(currentKey)
          await handleQrStatus(res)
        } catch (e) {
          message.value = e instanceof Error ? `等待扫码确认（${e.message}）` : '等待扫码确认…'
        } finally {
          checkInFlight = false
        }
      }, 1500)
    } catch (e) {
      error.value = e instanceof Error ? e.message : '二维码生成失败'
      message.value = ''
    } finally {
      qrLoading.value = false
    }
  }

  async function handleQrStatus(res: QrCheckResult): Promise<void> {
    if (res.status === 4) {
      stopPoll()
      message.value = '扫码成功，正在完成登录…'
      const fin = await finalizeQrLogin(res)
      await handleFinalize(fin)
      return
    }
    if (res.status === 2) {
      message.value = '已扫码，请在手机上确认登录'
      return
    }
    if (res.status === 1) {
      message.value = '等待扫码…'
      return
    }
    if (res.status === 0) {
      stopPoll()
      message.value = '二维码已过期，正在重新生成…'
      void startQr()
      return
    }
    message.value = res.message || '等待扫码…'
  }

  async function pickCandidate(c: AccountCandidate): Promise<void> {
    if (tab.value !== 'sms') return
    await submitSms(c.userid)
  }

  function switchTab(next: LoginTab): void {
    if (tab.value === next) return
    tab.value = next
    clearFeedback()
    candidates.value = []
    if (next === 'qr') {
      if (!qrImg.value && !qrLoading.value) void startQr()
    } else {
      stopPoll()
    }
  }

  onBeforeUnmount(() => {
    stopPoll()
    stopSmsTimer()
  })

  return {
    tab,
    busy,
    message,
    error,
    mobile,
    smsCode,
    smsSending,
    smsCountdown,
    username,
    password,
    candidates,
    qrImg,
    qrLoading,
    polling,
    sendCode,
    submit,
    startQr,
    pickCandidate,
    switchTab
  }
}
