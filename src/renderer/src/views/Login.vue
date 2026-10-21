<script setup lang="ts">
import { onMounted, ref } from 'vue'
import {
  PhArrowClockwise,
  PhCircleNotch,
  PhDeviceMobile,
  PhEye,
  PhEyeSlash,
  PhLockKey,
  PhMusicNotes,
  PhQrCode,
  PhShieldCheck,
  PhWarningCircle
} from '@phosphor-icons/vue'
import WindowControls from '../components/WindowControls.vue'
import { useLogin } from '../composables/useLogin'
import { useAppStore } from '../stores/app'
import { fetchTopSongs, songCover } from '../api/kugou'
import { initialOf } from '../utils/format'
import { isDesktopShell } from '../utils/platform'
import brandMark from '../assets/brand-mark.png'

const app = useAppStore()
const desktop = isDesktopShell()

const {
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
  sendCode,
  submit,
  startQr,
  pickCandidate,
  switchTab
} = useLogin()

const showPassword = ref(false)
const art = ref<string[]>([])

function onChromeDoubleClick(event: MouseEvent): void {
  const target = event.target as HTMLElement | null
  if (target?.closest('button')) return
  if (!desktop) return
  void window.kugou?.windowMaximize?.()
}

onMounted(async () => {
  if (!app.apiReady) return
  try {
    const songs = await fetchTopSongs()
    art.value = songs
      .slice(0, 9)
      .map((s) => songCover(s))
      .filter(Boolean)
  } catch {
    art.value = []
  }
})
</script>

