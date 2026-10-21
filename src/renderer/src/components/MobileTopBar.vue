<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { PhCaretLeft, PhMagnifyingGlass } from '@phosphor-icons/vue'
import { useAppStore } from '../stores/app'
import { initialOf } from '../utils/format'
import brandMark from '../assets/brand-mark.png'

const app = useAppStore()
const route = useRoute()
const router = useRouter()

const avatarFailed = ref(false)
watch(
  () => app.userPic,
  () => {
    avatarFailed.value = false
  }
)

const isPlaylist = computed(() => route.name === 'playlist')
const playlistName = computed(() => String(route.query.name || '歌单'))

function goBack(): void {
  if (window.history.length > 1) router.back()
  else void router.push({ name: 'library' })
}

function openSearch(): void {
  if (route.name !== 'search') void router.push({ name: 'search' })
}

function openLibrary(): void {
  if (route.name !== 'library') void router.push({ name: 'library' })
}
</script>

<template>
  <header class="mobile-topbar">
    <div class="mobile-topbar-left">
      <button
        v-if="isPlaylist"
        class="mobile-icon-btn"
        type="button"
        aria-label="返回"
        @click="goBack"
      >
        <PhCaretLeft :size="22" />
      </button>
      <span v-else class="mobile-brand-mark" aria-hidden="true">
        <img :src="brandMark" alt="" />
      </span>
      <span class="mobile-topbar-title">{{ isPlaylist ? playlistName : '音序' }}</span>
    </div>

    <div class="mobile-topbar-actions">
      <button
        v-if="route.name !== 'search'"
        class="mobile-icon-btn"
        type="button"
        title="搜索"
        aria-label="搜索"
        @click="openSearch"
      >
        <PhMagnifyingGlass :size="21" />
      </button>
      <button
        class="mobile-avatar"
        type="button"
        title="我的"
        aria-label="打开我的音乐"
        @click="openLibrary"
      >
        <img
          v-if="app.userPic && !avatarFailed"
          :src="app.userPic"
          alt=""
          @error="avatarFailed = true"
        />
        <span v-else>{{ initialOf(app.displayName) }}</span>
      </button>
    </div>
  </header>
</template>
