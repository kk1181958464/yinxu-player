<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import {
  PhCaretDown,
  PhCircleNotch,
  PhImage,
  PhPause,
  PhPlay,
  PhQueue,
  PhRepeat,
  PhRepeatOnce,
  PhShuffle,
  PhSkipBack,
  PhSkipForward,
  PhTextAa,
  PhX
} from '@phosphor-icons/vue'
import CoverArt from './CoverArt.vue'
import { usePlayerStore } from '../stores/player'
import { formatClock } from '../utils/format'
import { fetchLyricText, songArtist, songCover, songTitle } from '../api/kugou'
import { parseLyric, type LyricLine } from '../utils/lyric'
import { useLyricAutoScroll } from '../composables/useLyricAutoScroll'

const player = usePlayerStore()
const route = useRoute()

const expanded = ref(false)
const queueOpen = ref(false)
const showLyrics = ref(false)

const progressPct = computed(() => `${player.progress.toFixed(2)}%`)
const totalTime = computed(() => player.duration || 0)

const currentSong = computed(() => player.queue[player.currentIndex] || null)

const lyricLines = ref<LyricLine[]>([])
const lyricLoading = ref(false)
const lyricError = ref('')
const lyricBox = ref<HTMLElement | null>(null)
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
  if (!expanded.value || !song) {
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

watch(
  [expanded, () => currentSong.value?.hash],
  ([open]) => {
    if (open) {
      void loadLyrics()
    } else {
      lyricEpoch += 1
      lyricLines.value = []
      lyricLoading.value = false
      lyricError.value = ''
    }
  },
  { immediate: true }
)

useLyricAutoScroll(lyricBox, '.lyric-line', activeLyricIndex, () => expanded.value && showLyrics.value)

const playModeTitle = computed(() => {
  if (player.playMode === 'shuffle') return '随机播放'
  if (player.playMode === 'one') return '单曲循环'
  return '列表循环'
})

function openSheet(): void {
  if (player.hasQueue) expanded.value = true
}

function closeSheet(): void {
  queueOpen.value = false
  showLyrics.value = false
  expanded.value = false
}

function toggleQueue(): void {
  if (!player.hasQueue) return
  queueOpen.value = !queueOpen.value
}

function selectQueueSong(index: number): void {
  const song = player.queue[index]
  if (!song) return
  queueOpen.value = false
  void player.playSong(song)
}

function onProgressInput(e: Event): void {
  player.seek(Number((e.target as HTMLInputElement).value))
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return
  if (queueOpen.value) {
    queueOpen.value = false
    return
  }
  if (showLyrics.value) {
    showLyrics.value = false
    return
  }
  closeSheet()
}

function onAndroidBack(e: Event): void {
  if (queueOpen.value) {
    e.preventDefault()
    queueOpen.value = false
    return
  }
  if (!expanded.value) return
  e.preventDefault()
  if (showLyrics.value) {
    showLyrics.value = false
    return
  }
  closeSheet()
}

onMounted(() => {
  window.addEventListener('dsh:back', onAndroidBack)
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  window.removeEventListener('dsh:back', onAndroidBack)
})

watch(expanded, (open) => {
  if (open) {
    document.addEventListener('keydown', onKeydown)
  } else {
    queueOpen.value = false
    showLyrics.value = false
    document.removeEventListener('keydown', onKeydown)
  }
})

watch(
  () => route.fullPath,
  () => closeSheet()
)

watch(
  () => player.hasQueue,
  (hasQueue) => {
    if (!hasQueue) closeSheet()
  }
)
</script>

<template>
  <footer class="mobile-player">
    <div class="mobile-player-progress" aria-hidden="true">
      <span :style="{ width: progressPct }" />
    </div>

    <button
      class="mobile-player-main"
      type="button"
      :aria-label="`打开正在播放：${player.title}`"
      @click="openSheet"
    >
      <CoverArt class="mobile-player-cover" :src="player.cover" :alt="player.title" :icon-size="18" />
      <span class="mobile-player-text">
        <span class="mobile-player-title">{{ player.title }}</span>
        <span class="mobile-player-sub" :class="{ 'is-error': player.error }">
          {{ player.error || player.artist }}
        </span>
      </span>
    </button>

    <button
      class="mobile-player-btn mobile-player-toggle"
      type="button"
      :title="player.playing ? '暂停' : '播放'"
      :aria-label="player.playing ? '暂停' : '播放'"
      :disabled="!player.hasQueue"
      @click="player.toggle()"
    >
      <PhCircleNotch v-if="player.loading" :size="19" class="spinning" />
      <PhPause v-else-if="player.playing" :size="18" weight="fill" />
      <PhPlay v-else :size="18" weight="fill" />
    </button>
    <button
      class="mobile-player-btn"
      type="button"
      title="下一首"
      aria-label="下一首"
      :disabled="!player.hasQueue"
      @click="player.next()"
    >
      <PhSkipForward :size="22" weight="fill" />
    </button>
  </footer>

  <Transition name="sheet" :duration="{ enter: 380, leave: 260 }">
    <div v-if="expanded" class="player-sheet-layer">
      <section class="player-sheet" role="dialog" aria-modal="true" aria-label="正在播放">
        <header class="player-sheet-head">
          <span>正在播放</span>
          <div class="sheet-head-actions">
            <button
              class="quality-pill"
              :class="{ high: player.quality === 320 }"
              type="button"
              :title="player.quality === 320 ? '当前：高品 320kbps，点击切换标准' : '当前：标准 128kbps，点击切换高品'"
              :aria-label="player.quality === 320 ? '音质：高品 320kbps，点击切换标准' : '音质：标准 128kbps，点击切换高品'"
              @click="player.toggleQuality()"
            >
              {{ player.quality === 320 ? '高品' : '标准' }}
            </button>
            <button class="icon-btn" type="button" aria-label="收起" @click="closeSheet">
              <PhCaretDown :size="20" />
            </button>
          </div>
        </header>

        <div class="player-sheet-stage">
          <Transition name="stage-fade">
            <div v-show="!showLyrics" class="sheet-cover-view" @click="showLyrics = true">
              <div class="player-sheet-art">
                <CoverArt :src="player.cover" :alt="player.title" :icon-size="42" />
              </div>

              <div class="player-sheet-meta">
                <h2>{{ player.title }}</h2>
                <p>{{ player.artist }}</p>
              </div>

              <div v-if="player.error" class="player-sheet-error">{{ player.error }}</div>

              <p class="sheet-cover-hint">
                <PhTextAa :size="14" />
                轻点封面查看歌词
              </p>
            </div>
          </Transition>

          <Transition name="stage-fade">
            <div v-show="showLyrics" class="sheet-lyrics-view" @click="showLyrics = false">
              <header class="sheet-lyrics-head">
                <span>歌词</span>
                <button class="sheet-cover-back" type="button" @click.stop="showLyrics = false">
                  <PhImage :size="14" />
                  封面
                </button>
              </header>
              <div ref="lyricBox" class="player-sheet-lyrics" aria-label="歌词">
                <div v-if="lyricLoading" class="lyric-empty">歌词加载中…</div>
                <div v-else-if="lyricError" class="lyric-empty">{{ lyricError }}</div>
                <div v-else-if="!lyricLines.length" class="lyric-empty">暂无歌词</div>
                <div v-else class="lyric-lines">
                  <p
                    v-for="(line, i) in lyricLines"
                    :key="`${line.time}-${i}`"
                    class="lyric-line"
                    :class="{ active: i === activeLyricIndex }"
                    @click.stop="seekLyric(line.time)"
                  >
                    {{ line.text }}
                  </p>
                </div>
              </div>
            </div>
          </Transition>
        </div>

        <div class="player-sheet-progress">
          <input
            class="slider"
            type="range"
            min="0"
            :max="totalTime"
            step="0.1"
            :value="player.currentTime"
            :style="{ '--fill': progressPct }"
            aria-label="播放进度"
            :disabled="!player.hasQueue"
            @input="onProgressInput"
          />
          <div class="player-sheet-times">
            <span>{{ formatClock(player.currentTime) }}</span>
            <span>{{ formatClock(totalTime) }}</span>
          </div>
        </div>

        <div class="player-sheet-controls">
          <button
            class="icon-btn"
            :class="{ on: player.playMode !== 'order' }"
            type="button"
            :title="playModeTitle"
            :aria-label="playModeTitle"
            @click="player.cyclePlayMode()"
          >
            <PhRepeat v-if="player.playMode === 'order'" :size="20" />
            <PhShuffle v-else-if="player.playMode === 'shuffle'" :size="20" />
            <PhRepeatOnce v-else :size="20" />
          </button>
          <button class="sheet-skip" type="button" title="上一首" aria-label="上一首" @click="player.prev()">
            <PhSkipBack :size="26" weight="fill" />
          </button>
          <button
            class="sheet-play"
            type="button"
            :title="player.playing ? '暂停' : '播放'"
            :aria-label="player.playing ? '暂停' : '播放'"
            :disabled="!player.hasQueue"
            @click="player.toggle()"
          >
            <PhCircleNotch v-if="player.loading" :size="22" class="spinning" />
            <PhPause v-else-if="player.playing" :size="21" weight="fill" />
            <PhPlay v-else :size="21" weight="fill" />
          </button>
          <button class="sheet-skip" type="button" title="下一首" aria-label="下一首" @click="player.next()">
            <PhSkipForward :size="26" weight="fill" />
          </button>
          <button
            class="icon-btn"
            :class="{ on: queueOpen }"
            type="button"
            title="播放列表"
            aria-label="播放列表"
            :aria-expanded="queueOpen"
            @click="toggleQueue"
          >
            <PhQueue :size="20" />
          </button>
        </div>

        <Transition name="mobile-queue" :duration="250">
          <div v-if="queueOpen" class="mobile-queue-layer">
            <button
              class="mobile-queue-scrim"
              type="button"
              aria-label="关闭播放列表"
              @click="queueOpen = false"
            />
            <section class="mobile-queue-panel" role="dialog" aria-modal="true" aria-label="播放列表">
              <header class="mobile-queue-head">
                <div>
                  <h3>播放列表</h3>
                  <span>{{ player.queue.length }} 首</span>
                </div>
                <button class="icon-btn" type="button" aria-label="关闭" @click="queueOpen = false">
                  <PhX :size="20" />
                </button>
              </header>
              <div class="mobile-queue-list">
                <button
                  v-for="(s, i) in player.queue"
                  :key="(s.hash || '') + '-' + i"
                  class="mobile-queue-item"
                  :class="{ active: i === player.currentIndex }"
                  type="button"
                  @click="selectQueueSong(i)"
                >
                  <CoverArt class="mobile-queue-cover" :src="songCover(s)" :alt="songTitle(s)" :icon-size="14" />
                  <span class="mobile-queue-text">
                    <span class="mobile-queue-title">{{ songTitle(s) }}</span>
                    <span class="mobile-queue-artist">{{ songArtist(s) }}</span>
                  </span>
                  <span v-if="i === player.currentIndex" class="mobile-queue-badge">播放中</span>
                </button>
              </div>
            </section>
          </div>
        </Transition>
      </section>
    </div>
  </Transition>
</template>
