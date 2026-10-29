<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  PhCaretLeft
} from '@phosphor-icons/vue'
import CoverArt from '../components/CoverArt.vue'
import { usePlayerStore } from '../stores/player'
import { fetchLyricText } from '../api/kugou'
import { parseLyric, type LyricLine } from '../utils/lyric'
import { useLyricAutoScroll } from '../composables/useLyricAutoScroll'

const player = usePlayerStore()
const router = useRouter()

const currentSong = computed(() => player.queue[player.currentIndex] || null)

const lyricLines = ref<LyricLine[]>([])
const lyricLoading = ref(false)
const lyricError = ref('')
const lyricsViewport = ref<HTMLElement | null>(null)
const lyricCache = new Map<string, LyricLine[]>()
let lyricEpoch = 0

const activeLyricIndex = computed(() => {
  const now = player.currentTime + 0.25
  let index = -1
  for (let i = 0; i < lyricLines.value.length; i += 1) {
    if (lyricLines.value[i].time <= now) index = i
    else break
  }
  return index
})

async function loadLyrics(): Promise<void> {
  const song = currentSong.value
  if (!song) {
    lyricLines.value = []
    lyricLoading.value = false
    lyricError.value = ''
    return
  }

  const cacheKey = song.hash || `${player.title}::${player.artist}`
  const cached = lyricCache.get(cacheKey)
  if (cached) {
    lyricLines.value = cached
    lyricLoading.value = false
    lyricError.value = ''
    return
  }

  const epoch = ++lyricEpoch
  lyricLoading.value = true
  lyricError.value = ''
  lyricLines.value = []
  try {
    const raw = await fetchLyricText(song)
    if (epoch !== lyricEpoch) return
    const lines = parseLyric(raw)
    lyricCache.set(cacheKey, lines)
    lyricLines.value = lines
  } catch {
    if (epoch !== lyricEpoch) return
    lyricLines.value = []
    lyricError.value = '歌词加载失败'
  } finally {
    if (epoch === lyricEpoch) lyricLoading.value = false
  }
}

function seekLyric(time: number): void {
  player.seek(time)
}

function goBack(): void {
  if (window.history.length > 1) router.back()
  else void router.push({ name: 'home' })
}

watch(
  () => currentSong.value?.hash,
  () => {
    void loadLyrics()
  },
  { immediate: true }
)

useLyricAutoScroll(lyricsViewport, '.now-page-lyric-line', activeLyricIndex)

onBeforeUnmount(() => {
  lyricEpoch += 1
})
</script>

<template>
  <section
    class="now-page"
    :style="{ '--now-cover': player.cover ? `url(${player.cover})` : 'none' }"
  >
    <div class="now-page-glow" aria-hidden="true" />

    <header class="now-page-head">
      <button class="icon-btn" type="button" aria-label="返回" @click="goBack">
        <PhCaretLeft :size="18" />
      </button>
      <span class="now-page-kicker">正在播放</span>
    </header>

    <div v-if="!currentSong" class="now-page-empty">
      <CoverArt class="now-page-empty-art" :icon-size="28" />
      <h1>还没有正在播放的歌曲</h1>
      <p>从首页、搜索或歌单里选一首歌开始播放。</p>
      <button class="btn btn-primary" type="button" @click="router.push({ name: 'home' })">
        去首页看看
      </button>
    </div>

    <div v-else class="now-page-body">
      <aside class="now-page-art">
        <CoverArt class="now-page-cover" :src="player.cover" :alt="player.title" :icon-size="64" />
        <h1>{{ player.title }}</h1>
        <p class="now-page-artist">{{ player.artist }}</p>
        <div v-if="player.error" class="now-page-error">{{ player.error }}</div>
      </aside>

      <section class="now-page-lyrics-wrap" aria-label="歌词">
        <header class="now-page-lyrics-head">
          <span>歌词</span>
          <span v-if="lyricLines.length">{{ lyricLines.length }} 行</span>
        </header>
        <div ref="lyricsViewport" class="now-page-lyrics">
          <div v-if="lyricLoading" class="now-page-lyric-empty">歌词加载中…</div>
          <div v-else-if="lyricError" class="now-page-lyric-empty">{{ lyricError }}</div>
          <div v-else-if="!lyricLines.length" class="now-page-lyric-empty">暂无歌词</div>
          <div v-else class="now-page-lyric-lines">
            <p
              v-for="(line, i) in lyricLines"
              :key="`${line.time}-${i}`"
              class="now-page-lyric-line"
              :class="{ active: i === activeLyricIndex }"
              @click="seekLyric(line.time)"
            >
              {{ line.text }}
            </p>
          </div>
        </div>
      </section>
    </div>
  </section>
</template>
