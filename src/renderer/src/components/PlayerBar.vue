<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import {
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
import { songTitle, songArtist, songCover } from '../api/kugou'

const player = usePlayerStore()

const queueOpen = ref(false)
const queuePanel = ref<HTMLElement | null>(null)

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

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') queueOpen.value = false
}

watch(queueOpen, async (open) => {
  if (open) {
    document.addEventListener('keydown', onKeydown)
    await nextTick()
    queuePanel.value?.focus()
  } else {
    document.removeEventListener('keydown', onKeydown)
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <footer class="player-bar">
    <div class="now-playing">
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
    </div>

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
        class="icon-btn"
        type="button"
        title="待播清单"
        aria-label="待播清单"
        :aria-expanded="queueOpen"
        @click="queueOpen = !queueOpen"
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
  </footer>
</template>
