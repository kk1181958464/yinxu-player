<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  PhCamera,
  PhCircleNotch,
  PhMusicNotes,
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
  busy,
  message,
  error,
  profileRequired,
  profileBusy,
  profileError,
  profileNickname,
  profileGender,
  profilePic,
  mobile,
  smsCode,
  smsSending,
  smsCountdown,
  candidates,
  sendCode,
  submit,
  pickCandidate,
  completeProfile,
  skipProfile
} = useLogin()

const art = ref<string[]>([])
const avatarInput = ref<HTMLInputElement | null>(null)
const profileAvatar = ref('')
const avatarPreview = computed(() => profileAvatar.value || profilePic.value || brandMark)

function onAvatarChange(event: Event): void {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  if (!file.type.startsWith('image/')) {
    profileError.value = '请选择图片文件'
    return
  }
  profileError.value = ''
  const reader = new FileReader()
  reader.onload = () => {
    const src = String(reader.result || '')
    const image = new Image()
    image.onload = () => {
      const max = 256
      const scale = Math.min(1, max / Math.max(image.width, image.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(image.width * scale))
      canvas.height = Math.max(1, Math.round(image.height * scale))
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        profileAvatar.value = src
        return
      }
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
      profileAvatar.value = canvas.toDataURL('image/jpeg', 0.86)
    }
    image.onerror = () => {
      profileAvatar.value = src
    }
    image.src = src
  }
  reader.readAsDataURL(file)
}

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
          <p>手机号验证码登录 · 登录后同步歌单</p>
        </header>

        <form class="login-form" @submit.prevent="submit">
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

        <p v-if="message && !error" class="form-note" aria-live="polite">{{ message }}</p>
        <p v-if="error" class="form-error" role="alert">
          <PhWarningCircle :size="15" />
          <span>{{ error }}</span>
        </p>

        <p class="login-register-note">新用户直接使用手机号验证码登录，即自动注册。</p>

        <p class="login-legal">
          登录即表示你同意遵守音乐平台用户协议与当地法律法规。本应用为非官方学习用途客户端，
          不会领取会员或刷取权益。
        </p>
      </section>
    </main>

    <div v-if="profileRequired" class="profile-layer">
      <section
        class="profile-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-title"
      >
        <header class="profile-head">
          <h3 id="profile-title">完善资料</h3>
          <p>首次登录，设置头像和昵称后即可开始使用。</p>
        </header>

        <button class="profile-avatar" type="button" @click="avatarInput?.click()">
          <img :src="avatarPreview" alt="头像预览" />
          <span class="profile-avatar-edit"><PhCamera :size="15" /></span>
        </button>
        <input
          ref="avatarInput"
          class="profile-file"
          type="file"
          accept="image/*"
          @change="onAvatarChange"
        />

        <label class="profile-field">
          <span>昵称</span>
          <input
            v-model="profileNickname"
            type="text"
            maxlength="20"
            placeholder="给自己起个昵称"
            :disabled="profileBusy"
          />
        </label>

        <div class="profile-field">
          <span>性别</span>
          <div class="profile-gender">
            <button
              type="button"
              :class="{ active: profileGender === 1 }"
              @click="profileGender = 1"
            >
              男
            </button>
            <button
              type="button"
              :class="{ active: profileGender === 2 }"
              @click="profileGender = 2"
            >
              女
            </button>
            <button
              type="button"
              :class="{ active: profileGender === 0 }"
              @click="profileGender = 0"
            >
              保密
            </button>
          </div>
        </div>

        <p v-if="profileError" class="form-error" role="alert">
          <PhWarningCircle :size="15" />
          <span>{{ profileError }}</span>
        </p>

        <div class="profile-actions">
          <button
            class="btn btn-primary"
            type="button"
            :disabled="profileBusy"
            @click="completeProfile(profileAvatar)"
          >
            <PhCircleNotch v-if="profileBusy" :size="16" class="spinning" />
            {{ profileBusy ? '保存中' : '完成并进入' }}
          </button>
          <button class="btn btn-ghost" type="button" :disabled="profileBusy" @click="skipProfile">
            跳过
          </button>
        </div>
      </section>
    </div>
  </div>
</template>
