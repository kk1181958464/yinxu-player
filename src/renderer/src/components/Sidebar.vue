<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter, type RouteLocationRaw } from 'vue-router'
import {
  PhArrowClockwise,
  PhCrown,
  PhHouse,
  PhMagnifyingGlass,
  PhSignOut
} from '@phosphor-icons/vue'
import CoverArt from './CoverArt.vue'
import { useAppStore } from '../stores/app'
import { useVipStore } from '../stores/vip'
import type { PlaylistItem } from '../api/kugou'
import { initialOf } from '../utils/format'

const app = useAppStore()
const vip = useVipStore()
const route = useRoute()
const router = useRouter()

const vipMeta = computed(() => {
  const active = vip.products.filter((p) => p.active).map((p) => p.label)
  if (active.length) return active.join(' · ')
  return '已登录'
})

const navItems = [
  { name: 'home', label: '首页', icon: PhHouse },
  { name: 'search', label: '搜索', icon: PhMagnifyingGlass },
  { name: 'vip', label: '会员', icon: PhCrown }
] as const

function isPlaylistActive(p: PlaylistItem): boolean {
  if (route.name !== 'playlist') return false
  const listid = String(route.query.listid || '')
  const gid = String(route.query.gid || route.params.id || '')
  return Boolean((listid && p.listid === listid) || (gid && p.globalCollectionId === gid))
}

function playlistTo(p: PlaylistItem): RouteLocationRaw {
  const id = p.listid || p.globalCollectionId || '0'
  return {
    name: 'playlist',
    params: { id },
    query: {
      listid: p.listid || undefined,
      gid: p.globalCollectionId || undefined,
      name: p.name || undefined,
      cover: p.cover || undefined,
      type: String(p.type ?? 0)
    }
  }
}

async function logout(): Promise<void> {
  await app.logout()
  void router.push({ name: 'home' })
}
</script>

<template>
  <aside class="sidebar">
    <nav class="sidebar-nav" aria-label="主导航">
      <p class="side-label">浏览</p>
      <RouterLink
        v-for="item in navItems"
        :key="item.name"
        class="side-item"
        :class="{ active: route.name === item.name }"
        :to="{ name: item.name }"
      >
        <component :is="item.icon" :size="17" :weight="route.name === item.name ? 'fill' : 'regular'" />
        <span>{{ item.label }}</span>
      </RouterLink>
    </nav>

    <section class="sidebar-library">
      <div class="side-label-row">
        <p class="side-label">你的歌单</p>
        <button
          class="mini-btn"
          type="button"
          title="刷新歌单"
          aria-label="刷新歌单"
          :disabled="app.playlistsLoading"
          @click="app.loadPlaylists()"
        >
          <PhArrowClockwise :size="13" :class="{ spinning: app.playlistsLoading }" />
        </button>
      </div>

      <div v-if="app.playlistsLoading && !app.playlists.length" class="side-skeletons" aria-hidden="true">
        <div v-for="i in 5" :key="i" class="side-skeleton">
          <span class="skeleton side-skeleton-art" />
          <span class="skeleton side-skeleton-line" />
        </div>
      </div>

      <p v-else-if="app.playlistsError" class="side-hint side-hint-error">
        歌单加载失败
        <button class="link-btn" type="button" @click="app.loadPlaylists()">重试</button>
      </p>
      <p v-else-if="!app.playlists.length" class="side-hint">暂无歌单，登录账号 创建后会出现在这里</p>

      <div v-else class="side-playlists">
        <RouterLink
          v-for="p in app.playlists"
          :key="(p.listid || '') + '-' + (p.globalCollectionId || '')"
          class="side-playlist"
          :class="{ active: isPlaylistActive(p) }"
          :to="playlistTo(p)"
          :title="p.name"
        >
          <CoverArt class="side-playlist-cover" :src="p.cover" :alt="p.name" :icon-size="11" />
          <span class="side-playlist-name">{{ p.name }}</span>
        </RouterLink>
      </div>
    </section>

    <div class="sidebar-footer">
      <RouterLink class="side-account" :to="{ name: 'library' }">
        <img v-if="app.userPic" class="side-avatar" :src="app.userPic" alt="" />
        <span v-else class="side-avatar side-avatar-initial">{{ initialOf(app.displayName) }}</span>
        <span class="side-account-text">
          <span class="side-account-name">{{ app.displayName }}</span>
          <span class="side-account-meta">{{ vipMeta }}</span>
        </span>
      </RouterLink>
      <button class="mini-btn" type="button" title="退出登录" aria-label="退出登录" @click="logout">
        <PhSignOut :size="15" />
      </button>
    </div>
  </aside>
</template>
