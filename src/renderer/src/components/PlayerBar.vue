<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  PhCircleNotch,
  PhMusicNote,
  PhPause,
  PhPlay,
  PhQueue,
  PhRepeat,
  PhRepeatOnce,
  PhShuffle,
  PhSkipBack,
  PhSkipForward,
  PhSpeakerHigh,
  PhSpeakerLow,
  PhSpeakerSlash,
  PhX
} from '@phosphor-icons/vue'
import CoverArt from './CoverArt.vue'
import { usePlayerStore } from '../stores/player'
import { formatClock } from '../utils/format'
import { songTitle, songArtist, songCover, fetchLyricText } from '../api/kugou'
import { parseLyric, type LyricLine } from '../utils/lyric'

const player = usePlayerStore()
const router = useRouter()

const queueOpen = ref(false)
const queuePanel = ref<HTMLElement | null>(null)

const lyricsOpen = ref(false)
const lyricsPanel = ref<HTMLElement | null>(null)
const lyricViewport = ref<HTMLElement | null>(null)
const lyricLines = ref<LyricLine[]>([])
const lyricLoading = ref(false)
const lyricError = ref('')
const lyricCache = new Map<string, LyricLine[]>()
let lyricEpoch = 0

const currentSong = computed(() => player.queue[player.currentIndex] || null)

const activeLyricIndex = computed(() => {
  const now = player.currentTime + 0.25
  let index = -1
  for (let i = 0; i < lyricLines.value.length; i += 1) {
    if (lyricLines.value[i].time <= now) index = i
    else break
  }
  return index
})

const progressPct = computed(() => `${player.progress.toFixed(2)}%`)
const volumePct = computed(() =>
  `${((player.muted ? 0 : player.volume) * 100).toFixed(0)}%`
)

const totalTime = computed(() => player.duration || 0)

const volumeIcon = computed(() => {
  if (player.muted || player.volume === 0) return PhSpeakerSlash
  if (player.volume < 0.5) return PhSpeakerLow
  return PhSpeakerHigh
})

const repeatTitle = computed(() => {
  if (player.repeat === 'one') return '单曲循环'
  if (player.repeat === 'all') return '列表循环'
  return '顺序播放'
})

function onProgressInput(e: Event): void {
  const target = e.target as HTMLInputElement
  player.seek(Number(target.value))
}

function onVolumeInput(e: Event): void {
  const target = e.target as HTMLInputElement
  player.setVolume(Number(target.value) / 100)
}

function playFromQueue(index: number): void {
  const song = player.queue[index]
  if (song) void player.playSong(song)
}

function openNowPlaying(): void {
  if (!player.hasQueue) return
  void router.push({ name: 'now-playing' })
}

function openQueue(): void {
  lyricsOpen.value = false
  queueOpen.value = !queueOpen.value
}

function openLyrics(): void {
  queueOpen.value = false
  lyricsOpen.value = !lyricsOpen.value
}

async function loadLyrics(): Promise<void> {
  const song = currentSong.value
  if (!lyricsOpen.value || !song) {
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

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    queueOpen.value = false
    lyricsOpen.value = false
  }
}

watch([queueOpen, lyricsOpen], async ([queue, lyrics]) => {
  if (queue || lyrics) {
    document.addEventListener('keydown', onKeydown)
    await nextTick()
    if (queue) queuePanel.value?.focus()
    else if (lyrics) lyricsPanel.value?.focus()
  } else {
    document.removeEventListener('keydown', onKeydown)
  }
})

