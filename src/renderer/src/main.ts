import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import './styles/main.css'
import './styles/mobile.css'
import { applyLayoutClass, applyPlatformClass, isCapacitorNative } from './utils/platform'

applyPlatformClass()
applyLayoutClass()

if (typeof window !== 'undefined') {
  const media = window.matchMedia('(max-width: 768px)')
  media.addEventListener('change', applyLayoutClass)
  window.addEventListener('orientationchange', applyLayoutClass)
}

async function initNativeChrome(): Promise<void> {
  if (!isCapacitorNative()) return
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar')
    await StatusBar.setStyle({ style: Style.Dark })
    await StatusBar.setBackgroundColor({ color: '#0b0b0d' })
  } catch (e) {
    console.warn('[native] StatusBar init skipped', e)
  }
}

void initNativeChrome()

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')