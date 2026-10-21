<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  PhCaretLeft,
  PhCaretRight,
  PhMagnifyingGlass
} from '@phosphor-icons/vue'
import WindowControls from './WindowControls.vue'
import { useAppStore } from '../stores/app'
import { useNavHistory } from '../composables/useNavHistory'
import { initialOf } from '../utils/format'
import { isDesktopShell } from '../utils/platform'
import brandMark from '../assets/brand-mark.png'

const app = useAppStore()
const route = useRoute()
const router = useRouter()
const { canGoBack, canGoForward, back, forward } = useNavHistory()
const desktop = isDesktopShell()

const keyword = ref('')
const avatarFailed = ref(false)

watch(
  () => app.userPic,
  () => {
    avatarFailed.value = false
  }
)

watch(
  () => route.query.q,
  (q) => {
    if (route.name === 'search') keyword.value = String(q || '')
  },
  { immediate: true }
)

function submitSearch(): void {
  const q = keyword.value.trim()
  if (!q) return
  void router.push({ name: 'search', query: { q } })
}

function onTitlebarDoubleClick(event: MouseEvent): void {
  const target = event.target as HTMLElement | null
  if (target?.closest('button, input, form, a')) return
  if (!desktop) return
  void window.kugou?.windowMaximize?.()
}
</script>

<template>
  <header class="titlebar" @dblclick="onTitlebarDoubleClick">
    <div class="titlebar-side">
      <div class="brand" aria-label="音序">
        <span class="brand-mark" aria-hidden="true">
          <img :src="brandMark" alt="" />
        </span>
        <span class="brand-name">音序</span>
      </div>
    </div>

    <div class="titlebar-main">
      <div class="nav-group">
        <button
          class="icon-btn"
          type="button"
          title="后退"
          aria-label="后退"
          :disabled="!canGoBack"
          @click="back"
        >
          <PhCaretLeft :size="16" />
        </button>
        <button
          class="icon-btn"
          type="button"
          title="前进"
          aria-label="前进"
          :disabled="!canGoForward"
          @click="forward"
        >
          <PhCaretRight :size="16" />
        </button>
      </div>

      <div class="toolbar-spacer" />

      <form class="toolbar-search" role="search" @submit.prevent="submitSearch">
        <PhMagnifyingGlass :size="15" aria-hidden="true" />
        <input
          v-model="keyword"
          type="search"
          placeholder="搜索音乐、艺人"
          aria-label="搜索音乐、艺人"
          spellcheck="false"
        />
      </form>

      <button
        class="account-chip"
        type="button"
        title="打开我的音乐"
        @click="router.push({ name: 'library' })"
      >
        <img
          v-if="app.userPic && !avatarFailed"
          class="account-avatar"
          :src="app.userPic"
          alt=""
          @error="avatarFailed = true"
        />
        <span v-else class="account-avatar account-initial">{{ initialOf(app.displayName) }}</span>
        <span class="account-name">{{ app.displayName }}</span>
      </button>

      <WindowControls v-if="desktop" />
    </div>
  </header>
</template>
