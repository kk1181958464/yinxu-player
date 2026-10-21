<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'
import { PhWarningCircle, PhX } from '@phosphor-icons/vue'
import TitleBar from './components/TitleBar.vue'
import Sidebar from './components/Sidebar.vue'
import PlayerBar from './components/PlayerBar.vue'
import MobileTopBar from './components/MobileTopBar.vue'
import MobilePlayerBar from './components/MobilePlayerBar.vue'
import MobileTabBar from './components/MobileTabBar.vue'
import Login from './views/Login.vue'
import { useAppStore } from './stores/app'
import { usePlayerStore } from './stores/player'
import { useVipStore } from './stores/vip'
import { isCapacitorNative, isDesktopShell } from './utils/platform'
import brandMark from './assets/brand-mark.png'

const app = useAppStore()
const player = usePlayerStore()
const vip = useVipStore()
const route = useRoute()
const router = useRouter()

const shell = ref<HTMLElement | null>(null)
const desktop = isDesktopShell()
let backHandler: { remove: () => void } | null = null

watch(
  () => route.fullPath,
  () => {
    shell.value?.querySelector('.content')?.scrollTo({ top: 0 })
  }
)

watch(
  () => app.loggedIn,
  (loggedIn) => {
    if (!loggedIn) {
      player.stop()
      vip.resetOnLogout()
      return
    }
    void vip.refreshVip()
    vip.scheduleAutoClaim()
  }
)

onMounted(async () => {
  void app.bootstrap()
  if (!isCapacitorNative()) return
  try {
    const { App: CapApp } = await import('@capacitor/app')
    backHandler = await CapApp.addListener('backButton', () => {
      // 先让播放弹层等组件处理返回；没人处理时再按页面层级返回
      const handled = !window.dispatchEvent(
        new CustomEvent('dsh:back', { cancelable: true })
      )
      if (handled) return
      if (route.name === 'playlist') {
        void router.push({ name: 'library' })
        return
      }
      if (route.name && route.name !== 'home') {
        void router.push({ name: 'home' })
        return
      }
      void CapApp.exitApp()
    })
  } catch (e) {
    console.warn('[native] backButton listener skipped', e)
  }
})

onBeforeUnmount(() => {
  backHandler?.remove()
  backHandler = null
})

</script>

<template>
  <div v-if="!app.ready" class="boot-screen">
    <div class="boot-mark" aria-hidden="true"><img :src="brandMark" alt="" /></div>
    <p class="boot-title">音序</p>
    <div class="boot-bar" aria-label="正在启动"><span /></div>
  </div>

  <div v-else-if="!app.apiReady" class="boot-screen boot-screen-error">
    <PhWarningCircle :size="34" />
    <h1>音乐服务未连接</h1>
    <p>{{ app.bootError }}</p>
    <button class="btn btn-primary" type="button" @click="app.retryBootstrap()">重新连接</button>
  </div>

  <Login v-else-if="!app.loggedIn" />

  <div v-else ref="shell" class="app-shell" :class="{ 'app-shell-desktop': desktop }">
    <TitleBar />
    <MobileTopBar />
    <Sidebar />
    <main class="content">
      <RouterView v-slot="{ Component }">
        <Transition name="page" mode="out-in">
          <component :is="Component" :key="route.path" />
        </Transition>
      </RouterView>
    </main>
    <PlayerBar />
    <MobilePlayerBar v-if="player.hasQueue" />
    <MobileTabBar />
    <div v-if="vip.toast" class="app-toast" :class="'app-toast-' + vip.toast.level" role="status">
      <p>{{ vip.toast.text }}</p>
      <button class="icon-btn" type="button" aria-label="关闭提示" @click="vip.dismissToast()">
        <PhX :size="14" />
      </button>
    </div>
  </div>
</template>