<template>
  <div class="login-screen">
    <div class="login-ambient" aria-hidden="true">
      <div v-if="art.length" class="login-art-grid">
        <img v-for="(src, i) in art" :key="i" :src="src" alt="" />
      </div>
      <div class="login-scrim" />
    </div>

    <div v-if="desktop" class="login-chrome" @dblclick="onChromeDoubleClick">
      <WindowControls />
    </div>

    <main class="login-main">
      <section class="login-brand">
        <div class="login-appicon" aria-hidden="true">
          <img :src="brandMark" alt="" />
        </div>
        <p class="login-kicker">第三方音乐客户端</p>
        <h1 class="login-title">音乐，<br />现在就开始。</h1>
        <p class="login-lead">
          登录后即可进入，并同步你的账号歌单。账号凭证只留在本机，随时可以退出。
        </p>
        <ul class="login-points">
          <li><PhShieldCheck :size="16" /><span>登录凭证仅保存在本机</span></li>
          <li><PhMusicNotes :size="16" /><span>登录后同步账号歌单</span></li>
        </ul>
        <p class="login-footnote">非官方客户端 · 仅供学习研究</p>
      </section>

      <section class="login-panel" aria-labelledby="login-heading">
        <header class="login-panel-head">
          <h2 id="login-heading">登录音序</h2>
          <p>使用音乐账号继续</p>
        </header>

        <div class="segmented" role="tablist" aria-label="选择登录方式">
          <button
            class="segmented-item"
            :class="{ active: tab === 'sms' }"
            type="button"
            role="tab"
            :aria-selected="tab === 'sms'"
            @click="switchTab('sms')"
          >
            <PhDeviceMobile :size="15" /> 验证码
          </button>
          <button
            class="segmented-item"
            :class="{ active: tab === 'password' }"
            type="button"
            role="tab"
            :aria-selected="tab === 'password'"
            @click="switchTab('password')"
          >
            <PhLockKey :size="15" /> 密码
          </button>
          <button
            class="segmented-item"
            :class="{ active: tab === 'qr' }"
            type="button"
            role="tab"
            :aria-selected="tab === 'qr'"
            @click="switchTab('qr')"
          >
            <PhQrCode :size="15" /> 扫码
          </button>
        </div>

        <form v-if="tab === 'sms'" class="login-form" @submit.prevent="submit">
          <div class="field">
            <label class="field-label" for="login-mobile">手机号</label>
            <input
              id="login-mobile"
              v-model="mobile"
              type="tel"
              inputmode="numeric"
              maxlength="11"
              placeholder="11 位手机号"
              autocomplete="tel"
              :disabled="busy"
            />
          </div>
          <div class="field">
            <label class="field-label" for="login-code">短信验证码</label>
            <span class="field-inline">
              <input
                id="login-code"
                v-model="smsCode"
                type="text"
                inputmode="numeric"
                maxlength="8"
                placeholder="验证码"
                autocomplete="one-time-code"
                :disabled="busy"
              />
              <button
                class="btn btn-secondary sms-btn"
                type="button"
                :disabled="smsSending || smsCountdown > 0 || busy"
                @click="sendCode"
              >
                {{ smsCountdown > 0 ? `${smsCountdown} 秒` : smsSending ? '发送中' : '获取验证码' }}
              </button>
            </span>
          </div>
          <button class="btn btn-primary btn-block" type="submit" :disabled="busy">
            <PhCircleNotch v-if="busy" :size="16" class="spinning" />
            {{ busy ? '正在登录' : '登录' }}
          </button>
        </form>

        <form v-else-if="tab === 'password'" class="login-form" @submit.prevent="submit">
          <div class="field">
            <label class="field-label" for="login-account">账号</label>
            <input
              id="login-account"
              v-model="username"
              type="text"
              placeholder="用户名 / 邮箱 / 手机号"
              autocomplete="username"
              :disabled="busy"
            />
          </div>
          <div class="field">
            <label class="field-label" for="login-password">密码</label>
            <span class="field-inline field-control">
              <input
                id="login-password"
                v-model="password"
                :type="showPassword ? 'text' : 'password'"
                placeholder="输入密码"
                autocomplete="current-password"
                :disabled="busy"
              />
              <button
                class="field-action"
                type="button"
                :aria-label="showPassword ? '隐藏密码' : '显示密码'"
                @click="showPassword = !showPassword"
              >
                <PhEyeSlash v-if="showPassword" :size="16" />
                <PhEye v-else :size="16" />
              </button>
            </span>
          </div>
          <button class="btn btn-primary btn-block" type="submit" :disabled="busy">
            <PhCircleNotch v-if="busy" :size="16" class="spinning" />
            {{ busy ? '正在登录' : '登录' }}
          </button>
          <p class="form-note">密码登录可能触发安全验证，失败时会自动切到验证码登录。</p>
        </form>

        <div v-else class="login-form qr-pane">
          <div class="qr-frame">
            <img v-if="qrImg" :src="qrImg" alt="登录二维码" />
            <div v-else class="qr-empty">
              <PhQrCode :size="36" />
              <span>{{ qrLoading ? '正在生成二维码' : '二维码尚未生成' }}</span>
            </div>
          </div>
          <p class="qr-hint">使用手机音乐 App 扫码。扫码登录可能无法同步歌单，建议使用验证码登录。</p>
          <p v-if="message && !error" class="qr-status" aria-live="polite">{{ message }}</p>
          <button class="btn btn-secondary btn-block" type="button" :disabled="qrLoading" @click="startQr">
            <PhArrowClockwise :size="15" :class="{ spinning: qrLoading }" />
            {{ qrImg ? '刷新二维码' : '生成二维码' }}
          </button>
        </div>

        <div v-if="candidates.length" class="candidate-list">
          <p class="candidate-title">该手机号绑定了多个账号，请选择</p>
          <button
            v-for="c in candidates"
            :key="c.userid"
            class="candidate-item"
            type="button"
            @click="pickCandidate(c)"
          >
            <img v-if="c.pic" class="candidate-avatar" :src="c.pic" alt="" />
            <span v-else class="candidate-avatar candidate-initial">{{ initialOf(c.nickname) }}</span>
            <span class="candidate-text">
              <span class="candidate-name">{{ c.nickname }}</span>
              <span class="candidate-uid">UID {{ c.userid }}</span>
            </span>
          </button>
        </div>

        <p v-if="message && !error && tab !== 'qr'" class="form-note" aria-live="polite">{{ message }}</p>
        <p v-if="error" class="form-error" role="alert">
          <PhWarningCircle :size="15" />
          <span>{{ error }}</span>
        </p>

        <p class="login-legal">
          登录即表示你同意遵守音乐平台用户协议与当地法律法规。本应用为非官方学习用途客户端，
          不会领取会员或刷取权益。
        </p>
      </section>
    </main>
  </div>
</template>
