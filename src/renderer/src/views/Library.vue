<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useRouter, type RouteLocationRaw } from 'vue-router'
import {
  PhArrowClockwise,
  PhCrown,
  PhPlaylist,
  PhSignOut,
  PhWarningCircle
} from '@phosphor-icons/vue'
import MediaCard from '../components/MediaCard.vue'
import { useAppStore } from '../stores/app'
import { useVipStore } from '../stores/vip'
import type { PlaylistItem } from '../api/kugou'
import { initialOf } from '../utils/format'

const app = useAppStore()
const vip = useVipStore()
const router = useRouter()

const avatarFailed = ref(false)
watch(
  () => app.userPic,
  () => {
    avatarFailed.value = false
  }
)

function openPlaylist(p: PlaylistItem): void {
  const id = p.listid || p.globalCollectionId || '0'
  const target: RouteLocationRaw = {
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
  void router.push(target)
}

async function logout(): Promise<void> {
  await app.logout()
  void router.push({ name: 'home' })
}

onMounted(() => {
  if (!app.playlists.length && !app.playlistsLoading) void app.loadPlaylists()
  if (!vip.products.length && !vip.vipLoading) void vip.refreshVip()
})
</script>

<template>
  <div class="page">
    <header class="profile-head">
      <div class="profile-avatar">
        <img
          v-if="app.userPic && !avatarFailed"
          :src="app.userPic"
          alt=""
          @error="avatarFailed = true"
        />
        <span v-else>{{ initialOf(app.displayName) }}</span>
      </div>
      <div class="profile-info">
        <h1 class="profile-name">{{ app.displayName }}</h1>
        <div class="profile-meta">
          <span v-if="app.userid" class="profile-uid">UID {{ app.userid }}</span>
          <span class="pill">已登录</span>
          <span v-for="p in vip.products.filter((x) => x.active)" :key="p.key" class="pill">{{ p.label }}</span>
        </div>
      </div>
      <div class="profile-actions">
        <button
          class="btn btn-secondary"
          type="button"
          :disabled="app.playlistsLoading"
          @click="app.loadPlaylists()"
        >
          <PhArrowClockwise :size="15" :class="{ spinning: app.playlistsLoading }" />
          {{ app.playlistsLoading ? '同步中' : '刷新歌单' }}
        </button>
        <button class="btn btn-ghost" type="button" @click="router.push({ name: 'vip' })">
          <PhCrown :size="15" /> 会员
        </button>
        <button class="btn btn-ghost" type="button" @click="logout">
          <PhSignOut :size="15" /> 退出登录
        </button>
      </div>
    </header>

    <section class="section">
      <div class="section-head">
        <h2>我的歌单</h2>
        <span class="section-meta">{{ app.playlists.length }} 个</span>
      </div>

      <div v-if="app.playlistsLoading && !app.playlists.length" class="playlist-grid" aria-hidden="true">
        <div v-for="i in 6" :key="i" class="media-card">
          <div class="skeleton media-art" />
          <div class="skeleton" style="height: 12px; width: 76%" />
          <div class="skeleton" style="height: 10px; width: 40%" />
        </div>
      </div>

      <section v-else-if="app.playlistsError" class="state-panel">
        <PhWarningCircle :size="28" />
        <h2>歌单同步失败</h2>
        <p>{{ app.playlistsError }}</p>
        <button class="btn btn-secondary" type="button" @click="app.loadPlaylists()">
          <PhArrowClockwise :size="15" /> 重试
        </button>
      </section>

      <section v-else-if="!app.playlists.length" class="state-panel">
        <PhPlaylist :size="28" />
        <h2>还没有歌单</h2>
        <p>在手机音乐 App 中创建或收藏歌单后，这里会自动同步。</p>
        <button class="btn btn-secondary" type="button" @click="app.loadPlaylists()">
          <PhArrowClockwise :size="15" /> 刷新
        </button>
      </section>

      <div v-else class="playlist-grid">
        <MediaCard
          v-for="p in app.playlists"
          :key="(p.listid || '') + '-' + (p.globalCollectionId || '')"
          :title="p.name"
          :subtitle="`${p.count} 首歌曲`"
          :cover="p.cover"
          @activate="openPlaylist(p)"
        />
      </div>
    </section>

    <section class="legal">
      <h2>关于与免责声明</h2>
      <p>
        本项目是第三方非官方音乐客户端，接口来自开源音乐接口，仅供学习与研究使用。
        音乐版权归权利人所有，请遵守音乐平台用户协议与当地法律法规，不要用于商业用途。
      </p>
    </section>
  </div>
</template>
