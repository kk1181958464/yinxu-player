<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { PhArrowClockwise, PhPlay, PhWarningCircle } from '@phosphor-icons/vue'
import {
  fetchTopSongs,
  type SongItem,
  songTitle,
  songArtist,
  songAlbum,
  songCover,
  coverAt
} from '../api/kugou'
import { useAppStore } from '../stores/app'
import { usePlayerStore } from '../stores/player'
import { greeting } from '../utils/format'
import CoverArt from '../components/CoverArt.vue'
import MediaCard from '../components/MediaCard.vue'
import SongList from '../components/SongList.vue'

const app = useAppStore()
const player = usePlayerStore()

const songs = ref<SongItem[]>([])
const loading = ref(true)
const error = ref('')

const greetingText = computed(() => greeting())

const hero = computed(() => songs.value[0])
const shelf = computed(() => songs.value.slice(0, 6))
const heroCover = computed(() => (hero.value ? songCover(hero.value) : ''))
const heroBackdrop = computed(() => (heroCover.value ? coverAt(heroCover.value, 480) : ''))

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    songs.value = await fetchTopSongs()
  } catch (e) {
    error.value = e instanceof Error ? e.message : '推荐加载失败'
    songs.value = []
  } finally {
    loading.value = false
  }
}

function playHero(): void {
  if (hero.value) void player.playSong(hero.value, songs.value)
}

function playShelfSong(song: SongItem): void {
  void player.playSong(song, songs.value)
}

function playAll(): void {
  void player.playQueue(songs.value, 0)
}

onMounted(load)
</script>

<template>
  <div class="page">
    <header class="page-head">
      <h1 class="page-title">现在就听</h1>
      <p class="page-sub">{{ greetingText }}，{{ app.displayName }}。为你准备了今天的新鲜音乐。</p>
    </header>

    <template v-if="loading">
      <section class="hero hero-skeleton" aria-hidden="true">
        <div class="skeleton hero-cover" />
        <div class="hero-body">
          <div class="skeleton" style="width: 84px; height: 12px; margin-bottom: 14px" />
          <div class="skeleton" style="width: 52%; height: 34px; margin-bottom: 12px" />
          <div class="skeleton" style="width: 34%; height: 14px; margin-bottom: 22px" />
          <div class="skeleton" style="width: 180px; height: 36px; border-radius: 999px" />
        </div>
      </section>
      <section class="section">
        <div class="section-head">
          <div class="skeleton" style="width: 120px; height: 22px" />
        </div>
        <div class="shelf">
          <div v-for="i in 6" :key="i" class="media-card">
            <div class="skeleton media-art" />
            <div class="skeleton" style="height: 12px; width: 80%" />
          </div>
        </div>
      </section>
    </template>

    <section v-else-if="error" class="state-panel">
      <PhWarningCircle :size="28" />
      <h2>推荐加载失败</h2>
      <p>{{ error }}</p>
      <button class="btn btn-secondary" type="button" @click="load">
        <PhArrowClockwise :size="15" /> 重新加载
      </button>
    </section>

    <template v-else-if="hero">
      <section class="hero">
        <img v-if="heroBackdrop" class="hero-bg" :src="heroBackdrop" alt="" aria-hidden="true" />
        <CoverArt class="hero-cover" :src="heroCover" :alt="songTitle(hero)" :icon-size="36" />
        <div class="hero-body">
          <p class="hero-eyebrow">今日精选</p>
          <h2 class="hero-title">{{ songTitle(hero) }}</h2>
          <p class="hero-sub">
            {{ songArtist(hero) }}
            <span v-if="songAlbum(hero)"> · {{ songAlbum(hero) }}</span>
          </p>
          <div class="hero-actions">
            <button class="btn btn-primary" type="button" @click="playHero">
              <PhPlay :size="13" weight="fill" /> 播放
            </button>
            <button class="btn btn-glass" type="button" @click="playAll">
              播放全部 {{ songs.length }} 首
            </button>
          </div>
        </div>
      </section>

      <section class="section">
        <div class="section-head">
          <h2>新歌速递</h2>
          <button class="text-btn" type="button" @click="playAll">播放全部</button>
        </div>
        <div class="shelf">
          <MediaCard
            v-for="(s, i) in shelf"
            :key="(s.hash || '') + '-' + i"
            :title="songTitle(s)"
            :subtitle="songArtist(s)"
            :cover="songCover(s)"
            @activate="playShelfSong(s)"
          />
        </div>
      </section>

      <section class="section">
        <div class="section-head">
          <h2>全部新歌</h2>
          <span class="section-meta">{{ songs.length }} 首</span>
        </div>
        <SongList :songs="songs" />
      </section>
    </template>

    <section v-else class="state-panel">
      <h2>暂时没有推荐</h2>
      <p>稍后再来看看，或直接去搜索喜欢的歌曲。</p>
      <button class="btn btn-secondary" type="button" @click="load">重新加载</button>
    </section>
  </div>
</template>
