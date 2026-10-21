<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import {
  PhCaretDown,
  PhCircleNotch,
  PhPause,
  PhPlay,
  PhRepeat,
  PhRepeatOnce,
  PhShuffle,
  PhSkipBack,
  PhSkipForward
} from '@phosphor-icons/vue'
import CoverArt from './CoverArt.vue'
import { usePlayerStore } from '../stores/player'
import { formatClock } from '../utils/format'

const player = usePlayerStore()
const route = useRoute()

const expanded = ref(false)

const progressPct = computed(() => `${player.progress.toFixed(2)}%`)
const totalTime = computed(() => player.duration || 0)

const repeatTitle = computed(() => {
  if (player.repeat === 'one') return '单曲循环'
  if (player.repeat === 'all') return '列表循环'
  return '顺序播放'
})

function openSheet(): void {
  if (player.hasQueue) expanded.value = true
}

function closeSheet(): void {
  expanded.value = false
}

function onProgressInput(e: Event): void {
  player.seek(Number((e.target as HTMLInputElement).value))
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') closeSheet()
}

function onAndroidBack(e: Event): void {
  if (!expanded.value) return
  e.preventDefault()
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
  if (open) document.addEventListener('keydown', onKeydown)
  else document.removeEventListener('keydown', onKeydown)
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

  <Transition name="sheet">
    <div v-if="expanded" class="player-sheet-layer">
      <section class="player-sheet" role="dialog" aria-modal="true" aria-label="正在播放">
        <header class="player-sheet-head">
          <span>正在播放</span>
          <button class="icon-btn" type="button" aria-label="收起" @click="closeSheet">
            <PhCaretDown :size="20" />
          </button>
        </header>

        <div class="player-sheet-art">
          <CoverArt :src="player.cover" :alt="player.title" :icon-size="42" />
        </div>

        <div class="player-sheet-meta">
          <h2>{{ player.title }}</h2>
          <p>{{ player.artist }}</p>
        </div>

        <div v-if="player.error" class="player-sheet-error">{{ player.error }}</div>

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
            :class="{ on: player.shuffle }"
            type="button"
            title="随机播放"
            aria-label="随机播放"
            :aria-pressed="player.shuffle"
            @click="player.toggleShuffle()"
          >
            <PhShuffle :size="20" />
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
            :class="{ on: player.repeat !== 'off' }"
            type="button"
            :title="repeatTitle"
            :aria-label="repeatTitle"
            @click="player.cycleRepeat()"
          >
            <PhRepeatOnce v-if="player.repeat === 'one'" :size="20" />
            <PhRepeat v-else :size="20" />
          </button>
        </div>
      </section>
    </div>
  </Transition>
</template>
