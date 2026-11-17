<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { PhArrowClockwise, PhPlay, PhWarningCircle } from '@phosphor-icons/vue'
import {
  fetchTopSongsPage,
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
const featured = ref<SongItem[]>([])
const loading = ref(true)
const error = ref('')
const page = ref(1)
const pageSize = ref(20)
const total = ref(0)
const pageLoading = ref(false)
const pageError = ref('')
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))

const greetingText = computed(() => greeting())

const hero = computed(() => featured.value[0])
const shelf = computed(() => featured.value.slice(0, 6))
const heroCover = computed(() => (hero.value ? songCover(hero.value) : ''))
const heroBackdrop = computed(() => (heroCover.value ? coverAt(heroCover.value, 480) : ''))

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  pageError.value = ''
  page.value = 1
  total.value = 0
  try {
    const result = await fetchTopSongsPage(1, pageSize.value)
    songs.value = result.songs
    featured.value = result.songs
    page.value = result.page
    pageSize.value = result.pagesize
    total.value = result.total
  } catch (e) {
    error.value = e instanceof Error ? e.message : '推荐加载失败'
    songs.value = []
    featured.value = []
  } finally {
    loading.value = false
  }
}

async function goToPage(target: number): Promise<void> {
  if (loading.value || pageLoading.value) return
  const nextPage = Math.min(Math.max(1, target), pageCount.value)
  if (nextPage === page.value) return
  pageLoading.value = true
  pageError.value = ''
  try {
    const result = await fetchTopSongsPage(nextPage, pageSize.value)
    songs.value = result.songs
    page.value = result.page
    pageSize.value = result.pagesize
    total.value = result.total
    await nextTick()
    document.querySelector('.home-all-songs')?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  } catch (e) {
    pageError.value = e instanceof Error ? e.message : '翻页失败'
  } finally {
    pageLoading.value = false
  }
}

function playHero(): void {
  if (hero.value) void player.playSong(hero.value, featured.value)
}

function playShelfSong(song: SongItem): void {
  void player.playSong(song, featured.value)
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

      <section class="section home-all-songs">
        <div class="section-head">
          <h2>全部新歌</h2>
          <span class="section-meta">{{ total ? `共 ${total} 首` : `${songs.length} 首` }}</span>
        </div>
        <SongList :songs="songs" />
        <nav v-if="songs.length && total > pageSize" class="search-pager home-pager" aria-label="全部新歌分页">
          <button
            class="btn btn-secondary"
            type="button"
            :disabled="page <= 1 || pageLoading"
            @click="goToPage(page - 1)"
          >
            上一页
          </button>
          <span class="search-pager-info">
            {{ pageLoading ? '加载中…' : `第 ${page} / ${pageCount} 页` }}
          </span>
          <button
            class="btn btn-secondary"
            type="button"
            :disabled="page >= pageCount || pageLoading"
            @click="goToPage(page + 1)"
          >
            下一页
          </button>
        </nav>
        <p v-if="pageError" class="form-error search-page-error">{{ pageError }}</p>
      </section>
    </template>

    <section v-else class="state-panel">
      <h2>暂时没有推荐</h2>
      <p>稍后再来看看，或直接去搜索喜欢的歌曲。</p>
      <button class="btn btn-secondary" type="button" @click="load">重新加载</button>
    </section>
  </div>
</template>