watch(
  [lyricsOpen, () => currentSong.value?.hash],
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

watch(activeLyricIndex, async (index) => {
  if (!lyricsOpen.value || index < 0 || !lyricViewport.value) return
  await nextTick()
  const view = lyricViewport.value
  const line = view.querySelectorAll<HTMLElement>('.lyrics-line')[index]
  if (!view || !line) return
  const viewRect = view.getBoundingClientRect()
  const lineRect = line.getBoundingClientRect()
  const top =
    view.scrollTop +
    (lineRect.top - viewRect.top) -
    view.clientHeight / 2 +
    line.clientHeight / 2
  view.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <footer class="player-bar">
    <button
      class="now-playing"
      type="button"
      :disabled="!player.hasQueue"
      aria-label="打开正在播放详情"
      @click="openNowPlaying"
    >
      <CoverArt
        v-if="player.hasQueue"
        class="np-cover"
        :src="player.cover"
        :alt="player.title"
        :icon-size="20"
      />
      <span v-else class="np-cover np-empty-art" aria-hidden="true">
        <PhMusicNote :size="20" weight="fill" />
      </span>
      <div class="np-meta">
        <div class="np-title">{{ player.hasQueue ? player.title : '未在播放' }}</div>
        <div
          class="np-artist"
          :class="{ 'np-error': player.error }"
          :title="player.error || player.artist"
        >
          {{ player.error || player.artist || '从首页或搜索中挑一首歌' }}
        </div>
      </div>
    </button>

    <div class="np-center">
      <div class="np-controls">
        <button
          class="icon-btn"
          :class="{ on: player.shuffle }"
          type="button"
          title="随机播放"
          aria-label="随机播放"
          :aria-pressed="player.shuffle"
          @click="player.toggleShuffle()"
        >
          <PhShuffle :size="16" />
        </button>
        <button
          class="icon-btn"
          type="button"
          title="上一首"
          aria-label="上一首"
          :disabled="!player.hasQueue"
          @click="player.prev()"
        >
          <PhSkipBack :size="17" weight="fill" />
        </button>
        <button
          class="play-btn"
          type="button"
          :title="player.playing ? '暂停' : '播放'"
          :aria-label="player.playing ? '暂停' : '播放'"
          :disabled="!player.hasQueue"
          @click="player.toggle()"
        >
          <PhCircleNotch v-if="player.loading" :size="17" class="spinning" />
          <PhPause v-else-if="player.playing" :size="16" weight="fill" />
          <PhPlay v-else :size="16" weight="fill" />
        </button>
        <button
          class="icon-btn"
          type="button"
          title="下一首"
          aria-label="下一首"
          :disabled="!player.hasQueue"
          @click="player.next()"
        >
          <PhSkipForward :size="17" weight="fill" />
        </button>
        <button
          class="icon-btn"
          :class="{ on: player.repeat !== 'off' }"
          type="button"
          :title="repeatTitle"
          :aria-label="repeatTitle"
          @click="player.cycleRepeat()"
        >
          <PhRepeatOnce v-if="player.repeat === 'one'" :size="16" />
          <PhRepeat v-else :size="16" />
        </button>
      </div>

      <div class="np-progress">
        <span class="np-time">{{ formatClock(player.currentTime) }}</span>
        <input
          class="slider np-slider"
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
        <span class="np-time">{{ formatClock(totalTime) }}</span>
      </div>
    </div>

    <div class="np-extra">
      <span class="np-queue-count">{{ player.hasQueue ? `${player.currentIndex + 1} / ${player.queue.length}` : '' }}</span>
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
      <button
        class="icon-btn"
        :class="{ on: queueOpen }"
        type="button"
        title="待播清单"
        aria-label="待播清单"
        :aria-expanded="queueOpen"
        @click="openQueue"
      >
        <PhQueue :size="17" />
      </button>
      <div class="volume">
        <button
          class="icon-btn"
          type="button"
          :title="player.muted ? '取消静音' : '静音'"
          :aria-label="player.muted ? '取消静音' : '静音'"
          @click="player.toggleMute()"
        >
          <component :is="volumeIcon" :size="16" />
        </button>
        <input
          class="slider volume-slider"
          type="range"
          min="0"
          max="100"
          step="1"
          :value="player.muted ? 0 : Math.round(player.volume * 100)"
          :style="{ '--fill': volumePct }"
          aria-label="音量"
          @input="onVolumeInput"
        />
      </div>
    </div>

    <Transition name="queue">
      <div v-if="queueOpen" class="queue-layer">
        <button class="queue-scrim" type="button" aria-label="关闭待播清单" @click="queueOpen = false" />
        <section
          ref="queuePanel"
          class="queue-panel"
          role="dialog"
          aria-label="待播清单"
          tabindex="-1"
        >
          <header class="queue-head">
            <div>
              <h2>待播清单</h2>
              <p>{{ player.hasQueue ? `${player.queue.length} 首歌曲` : '暂无歌曲' }}</p>
            </div>
            <button class="icon-btn" type="button" title="关闭" aria-label="关闭" @click="queueOpen = false">
              <PhX :size="15" />
            </button>
          </header>
          <div v-if="!player.hasQueue" class="queue-empty">从首页或搜索中挑一首歌开始播放</div>
          <div v-else class="queue-list">
            <button
              v-for="(s, i) in player.queue"
              :key="(s.hash || '') + '-' + i"
              class="queue-item"
              :class="{ active: i === player.currentIndex }"
              type="button"
              @click="playFromQueue(i)"
            >
              <CoverArt class="queue-cover" :src="songCover(s)" :alt="songTitle(s)" :icon-size="12" />
              <span class="queue-text">
                <span class="queue-title">{{ songTitle(s) }}</span>
                <span class="queue-artist">{{ songArtist(s) }}</span>
              </span>
              <span v-if="i === player.currentIndex" class="queue-badge">播放中</span>
            </button>
          </div>
        </section>
      </div>
    </Transition>

    <Transition name="queue">
      <div v-if="lyricsOpen" class="queue-layer">
        <button class="queue-scrim" type="button" aria-label="关闭歌词" @click="lyricsOpen = false" />
        <section
          ref="lyricsPanel"
          class="queue-panel lyrics-panel"
          role="dialog"
          aria-label="歌词"
          tabindex="-1"
        >
          <header class="queue-head">
            <div>
              <h2>歌词</h2>
              <p class="lyrics-sub">
                {{ player.hasQueue ? `${player.title} · ${player.artist}` : '暂无播放' }}
              </p>
            </div>
            <button class="icon-btn" type="button" title="关闭" aria-label="关闭" @click="lyricsOpen = false">
              <PhX :size="15" />
            </button>
          </header>
          <div ref="lyricViewport" class="lyrics-viewport">
            <div v-if="lyricLoading" class="lyrics-empty">歌词加载中…</div>
            <div v-else-if="lyricError" class="lyrics-empty">{{ lyricError }}</div>
            <div v-else-if="!lyricLines.length" class="lyrics-empty">暂无歌词</div>
            <div v-else class="lyrics-lines">
              <p
                v-for="(line, i) in lyricLines"
                :key="`${line.time}-${i}`"
                class="lyrics-line"
                :class="{ active: i === activeLyricIndex }"
                @click="seekLyric(line.time)"
              >
                {{ line.text }}
              </p>
            </div>
          </div>
        </section>
      </div>
    </Transition>
  </footer>
</template>
